import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { get, query, run } from "./db.js";
import { runtimeEnv } from "./runtime-env.js";
import { getDefaultCurrency } from "./settings.js";
import { isValidCurrency, DEFAULT_CURRENCY } from "../shared/currency.js";
import {
  addMinutes,
  generateBookingToken,
  bookingLinkExpiresAt,
  isLinkExpired,
} from "./helpers.js";
import { findOrCreateClient } from "./clients.js";
import { assertRegularBookingAllowed } from "./event-override.js";
import {
  createBookingLinkCheckout,
  finalizeBookingLinkCheckout,
  linkRequiresPayment,
} from "./booking-link-payments.js";
import { isStripePaymentsActive } from "./stripe-payments-settings.js";
import { scheduleBookingConfirmation } from "./notifications.js";
import {
  bookingLinkCheckoutAmount,
  clientHasPaymentChoice,
  resolveLinkDeposit,
  type PaymentChoice,
} from "../shared/payment.js";
import {
  createAppointmentForLink,
  formatLink,
  linkServiceSubtotal,
  loadBookingLinkByToken,
  type LinkRow,
} from "./booking-links-shared.js";
import type { StripeEnv } from "./stripe.js";

const ErrorSchema = z.object({ error: z.string() });
const TokenParam = z.object({
  token: z.string().openapi({ description: "Booking link token" }),
});

const BookingLinkSchema = z.object({
  id: z.number().int(),
  token: z.string(),
  staff_id: z.number().int(),
  scheduled_date: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  total_price: z.number(),
  deposit_amount: z.number(),
  travel_fee: z.number(),
  currency: z.string(),
  notes: z.string(),
  service_ids: z.array(z.number().int()),
  status: z.string(),
  expires_at: z.string().nullable(),
  appointment_id: z.number().int().nullable(),
  client_id: z.number().int().nullable(),
  stripe_checkout_session_id: z.string().nullable().optional(),
  created_at: z.string(),
  confirmed_at: z.string().nullable(),
  staff_name: z.string().optional(),
});

function parseServiceIds(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === "number") : [];
  } catch {
    return [];
  }
}

function validateLinkAvailable(row: LinkRow): string | null {
  if (row.status === "confirmed") return "This link is no longer available";
  if (row.status === "expired") return "This link has expired";
  if (row.status !== "pending" && row.status !== "awaiting_payment") {
    return "This link is no longer available";
  }
  if (isLinkExpired(row.expires_at)) return "This link has expired";
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerBookingLinkRoutes(app: OpenAPIHono<any>) {
  const createBookingLink = createRoute({
    method: "post",
    path: "/api/booking-links",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              staff_id: z.number().int(),
              scheduled_date: z.string(),
              start_time: z.string(),
              end_time: z.string().optional(),
              duration_minutes: z.number().int().optional(),
              total_price: z.number().optional(),
              deposit_amount: z.number().optional(),
              travel_fee: z.number().optional(),
              currency: z.string().optional(),
              notes: z.string().optional(),
              service_ids: z.array(z.number().int()).optional(),
            }),
          },
        },
      },
    },
    responses: {
      201: {
        description: "Booking link created",
        content: {
          "application/json": {
            schema: z.object({
              booking_link: BookingLinkSchema,
              url_path: z.string(),
            }),
          },
        },
      },
    },
  });

  app.openapi(createBookingLink, async (c) => {
    const body = c.req.valid("json");
    try {
      await assertRegularBookingAllowed(body.scheduled_date);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }

    const travelFee = Math.max(0, body.travel_fee ?? 0);

    const startTime = body.start_time;
    let endTime = body.end_time;
    let servicePrice = body.total_price ?? 0;
    const serviceIds = body.service_ids ?? [];

    if (!endTime) {
      let duration = body.duration_minutes ?? 60;
      if (serviceIds.length > 0) {
        const svcs = await query<{ duration: number; price: number }>(
          `SELECT duration, price FROM services WHERE id IN (${serviceIds.map(() => "?").join(",")})`,
          serviceIds,
        );
        duration = svcs.reduce((sum, s) => sum + s.duration, 0) || duration;
        if (body.total_price === undefined) {
          servicePrice = svcs.reduce((sum, s) => sum + s.price, 0);
        }
      }
      endTime = addMinutes(startTime, duration);
    }

    const totalPrice = servicePrice + travelFee;
    const depositAmount = resolveLinkDeposit(body.deposit_amount, totalPrice, travelFee);

    if (servicePrice > 0 && depositAmount > servicePrice) {
      return c.json({ error: "Deposit cannot exceed service price" }, 400);
    }

    const staff = await get<{ id: number }>("SELECT id FROM staff WHERE id = ? AND active = 1", [body.staff_id]);
    if (!staff) return c.json({ error: "Staff not found" }, 404);

    const token = generateBookingToken();
    const expiresAt = bookingLinkExpiresAt();

    let currency = body.currency || (await getDefaultCurrency());
    if (!isValidCurrency(currency)) currency = DEFAULT_CURRENCY;

    const result = await run(
      `INSERT INTO booking_links (token, staff_id, scheduled_date, start_time, end_time, total_price, deposit_amount, travel_fee, currency, notes, service_ids, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        token,
        body.staff_id,
        body.scheduled_date,
        startTime,
        endTime,
        totalPrice,
        depositAmount,
        travelFee,
        currency,
        body.notes || "",
        JSON.stringify(serviceIds),
        expiresAt,
      ],
    );

    const row = await get<LinkRow>(
      `SELECT bl.*, s.name as staff_name FROM booking_links bl
       LEFT JOIN staff s ON s.id = bl.staff_id WHERE bl.id = ?`,
      [result.lastInsertRowid],
    );
    if (!row) return c.json({ error: "Failed to create link" }, 500);

    return c.json({ booking_link: formatLink(row), url_path: `/book/${token}` }, 201);
  });

  const getPublicBookingLink = createRoute({
    method: "get",
    path: "/api/book/public/{token}",
    request: { params: TokenParam },
    responses: {
      200: {
        description: "Public booking offer",
        content: {
          "application/json": {
            schema: z.object({
              booking_link: BookingLinkSchema,
              services: z.array(z.object({ id: z.number().int(), name: z.string(), price: z.number() })),
              stripe_enabled: z.boolean(),
              requires_address: z.boolean(),
              service_subtotal: z.number(),
            }),
          },
        },
      },
      404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
      410: { description: "Expired or used", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  app.openapi(getPublicBookingLink, async (c) => {
    const { token } = c.req.valid("param");
    const env = runtimeEnv(c.env) as StripeEnv;
    const row = await loadBookingLinkByToken(token);
    if (!row) return c.json({ error: "Link not found" }, 404);

    const unavailable = validateLinkAvailable(row);
    if (unavailable) {
      if (isLinkExpired(row.expires_at) && row.status === "pending") {
        await run("UPDATE booking_links SET status = 'expired' WHERE id = ?", [row.id]);
      }
      return c.json({ error: unavailable }, 410);
    }

    const serviceIds = parseServiceIds(row.service_ids);
    let services: { id: number; name: string; price: number }[] = [];
    if (serviceIds.length > 0) {
      services = await query<{ id: number; name: string; price: number }>(
        `SELECT id, name, price FROM services WHERE id IN (${serviceIds.map(() => "?").join(",")})`,
        serviceIds,
      );
    }

    const stripeEnabled = await isStripePaymentsActive(env);
    const paymentRequired = linkRequiresPayment(row);

    return c.json({
      booking_link: formatLink(row),
      services,
      stripe_enabled: stripeEnabled,
      payment_required: paymentRequired,
      client_payment_choice: clientHasPaymentChoice(row),
      requires_address: row.travel_fee > 0,
      service_subtotal: linkServiceSubtotal(row),
    }, 200);
  });

  const confirmPublicBooking = createRoute({
    method: "post",
    path: "/api/book/public/{token}/confirm",
    request: {
      params: TokenParam,
      body: {
        content: {
          "application/json": {
            schema: z.object({
              name: z.string().min(1),
              phone: z.string().min(1),
              email: z.string().optional(),
              address: z.string().optional(),
              payment_choice: z.enum(["full", "deposit"]).optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Booking confirmed or checkout required",
        content: {
          "application/json": {
            schema: z.object({
              requires_payment: z.boolean().optional(),
              checkout_url: z.string().optional(),
              deposit_amount: z.number().optional(),
              travel_fee: z.number().optional(),
              checkout_total: z.number().optional(),
              appointment: z.object({
                id: z.number().int().optional(),
                identifier: z.string(),
                scheduled_date: z.string(),
                start_time: z.string(),
                end_time: z.string(),
                total_price: z.number(),
                deposit_amount: z.number().optional(),
                payment_status: z.string().optional(),
                staff_name: z.string().nullable().optional(),
              }).optional(),
            }),
          },
        },
      },
      400: { description: "Invalid", content: { "application/json": { schema: ErrorSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
      410: { description: "Expired or used", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  app.openapi(confirmPublicBooking, async (c) => {
    const { token } = c.req.valid("param");
    const body = c.req.valid("json");
    const env = runtimeEnv(c.env) as StripeEnv;

    const row = await loadBookingLinkByToken(token);
    if (!row) return c.json({ error: "Link not found" }, 404);

    const unavailable = validateLinkAvailable(row);
    if (unavailable) {
      if (isLinkExpired(row.expires_at) && row.status === "pending") {
        await run("UPDATE booking_links SET status = 'expired' WHERE id = ?", [row.id]);
      }
      return c.json({ error: unavailable }, 410);
    }

    if (row.travel_fee > 0 && !body.address?.trim()) {
      return c.json({ error: "Address is required for on-location appointments" }, 400);
    }

    const clientId = await findOrCreateClient(body);
    const needsPayment = linkRequiresPayment(row) && await isStripePaymentsActive(env);
    const paymentChoice: PaymentChoice = body.payment_choice === "deposit" ? "deposit" : "full";
    const checkoutTotal = bookingLinkCheckoutAmount(row, paymentChoice);

    if (needsPayment) {
      try {
        const { checkout_url } = await createBookingLinkCheckout(
          env,
          row,
          clientId,
          c.req.url,
          paymentChoice,
        );
        return c.json({
          requires_payment: true,
          checkout_url,
          deposit_amount: row.deposit_amount,
          travel_fee: row.travel_fee,
          checkout_total: checkoutTotal,
          payment_choice: paymentChoice,
        }, 200);
      } catch (err) {
        return c.json({ error: (err as Error).message }, 400);
      }
    }

    const aptId = await createAppointmentForLink(row, clientId, {
      payment_status: "not_required",
      service_address: body.address?.trim(),
    });

    await run(
      `UPDATE booking_links SET status = 'confirmed', client_id = ?, appointment_id = ?, confirmed_at = datetime('now') WHERE id = ?`,
      [clientId, aptId, row.id],
    );

    const apt = await get<Record<string, unknown>>(
      `SELECT a.*, s.name as staff_name FROM appointments a
       LEFT JOIN staff s ON s.id = a.staff_id WHERE a.id = ?`,
      [aptId],
    );

    scheduleBookingConfirmation(c, aptId as number);

    return c.json({ requires_payment: false, appointment: apt }, 200);
  });

  const completePublicBooking = createRoute({
    method: "get",
    path: "/api/book/public/{token}/complete",
    request: {
      params: TokenParam,
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
                travel_fee: z.number(),
                amount_paid: z.number(),
                payment_status: z.string(),
              }),
            }),
          },
        },
      },
      400: { description: "Invalid", content: { "application/json": { schema: ErrorSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  app.openapi(completePublicBooking, async (c) => {
    const { token } = c.req.valid("param");
    const { session_id: sessionId } = c.req.valid("query");
    const env = runtimeEnv(c.env) as StripeEnv;

    const row = await loadBookingLinkByToken(token);
    if (!row) return c.json({ error: "Link not found" }, 404);

    try {
      const client = row.client_id
        ? await get<{ address: string }>("SELECT address FROM clients WHERE id = ?", [row.client_id])
        : null;
      const result = await finalizeBookingLinkCheckout(env, sessionId, client?.address);
      const apt = await get<{
        identifier: string;
        scheduled_date: string;
        start_time: string;
        end_time: string;
        total_price: number;
        deposit_amount: number;
        travel_fee: number;
        amount_paid: number;
        payment_status: string;
        currency: string;
      }>(
        "SELECT identifier, scheduled_date, start_time, end_time, total_price, deposit_amount, travel_fee, amount_paid, payment_status, currency FROM appointments WHERE id = ?",
        [result.appointment_id],
      );
      if (!apt) return c.json({ error: "Appointment not found" }, 404);
      scheduleBookingConfirmation(c, result.appointment_id, { receipt: true });
      return c.json({ appointment: apt }, 200);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });
}
