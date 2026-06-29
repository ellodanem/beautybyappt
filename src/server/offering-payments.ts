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
import { bookOfferingSlotInstance } from "./offerings.js";

export { offeringRequiresPayment };

const CHECKOUT_HOLD_MINUTES = 15;

export type OfferingCheckoutRow = {
  id: number;
  offering_id: number;
  slot_instance_id: number;
  client_id: number;
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

export async function expireStaleOfferingCheckouts(): Promise<void> {
  await run(
    `UPDATE offering_booking_checkouts SET status = 'expired'
     WHERE status = 'pending' AND expires_at <= ?`,
    [nowIso()],
  );
}

export async function countPendingOfferingCheckouts(slotInstanceId: number): Promise<number> {
  await expireStaleOfferingCheckouts();
  const row = await get<{ count: number }>(
    `SELECT COUNT(*) as count FROM offering_booking_checkouts
     WHERE slot_instance_id = ? AND status = 'pending' AND expires_at > ?`,
    [slotInstanceId, nowIso()],
  );
  return row?.count ?? 0;
}

export function offeringSlotSpotsLeft(
  capacity: number,
  bookedCount: number,
  pendingCheckouts: number,
): number {
  return Math.max(0, capacity - bookedCount - pendingCheckouts);
}

export async function computeOfferingBookingTotal(
  offeringId: number,
  basePrice: number,
  addonIds: number[],
  allowAddons = 1,
): Promise<number> {
  if (addonIds.length === 0 || !allowAddons) return basePrice;
  const addons = await query<{ price: number }>(
    `SELECT price FROM offering_addons
     WHERE offering_id = ? AND active = 1 AND id IN (${addonIds.map(() => "?").join(",")})`,
    [offeringId, ...addonIds],
  );
  return basePrice + addons.reduce((sum, a) => sum + a.price, 0);
}

function checkoutLineItems(
  checkout: Pick<OfferingCheckoutRow, "total_price" | "deposit_amount" | "payment_choice">,
  offeringName: string,
  slotDate: string,
  startTime: string,
): CheckoutLineItem[] {
  const choice = checkout.payment_choice === "deposit" ? "deposit" : "full";
  const items: CheckoutLineItem[] = [];

  if (choice === "full") {
    items.push({
      name: offeringName,
      description: `${slotDate} ${startTime} event booking`,
      amount: checkout.total_price,
    });
  } else if (checkout.deposit_amount > 0) {
    items.push({
      name: `${offeringName} deposit`,
      description: `${slotDate} ${startTime} event booking deposit`,
      amount: checkout.deposit_amount,
    });
  }

  return items;
}

async function loadOfferingCheckoutById(id: number): Promise<OfferingCheckoutRow | null> {
  return get<OfferingCheckoutRow>("SELECT * FROM offering_booking_checkouts WHERE id = ?", [id]);
}

export async function loadOfferingCheckoutBySessionId(
  sessionId: string,
): Promise<OfferingCheckoutRow | null> {
  return get<OfferingCheckoutRow>(
    "SELECT * FROM offering_booking_checkouts WHERE stripe_checkout_session_id = ?",
    [sessionId],
  );
}

export async function createOfferingBookingCheckout(
  env: StripeEnv,
  opts: {
    offeringId: number;
    offeringSlug: string;
    offeringName: string;
    slotInstanceId: number;
    slotDate: string;
    startTime: string;
    clientId: number;
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

  await expireStaleOfferingCheckouts();

  const slot = await get<{ capacity: number; booked_count: number }>(
    "SELECT capacity, booked_count FROM offering_slot_instances WHERE id = ?",
    [opts.slotInstanceId],
  );
  if (!slot) throw new Error("Time slot not found");

  const pending = await countPendingOfferingCheckouts(opts.slotInstanceId);
  if (offeringSlotSpotsLeft(slot.capacity, slot.booked_count, pending) <= 0) {
    throw new Error("SLOT_FULL");
  }

  const depositAmount = resolveOfferingDeposit(opts.totalPrice);
  const expiresAt = checkoutExpiresAt();

  const insert = await run(
    `INSERT INTO offering_booking_checkouts (
      offering_id, slot_instance_id, client_id, addon_ids, notes,
      total_price, deposit_amount, currency, payment_choice, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.offeringId,
      opts.slotInstanceId,
      opts.clientId,
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
  const checkout = await loadOfferingCheckoutById(checkoutId);
  if (!checkout) throw new Error("Failed to create checkout hold");

  const lineItems = checkoutLineItems(
    checkout,
    opts.offeringName,
    opts.slotDate,
    opts.startTime,
  );
  if (lineItems.length === 0) throw new Error("No payment required");

  const base = appBaseUrl(env, opts.requestUrl);
  const session = await createCheckoutSession(env, {
    currency: opts.currency,
    lineItems,
    successUrl: `${base}/offer/${encodeURIComponent(opts.offeringSlug)}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}/offer/${encodeURIComponent(opts.offeringSlug)}?cancelled=1`,
    customerEmail: opts.clientEmail,
    metadata: {
      type: opts.paymentChoice === "full" ? "offering_booking_full" : "offering_booking_deposit",
      payment_choice: opts.paymentChoice,
      offering_checkout_id: String(checkoutId),
      offering_slug: opts.offeringSlug,
    },
  });

  if (!session.url) throw new Error("Failed to create checkout session");

  await run(
    "UPDATE offering_booking_checkouts SET stripe_checkout_session_id = ? WHERE id = ?",
    [session.id, checkoutId],
  );

  return { checkout_url: session.url, session_id: session.id };
}

export async function finalizeOfferingBookingCheckout(
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

  let checkout = await loadOfferingCheckoutBySessionId(sessionId);
  if (!checkout && session.metadata?.offering_checkout_id) {
    checkout = await loadOfferingCheckoutById(parseInt(session.metadata.offering_checkout_id, 10));
  }
  if (!checkout) throw new Error("Offering checkout not found");

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

  await expireStaleOfferingCheckouts();

  const slot = await get<{ capacity: number; booked_count: number }>(
    "SELECT capacity, booked_count FROM offering_slot_instances WHERE id = ?",
    [checkout.slot_instance_id],
  );
  if (!slot) throw new Error("Time slot not found");
  if (slot.booked_count >= slot.capacity) {
    throw new Error("This time slot just filled up — contact us for a refund");
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

  const appointment = await bookOfferingSlotInstance(checkout.slot_instance_id, {
    client_id: checkout.client_id,
    addon_ids: parseAddonIds(checkout.addon_ids),
    notes: checkout.notes,
    via: "public",
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
    `UPDATE offering_booking_checkouts
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

export function isOfferingCheckoutMetadata(type: string | undefined): boolean {
  return type === "offering_booking_full" || type === "offering_booking_deposit";
}

export function isBookingLinkCheckoutMetadata(type: string | undefined): boolean {
  return type === "booking_link_full" || type === "booking_link_deposit";
}
