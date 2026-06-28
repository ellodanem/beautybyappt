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
  const isDeposit = amountPaid <= 0 && amount < balance - 0.009;
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

const TokenParam = z.object({
  token: z.string().openapi({ param: { name: "token", in: "path" } }),
});

type AppointmentPaymentRow = {
  identifier: string;
  total_price: number;
  deposit_amount: number;
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
};

async function loadAppointmentForPayment(appointmentId: number): Promise<AppointmentPaymentRow | null> {
  return get<AppointmentPaymentRow>(
    `SELECT a.identifier, a.total_price, a.deposit_amount, a.amount_paid, a.currency, a.scheduled_date, a.start_time, a.end_time,
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
}

export async function loadPendingAppointmentPayments(appointmentId: number) {
  return query<{ id: number; stripe_checkout_session_id: string | null; status: string }>(
    `SELECT id, stripe_checkout_session_id, status FROM payments
     WHERE appointment_id = ? AND status IN ('open', 'pending')`,
    [appointmentId],
  );
}

export async function loadPendingPaymentSummary(
  appointmentId: number,
  env?: StripeEnv,
  requestUrl?: string,
) {
  const row = await get<{
    amount: number;
    currency: string;
    created_at: string;
    stripe_checkout_session_id: string | null;
    link_token: string | null;
    status: string;
    total_price: number;
    amount_paid: number;
  }>(
    `SELECT p.amount, p.currency, p.created_at, p.stripe_checkout_session_id, p.link_token, p.status,
            a.total_price, a.amount_paid
     FROM payments p
     JOIN appointments a ON a.id = p.appointment_id
     WHERE p.appointment_id = ? AND p.status IN ('open', 'pending')
     ORDER BY p.created_at DESC LIMIT 1`,
    [appointmentId],
  );
  if (!row) return null;

  const balance = appointmentBalance(row.total_price, row.amount_paid);
  const base = env ? appBaseUrl(env, requestUrl) : null;
  const page_url = row.link_token && base ? `${base}/pay/${row.link_token}` : null;

  let checkout_url = page_url;
  if (row.status === "pending" && row.stripe_checkout_session_id && env && isStripeConfigured(env)) {
    try {
      const session = await retrieveCheckoutSession(env, row.stripe_checkout_session_id);
      checkout_url = session.url ?? page_url;
    } catch {
      checkout_url = page_url;
    }
  }

  return {
    amount: row.status === "pending" && row.amount > 0 ? row.amount : balance,
    currency: row.currency,
    created_at: row.created_at,
    page_url,
    checkout_url,
  };
}

export async function expirePendingAppointmentPayments(
  env: StripeEnv,
  appointmentId: number,
): Promise<void> {
  const active = await loadPendingAppointmentPayments(appointmentId);
  for (const payment of active) {
    if (payment.status === "pending" && payment.stripe_checkout_session_id) {
      try {
        await expireCheckoutSession(env, payment.stripe_checkout_session_id);
      } catch (err) {
        console.warn("Expire checkout session failed:", (err as Error).message);
      }
    }
    await run("UPDATE payments SET status = 'expired' WHERE id = ?", [payment.id]);
  }
}

async function loadPaymentByToken(token: string) {
  return get<{
    id: number;
    appointment_id: number;
    status: string;
    stripe_checkout_session_id: string | null;
    amount: number;
    currency: string;
  }>(
    `SELECT id, appointment_id, status, stripe_checkout_session_id, amount, currency FROM payments
     WHERE link_token = ? AND status IN ('open', 'pending')`,
    [token],
  );
}

export async function createAppointmentPaymentLink(
  env: StripeEnv,
  appointmentId: number,
  requestUrl: string,
): Promise<{
  page_url: string;
  link_token: string;
  balance_due: number;
  deposit_due: number;
  currency: string;
}> {
  if (!await isStripePaymentsActive(env)) throw new Error("Stripe payments are disabled");

  const apt = await loadAppointmentForPayment(appointmentId);
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

  const token = generateBookingToken();
  const base = appBaseUrl(env, requestUrl);
  const depositDue = appointmentCheckoutAmount(apt, "deposit");

  await run(
    `INSERT INTO payments (appointment_id, link_token, amount, currency, type, status)
     VALUES (?, ?, 0, ?, 'link', 'open')`,
    [appointmentId, token, currency],
  );

  await run(
    "INSERT INTO appointment_notes (appointment_id, content) VALUES (?, ?)",
    [appointmentId, `Payment link sent — client can book with deposit (${formatMoney(depositDue, currency)}) or pay in full (${formatMoney(balance, currency)})`],
  );

  return {
    page_url: `${base}/pay/${token}`,
    link_token: token,
    balance_due: balance,
    deposit_due: depositDue,
    currency,
  };
}

export async function createAppointmentStripeCheckout(
  env: StripeEnv,
  token: string,
  paymentChoice: PaymentChoice,
  requestUrl: string,
): Promise<{ checkout_url: string; session_id: string; amount: number; currency: string }> {
  if (!await isStripePaymentsActive(env)) throw new Error("Stripe payments are disabled");

  const payment = await loadPaymentByToken(token);
  if (!payment) throw new Error("Payment link not found or expired");

  const apt = await loadAppointmentForPayment(payment.appointment_id);
  if (!apt) throw new Error("Appointment not found");

  const total = apt.total_price ?? 0;
  const amountPaid = apt.amount_paid ?? 0;
  const balance = appointmentBalance(total, amountPaid);
  if (balance <= 0) throw new Error("This booking is already paid in full");

  const hasChoice = appointmentHasPaymentChoice(apt);
  const choice: PaymentChoice = hasChoice && paymentChoice === "deposit" ? "deposit" : "full";
  const amount = Math.round(appointmentCheckoutAmount(apt, choice) * 100) / 100;

  if (payment.status === "pending" && payment.stripe_checkout_session_id) {
    try {
      const existing = await retrieveCheckoutSession(env, payment.stripe_checkout_session_id);
      if (existing.url && existing.payment_status !== "paid") {
        const existingAmount = existing.amount_total != null ? existing.amount_total / 100 : payment.amount;
        if (Math.abs(existingAmount - amount) < 0.01) {
          return {
            checkout_url: existing.url,
            session_id: existing.id,
            amount: payment.amount,
            currency: payment.currency,
          };
        }
        await expireCheckoutSession(env, payment.stripe_checkout_session_id);
      }
    } catch {
      // create a fresh session below
    }
  }

  const currency = (apt.currency || payment.currency || "USD").toUpperCase();
  const minCharge = minChargeAmount(currency);
  if (amount < minCharge) {
    throw new Error(`Amount must be at least ${currency} ${minCharge.toFixed(2)} to collect via Stripe`);
  }

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
    cancelUrl: `${base}/pay/${token}?cancelled=1`,
    customerEmail: apt.client_email ?? undefined,
    submitMessage: checkoutCopy.submitMessage,
    submitButtonLabel: "Book",
    metadata: {
      type: "appointment_payment",
      appointment_id: String(payment.appointment_id),
      amount: amount.toFixed(2),
      identifier: apt.identifier,
      payment_choice: choice,
    },
  });

  if (!session.url) throw new Error("Failed to create checkout session");

  const paymentType = amountPaid <= 0 && amount >= total - 0.009 ? "full" : amountPaid <= 0 ? "deposit" : "balance";

  await run(
    `UPDATE payments SET stripe_checkout_session_id = ?, amount = ?, type = ?, status = 'pending' WHERE id = ?`,
    [session.id, amount, paymentType, payment.id],
  );

  return { checkout_url: session.url, session_id: session.id, amount, currency };
}

export async function loadPublicPaymentPage(token: string, env: StripeEnv) {
  const payment = await loadPaymentByToken(token);
  if (!payment) return null;

  const apt = await loadAppointmentForPayment(payment.appointment_id);
  if (!apt) return null;

  const balance = appointmentBalance(apt.total_price, apt.amount_paid ?? 0);
  if (balance <= 0) return null;

  const currency = (apt.currency || payment.currency || "USD").toUpperCase();
  const hasChoice = appointmentHasPaymentChoice(apt);
  const depositAmount = appointmentCheckoutAmount(apt, "deposit");
  const fullAmount = appointmentCheckoutAmount(apt, "full");

  let continueCheckoutUrl: string | null = null;
  if (payment.status === "pending" && payment.stripe_checkout_session_id && isStripeConfigured(env)) {
    try {
      const session = await retrieveCheckoutSession(env, payment.stripe_checkout_session_id);
      continueCheckoutUrl = session.url;
    } catch {
      continueCheckoutUrl = null;
    }
  }

  return {
    appointment: {
      identifier: apt.identifier,
      scheduled_date: apt.scheduled_date,
      start_time: apt.start_time,
      end_time: apt.end_time,
      total_price: apt.total_price,
      deposit_amount: apt.deposit_amount ?? 0,
      amount_paid: apt.amount_paid ?? 0,
      currency,
      client_name: apt.client_name,
      staff_name: apt.staff_name,
      offering_name: apt.offering_name,
      service_name: apt.service_name,
    },
    payment_choice_available: hasChoice,
    deposit_amount: depositAmount,
    full_amount: fullAmount,
    balance_due: balance,
    continue_checkout_url: continueCheckoutUrl,
    status: payment.status,
  };
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
    `UPDATE payments SET status = 'expired' WHERE appointment_id = ? AND status IN ('open', 'pending') AND (stripe_checkout_session_id IS NULL OR stripe_checkout_session_id != ?)`,
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
        description: "Public payment page link for appointment",
        content: {
          "application/json": {
            schema: z.object({
              page_url: z.string(),
              link_token: z.string(),
              balance_due: z.number(),
              deposit_due: z.number(),
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

  const getPublicPayment = createRoute({
    method: "get",
    path: "/api/pay/public/{token}",
    request: { params: TokenParam },
    responses: {
      200: {
        description: "Public appointment payment page data",
        content: { "application/json": { schema: z.object({}).passthrough() } },
      },
      404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  app.openapi(getPublicPayment, async (c) => {
    const { token } = c.req.valid("param");
    const env = runtimeEnv(c.env) as StripeEnv;
    const data = await loadPublicPaymentPage(token, env);
    if (!data) return c.json({ error: "Payment link not found or expired" }, 404);
    return c.json(data, 200);
  });

  const checkoutPublicPayment = createRoute({
    method: "post",
    path: "/api/pay/public/{token}/checkout",
    request: {
      params: TokenParam,
      body: {
        content: {
          "application/json": {
            schema: z.object({
              payment_choice: z.enum(["full", "deposit"]).optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Stripe Checkout redirect URL",
        content: {
          "application/json": {
            schema: z.object({
              checkout_url: z.string(),
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

  app.openapi(checkoutPublicPayment, async (c) => {
    const { token } = c.req.valid("param");
    const body = c.req.valid("json");
    const env = runtimeEnv(c.env) as StripeEnv;
    try {
      const result = await createAppointmentStripeCheckout(
        env,
        token,
        body.payment_choice === "deposit" ? "deposit" : "full",
        c.req.url,
      );
      return c.json({
        checkout_url: result.checkout_url,
        amount: result.amount,
        currency: result.currency,
      }, 200);
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
