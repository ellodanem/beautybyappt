import { get, run } from "./db.js";
import {
  appBaseUrl,
  createCheckoutSession,
  paymentIntentId,
  retrieveCheckoutSession,
  type StripeEnv,
} from "./stripe.js";
import { isStripePaymentsActive } from "./stripe-payments-settings.js";
import { feeCheckoutMetadata, maybeGrossUpLineItems, resolveNetPaidAmount } from "./stripe-checkout-fees.js";
import { computeDefaultDeposit, type PaymentChoice } from "../shared/payment.js";
import { roundMoney } from "../shared/stripe-fees.js";

export type PaymentLinkRow = {
  id: number;
  token: string;
  staff_id: number | null;
  quoted_total: number;
  deposit_amount: number;
  currency: string;
  notes: string;
  status: string;
  expires_at: string | null;
  client_id: number | null;
  pending_payment_id: number | null;
  stripe_checkout_session_id: string | null;
  fee_passthrough: number;
  created_at: string;
  paid_at: string | null;
  staff_name?: string | null;
};

export function paymentLinkHasDepositChoice(link: Pick<PaymentLinkRow, "quoted_total" | "deposit_amount">): boolean {
  return link.quoted_total > 0 && link.deposit_amount > 0 && link.deposit_amount < link.quoted_total - 0.009;
}

export function paymentLinkCheckoutNet(
  link: Pick<PaymentLinkRow, "quoted_total" | "deposit_amount">,
  choice: PaymentChoice,
): number {
  if (choice === "deposit" && paymentLinkHasDepositChoice(link)) {
    return roundMoney(link.deposit_amount);
  }
  return roundMoney(link.quoted_total);
}

export async function loadPaymentLinkByToken(token: string): Promise<PaymentLinkRow | null> {
  return (await get<PaymentLinkRow>(
    `SELECT pl.*, s.name as staff_name FROM payment_links pl
     LEFT JOIN staff s ON s.id = pl.staff_id WHERE pl.token = ?`,
    [token],
  )) ?? null;
}

export async function loadPaymentLinkById(id: number): Promise<PaymentLinkRow | null> {
  return (await get<PaymentLinkRow>(
    `SELECT pl.*, s.name as staff_name FROM payment_links pl
     LEFT JOIN staff s ON s.id = pl.staff_id WHERE pl.id = ?`,
    [id],
  )) ?? null;
}

export async function loadPaymentLinkBySessionId(sessionId: string): Promise<PaymentLinkRow | null> {
  return (await get<PaymentLinkRow>(
    `SELECT pl.*, s.name as staff_name FROM payment_links pl
     LEFT JOIN staff s ON s.id = pl.staff_id WHERE pl.stripe_checkout_session_id = ?`,
    [sessionId],
  )) ?? null;
}

export async function createPaymentLinkCheckout(
  env: StripeEnv,
  link: PaymentLinkRow,
  clientId: number,
  requestUrl: string,
  paymentChoice: PaymentChoice = "full",
  clientWasExisting = false,
): Promise<{ checkout_url: string; session_id: string }> {
  if (!await isStripePaymentsActive(env)) throw new Error("Stripe payments are disabled");

  const choice: PaymentChoice =
    paymentChoice === "deposit" && paymentLinkHasDepositChoice(link) ? "deposit" : "full";
  const netAmount = paymentLinkCheckoutNet(link, choice);
  if (netAmount <= 0) throw new Error("No payment required");

  const feePassthrough = Boolean(link.fee_passthrough);
  const adjusted = await maybeGrossUpLineItems(
    [{
      name: choice === "deposit" ? "Deposit" : "Payment",
      description: choice === "deposit"
        ? `Deposit toward ${link.currency} ${link.quoted_total.toFixed(2)}`
        : "Payment toward appointment",
      amount: netAmount,
    }],
    feePassthrough,
  );

  const base = appBaseUrl(env, requestUrl);
  const session = await createCheckoutSession(env, {
    currency: link.currency,
    lineItems: adjusted.lineItems,
    successUrl: `${base}/p/${link.token}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}/p/${link.token}?cancelled=1`,
    metadata: {
      type: choice === "deposit" ? "payment_link_deposit" : "payment_link_full",
      payment_link_id: String(link.id),
      payment_link_token: link.token,
      payment_choice: choice,
      client_was_existing: clientWasExisting ? "1" : "0",
      ...feeCheckoutMetadata(adjusted),
    },
  });

  if (!session.url) throw new Error("Failed to create checkout session");

  await run(
    `UPDATE payment_links SET client_id = ?, status = 'awaiting_payment', stripe_checkout_session_id = ? WHERE id = ?`,
    [clientId, session.id, link.id],
  );

  return { checkout_url: session.url, session_id: session.id };
}

export async function finalizePaymentLinkCheckout(
  env: StripeEnv,
  sessionId: string,
): Promise<{
  already_done: boolean;
  pending_payment_id: number | null;
}> {
  const session = await retrieveCheckoutSession(env, sessionId);
  if (session.payment_status !== "paid") {
    throw new Error("Payment not completed");
  }

  let link = await loadPaymentLinkBySessionId(sessionId);
  if (!link && session.metadata?.payment_link_id) {
    link = await loadPaymentLinkById(parseInt(session.metadata.payment_link_id, 10));
  }
  if (!link) throw new Error("Payment link not found");

  if (link.status === "paid" && link.pending_payment_id) {
    return { already_done: true, pending_payment_id: link.pending_payment_id };
  }

  const clientId = link.client_id;
  if (!clientId) throw new Error("Client not found for this payment");

  const choice = (session.metadata?.payment_choice === "deposit" ? "deposit" : "full") as PaymentChoice;
  const expectedNet = paymentLinkCheckoutNet(link, choice);
  const amountPaid = resolveNetPaidAmount(session.metadata, session.amount_total, expectedNet);
  const piId = paymentIntentId(session);
  const paymentType = choice === "deposit" ? "deposit" : "full";
  const clientWasExisting = session.metadata?.client_was_existing === "1";

  const existingPending = await get<{ id: number }>(
    "SELECT id FROM pending_payments WHERE stripe_checkout_session_id = ?",
    [sessionId],
  );
  if (existingPending) {
    await run(
      `UPDATE payment_links SET status = 'paid', pending_payment_id = ?, paid_at = COALESCE(paid_at, datetime('now')), stripe_checkout_session_id = ? WHERE id = ?`,
      [existingPending.id, sessionId, link.id],
    );
    return { already_done: true, pending_payment_id: existingPending.id };
  }

  const insert = await run(
    `INSERT INTO pending_payments (
      payment_link_id, client_id, staff_id, quoted_total, amount_paid, currency, notes,
      status, client_was_existing, stripe_checkout_session_id, stripe_payment_intent_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    [
      link.id,
      clientId,
      link.staff_id,
      link.quoted_total,
      amountPaid,
      link.currency,
      link.notes || "",
      clientWasExisting ? 1 : 0,
      sessionId,
      piId,
    ],
  );
  const pendingId = Number(insert.lastInsertRowid);

  await run(
    `UPDATE payment_links SET status = 'paid', pending_payment_id = ?, paid_at = datetime('now'), stripe_checkout_session_id = ? WHERE id = ?`,
    [pendingId, sessionId, link.id],
  );

  await run(
    `INSERT INTO payments (appointment_id, stripe_checkout_session_id, stripe_payment_intent_id, amount, currency, type, status, fee_passthrough)
     VALUES (NULL, ?, ?, ?, ?, ?, 'succeeded', ?)`,
    [sessionId, piId, amountPaid, link.currency, paymentType, link.fee_passthrough ? 1 : 0],
  );

  return { already_done: false, pending_payment_id: pendingId };
}

export function resolvePaymentLinkDeposit(
  quotedTotal: number,
  collect: "full" | "deposit",
): number {
  if (quotedTotal <= 0) return 0;
  if (collect === "full") return quotedTotal;
  return computeDefaultDeposit(quotedTotal, 0.5);
}

export function isPaymentLinkCheckoutMetadata(type: string | undefined): boolean {
  return type === "payment_link_full" || type === "payment_link_deposit";
}
