import { get, query, run } from "./db.js";
import {
  appBaseUrl,
  createCheckoutSession,
  paymentIntentId,
  retrieveCheckoutSession,
  type CheckoutLineItem,
  type StripeEnv,
} from "./stripe.js";
import { isStripePaymentsActive } from "./stripe-payments-settings.js";
import {
  derivePaymentStatus,
  offeringCheckoutAmount,
  offeringRequiresPayment,
  resolveOfferingDeposit,
  type PaymentChoice,
} from "../shared/payment.js";
import { createAnytimeAppointment, assertAnytimeSlotAvailable } from "./anytime-booking.js";

const CHECKOUT_HOLD_MINUTES = 15;

export type AnytimeCheckoutRow = {
  id: number;
  service_id: number;
  service_slug: string;
  client_id: number;
  scheduled_date: string;
  start_time: string;
  end_time: string;
  staff_id: number | null;
  addon_ids: string;
  notes: string;
  total_price: number;
  deposit_amount: number;
  currency: string;
  payment_choice: string;
  stripe_checkout_session_id: string | null;
  status: string;
  expires_at: string;
  appointment_id: number | null;
};

function checkoutExpiresAt(): string {
  return new Date(Date.now() + CHECKOUT_HOLD_MINUTES * 60 * 1000).toISOString();
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseAddonIds(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === "number") : [];
  } catch {
    return [];
  }
}

export async function expireStaleAnytimeCheckouts(): Promise<void> {
  await run(
    `UPDATE anytime_booking_checkouts SET status = 'expired'
     WHERE status = 'pending' AND expires_at <= ?`,
    [nowIso()],
  );
}

export async function loadPendingAnytimeHolds(
  date: string,
): Promise<{ staff_id: number | null; start_time: string; end_time: string }[]> {
  await expireStaleAnytimeCheckouts();
  return query<{ staff_id: number | null; start_time: string; end_time: string }>(
    `SELECT staff_id, start_time, end_time FROM anytime_booking_checkouts
     WHERE scheduled_date = ? AND status = 'pending' AND expires_at > ?`,
    [date, nowIso()],
  );
}

function anytimeBookingPath(serviceSlug: string): string {
  return serviceSlug ? `/anytime/${encodeURIComponent(serviceSlug)}` : "/anytime";
}

function anytimeSuccessPath(serviceSlug: string): string {
  return serviceSlug ? `/anytime/${encodeURIComponent(serviceSlug)}/success` : "/anytime/success";
}

function checkoutLineItems(
  checkout: Pick<AnytimeCheckoutRow, "total_price" | "deposit_amount" | "payment_choice">,
  serviceName: string,
  scheduledDate: string,
  startTime: string,
): CheckoutLineItem[] {
  const choice = checkout.payment_choice === "deposit" ? "deposit" : "full";
  const items: CheckoutLineItem[] = [];

  if (choice === "full") {
    items.push({
      name: serviceName,
      description: `${scheduledDate} ${startTime} appointment`,
      amount: checkout.total_price,
    });
  } else if (checkout.deposit_amount > 0) {
    items.push({
      name: `${serviceName} deposit`,
      description: `${scheduledDate} ${startTime} appointment deposit`,
      amount: checkout.deposit_amount,
    });
  }

  return items;
}

async function loadAnytimeCheckoutById(id: number): Promise<AnytimeCheckoutRow | null> {
  return get<AnytimeCheckoutRow>("SELECT * FROM anytime_booking_checkouts WHERE id = ?", [id]);
}

async function loadAnytimeCheckoutBySessionId(sessionId: string): Promise<AnytimeCheckoutRow | null> {
  return get<AnytimeCheckoutRow>(
    "SELECT * FROM anytime_booking_checkouts WHERE stripe_checkout_session_id = ?",
    [sessionId],
  );
}

export async function createAnytimeBookingCheckout(
  env: StripeEnv,
  opts: {
    serviceId: number;
    serviceSlug: string;
    serviceName: string;
    clientId: number;
    scheduledDate: string;
    startTime: string;
    endTime: string;
    staffId: number | null;
    addonIds: number[];
    notes?: string;
    totalPrice: number;
    currency: string;
    paymentChoice: PaymentChoice;
    requestUrl: string;
    clientEmail?: string;
  },
): Promise<{ checkout_url: string; session_id: string }> {
  if (!await isStripePaymentsActive(env)) throw new Error("Stripe payments are disabled");
  if (!offeringRequiresPayment(opts.totalPrice)) throw new Error("No payment required");

  await expireStaleAnytimeCheckouts();

  try {
    await assertAnytimeSlotAvailable(
      opts.scheduledDate,
      opts.startTime,
      opts.endTime,
      opts.staffId,
    );
  } catch {
    throw new Error("That time is no longer available");
  }

  const depositAmount = resolveOfferingDeposit(opts.totalPrice);
  const expiresAt = checkoutExpiresAt();

  const insert = await run(
    `INSERT INTO anytime_booking_checkouts (
      service_id, service_slug, client_id, scheduled_date, start_time, end_time, staff_id,
      addon_ids, notes, total_price, deposit_amount, currency, payment_choice, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.serviceId,
      opts.serviceSlug,
      opts.clientId,
      opts.scheduledDate,
      opts.startTime,
      opts.endTime,
      opts.staffId,
      JSON.stringify(opts.addonIds),
      opts.notes?.trim() || "",
      opts.totalPrice,
      depositAmount,
      opts.currency,
      opts.paymentChoice,
      expiresAt,
    ],
  );

  const checkoutId = Number(insert.lastInsertRowid);
  const checkout = await loadAnytimeCheckoutById(checkoutId);
  if (!checkout) throw new Error("Failed to create checkout hold");

  const lineItems = checkoutLineItems(
    checkout,
    opts.serviceName,
    opts.scheduledDate,
    opts.startTime,
  );
  if (lineItems.length === 0) throw new Error("No payment required");

  const base = appBaseUrl(env, opts.requestUrl);
  const session = await createCheckoutSession(env, {
    currency: opts.currency,
    lineItems,
    successUrl: `${base}${anytimeSuccessPath(opts.serviceSlug)}?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}${anytimeBookingPath(opts.serviceSlug)}?cancelled=1`,
    customerEmail: opts.clientEmail,
    metadata: {
      type: opts.paymentChoice === "full" ? "anytime_booking_full" : "anytime_booking_deposit",
      payment_choice: opts.paymentChoice,
      anytime_checkout_id: String(checkoutId),
      service_slug: opts.serviceSlug,
    },
  });

  if (!session.url) throw new Error("Failed to create checkout session");

  await run(
    "UPDATE anytime_booking_checkouts SET stripe_checkout_session_id = ? WHERE id = ?",
    [session.id, checkoutId],
  );

  return { checkout_url: session.url, session_id: session.id };
}

export async function finalizeAnytimeBookingCheckout(
  env: StripeEnv,
  sessionId: string,
): Promise<{
  already_done: boolean;
  appointment_id: number | null;
  identifier?: string;
}> {
  const session = await retrieveCheckoutSession(env, sessionId);
  if (session.payment_status !== "paid") {
    throw new Error("Payment not completed");
  }

  let checkout = await loadAnytimeCheckoutBySessionId(sessionId);
  if (!checkout && session.metadata?.anytime_checkout_id) {
    checkout = await loadAnytimeCheckoutById(parseInt(session.metadata.anytime_checkout_id, 10));
  }
  if (!checkout) throw new Error("Anytime checkout not found");

  if (checkout.status === "completed" && checkout.appointment_id) {
    const apt = await get<{ identifier: string }>(
      "SELECT identifier FROM appointments WHERE id = ?",
      [checkout.appointment_id],
    );
    return {
      already_done: true,
      appointment_id: checkout.appointment_id,
      identifier: apt?.identifier,
    };
  }

  if (checkout.status !== "pending") {
    throw new Error("This checkout is no longer valid");
  }

  await expireStaleAnytimeCheckouts();

  await run(
    "UPDATE anytime_booking_checkouts SET status = 'processing' WHERE id = ? AND status = 'pending'",
    [checkout.id],
  );

  const service = await get<{
    id: number;
    name: string;
    slug: string;
    duration: number;
    price: number;
    allow_addons: number;
    active: number;
  }>("SELECT * FROM services WHERE id = ?", [checkout.service_id]);
  if (!service || !service.active) throw new Error("Service not found");

  try {
    await assertAnytimeSlotAvailable(
      checkout.scheduled_date,
      checkout.start_time,
      checkout.end_time,
      checkout.staff_id,
    );
  } catch {
    throw new Error("That time is no longer available — contact us for a refund");
  }

  const paymentChoice = (session.metadata?.payment_choice === "deposit" ? "deposit" : "full") as PaymentChoice;
  const expectedTotal = offeringCheckoutAmount(
    checkout.total_price,
    checkout.deposit_amount,
    paymentChoice,
  );
  const amountPaid = session.amount_total != null
    ? session.amount_total / 100
    : expectedTotal;
  const piId = paymentIntentId(session);
  const paymentStatus = derivePaymentStatus(
    checkout.total_price,
    checkout.deposit_amount,
    amountPaid,
  );
  const paymentType = paymentStatus === "paid" ? "full" : "deposit";

  const appointment = await createAnytimeAppointment({
    service,
    clientId: checkout.client_id,
    scheduledDate: checkout.scheduled_date,
    startTime: checkout.start_time,
    endTime: checkout.end_time,
    staffId: checkout.staff_id,
    addonIds: parseAddonIds(checkout.addon_ids),
    notes: checkout.notes,
    payment: {
      deposit_amount: checkout.deposit_amount,
      amount_paid: amountPaid,
      payment_status: paymentStatus,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: piId,
    },
  });

  const aptId = appointment.id as number;

  await run(
    `UPDATE anytime_booking_checkouts
     SET status = 'completed', appointment_id = ?, stripe_checkout_session_id = ?
     WHERE id = ?`,
    [aptId, session.id, checkout.id],
  );

  await run(
    `INSERT INTO payments (appointment_id, stripe_checkout_session_id, stripe_payment_intent_id, amount, currency, type, status)
     VALUES (?, ?, ?, ?, ?, ?, 'succeeded')`,
    [aptId, session.id, piId, amountPaid, checkout.currency, paymentType],
  );

  return {
    already_done: false,
    appointment_id: aptId,
    identifier: appointment.identifier as string,
  };
}

export function isAnytimeCheckoutMetadata(type: string | undefined): boolean {
  return type === "anytime_booking_full" || type === "anytime_booking_deposit";
}
