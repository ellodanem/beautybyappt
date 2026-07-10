import { get, query, run } from "./db.js";
import { runtimeEnv } from "./runtime-env.js";
import { getBusinessLocale } from "./business-locale.js";
import {
  deleteGoogleCalendarEvent,
  isGoogleCalendarConnected,
  upsertGoogleCalendarEvent,
  type GoogleCalendarEnv,
} from "./calendar-google.js";

type SchedulableContext = {
  env: GoogleCalendarEnv;
  executionCtx?: { waitUntil(p: Promise<unknown>): void };
};

const ACTIVE_STATUSES = new Set(["booked", "confirmed", "in_progress"]);

function normalizeTime(time: string): string {
  const parts = time.trim().split(":");
  const h = (parts[0] || "0").padStart(2, "0");
  const m = (parts[1] || "0").padStart(2, "0");
  const s = (parts[2] || "00").padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function toDateTimeLocal(date: string, time: string): string {
  return `${date}T${normalizeTime(time)}`;
}

function runInBackground(ctx: SchedulableContext, task: Promise<unknown>, label: string): void {
  if (ctx.executionCtx) {
    ctx.executionCtx.waitUntil(task);
  } else {
    void task.catch((err) => console.error(`[gcal] ${label} failed:`, err));
  }
}

async function loadAppointmentForSync(appointmentId: number) {
  const apt = await get<{
    id: number;
    identifier: string;
    status: string;
    scheduled_date: string;
    start_time: string;
    end_time: string;
    notes: string | null;
    travel_fee: number | null;
    service_address: string | null;
    google_event_id: string | null;
    client_name: string;
    client_address: string;
    staff_name: string | null;
    offering_name: string | null;
  }>(
    `SELECT a.id, a.identifier, a.status, a.scheduled_date, a.start_time, a.end_time,
            a.notes, a.travel_fee, a.service_address, a.google_event_id,
            cl.name as client_name, cl.address as client_address,
            s.name as staff_name, o.name as offering_name
     FROM appointments a
     LEFT JOIN clients cl ON cl.id = a.client_id
     LEFT JOIN staff s ON s.id = a.staff_id
     LEFT JOIN offering_slot_instances si ON si.id = a.offering_slot_instance_id
     LEFT JOIN offerings o ON o.id = si.offering_id
     WHERE a.id = ?`,
    [appointmentId],
  );
  if (!apt) return null;

  const services = await getDbServices(appointmentId);
  return { ...apt, travel_fee: apt.travel_fee ?? 0, service_names: services };
}

async function getDbServices(appointmentId: number): Promise<string[]> {
  const rows = await query<{ name: string }>(
    `SELECT COALESCE(NULLIF(aps.service_name, ''), s.name) as name
     FROM appointment_services aps
     LEFT JOIN services s ON s.id = aps.service_id
     WHERE aps.appointment_id = ?`,
    [appointmentId],
  );
  return rows.map((r) => r.name).filter(Boolean);
}

function appointmentLocation(apt: {
  travel_fee: number;
  service_address: string | null;
  client_address: string;
}): string {
  if ((apt.travel_fee ?? 0) <= 0) return "";
  return (apt.service_address || "").trim() || (apt.client_address || "").trim();
}

function appointmentSummary(apt: {
  client_name: string;
  service_names: string[];
  offering_name: string | null;
}): string {
  const service =
    apt.service_names.filter(Boolean).join(", ")
    || apt.offering_name?.trim()
    || "Appointment";
  const client = apt.client_name?.trim() || "Client";
  return `${client} — ${service}`;
}

function appointmentDescription(apt: {
  identifier: string;
  staff_name: string | null;
  notes: string | null;
  service_names: string[];
  offering_name: string | null;
  travel_fee: number;
}): string {
  const lines: string[] = [`Reference: ${apt.identifier}`];
  if (apt.staff_name?.trim()) lines.push(`Staff: ${apt.staff_name.trim()}`);
  if (apt.offering_name?.trim()) lines.push(`Event: ${apt.offering_name.trim()}`);
  if (apt.service_names.length) lines.push(`Services: ${apt.service_names.join(", ")}`);
  if (apt.travel_fee > 0) lines.push("On-location / travel booking");
  if (apt.notes?.trim()) lines.push("", apt.notes.trim());
  return lines.join("\n");
}

export async function syncAppointmentToGoogle(
  env: GoogleCalendarEnv,
  appointmentId: number,
): Promise<void> {
  if (!(await isGoogleCalendarConnected())) return;

  const apt = await loadAppointmentForSync(appointmentId);
  if (!apt) return;

  if (!ACTIVE_STATUSES.has(apt.status)) {
    if (apt.google_event_id) {
      await deleteGoogleCalendarEvent(env, apt.google_event_id);
      await run("UPDATE appointments SET google_event_id = NULL WHERE id = ?", [appointmentId]);
    }
    return;
  }

  const locale = await getBusinessLocale();
  const location = appointmentLocation(apt);
  const result = await upsertGoogleCalendarEvent(
    env,
    {
      summary: appointmentSummary(apt),
      description: appointmentDescription(apt),
      location: location || undefined,
      startDateTime: toDateTimeLocal(apt.scheduled_date, apt.start_time),
      endDateTime: toDateTimeLocal(apt.scheduled_date, apt.end_time),
      timeZone: locale.timezone,
    },
    apt.google_event_id,
  );

  if (result.error) {
    console.error(`[gcal] appointment ${appointmentId} sync failed:`, result.error);
    return;
  }
  if (result.eventId && result.eventId !== apt.google_event_id) {
    await run("UPDATE appointments SET google_event_id = ? WHERE id = ?", [result.eventId, appointmentId]);
  }
}

export async function deleteAppointmentGoogleEvent(
  env: GoogleCalendarEnv,
  appointmentId: number,
): Promise<void> {
  if (!(await isGoogleCalendarConnected())) return;
  const apt = await get<{ google_event_id: string | null }>(
    "SELECT google_event_id FROM appointments WHERE id = ?",
    [appointmentId],
  );
  if (!apt?.google_event_id) return;
  await deleteGoogleEventId(env, apt.google_event_id);
}

export async function deleteGoogleEventId(
  env: GoogleCalendarEnv,
  eventId: string | null | undefined,
): Promise<void> {
  if (!eventId?.trim()) return;
  if (!(await isGoogleCalendarConnected())) return;
  const result = await deleteGoogleCalendarEvent(env, eventId);
  if (result.error) {
    console.error(`[gcal] event ${eventId} delete failed:`, result.error);
  }
}

export async function syncBlockedSlotToGoogle(
  env: GoogleCalendarEnv,
  blockedSlotId: number,
): Promise<void> {
  if (!(await isGoogleCalendarConnected())) return;

  const slot = await get<{
    id: number;
    blocked_date: string;
    start_time: string;
    end_time: string;
    reason: string | null;
    google_event_id: string | null;
    staff_name: string | null;
  }>(
    `SELECT b.id, b.blocked_date, b.start_time, b.end_time, b.reason, b.google_event_id,
            s.name as staff_name
     FROM blocked_slots b
     LEFT JOIN staff s ON s.id = b.staff_id
     WHERE b.id = ?`,
    [blockedSlotId],
  );
  if (!slot) return;

  const locale = await getBusinessLocale();
  const reason = slot.reason?.trim();
  const summary = reason ? `Blocked — ${reason}` : "Blocked time";
  const description = [
    "Blocked time from Beauty By Appointment",
    slot.staff_name?.trim() ? `Staff: ${slot.staff_name.trim()}` : "",
    reason ? `Reason: ${reason}` : "",
  ].filter(Boolean).join("\n");

  const result = await upsertGoogleCalendarEvent(
    env,
    {
      summary,
      description,
      startDateTime: toDateTimeLocal(slot.blocked_date, slot.start_time),
      endDateTime: toDateTimeLocal(slot.blocked_date, slot.end_time),
      timeZone: locale.timezone,
    },
    slot.google_event_id,
  );

  if (result.error) {
    console.error(`[gcal] blocked slot ${blockedSlotId} sync failed:`, result.error);
    return;
  }
  if (result.eventId && result.eventId !== slot.google_event_id) {
    await run("UPDATE blocked_slots SET google_event_id = ? WHERE id = ?", [result.eventId, blockedSlotId]);
  }
}

export async function deleteBlockedSlotGoogleEvent(
  env: GoogleCalendarEnv,
  blockedSlotId: number,
): Promise<void> {
  if (!(await isGoogleCalendarConnected())) return;
  const slot = await get<{ google_event_id: string | null }>(
    "SELECT google_event_id FROM blocked_slots WHERE id = ?",
    [blockedSlotId],
  );
  if (!slot?.google_event_id) return;
  await deleteGoogleEventId(env, slot.google_event_id);
}

export function scheduleGoogleCalendarAppointmentSync(
  ctx: SchedulableContext,
  appointmentId: number | string | null | undefined,
): void {
  const id = typeof appointmentId === "string" ? Number(appointmentId) : appointmentId;
  if (!id || !Number.isFinite(id)) return;
  const env = runtimeEnv(ctx.env) as GoogleCalendarEnv;
  runInBackground(ctx, syncAppointmentToGoogle(env, id), `appointment ${id}`);
}

export function scheduleGoogleCalendarAppointmentDelete(
  ctx: SchedulableContext,
  appointmentId: number | string | null | undefined,
): void {
  const id = typeof appointmentId === "string" ? Number(appointmentId) : appointmentId;
  if (!id || !Number.isFinite(id)) return;
  const env = runtimeEnv(ctx.env) as GoogleCalendarEnv;
  runInBackground(ctx, deleteAppointmentGoogleEvent(env, id), `appointment delete ${id}`);
}

export function scheduleGoogleCalendarEventDelete(
  ctx: SchedulableContext,
  eventId: string | null | undefined,
): void {
  if (!eventId?.trim()) return;
  const env = runtimeEnv(ctx.env) as GoogleCalendarEnv;
  runInBackground(ctx, deleteGoogleEventId(env, eventId), `event delete ${eventId}`);
}

export function scheduleGoogleCalendarBlockedSync(
  ctx: SchedulableContext,
  blockedSlotId: number | string | null | undefined,
): void {
  const id = typeof blockedSlotId === "string" ? Number(blockedSlotId) : blockedSlotId;
  if (!id || !Number.isFinite(id)) return;
  const env = runtimeEnv(ctx.env) as GoogleCalendarEnv;
  runInBackground(ctx, syncBlockedSlotToGoogle(env, id), `blocked ${id}`);
}

export function scheduleGoogleCalendarBlockedDelete(
  ctx: SchedulableContext,
  blockedSlotId: number | string | null | undefined,
): void {
  const id = typeof blockedSlotId === "string" ? Number(blockedSlotId) : blockedSlotId;
  if (!id || !Number.isFinite(id)) return;
  const env = runtimeEnv(ctx.env) as GoogleCalendarEnv;
  runInBackground(ctx, deleteBlockedSlotGoogleEvent(env, id), `blocked delete ${id}`);
}
