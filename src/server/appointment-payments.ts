import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { get, query, run } from "./db.js";
import { runtimeEnv } from "./runtime-env.js";
import {
  appBaseUrl,
  createCheckoutSession,
  expireCheckoutSession,
  isStripeConfigured,
  paymentIntentId,
  retrieveCheckoutSession,
  type StripeEnv,
} from "./stripe.js";
import { isStripePaymentsActive } from "./stripe-payments-settings.js";
import {
  appointmentBalance,
  appointmentCheckoutAmount,
  appointmentHasPaymentChoice,
  derivePaymentStatus,
  type PaymentChoice,
} from "../shared/payment.js";
import { formatMoney } from "../shared/currency.js";
import { scheduleBookingConfirmation } from "./notifications.js";
import { generateBookingToken } from "./helpers.js";

const ErrorSchema = z.object({ error: z.string() }).openapi("AppointmentPaymentError");

const IdParam = z.object({ id: z.string().openapi({ param: { name: "id", in: "path" } }) });

const STRIPE_MIN_USD = 0.5;
const STRIPE_TEXT_LIMIT = 500;

function minChargeAmount(currency: string): number {
  if (currency.toUpperCase() === "USD") return STRIPE_MIN_USD;
  return STRIPE_MIN_USD;
}

function truncateStripeText(value: string, max = STRIPE_TEXT_LIMIT): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function formatCheckoutDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCheckoutTime(timeStr: string): string {
  const [h, m] = timeStr.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

function appointmentCheckoutCopy(
  apt: {
    identifier: string;
    total_price: number;
    scheduled_date: string;
    start_time: string;
    end_time: string;
    client_name: string | null;
    staff_name: string | null;
    offering_name: string | null;
    service_name: string | null;
  },
  amountPaid: number,
  balance: number,
  amount: number,
  currency: string,
): { name: string; description: string; submitMessage: string } {
  const serviceLabel = apt.offering_name || apt.service_name || "Appointment";
  const clientLabel = apt.client_name?.trim() || "Client";
  const isDeposit = amountPaid <= 0 && balance < apt.total_price - 0.009;
  const paymentLabel = amountPaid > 0 ? "Balance payment" : isDeposit ? "Deposit" : "Payment";
  const dateTime = `${formatCheckoutDate(apt.scheduled_date)}, ${formatCheckoutTime(apt.start_time)} – ${formatCheckoutTime(apt.end_time)}`;
  const amountDue = formatMoney(amount, currency);
  const totalBooking = formatMoney(apt.total_price, currency);

  // Product name is the largest text on Stripe Checkout — lead with service + client.
  const name = truncateStripeText(`${serviceLabel} — ${clientLabel}`, 250);

  const description = truncateStripeText([
    dateTime,
    apt.identifier,
    apt.staff_name ? `Artist: ${apt.staff_name}` : null,
    paymentLabel,
  ].filter(Boolean).join("\n"));

  const submitLines = [
    `${apt.identifier} · ${paymentLabel}`,
    dateTime,
    apt.staff_name ? `Artist: ${apt.staff_name}` : null,
    "",
    amountPaid > 0
      ? `Book now: ${amountDue} (${totalBooking} total booking)`
      : isDeposit
        ? `Book with ${amountDue} deposit (${totalBooking} total booking)`
        : `Book now: ${amountDue}`,
  ].filter((line): line is string => line !== null);

  return {
    name,
    description,
    submitMessage: truncateStripeText(submitLines.join("\n"), 1200),
  };
}

function resolvePaymentType(
  total: number,
  amountPaidBefore: number,
  amountCharged: number,
  paymentStatus: string,
): string {
  if (paymentStatus === "paid") return "full";
  if (amountPaidBefore <= 0 && amountCharged >= total - 0.009) return "full";
  if (amountPaidBefore <= 0) return "deposit";
  return "balance";
}

export async function loadPendingAppointmentPayments(appointmentId: number) {
  return query<{ id: number; stripe_checkout_session_id: string; amount: number }>(
    `SELECT id, stripe_checkout_session_id, amount FROM payments
     WHERE appointment_id = ? AND status = 'pending' AND stripe_checkout_session_id IS NOT NULL`,
    [appointmentId],
  );
}

export async function loadPendingPaymentSummary(appointmentId: number, env?: StripeEnv) {
  const row = await get<{
    amount: number;
    currency: string;
    created_at: string;
    stripe_checkout_session_id: string | null;
  }>(
    `SELECT amount, currency, created_at, stripe_checkout_session_id FROM payments
     WHERE appointment_id = ? AND status = 'pending'
     ORDER BY created_at DESC LIMIT 1`,
    [appointmentId],
  );
  if (!row) return null;

  let checkout_url: string | null = null;
  if (env && row.stripe_checkout_session_id && isStripeConfigured(env)) {
    try {
      const session = await retrieveCheckoutSession(env, row.stripe_checkout_session_id);
      checkout_url = session.url;
    } catch {
      checkout_url = null;
    }
  }

  return {
    amount: row.amount,
    currency: row.currency,
    created_at: row.created_at,
    checkout_url,
  };
}

export async function expirePendingAppointmentPayments(
  env: StripeEnv,
  appointmentId: number,
): Promise<void> {
  const pending = await loadPendingAppointmentPayments(appointmentId);
  for (const payment of pending) {
    try {
      await expireCheckoutSession(env, payment.stripe_checkout_session_id);
    } catch (err) {
      console.warn("Expire checkout session failed:", (err as Error).message);
    }
    await run("UPDATE payments SET status = 'expired' WHERE id = ?", [payment.id]);
  }
}

export async function createAppointmentPaymentLink(
  env: StripeEnv,
  appointmentId: number,
  requestUrl: string,
): Promise<{ checkout_url: string; session_id: string; amount: number; currency: string }> {
  if (!await isStripePaymentsActive(env)) throw new Error("Stripe payments are disabled");

  const apt = await get<{
    identifier: string;
    total_price: number;
    amount_paid: number;
    currency: string | null;
    scheduled_date: string;
    start_time: string;
    end_time: string;
    client_name: string | null;
    client_email: string | null;
    staff_name: string | null;
    offering_name: string | null;
    service_name: string | null;
  }>(
    `SELECT a.identifier, a.total_price, a.amount_paid, a.currency, a.scheduled_date, a.start_time, a.end_time,
            cl.name as client_name, cl.email as client_email,
            s.name as staff_name,
            o.name as offering_name,
            (SELECT sv.name FROM appointment_services aps
             JOIN services sv ON sv.id = aps.service_id
             WHERE aps.appointment_id = a.id
             ORDER BY aps.id LIMIT 1) as service_name
     FROM appointments a
     LEFT JOIN clients cl ON cl.id = a.client_id
     LEFT JOIN staff s ON s.id = a.staff_id
     LEFT JOIN offering_slot_instances si ON si.id = a.offering_slot_instance_id
     LEFT JOIN offerings o ON o.id = si.offering_id
     WHERE a.id = ?`,
    [appointmentId],
  );
  if (!apt) throw new Error("Appointment not found");

  const total = apt.total_price ?? 0;
  const amountPaid = apt.amount_paid ?? 0;
  const balance = appointmentBalance(total, amountPaid);

  if (total <= 0) throw new Error("No payment required for this booking");
  if (balance <= 0) throw new Error("This booking is already paid in full");

  const currency = (apt.currency || "USD").toUpperCase();
  const minCharge = minChargeAmount(currency);
  if (balance < minCharge) {
    throw new Error(`Balance must be at least ${currency} ${minCharge.toFixed(2)} to collect via Stripe`);
  }

  await expirePendingAppointmentPayments(env, appointmentId);

  const amount = Math.round(balance * 100) / 100;
  const base = appBaseUrl(env, requestUrl);
  const checkoutCopy = appointmentCheckoutCopy(apt, amountPaid, balance, amount, currency);

  const session = await createCheckoutSession(env, {
    currency,
    lineItems: [{
      name: checkoutCopy.name,
      description: checkoutCopy.description,
      amount,
    }],
    successUrl: `${base}/pay/success?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}/pay/cancelled`,
    customerEmail: apt.client_email ?? undefined,
    submitMessage: checkoutCopy.submitMessage,
    metadata: {
      type: "appointment_payment",
      appointment_id: String(appointmentId),
      amount: amount.toFixed(2),
      identifier: apt.identifier,
    },
  });

  if (!session.url) throw new Error("Failed to create checkout session");

  const paymentType = amountPaid <= 0 && amount >= total - 0.009 ? "full" : amountPaid <= 0 ? "deposit" : "balance";

  await run(
    `INSERT INTO payments (appointment_id, stripe_checkout_session_id, amount, currency, type, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
    [appointmentId, session.id, amount, currency, paymentType],
  );

  await run(
    "INSERT INTO appointment_notes (appointment_id, content) VALUES (?, ?)",
    [appointmentId, `Payment link sent for ${currency} ${amount.toFixed(2)}`],
  );

  return { checkout_url: session.url, session_id: session.id, amount, currency };
}

export async function finalizeAppointmentPaymentCheckout(
  env: StripeEnv,
  sessionId: string,
): Promise<{
  already_done: boolean;
  appointment_id: number;
  amount_credited: number;
  payment_status: string;
  identifier?: string;
}> {
  const session = await retrieveCheckoutSession(env, sessionId);
  if (session.payment_status !== "paid") {
    throw new Error("Payment not completed");
  }

  if (session.metadata?.type !== "appointment_payment") {
    throw new Error("Not an appointment payment session");
  }

  const appointmentId = parseInt(session.metadata.appointment_id, 10);
  if (!Number.isFinite(appointmentId)) throw new Error("Invalid appointment");

  const existing = await get<{ id: number; status: string; amount: number }>(
    "SELECT id, status, amount FROM payments WHERE stripe_checkout_session_id = ?",
    [sessionId],
  );

  if (existing?.status === "succeeded") {
    const apt = await get<{ payment_status: string; identifier: string }>(
      "SELECT payment_status, identifier FROM appointments WHERE id = ?",
      [appointmentId],
    );
    return {
      already_done: true,
      appointment_id: appointmentId,
      amount_credited: existing.amount,
      payment_status: apt?.payment_status ?? "paid",
      identifier: apt?.identifier,
    };
  }

  const snapshotAmount = parseFloat(session.metadata.amount ?? "0");
  const sessionAmount = session.amount_total != null ? session.amount_total / 100 : snapshotAmount;
  const amountToCredit = snapshotAmount > 0 ? snapshotAmount : sessionAmount;

  const apt = await get<{
    identifier: string;
    total_price: number;
    deposit_amount: number;
    amount_paid: number;
    currency: string | null;
  }>(
    "SELECT identifier, total_price, deposit_amount, amount_paid, currency FROM appointments WHERE id = ?",
    [appointmentId],
  );
  if (!apt) throw new Error("Appointment not found");

  const amountPaidBefore = apt.amount_paid ?? 0;
  const newAmountPaid = Math.min(
    apt.total_price,
    Math.round((amountPaidBefore + amountToCredit) * 100) / 100,
  );
  const paymentStatus = derivePaymentStatus(apt.total_price, apt.deposit_amount, newAmountPaid);
  const piId = paymentIntentId(session);
  const paymentType = resolvePaymentType(apt.total_price, amountPaidBefore, amountToCredit, paymentStatus);
  const currency = (apt.currency || session.currency || "USD").toUpperCase();

  if (existing) {
    await run(
      `UPDATE payments SET status = 'succeeded', stripe_payment_intent_id = ?, amount = ?, type = ? WHERE id = ?`,
      [piId, amountToCredit, paymentType, existing.id],
    );
  } else {
    await run(
      `INSERT INTO payments (appointment_id, stripe_checkout_session_id, stripe_payment_intent_id, amount, currency, type, status)
       VALUES (?, ?, ?, ?, ?, ?, 'succeeded')`,
      [appointmentId, sessionId, piId, amountToCredit, currency, paymentType],
    );
  }

  await run(
    `UPDATE appointments SET amount_paid = ?, payment_status = ?, stripe_checkout_session_id = ?, stripe_payment_intent_id = ?, updated_at = datetime('now') WHERE id = ?`,
    [newAmountPaid, paymentStatus, sessionId, piId, appointmentId],
  );

  await run(
    `UPDATE payments SET status = 'expired' WHERE appointment_id = ? AND status = 'pending' AND stripe_checkout_session_id != ?`,
    [appointmentId, sessionId],
  );

  if (!existing || existing.status !== "succeeded") {
    await run(
      "INSERT INTO appointment_notes (appointment_id, content) VALUES (?, ?)",
      [appointmentId, `${currency} ${amountToCredit.toFixed(2)} received via Stripe`],
    );
  }

  return {
    already_done: false,
    appointment_id: appointmentId,
    amount_credited: amountToCredit,
    payment_status: paymentStatus,
    identifier: apt.identifier,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerAppointmentPaymentRoutes(app: OpenAPIHono<any>) {
  const createPaymentLink = createRoute({
    method: "post",
    path: "/api/appointments/{id}/payment-link",
    request: { params: IdParam },
    responses: {
      200: {
        description: "Stripe Checkout session for appointment balance",
        content: {
          "application/json": {
            schema: z.object({
              checkout_url: z.string(),
              session_id: z.string(),
              amount: z.number(),
              currency: z.string(),
            }),
          },
        },
      },
      400: { description: "Invalid", content: { "application/json": { schema: ErrorSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  app.openapi(createPaymentLink, async (c) => {
    const { id } = c.req.valid("param");
    const appointmentId = parseInt(id, 10);
    const env = runtimeEnv(c.env) as StripeEnv;

    const exists = await get<{ id: number }>("SELECT id FROM appointments WHERE id = ?", [appointmentId]);
    if (!exists) return c.json({ error: "Appointment not found" }, 404);

    try {
      const result = await createAppointmentPaymentLink(env, appointmentId, c.req.url);
      return c.json(result, 200);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  const completePayment = createRoute({
    method: "get",
    path: "/api/payments/complete",
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
                total_price: z.number(),
                amount_paid: z.number(),
                payment_status: z.string(),
                currency: z.string(),
              }),
              amount_credited: z.number(),
            }),
          },
        },
      },
      400: { description: "Invalid", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  app.openapi(completePayment, async (c) => {
    const { session_id: sessionId } = c.req.valid("query");
    const env = runtimeEnv(c.env) as StripeEnv;

    try {
      const result = await finalizeAppointmentPaymentCheckout(env, sessionId);
      const apt = await get<{
        identifier: string;
        total_price: number;
        amount_paid: number;
        payment_status: string;
        currency: string | null;
      }>(
        "SELECT identifier, total_price, amount_paid, payment_status, currency FROM appointments WHERE id = ?",
        [result.appointment_id],
      );
      if (!apt) return c.json({ error: "Appointment not found" }, 400);

      if (!result.already_done) {
        scheduleBookingConfirmation(c, result.appointment_id, { receipt: true });
      }

      return c.json({
        appointment: {
          identifier: apt.identifier,
          total_price: apt.total_price,
          amount_paid: apt.amount_paid,
          payment_status: apt.payment_status,
          currency: apt.currency || "USD",
        },
        amount_credited: result.amount_credited,
      }, 200);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });
}
