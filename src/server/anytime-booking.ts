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

const ErrorSchema = z.object({ error: z.string() });

const BUSINESS_OPEN = "09:00";
const BUSINESS_CLOSE = "18:00";
const BOOKING_DAYS_AHEAD = 30;

type ServiceRow = {
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

function rangesOverlap(start1: string, end1: string, start2: string, end2: string): boolean {
  const s1 = timeToMinutes(start1);
  const e1 = timeToMinutes(end1);
  const s2 = timeToMinutes(start2);
  const e2 = timeToMinutes(end2);
  return s1 < e2 && s2 < e1;
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

  const interval = duration <= 30 ? duration : 30;
  const templates = generateTimeSlots(BUSINESS_OPEN, BUSINESS_CLOSE, interval);
  const available: { start_time: string; end_time: string; staff_id: number | null }[] = [];

  for (const template of templates) {
    const start = template.start_time;
    const end = addMinutes(start, duration);
    if (timeToMinutes(end) > timeToMinutes(BUSINESS_CLOSE)) continue;

    if (staff.length === 0) {
      const conflict = appointments.some((apt) => rangesOverlap(start, end, apt.start_time, apt.end_time));
      if (!conflict) available.push({ start_time: start, end_time: end, staff_id: null });
      continue;
    }

    for (const member of staff) {
      const staffBlocked = blocked.some(
        (slot) => slot.staff_id === member.id && rangesOverlap(start, end, slot.start_time, slot.end_time),
      );
      const staffBusy = appointments.some(
        (apt) => apt.staff_id === member.id && rangesOverlap(start, end, apt.start_time, apt.end_time),
      );
      if (!staffBlocked && !staffBusy) {
        available.push({ start_time: start, end_time: end, staff_id: member.id });
        break;
      }
    }
  }

  return available;
}

async function findBookableSlot(
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
            }),
          },
        },
      },
    },
  });

  app.openapi(getPublicAnytime, async (c) => {
    const rows = await loadActiveServices();
    const services = await Promise.all(rows.map((row) => toPublicService(row)));
    const currency = await getDefaultCurrency();
    return c.json({ services, currency, dates: upcomingDates() }, 200);
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
            }),
          },
        },
      },
      404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  app.openapi(getPublicAnytimeService, async (c) => {
    const { slug } = c.req.valid("param");
    const services = await loadActiveServices(slug);
    if (services.length === 0) return c.json({ error: "This service is not available" }, 404);
    const currency = await getDefaultCurrency();
    return c.json({ service: await toPublicService(services[0]), currency, dates: upcomingDates() }, 200);
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
            }),
          },
        },
      },
    },
    responses: {
      201: {
        description: "Booked",
        content: {
          "application/json": {
            schema: z.object({
              appointment: z.object({
                identifier: z.string(),
                scheduled_date: z.string(),
                start_time: z.string(),
                end_time: z.string(),
                total_price: z.number(),
                currency: z.string(),
                service_name: z.string(),
              }),
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
    if (!body.name.trim() || !body.phone.trim()) {
      return c.json({ error: "Name and phone are required" }, 400);
    }
    const emailCheck = parseRequiredBookingEmail(body.email);
    if (!emailCheck.ok) return c.json({ error: emailCheck.error }, 400);

    await backfillServiceSlugs();
    const service = await get<ServiceRow>("SELECT * FROM services WHERE id = ? AND active = 1", [body.service_id]);
    if (!service) return c.json({ error: "Service not found" }, 404);

    const slot = await findBookableSlot(body.scheduled_date, service.duration, body.start_time);
    if (!slot) return c.json({ error: "That time is no longer available" }, 409);

    const uniqueAddonIds = [...new Set(body.addon_ids ?? [])];
    let addonPrice = 0;
    let extraDuration = 0;
    const selectedAddons: { id: number; price: number }[] = [];

    if (uniqueAddonIds.length > 0) {
      if (!service.allow_addons) {
        return c.json({ error: "Extras are not available for this service" }, 400);
      }
      const addons = await query<{ id: number; price: number; extra_duration: number }>(
        `SELECT id, price, extra_duration FROM service_addons
         WHERE service_id = ? AND active = 1 AND id IN (${uniqueAddonIds.map(() => "?").join(",")})`,
        [service.id, ...uniqueAddonIds],
      );
      if (addons.length !== uniqueAddonIds.length) {
        return c.json({ error: "One or more extras are invalid for this service" }, 400);
      }
      for (const addon of addons) {
        addonPrice += addon.price;
        extraDuration += addon.extra_duration;
        selectedAddons.push({ id: addon.id, price: addon.price });
      }
    }

    const totalDuration = service.duration + extraDuration;
    const endTime = addMinutes(slot.start_time, totalDuration);
    const totalPrice = service.price + addonPrice;

    const clientId = await findOrCreateClient({
      name: body.name,
      phone: body.phone,
      email: emailCheck.email,
      address: body.address,
    });

    const currency = await getDefaultCurrency();
    const identifier = await nextIdentifier();

    const result = await run(
      `INSERT INTO appointments (identifier, client_id, staff_id, scheduled_date, start_time, end_time, total_price, currency, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`,
      [
        identifier,
        clientId,
        slot.staff_id,
        body.scheduled_date,
        slot.start_time,
        endTime,
        totalPrice,
        currency,
        body.notes?.trim() || "",
      ],
    );

    const aptId = result.lastInsertRowid;
    await run(
      "INSERT INTO appointment_services (appointment_id, service_id, price, duration) VALUES (?, ?, ?, ?)",
      [aptId, service.id, service.price, service.duration],
    );

    for (const addon of selectedAddons) {
      await run(
        "INSERT INTO appointment_service_addons (appointment_id, service_addon_id, price) VALUES (?, ?, ?)",
        [aptId, addon.id, addon.price],
      );
    }

    scheduleBookingConfirmation(c, aptId as number);

    return c.json({
      appointment: {
        identifier,
        scheduled_date: body.scheduled_date,
        start_time: slot.start_time,
        end_time: endTime,
        total_price: totalPrice,
        currency,
        service_name: service.name,
      },
    }, 201);
  });
}
