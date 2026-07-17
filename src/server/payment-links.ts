import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { get, query, run } from "./db.js";
import { runtimeEnv } from "./runtime-env.js";
import { getDefaultCurrency } from "./settings.js";
import { isValidCurrency, DEFAULT_CURRENCY } from "../shared/currency.js";
import {
  generateBookingToken,
  bookingLinkExpiresAt,
  isLinkExpired,
  addMinutes,
  nextIdentifier,
} from "./helpers.js";
import { findOrCreateClientResult } from "./clients.js";
import { isStripePaymentsActive } from "./stripe-payments-settings.js";
import { snapshotFeePassthrough } from "./stripe-fee-settings.js";
import { derivePaymentStatus, type PaymentChoice } from "../shared/payment.js";
import type { StripeEnv } from "./stripe.js";
import {
  createPaymentLinkCheckout,
  finalizePaymentLinkCheckout,
  loadPaymentLinkByToken,
  paymentLinkCheckoutNet,
  paymentLinkHasDepositChoice,
  resolvePaymentLinkDeposit,
  type PaymentLinkRow,
} from "./payment-link-payments.js";

const ErrorSchema = z.object({ error: z.string() });
const TokenParam = z.object({
  token: z.string().openapi({ description: "Payment link token" }),
});

const PaymentLinkSchema = z.object({
  id: z.number().int(),
  token: z.string(),
  staff_id: z.number().int().nullable(),
  quoted_total: z.number(),
  deposit_amount: z.number(),
  currency: z.string(),
  notes: z.string(),
  status: z.string(),
  expires_at: z.string().nullable(),
  client_id: z.number().int().nullable(),
  pending_payment_id: z.number().int().nullable(),
  fee_passthrough: z.boolean(),
  created_at: z.string(),
  paid_at: z.string().nullable(),
  staff_name: z.string().nullable().optional(),
});

const PendingPaymentSchema = z.object({
  id: z.number().int(),
  payment_link_id: z.number().int().nullable(),
  client_id: z.number().int(),
  staff_id: z.number().int().nullable(),
  quoted_total: z.number(),
  amount_paid: z.number(),
  currency: z.string(),
  notes: z.string(),
  status: z.string(),
  client_was_existing: z.boolean(),
  appointment_id: z.number().int().nullable(),
  created_at: z.string(),
  applied_at: z.string().nullable(),
  client_name: z.string().optional(),
  client_email: z.string().optional(),
  client_phone: z.string().optional(),
  staff_name: z.string().nullable().optional(),
});

function formatPaymentLink(row: PaymentLinkRow) {
  return {
    id: row.id,
    token: row.token,
    staff_id: row.staff_id,
    quoted_total: row.quoted_total,
    deposit_amount: row.deposit_amount,
    currency: row.currency,
    notes: row.notes,
    status: row.status,
    expires_at: row.expires_at,
    client_id: row.client_id,
    pending_payment_id: row.pending_payment_id,
    fee_passthrough: Boolean(row.fee_passthrough),
    created_at: row.created_at,
    paid_at: row.paid_at,
    staff_name: row.staff_name ?? null,
  };
}

function validatePaymentLinkAvailable(row: PaymentLinkRow): string | null {
  if (row.status === "paid") return "This link has already been paid";
  if (row.status === "expired") return "This link has expired";
  if (row.status !== "pending" && row.status !== "awaiting_payment") {
    return "This link is no longer available";
  }
  if (isLinkExpired(row.expires_at)) return "This link has expired";
  return null;
}

type PendingRow = {
  id: number;
  payment_link_id: number | null;
  client_id: number;
  staff_id: number | null;
  quoted_total: number;
  amount_paid: number;
  currency: string;
  notes: string;
  status: string;
  client_was_existing: number;
  appointment_id: number | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  created_at: string;
  applied_at: string | null;
  client_name?: string;
  client_email?: string;
  client_phone?: string;
  staff_name?: string | null;
};

function formatPending(row: PendingRow) {
  return {
    id: row.id,
    payment_link_id: row.payment_link_id,
    client_id: row.client_id,
    staff_id: row.staff_id,
    quoted_total: row.quoted_total,
    amount_paid: row.amount_paid,
    currency: row.currency,
    notes: row.notes,
    status: row.status,
    client_was_existing: Boolean(row.client_was_existing),
    appointment_id: row.appointment_id,
    created_at: row.created_at,
    applied_at: row.applied_at,
    client_name: row.client_name,
    client_email: row.client_email,
    client_phone: row.client_phone,
    staff_name: row.staff_name ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerPaymentLinkRoutes(app: OpenAPIHono<any>) {
  const createLink = createRoute({
    method: "post",
    path: "/api/payment-links",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              quoted_total: z.number().positive(),
              collect: z.enum(["full", "deposit"]).optional(),
              staff_id: z.number().int().nullable().optional(),
              currency: z.string().optional(),
              notes: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: {
      201: {
        description: "Payment link created",
        content: {
          "application/json": {
            schema: z.object({
              payment_link: PaymentLinkSchema,
              url_path: z.string(),
            }),
          },
        },
      },
      400: { description: "Invalid", content: { "application/json": { schema: ErrorSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
      500: { description: "Failed", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.openapi(createLink, (async (c: any) => {
    const body = c.req.valid("json");
    const quotedTotal = Math.round(body.quoted_total * 100) / 100;
    if (quotedTotal <= 0) return c.json({ error: "Price must be greater than zero" }, 400);

    const collect = body.collect === "deposit" ? "deposit" : "full";
    const depositAmount = resolvePaymentLinkDeposit(quotedTotal, collect);

    if (body.staff_id != null) {
      const staff = await get<{ id: number }>(
        "SELECT id FROM staff WHERE id = ? AND active = 1",
        [body.staff_id],
      );
      if (!staff) return c.json({ error: "Staff not found" }, 404);
    }

    let currency = body.currency || (await getDefaultCurrency());
    if (!isValidCurrency(currency)) currency = DEFAULT_CURRENCY;

    const token = generateBookingToken();
    const expiresAt = bookingLinkExpiresAt();
    const feePassthrough = await snapshotFeePassthrough();

    const result = await run(
      `INSERT INTO payment_links (token, staff_id, quoted_total, deposit_amount, currency, notes, expires_at, fee_passthrough)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        token,
        body.staff_id ?? null,
        quotedTotal,
        depositAmount,
        currency,
        body.notes?.trim() || "",
        expiresAt,
        feePassthrough ? 1 : 0,
      ],
    );

    const row = await get<PaymentLinkRow>(
      `SELECT pl.*, s.name as staff_name FROM payment_links pl
       LEFT JOIN staff s ON s.id = pl.staff_id WHERE pl.id = ?`,
      [result.lastInsertRowid],
    );
    if (!row) return c.json({ error: "Failed to create link" }, 500);

    return c.json({ payment_link: formatPaymentLink(row), url_path: `/p/${token}` }, 201);
  }) as any);

  const getPublic = createRoute({
    method: "get",
    path: "/api/pay-link/public/{token}",
    request: { params: TokenParam },
    responses: {
      200: {
        description: "Public payment link",
        content: {
          "application/json": {
            schema: z.object({
              payment_link: PaymentLinkSchema,
              stripe_enabled: z.boolean(),
              payment_choice_available: z.boolean(),
              deposit_amount: z.number(),
              full_amount: z.number(),
            }),
          },
        },
      },
      404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
      410: { description: "Expired or used", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  app.openapi(getPublic, (async (c: any) => {
    const { token } = c.req.valid("param");
    const env = runtimeEnv(c.env) as StripeEnv;
    const row = await loadPaymentLinkByToken(token);
    if (!row) return c.json({ error: "Link not found" }, 404);

    const unavailable = validatePaymentLinkAvailable(row);
    if (unavailable) {
      if (isLinkExpired(row.expires_at) && row.status === "pending") {
        await run("UPDATE payment_links SET status = 'expired' WHERE id = ?", [row.id]);
      }
      return c.json({ error: unavailable }, 410);
    }

    return c.json({
      payment_link: formatPaymentLink(row),
      stripe_enabled: await isStripePaymentsActive(env),
      payment_choice_available: paymentLinkHasDepositChoice(row),
      deposit_amount: paymentLinkCheckoutNet(row, "deposit"),
      full_amount: paymentLinkCheckoutNet(row, "full"),
    });
  }) as any);

  const confirmPublic = createRoute({
    method: "post",
    path: "/api/pay-link/public/{token}/confirm",
    request: {
      params: TokenParam,
      body: {
        content: {
          "application/json": {
            schema: z.object({
              name: z.string().min(1),
              phone: z.string().optional(),
              email: z.string().min(1),
              payment_choice: z.enum(["full", "deposit"]).optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Checkout created",
        content: {
          "application/json": {
            schema: z.object({
              checkout_url: z.string().optional(),
              pending_payment_id: z.number().int().optional(),
            }),
          },
        },
      },
      400: { description: "Invalid", content: { "application/json": { schema: ErrorSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
      410: { description: "Unavailable", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  app.openapi(confirmPublic, (async (c: any) => {
    const { token } = c.req.valid("param");
    const body = c.req.valid("json");
    const env = runtimeEnv(c.env) as StripeEnv;
    const row = await loadPaymentLinkByToken(token);
    if (!row) return c.json({ error: "Link not found" }, 404);

    const unavailable = validatePaymentLinkAvailable(row);
    if (unavailable) return c.json({ error: unavailable }, 410);

    if (!(await isStripePaymentsActive(env))) {
      return c.json({ error: "Online payments are not available right now" }, 400);
    }

    let client: { id: number; existing: boolean };
    try {
      client = await findOrCreateClientResult({
        name: body.name,
        phone: body.phone || "",
        email: body.email,
      });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }

    const choice: PaymentChoice =
      body.payment_choice === "deposit" && paymentLinkHasDepositChoice(row) ? "deposit" : "full";

    try {
      const checkout = await createPaymentLinkCheckout(
        env,
        row,
        client.id,
        c.req.url,
        choice,
        client.existing,
      );
      return c.json({ checkout_url: checkout.checkout_url });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  }) as any);

  const completePublic = createRoute({
    method: "get",
    path: "/api/pay-link/public/{token}/complete",
    request: {
      params: TokenParam,
      query: z.object({ session_id: z.string() }),
    },
    responses: {
      200: {
        description: "Payment finalized",
        content: {
          "application/json": {
            schema: z.object({
              already_done: z.boolean(),
              pending_payment_id: z.number().int().nullable(),
            }),
          },
        },
      },
      400: { description: "Failed", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  app.openapi(completePublic, (async (c: any) => {
    const { session_id } = c.req.valid("query");
    const env = runtimeEnv(c.env) as StripeEnv;
    try {
      const result = await finalizePaymentLinkCheckout(env, session_id);
      return c.json(result);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  }) as any);

  const listPending = createRoute({
    method: "get",
    path: "/api/pending-payments",
    request: {
      query: z.object({
        status: z.enum(["open", "applied", "refunded", "all"]).optional(),
      }),
    },
    responses: {
      200: {
        description: "Pending payments",
        content: {
          "application/json": {
            schema: z.object({
              pending_payments: z.array(PendingPaymentSchema),
            }),
          },
        },
      },
    },
  });

  app.openapi(listPending, (async (c: any) => {
    const status = c.req.valid("query").status ?? "open";
    const statusClause = status === "all" ? "1=1" : "pp.status = ?";
    const params = status === "all" ? [] : [status];
    const rows = await query<PendingRow>(
      `SELECT pp.*, c.name as client_name, c.email as client_email, c.phone as client_phone, s.name as staff_name
       FROM pending_payments pp
       JOIN clients c ON c.id = pp.client_id
       LEFT JOIN staff s ON s.id = pp.staff_id
       WHERE ${statusClause}
       ORDER BY CASE WHEN pp.client_was_existing = 1 THEN 0 ELSE 1 END, pp.created_at DESC`,
      params,
    );
    return c.json({ pending_payments: rows.map(formatPending) });
  }) as any);

  const applyPending = createRoute({
    method: "post",
    path: "/api/pending-payments/{id}/apply",
    request: {
      params: z.object({ id: z.coerce.number().int() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              staff_id: z.number().int().nullable().optional(),
              scheduled_date: z.string(),
              start_time: z.string(),
              duration_minutes: z.number().int().optional(),
              end_time: z.string().optional(),
              service_ids: z.array(z.number().int()).optional(),
              total_price: z.number().optional(),
              travel_fee: z.number().optional(),
              service_address: z.string().optional(),
              notes: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Applied to appointment",
        content: {
          "application/json": {
            schema: z.object({
              appointment_id: z.number().int(),
              identifier: z.string(),
              amount_applied: z.number(),
              balance_due: z.number(),
            }),
          },
        },
      },
      400: { description: "Invalid", content: { "application/json": { schema: ErrorSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  app.openapi(applyPending, (async (c: any) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const pending = await get<PendingRow>(
      "SELECT * FROM pending_payments WHERE id = ?",
      [id],
    );
    if (!pending) return c.json({ error: "Pending payment not found" }, 404);
    if (pending.status !== "open") {
      return c.json({ error: "This payment is no longer open" }, 400);
    }

    const staffId = body.staff_id !== undefined ? body.staff_id : pending.staff_id;
    if (staffId != null) {
      const staff = await get<{ id: number }>("SELECT id FROM staff WHERE id = ? AND active = 1", [staffId]);
      if (!staff) return c.json({ error: "Staff not found" }, 404);
    }

    const serviceIds = body.service_ids ?? [];
    let servicePrice = body.total_price;
    let duration = body.duration_minutes ?? 60;
    const serviceLines: { service_id: number; name: string; price: number; duration: number }[] = [];

    if (serviceIds.length > 0) {
      const svcs = await query<{ id: number; name: string; price: number; duration: number }>(
        `SELECT id, name, price, duration FROM services WHERE id IN (${serviceIds.map(() => "?").join(",")})`,
        serviceIds,
      );
      for (const svc of svcs) {
        serviceLines.push({
          service_id: svc.id,
          name: svc.name,
          price: svc.price,
          duration: svc.duration,
        });
      }
      duration = serviceLines.reduce((sum, s) => sum + s.duration, 0) || duration;
      if (servicePrice === undefined) {
        servicePrice = serviceLines.reduce((sum, s) => sum + s.price, 0);
      }
    }

    const travelFee = Math.max(0, body.travel_fee ?? 0);
    const quotedFallback = pending.quoted_total > 0 ? pending.quoted_total : pending.amount_paid;
    const basePrice = servicePrice !== undefined ? servicePrice : quotedFallback;
    const totalPrice = Math.round((basePrice + travelFee) * 100) / 100;
    const startTime = body.start_time;
    const endTime = body.end_time || addMinutes(startTime, duration);
    const amountApplied = Math.min(pending.amount_paid, totalPrice);
    const paymentStatus = derivePaymentStatus(totalPrice, pending.amount_paid, amountApplied);
    const identifier = await nextIdentifier();
    const currency = pending.currency || (await getDefaultCurrency());

    const aptResult = await run(
      `INSERT INTO appointments (
        identifier, client_id, staff_id, status, scheduled_date, start_time, end_time,
        total_price, currency, deposit_amount, amount_paid, payment_status,
        travel_fee, service_address, notes, stripe_checkout_session_id, stripe_payment_intent_id
      ) VALUES (?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        identifier,
        pending.client_id,
        staffId,
        body.scheduled_date,
        startTime,
        endTime,
        totalPrice,
        currency,
        pending.amount_paid,
        amountApplied,
        paymentStatus,
        travelFee,
        body.service_address?.trim() || "",
        body.notes?.trim() || pending.notes || "",
        pending.stripe_checkout_session_id,
        pending.stripe_payment_intent_id,
      ],
    );
    const appointmentId = Number(aptResult.lastInsertRowid);

    for (const line of serviceLines) {
      await run(
        `INSERT INTO appointment_services (appointment_id, service_id, service_name, price, duration)
         VALUES (?, ?, ?, ?, ?)`,
        [appointmentId, line.service_id, line.name, line.price, line.duration],
      );
    }

    await run(
      `UPDATE pending_payments SET status = 'applied', appointment_id = ?, staff_id = ?, applied_at = datetime('now') WHERE id = ?`,
      [appointmentId, staffId, id],
    );

    await run(
      `UPDATE payments SET appointment_id = ? WHERE stripe_checkout_session_id = ? AND appointment_id IS NULL`,
      [appointmentId, pending.stripe_checkout_session_id],
    );

    await run(
      "INSERT INTO appointment_notes (appointment_id, content) VALUES (?, ?)",
      [
        appointmentId,
        `Applied pending payment ${currency} ${amountApplied.toFixed(2)} (quoted ${currency} ${pending.quoted_total.toFixed(2)})`,
      ],
    );

    return c.json({
      appointment_id: appointmentId,
      identifier,
      amount_applied: amountApplied,
      balance_due: Math.max(0, Math.round((totalPrice - amountApplied) * 100) / 100),
    });
  }) as any);

  const markRefunded = createRoute({
    method: "post",
    path: "/api/pending-payments/{id}/mark-refunded",
    request: {
      params: z.object({ id: z.coerce.number().int() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              note: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Marked refunded",
        content: {
          "application/json": {
            schema: z.object({ pending_payment: PendingPaymentSchema }),
          },
        },
      },
      400: { description: "Invalid", content: { "application/json": { schema: ErrorSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  app.openapi(markRefunded, (async (c: any) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const pending = await get<PendingRow>("SELECT * FROM pending_payments WHERE id = ?", [id]);
    if (!pending) return c.json({ error: "Pending payment not found" }, 404);
    if (pending.status !== "open") {
      return c.json({ error: "Only open pending payments can be marked refunded" }, 400);
    }

    const note = body.note?.trim();
    const notes = note
      ? `${pending.notes ? `${pending.notes}\n` : ""}Refunded: ${note}`
      : pending.notes;

    await run(
      `UPDATE pending_payments SET status = 'refunded', notes = ?, applied_at = datetime('now') WHERE id = ?`,
      [notes, id],
    );

    const row = await get<PendingRow>(
      `SELECT pp.*, c.name as client_name, c.email as client_email, c.phone as client_phone, s.name as staff_name
       FROM pending_payments pp
       JOIN clients c ON c.id = pp.client_id
       LEFT JOIN staff s ON s.id = pp.staff_id
       WHERE pp.id = ?`,
      [id],
    );
    if (!row) return c.json({ error: "Pending payment not found" }, 404);
    return c.json({ pending_payment: formatPending(row) });
  }) as any);
}
