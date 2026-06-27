import { get, run } from "./db.js";

import {

  appBaseUrl,

  createCheckoutSession,

  isStripeConfigured,

  paymentIntentId,

  retrieveCheckoutSession,

  type CheckoutLineItem,

  type StripeEnv,

} from "./stripe.js";

import { isStripePaymentsActive } from "./stripe-payments-settings.js";

import {

  bookingLinkCheckoutAmount,

  derivePaymentStatus,

  linkRequiresPayment,

  serviceSubtotal,

  type PaymentChoice,

} from "../shared/payment.js";

import {

  createAppointmentForLink,

  loadBookingLinkById,

  loadBookingLinkBySessionId,

  type LinkRow,

} from "./booking-links-shared.js";



export { isStripeConfigured, linkRequiresPayment };



function checkoutLineItems(link: LinkRow, choice: PaymentChoice): CheckoutLineItem[] {

  const items: CheckoutLineItem[] = [];

  const travelFee = link.travel_fee ?? 0;

  const service = serviceSubtotal(link.total_price, travelFee);



  if (choice === "full") {

    if (service > 0) {

      items.push({

        name: "Appointment",

        description: `${link.scheduled_date} ${link.start_time} booking`,

        amount: service,

      });

    }

  } else if (link.deposit_amount > 0) {

    items.push({

      name: "Booking deposit",

      description: `${link.scheduled_date} ${link.start_time} appointment deposit`,

      amount: link.deposit_amount,

    });

  }



  if (travelFee > 0) {

    items.push({

      name: "Travel fee",

      description: "On-location service travel",

      amount: travelFee,

    });

  }



  return items;

}



export async function createBookingLinkCheckout(

  env: StripeEnv,

  link: LinkRow,

  clientId: number,

  requestUrl: string,

  paymentChoice: PaymentChoice = "full",

): Promise<{ checkout_url: string; session_id: string }> {

  if (!await isStripePaymentsActive(env)) throw new Error("Stripe payments are disabled");



  const lineItems = checkoutLineItems(link, paymentChoice);

  if (lineItems.length === 0) throw new Error("No payment required");



  const base = appBaseUrl(env, requestUrl);

  const session = await createCheckoutSession(env, {

    currency: link.currency,

    lineItems,

    successUrl: `${base}/book/${link.token}/success?session_id={CHECKOUT_SESSION_ID}`,

    cancelUrl: `${base}/book/${link.token}?cancelled=1`,

    metadata: {

      booking_link_id: String(link.id),

      booking_link_token: link.token,

      type: paymentChoice === "full" ? "booking_link_full" : "booking_link_deposit",

      payment_choice: paymentChoice,

    },

  });



  if (!session.url) throw new Error("Failed to create checkout session");



  await run(

    `UPDATE booking_links SET client_id = ?, status = 'awaiting_payment', stripe_checkout_session_id = ? WHERE id = ?`,

    [clientId, session.id, link.id],

  );



  return { checkout_url: session.url, session_id: session.id };

}



export async function finalizeBookingLinkCheckout(

  env: StripeEnv,

  sessionId: string,

  serviceAddress?: string,

): Promise<{ already_done: boolean; appointment_id: number | null; identifier?: string }> {

  const session = await retrieveCheckoutSession(env, sessionId);

  if (session.payment_status !== "paid") {

    throw new Error("Payment not completed");

  }



  let link = await loadBookingLinkBySessionId(sessionId);

  if (!link && session.metadata?.booking_link_id) {

    link = await loadBookingLinkById(parseInt(session.metadata.booking_link_id, 10));

  }

  if (!link) throw new Error("Booking link not found");



  if (link.status === "confirmed" && link.appointment_id) {

    const apt = await get<{ identifier: string }>(

      "SELECT identifier FROM appointments WHERE id = ?",

      [link.appointment_id],

    );

    return {

      already_done: true,

      appointment_id: link.appointment_id,

      identifier: apt?.identifier,

    };

  }



  const clientId = link.client_id;

  if (!clientId) throw new Error("Client not found for this booking");



  const paymentChoice = (session.metadata?.payment_choice === "deposit" ? "deposit" : "full") as PaymentChoice;

  const expectedTotal = bookingLinkCheckoutAmount(link, paymentChoice);

  const amountPaid = session.amount_total != null

    ? session.amount_total / 100

    : expectedTotal;

  const piId = paymentIntentId(session);

  const paymentStatus = derivePaymentStatus(link.total_price, link.deposit_amount, amountPaid);

  const paymentType = paymentStatus === "paid" ? "full" : "deposit";



  const aptId = await createAppointmentForLink(link, clientId, {

    deposit_amount: link.deposit_amount,

    amount_paid: amountPaid,

    payment_status: paymentStatus,

    stripe_checkout_session_id: session.id,

    stripe_payment_intent_id: piId,

    service_address: serviceAddress,

  });



  await run(

    `UPDATE booking_links SET status = 'confirmed', appointment_id = ?, confirmed_at = datetime('now'), stripe_checkout_session_id = ? WHERE id = ?`,

    [aptId, session.id, link.id],

  );



  await run(

    `INSERT INTO payments (appointment_id, booking_link_id, stripe_checkout_session_id, stripe_payment_intent_id, amount, currency, type, status)

     VALUES (?, ?, ?, ?, ?, ?, ?, 'succeeded')`,

    [aptId, link.id, session.id, piId, amountPaid, link.currency, paymentType],

  );



  const apt = await get<{ identifier: string }>("SELECT identifier FROM appointments WHERE id = ?", [aptId]);

  return { already_done: false, appointment_id: aptId, identifier: apt?.identifier };

}


