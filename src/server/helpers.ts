import { get, run } from "./db.js";

export function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export async function nextIdentifier(): Promise<string> {
  const prefix = await get<{ value: string }>("SELECT value FROM _meta WHERE key = 'appointment_prefix'");
  const counter = await get<{ value: string }>("SELECT value FROM _meta WHERE key = 'appointment_counter'");
  const next = parseInt(counter?.value || "0", 10) + 1;
  await run("UPDATE _meta SET value = ? WHERE key = 'appointment_counter'", [String(next)]);
  return `${prefix?.value || "APT"}-${next}`;
}

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function generateBookingToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const BOOKING_LINK_TTL_HOURS = 48;

export function bookingLinkExpiresAt(from = new Date()): string {
  return new Date(from.getTime() + BOOKING_LINK_TTL_HOURS * 60 * 60 * 1000).toISOString();
}

export function isLinkExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= Date.now();
}
