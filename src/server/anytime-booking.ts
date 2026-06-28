import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { get, query, run } from "./db.js";
import { addMinutes, nextIdentifier } from "./helpers.js";
import { getDefaultCurrency } from "./settings.js";
import { generateTimeSlots, timeToMinutes } from "../shared/offerings.js";
import { assertRegularBookingAllowed } from "./event-override.js";
import { findOrCreateClient } from "./clients.js";
import { parseRequiredBookingEmail } from "../shared/email.js";
import { backfillServiceSlugs, loadServiceAddons } from "./services.js";
import { scheduleBookingConfirmation } from "./notifications.js";
import { runtimeEnv } from "./runtime-env.js";
import { isStripePaymentsActive } from "./stripe-payments-settings.js";
import type { StripeEnv } from "./stripe.js";
import {
  createAnytimeBookingCheckout,
  finalizeAnytimeBookingCheckout,
  loadPendingAnytimeHolds,
} from "./anytime-payments.js";
import {
  offeringCheckoutAmount,
  offeringRequiresPayment,
  resolveOfferingDeposit,
  type PaymentChoice,
} from "../shared/payment.js";

const ErrorSchema = z.object({ error: z.string() });

const BUSINESS_OPEN = "09:00";
const BUSINESS_CLOSE = "18:00";
const BOOKING_DAYS_AHEAD = 30;

export type ServiceRow = {
  id: number;
  name: string;
  slug: string;
  description: string;
  duration: number;
  price: number;
  color: string;
  category: string;
  active: number;
  allow_addons: number;
};

type PublicService = {
  id: number;
  name: string;
  slug: string;
  description: string;
  duration: number;
  price: number;
  color: string;
  category: string;
  allow_addons: number;
  addons: { id: number; name: string; price: number; extra_duration: number }[];
};

function rangesOverlap(start1: string, end1: string, start2: string, end2: string): boolean {
  const s1 = timeToMinutes(start1);
  const e1 = timeToMinutes(end1);
  const s2 = timeToMinutes(start2);
  const e2 = timeToMinutes(end2);
  return s1 < e2 && s2 < e1;
}

function staffScheduleConflict(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return true;
  return a === b;
}

async function toPublicService(service: ServiceRow): Promise<PublicService> {
  const addons = service.allow_addons
    ? await loadServiceAddons(service.id)
    : [];
  return {
    id: service.id,
    name: service.name,
    slug: service.slug,
    description: service.description,
    duration: service.duration,
    price: service.price,
    color: service.color,
    category: service.category,
    allow_addons: service.allow_addons ?? 0,
    addons: addons.map((a) => ({
      id: a.id,
      name: a.name,
      price: a.price,
      extra_duration: a.extra_duration,
    })),
  };
}

function upcomingDates(count = BOOKING_DAYS_AHEAD): string[] {
  const dates: string[] = [];
  const cursor = new Date();
  for (let i = 0; i < count; i += 1) {
    dates.push(cursor.toISOString().split("T")[0]);
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

async function loadActiveServices(slug?: string): Promise<ServiceRow[]> {
  await backfillServiceSlugs();
  if (slug) {
    const row = await get<ServiceRow>(
      "SELECT * FROM services WHERE slug = ? AND active = 1",
      [slug],
    );
    return row ? [row] : [];
  }
  return query<ServiceRow>("SELECT * FROM services WHERE active = 1 ORDER BY name ASC");
}

export async function resolveServiceAddons(
  service: ServiceRow,
  addonIds: number[],
): Promise<{ addonPrice: number; extraDuration: number; selectedAddons: { id: number; price: number }[] }> {
  const uniqueAddonIds = [...new Set(addonIds)];
  if (uniqueAddonIds.length === 0) {
    return { addonPrice: 0, extraDuration: 0, selectedAddons: [] };
  }
  if (!service.allow_addons) {
    throw new Error("Extras are not available for this service");
  }
  const addons = await query<{ id: number; price: number; extra_duration: number }>(
    `SELECT id, price, extra_duration FROM service_addons
     WHERE service_id = ? AND active = 1 AND id IN (${uniqueAddonIds.map(() => "?").join(",")})`,
    [service.id, ...uniqueAddonIds],
  );
  if (addons.length !== uniqueAddonIds.length) {
    throw new Error("One or more extras are invalid for this service");
  }
  let addonPrice = 0;
  let extraDuration = 0;
  const selectedAddons: { id: number; price: number }[] = [];
  for (const addon of addons) {
    addonPrice += addon.price;
    extraDuration += addon.extra_duration;
    selectedAddons.push({ id: addon.id, price: addon.price });
  }
  return { addonPrice, extraDuration, selectedAddons };
}

async function computeAvailableSlots(
  date: string,
  duration: number,
): Promise<{ start_time: string; end_time: string; staff_id: number | null }[]> {
  const staff = await query<{ id: number }>("SELECT id FROM staff WHERE active = 1 ORDER BY id");

  const appointments = await query<{ staff_id: number | null; start_time: string; end_time: string }>(
    `SELECT staff_id, start_time, end_time FROM appointments
     WHERE scheduled_date = ? AND status != 'cancelled'
       AND (offering_slot_instance_id IS NULL OR offering_slot_instance_id = 0)`,
    [date],
  );

  const blocked = await query<{ staff_id: number; start_time: string; end_time: string }>(
    "SELECT staff_id, start_time, end_time FROM blocked_slots WHERE blocked_date = ?",
    [date],
  );

  const pendingHolds = await loadPendingAnytimeHolds(date);

  const interval = duration <= 30 ? duration : 30;
  const templates = generateTimeSlots(BUSINESS_OPEN, BUSINESS_CLOSE, interval);
  const available: { start_time: string; end_time: string; staff_id: number | null }[] = [];

  for (const template of templates) {
    const start = template.start_time;
    const end = addMinutes(start, duration);
    if (timeToMinutes(end) > timeToMinutes(BUSINESS_CLOSE)) continue;

    if (staff.length === 0) {
      const conflict = appointments.some((apt) => rangesOverlap(start, end, apt.start_time, apt.end_time))
        || pendingHolds.some((hold) => rangesOverlap(start, end, hold.start_time, hold.end_time));
      if (!conflict) available.push({ start_time: start, end_time: end, staff_id: null });
      continue;
    }

    for (const member of staff) {
      const staffBlocked = blocked.some(
        (slot) => slot.staff_id === member.id && rangesOverlap(start, end, slot.start_time, slot.end_time),
      );
      const staffBusy = appointments.some(
        (apt) => staffScheduleConflict(apt.staff_id, member.id)
          && rangesOverlap(start, end, apt.start_time, apt.end_time),
      );
      const staffHeld = pendingHolds.some(
        (hold) => staffScheduleConflict(hold.staff_id, member.id)
          && rangesOverlap(start, end, hold.start_time, hold.end_time),
      );
      if (!staffBlocked && !staffBusy && !staffHeld) {
        available.push({ start_time: start, end_time: end, staff_id: member.id });
        break;
      }
    }
  }

  return available;
}

export async function findBookableSlot(
  date: string,
  duration: number,
  startTime: string,
): Promise<{ start_time: string; end_time: string; staff_id: number | null } | null> {
  try {
    await assertRegularBookingAllowed(date);
  } catch {
    return null;
  }
  const slots = await computeAvailableSlots(date, duration);
  return slots.find((slot) => slot.start_time === startTime) ?? null;
}

export async function assertAnytimeSlotAvailable(
  date: string,
  startTime: string,
  endTime: string,
  staffId: number | null,
): Promise<void> {
  const duration = timeToMinutes(endTime) - timeToMinutes(startTime);
  const slot = await findBookableSlot(date, duration, startTime);
  if (!slot) throw new Error("SLOT_UNAVAILABLE");
  if (slot.staff_id !== staffId && !(slot.staff_id == null && staffId == null)) {
    throw new Error("SLOT_UNAVAILABLE");
  }
}

export async function createAnytimeAppointment(opts: {
  service: ServiceRow;
  clientId: number;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  staffId: number | null;
  addonIds: number[];
  notes?: string;
  payment?: {
    deposit_amount: number;
    amount_paid: number;
    payment_status: string;
    stripe_checkout_session_id?: string | null;
    stripe_payment_intent_id?: string | null;
  };
}): Promise<Record<string, unknown>> {
  const { selectedAddons } = await resolveServiceAddons(opts.service, opts.addonIds);
  const totalPrice = opts.service.price + selectedAddons.reduce((sum, a) => sum + a.price, 0);
  const currency = await getDefaultCurrency();
  const identifier = await nextIdentifier();
  const depositAmount = opts.payment?.deposit_amount ?? 0;
  const amountPaid = opts.payment?.amount_paid ?? 0;
  const paymentStatus = opts.payment?.payment_status
    ?? (totalPrice > 0 ? "unpaid" : "not_required");

  const result = await run(
    `INSERT INTO appointments (
      identifier, client_id, staff_id, scheduled_date, start_time, end_time,
      total_price, currency, deposit_amount, amount_paid, payment_status,
      stripe_checkout_session_id, stripe_payment_intent_id, notes, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`,
    [
      identifier,
      opts.clientId,
      opts.staffId,
      opts.scheduledDate,
      opts.startTime,
      opts.endTime,
      totalPrice,
      currency,
      depositAmount,
      amountPaid,
      paymentStatus,
      opts.payment?.stripe_checkout_session_id ?? null,
      opts.payment?.stripe_payment_intent_id ?? null,
      opts.notes?.trim() || "",
    ],
  );

  const aptId = result.lastInsertRowid;
  await run(
    "INSERT INTO appointment_services (appointment_id, service_id, price, duration) VALUES (?, ?, ?, ?)",
    [aptId, opts.service.id, opts.service.price, opts.service.duration],
  );

  for (const addon of selectedAddons) {
    await run(
      "INSERT INTO appointment_service_addons (appointment_id, service_addon_id, price) VALUES (?, ?, ?)",
      [aptId, addon.id, addon.price],
    );
  }

  return {
    id: aptId,
    identifier,
    scheduled_date: opts.scheduledDate,
    start_time: opts.startTime,
    end_time: opts.endTime,
    total_price: totalPrice,
    currency,
    service_name: opts.service.name,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerAnytimeBookingRoutes(app: OpenAPIHono<any>) {
  const PublicServiceSchema = z.object({
    id: z.number().int(),
    name: z.string(),
    slug: z.string(),
    description: z.string(),
    duration: z.number().int(),
    price: z.number(),
    color: z.string(),
    category: z.string(),
    allow_addons: z.number().int(),
    addons: z.array(z.object({
      id: z.number().int(),
      name: z.string(),
      price: z.number(),
      extra_duration: z.number().int(),
    })),
  });

  const getPublicAnytime = createRoute({
    method: "get",
    path: "/api/anytime/public",
    responses: {
      200: {
        description: "Public anytime booking page data",
        content: {
          "application/json": {
            schema: z.object({
              services: z.array(PublicServiceSchema),
              currency: z.string(),
              dates: z.array(z.string()),
              stripe_enabled: z.boolean(),
            }),
          },
        },
      },
    },
  });

  app.openapi(getPublicAnytime, async (c) => {
    const env = runtimeEnv(c.env) as StripeEnv;
    const rows = await loadActiveServices();
    const services = await Promise.all(rows.map((row) => toPublicService(row)));
    const currency = await getDefaultCurrency();
    return c.json({
      services,
      currency,
      dates: upcomingDates(),
      stripe_enabled: await isStripePaymentsActive(env),
    }, 200);
  });

  const getAvailability = createRoute({
    method: "get",
    path: "/api/anytime/public/availability",
    request: {
      query: z.object({
        date: z.string(),
        service_id: z.string(),
      }),
    },
    responses: {
      200: {
        description: "Available time slots",
        content: {
          "application/json": {
            schema: z.object({
              date: z.string(),
              slots: z.array(z.object({
                start_time: z.string(),
                end_time: z.string(),
              })),
            }),
          },
        },
      },
      400: { description: "Invalid", content: { "application/json": { schema: ErrorSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  app.openapi(getAvailability, async (c) => {
    const { date, service_id } = c.req.valid("query");
    const serviceId = parseInt(service_id, 10);
    if (!serviceId) return c.json({ error: "Invalid service" }, 400);

    await backfillServiceSlugs();
    const service = await get<ServiceRow>("SELECT * FROM services WHERE id = ? AND active = 1", [serviceId]);
    if (!service) return c.json({ error: "Service not found" }, 404);

    try {
      await assertRegularBookingAllowed(date);
    } catch (err) {
      return c.json({ date, slots: [] }, 200);
    }

    const slots = await computeAvailableSlots(date, service.duration);
    return c.json({
      date,
      slots: slots.map(({ start_time, end_time }) => ({ start_time, end_time })),
    }, 200);
  });

  const SlugParam = z.object({
    slug: z.string().openapi({ description: "Service slug" }),
  });

  const getPublicAnytimeService = createRoute({
    method: "get",
    path: "/api/anytime/public/{slug}",
    request: { params: SlugParam },
    responses: {
      200: {
        description: "Public anytime booking page for one service",
        content: {
          "application/json": {
            schema: z.object({
              service: PublicServiceSchema,
              currency: z.string(),
              dates: z.array(z.string()),
              stripe_enabled: z.boolean(),
            }),
          },
        },
      },
      404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  app.openapi(getPublicAnytimeService, async (c) => {
    const env = runtimeEnv(c.env) as StripeEnv;
    const { slug } = c.req.valid("param");
    const services = await loadActiveServices(slug);
    if (services.length === 0) return c.json({ error: "This service is not available" }, 404);
    const currency = await getDefaultCurrency();
    return c.json({
      service: await toPublicService(services[0]),
      currency,
      dates: upcomingDates(),
      stripe_enabled: await isStripePaymentsActive(env),
    }, 200);
  });

  const bookAnytime = createRoute({
    method: "post",
    path: "/api/anytime/public/book",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              service_id: z.number().int(),
              scheduled_date: z.string(),
              start_time: z.string(),
              name: z.string(),
              phone: z.string(),
              email: z.string().trim().min(1).email(),
              address: z.string().optional(),
              notes: z.string().optional(),
              addon_ids: z.array(z.number().int()).optional(),
              payment_choice: z.enum(["full", "deposit"]).optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Checkout required or booked",
        content: {
          "application/json": {
            schema: z.object({
              requires_payment: z.boolean().optional(),
              checkout_url: z.string().optional(),
              deposit_amount: z.number().optional(),
              checkout_total: z.number().optional(),
              payment_choice: z.enum(["full", "deposit"]).optional(),
              appointment: z.object({
                identifier: z.string(),
                scheduled_date: z.string(),
                start_time: z.string(),
                end_time: z.string(),
                total_price: z.number(),
                currency: z.string(),
                service_name: z.string(),
              }).optional(),
            }),
          },
        },
      },
      400: { description: "Invalid", content: { "application/json": { schema: ErrorSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
      409: { description: "Slot unavailable", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  app.openapi(bookAnytime, async (c) => {
    const body = c.req.valid("json");
    const env = runtimeEnv(c.env) as StripeEnv;

    if (!body.name.trim() || !body.phone.trim()) {
      return c.json({ error: "Name and phone are required" }, 400);
    }
    const emailCheck = parseRequiredBookingEmail(body.email);
    if (!emailCheck.ok) return c.json({ error: emailCheck.error }, 400);

    await backfillServiceSlugs();
    const service = await get<ServiceRow>("SELECT * FROM services WHERE id = ? AND active = 1", [body.service_id]);
    if (!service) return c.json({ error: "Service not found" }, 404);

    let pricing;
    try {
      pricing = await resolveServiceAddons(service, body.addon_ids ?? []);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }

    const totalDuration = service.duration + pricing.extraDuration;
    const totalPrice = service.price + pricing.addonPrice;
    const slot = await findBookableSlot(body.scheduled_date, totalDuration, body.start_time);
    if (!slot) return c.json({ error: "That time is no longer available" }, 409);

    const endTime = addMinutes(slot.start_time, totalDuration);
    const depositAmount = resolveOfferingDeposit(totalPrice);
    const paymentChoice: PaymentChoice = body.payment_choice === "deposit" ? "deposit" : "full";
    const checkoutTotal = offeringCheckoutAmount(totalPrice, depositAmount, paymentChoice);
    const needsPayment = offeringRequiresPayment(totalPrice) && await isStripePaymentsActive(env);

    const clientId = await findOrCreateClient({
      name: body.name,
      phone: body.phone,
      email: emailCheck.email,
      address: body.address,
    });

    const currency = await getDefaultCurrency();

    if (needsPayment) {
      try {
        const { checkout_url } = await createAnytimeBookingCheckout(env, {
          serviceId: service.id,
          serviceSlug: service.slug,
          serviceName: service.name,
          clientId,
          scheduledDate: body.scheduled_date,
          startTime: slot.start_time,
          endTime,
          staffId: slot.staff_id,
          addonIds: body.addon_ids ?? [],
          notes: body.notes,
          totalPrice,
          currency,
          paymentChoice,
          requestUrl: c.req.url,
          clientEmail: emailCheck.email,
        });
        return c.json({
          requires_payment: true,
          checkout_url,
          deposit_amount: depositAmount,
          checkout_total: checkoutTotal,
          payment_choice: paymentChoice,
        }, 200);
      } catch (err) {
        const msg = (err as Error).message;
        if (msg === "That time is no longer available") {
          return c.json({ error: msg }, 409);
        }
        return c.json({ error: msg }, 400);
      }
    }

    const appointment = await createAnytimeAppointment({
      service,
      clientId,
      scheduledDate: body.scheduled_date,
      startTime: slot.start_time,
      endTime,
      staffId: slot.staff_id,
      addonIds: body.addon_ids ?? [],
      notes: body.notes,
    });

    scheduleBookingConfirmation(c, appointment.id as number);

    return c.json({
      requires_payment: false,
      appointment: {
        identifier: appointment.identifier as string,
        scheduled_date: appointment.scheduled_date as string,
        start_time: appointment.start_time as string,
        end_time: appointment.end_time as string,
        total_price: appointment.total_price as number,
        currency: appointment.currency as string,
        service_name: appointment.service_name as string,
      },
    }, 200);
  });

  const completeAnytimeBooking = createRoute({
    method: "get",
    path: "/api/anytime/public/complete",
    request: {
      query: z.object({ session_id: z.string() }),
    },
    responses: {
      200: {
        description: "Payment completed",
        content: {
          "application/json": {
            schema: z.object({
              appointment: z.object({
                identifier: z.string(),
                scheduled_date: z.string(),
                start_time: z.string(),
                end_time: z.string(),
                total_price: z.number(),
                deposit_amount: z.number(),
                amount_paid: z.number(),
                payment_status: z.string(),
                currency: z.string(),
                service_name: z.string(),
              }),
            }),
          },
        },
      },
      400: { description: "Invalid", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  app.openapi(completeAnytimeBooking, async (c) => {
    const { session_id: sessionId } = c.req.valid("query");
    const env = runtimeEnv(c.env) as StripeEnv;

    try {
      const result = await finalizeAnytimeBookingCheckout(env, sessionId);
      if (!result.already_done) {
        scheduleBookingConfirmation(c, result.appointment_id!, { receipt: true });
      }
      const apt = await get<{
        identifier: string;
        scheduled_date: string;
        start_time: string;
        end_time: string;
        total_price: number;
        deposit_amount: number;
        amount_paid: number;
        payment_status: string;
        currency: string;
        service_name: string;
      }>(
        `SELECT a.identifier, a.scheduled_date, a.start_time, a.end_time, a.total_price,
                a.deposit_amount, a.amount_paid, a.payment_status, a.currency, s.name as service_name
         FROM appointments a
         JOIN appointment_services aps ON aps.appointment_id = a.id
         JOIN services s ON s.id = aps.service_id
         WHERE a.id = ?`,
        [result.appointment_id],
      );
      if (!apt) return c.json({ error: "Appointment not found" }, 400);
      return c.json({ appointment: apt }, 200);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });
}
