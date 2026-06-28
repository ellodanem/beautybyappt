import { get, query, run } from "./db.js";
import { normalizePhone } from "./helpers.js";
import { parseRequiredBookingEmail } from "../shared/email.js";

export function todayIsoDate(): string {
  return new Date().toISOString().split("T")[0];
}

/** Appointments that must be cleared before a client can be deleted. */
export function blockingClientAppointmentsWhere(alias = "appointments"): string {
  return `(
    ${alias}.status = 'in_progress'
    OR (${alias}.status IN ('booked', 'confirmed') AND ${alias}.scheduled_date >= ?)
  )`;
}

/** Booking links that still tie a client to an active/upcoming reservation. */
export function blockingClientBookingLinksWhere(alias = "booking_links"): string {
  return `(
    ${alias}.status IN ('pending', 'awaiting_payment', 'confirmed')
    AND ${alias}.scheduled_date >= ?
  )`;
}

export async function countClientBlockingAppointments(clientId: number, today = todayIsoDate()): Promise<number> {
  const row = await get<{ count: number }>(
    `SELECT COUNT(*) as count FROM appointments WHERE client_id = ? AND ${blockingClientAppointmentsWhere()}`,
    [clientId, today],
  );
  return row?.count ?? 0;
}

export async function countClientBlockingBookingLinks(clientId: number, today = todayIsoDate()): Promise<number> {
  const row = await get<{ count: number }>(
    `SELECT COUNT(*) as count FROM booking_links WHERE client_id = ? AND ${blockingClientBookingLinksWhere()}`,
    [clientId, today],
  );
  return row?.count ?? 0;
}

export async function countClientActiveBookings(clientId: number, today = todayIsoDate()): Promise<number> {
  const [appointments, bookingLinks] = await Promise.all([
    countClientBlockingAppointments(clientId, today),
    countClientBlockingBookingLinks(clientId, today),
  ]);
  return appointments + bookingLinks;
}

export async function detachClientBookingLinks(clientId: number): Promise<void> {
  await run("UPDATE booking_links SET client_id = NULL WHERE client_id = ?", [clientId]);
}

export async function assertClientEmailForBooking(clientId: number): Promise<void> {
  const client = await get<{ email: string }>("SELECT email FROM clients WHERE id = ?", [clientId]);
  if (!client) throw new Error("CLIENT_NOT_FOUND");
  const parsed = parseRequiredBookingEmail(client.email);
  if (!parsed.ok) throw new Error(parsed.error);
}

export async function findOrCreateClient(data: {
  name: string;
  phone: string;
  email: string;
  address?: string;
}): Promise<number> {
  const parsed = parseRequiredBookingEmail(data.email);
  if (!parsed.ok) throw new Error(parsed.error);
  const email = parsed.email;
  const phoneNorm = normalizePhone(data.phone);
  const addressUpdate = data.address !== undefined ? data.address.trim() : null;

  if (email) {
    const byEmail = await get<{ id: number }>(
      "SELECT id FROM clients WHERE lower(trim(email)) = ?",
      [email],
    );
    if (byEmail) {
      await run(
        "UPDATE clients SET name = ?, phone = ?, address = COALESCE(?, address), updated_at = datetime('now') WHERE id = ?",
        [data.name.trim(), data.phone.trim(), addressUpdate, byEmail.id],
      );
      return byEmail.id;
    }
  }

  if (phoneNorm) {
    const clients = await query<{ id: number; phone: string }>("SELECT id, phone FROM clients WHERE phone != ''");
    const match = clients.find((c) => normalizePhone(c.phone) === phoneNorm);
    if (match) {
      await run(
        "UPDATE clients SET name = ?, email = CASE WHEN ? != '' THEN ? ELSE email END, address = COALESCE(?, address), updated_at = datetime('now') WHERE id = ?",
        [data.name.trim(), email, email, addressUpdate, match.id],
      );
      return match.id;
    }
  }

  const result = await run(
    "INSERT INTO clients (name, email, phone, address) VALUES (?, ?, ?, ?)",
    [data.name.trim(), email, data.phone.trim(), data.address?.trim() || ""],
  );
  return Number(result.lastInsertRowid);
}
