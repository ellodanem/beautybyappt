import { get, query, run } from "./db.js";
import { DEFAULT_CURRENCY } from "../shared/currency.js";
import { addMinutes, nextIdentifier } from "./helpers.js";

export type LinkRow = {
  id: number;
  token: string;
  staff_id: number;
  scheduled_date: string;
  start_time: string;
  end_time: string;
  total_price: number;
  deposit_amount: number;
  travel_fee: number;
  currency: string;
  notes: string;
  service_ids: string;
  status: string;
  expires_at: string | null;
  appointment_id: number | null;
  client_id: number | null;
  stripe_checkout_session_id: string | null;
  created_at: string;
  confirmed_at: string | null;
  staff_name?: string;
};

function parseServiceIds(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === "number") : [];
  } catch {
    return [];
  }
}

export function formatLink(row: LinkRow) {
  return {
    ...row,
    travel_fee: row.travel_fee ?? 0,
    service_ids: parseServiceIds(row.service_ids),
    appointment_id: row.appointment_id ?? null,
    client_id: row.client_id ?? null,
    confirmed_at: row.confirmed_at ?? null,
    expires_at: row.expires_at ?? null,
    stripe_checkout_session_id: row.stripe_checkout_session_id ?? null,
  };
}

export function linkServiceSubtotal(link: Pick<LinkRow, "total_price" | "travel_fee">): number {
  return Math.max(0, link.total_price - (link.travel_fee ?? 0));
}

const LINK_SELECT = `SELECT bl.*, s.name as staff_name FROM booking_links bl
  LEFT JOIN staff s ON s.id = bl.staff_id`;

export async function loadBookingLinkByToken(token: string): Promise<LinkRow | null> {
  return get<LinkRow>(`${LINK_SELECT} WHERE bl.token = ?`, [token]);
}

export async function loadBookingLinkById(id: number): Promise<LinkRow | null> {
  return get<LinkRow>(`${LINK_SELECT} WHERE bl.id = ?`, [id]);
}

export async function loadBookingLinkBySessionId(sessionId: string): Promise<LinkRow | null> {
  return get<LinkRow>(`${LINK_SELECT} WHERE bl.stripe_checkout_session_id = ?`, [sessionId]);
}

export async function createAppointmentForLink(
  link: LinkRow,
  clientId: number,
  opts?: {
    deposit_amount?: number;
    amount_paid?: number;
    payment_status?: string;
    stripe_checkout_session_id?: string | null;
    stripe_payment_intent_id?: string | null;
    service_address?: string;
  },
): Promise<number> {
  const identifier = await nextIdentifier();
  const serviceIds = parseServiceIds(link.service_ids);
  const travelFee = link.travel_fee ?? 0;
  const depositAmount = opts?.deposit_amount ?? link.deposit_amount ?? 0;
  const paymentStatus = opts?.payment_status
    ?? (depositAmount > 0 ? "unpaid" : "not_required");

  const result = await run(
    `INSERT INTO appointments (
      identifier, client_id, staff_id, status, scheduled_date, start_time, end_time,
      total_price, currency, deposit_amount, amount_paid, payment_status,
      stripe_checkout_session_id, stripe_payment_intent_id, travel_fee, service_address,
      notes, is_recurring, recurrence_interval
    ) VALUES (?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '')`,
    [
      identifier,
      clientId,
      link.staff_id,
      link.scheduled_date,
      link.start_time,
      link.end_time,
      link.total_price,
      link.currency || DEFAULT_CURRENCY,
      depositAmount,
      opts?.amount_paid ?? 0,
      paymentStatus,
      opts?.stripe_checkout_session_id ?? null,
      opts?.stripe_payment_intent_id ?? null,
      travelFee,
      opts?.service_address?.trim() || "",
      link.notes ? `Booking link: ${link.notes}` : "Booked via custom link",
    ],
  );
  const aptId = Number(result.lastInsertRowid);

  if (serviceIds.length > 0) {
    const svcs = await query<{ id: number; duration: number; price: number }>(
      `SELECT id, duration, price FROM services WHERE id IN (${serviceIds.map(() => "?").join(",")})`,
      serviceIds,
    );
    for (const svc of svcs) {
      await run(
        "INSERT INTO appointment_services (appointment_id, service_id, price, duration) VALUES (?, ?, ?, ?)",
        [aptId, svc.id, svc.price, svc.duration],
      );
    }
  }

  return aptId;
}
