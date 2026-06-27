import { get, query, run } from "./db.js";
import { expandDateWindows } from "../shared/offerings.js";

const META_KEY = "block_regular_on_event_days";

export async function getGlobalBlockRegularOnEventDays(): Promise<boolean> {
  const row = await get<{ value: string }>("SELECT value FROM _meta WHERE key = ?", [META_KEY]);
  if (!row) return true;
  return row.value !== "0" && row.value !== "false";
}

export async function setGlobalBlockRegularOnEventDays(enabled: boolean): Promise<void> {
  await run("INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)", [META_KEY, enabled ? "1" : "0"]);
}

function offeringBlocksRegular(
  blockRegularBookings: number | null | undefined,
  globalDefault: boolean,
): boolean {
  if (blockRegularBookings === 0) return false;
  if (blockRegularBookings === 1) return true;
  return globalDefault;
}

export interface EventDayInfo {
  is_event_day: boolean;
  block_regular_bookings: boolean;
  event_names: string[];
}

export async function getEventDayInfo(date: string): Promise<EventDayInfo> {
  const global = await getGlobalBlockRegularOnEventDays();
  const rows = await query<{
    name: string;
    block_regular_bookings: number | null;
  }>(
    `SELECT DISTINCT o.name, o.block_regular_bookings
     FROM offerings o
     INNER JOIN offering_date_windows w ON w.offering_id = o.id
     WHERE o.status = 'live'
       AND ? >= w.start_date AND ? <= w.end_date`,
    [date, date],
  );

  if (rows.length === 0) {
    return { is_event_day: false, block_regular_bookings: false, event_names: [] };
  }

  const event_names = rows.map((r) => r.name);
  const block_regular_bookings = rows.some((r) => offeringBlocksRegular(r.block_regular_bookings, global));

  return {
    is_event_day: true,
    block_regular_bookings,
    event_names,
  };
}

export function regularBookingBlockedMessage(eventNames: string[]): string {
  const list = eventNames.join(", ");
  return `This day is reserved for ${list}. Book clients through event times, or turn off "block regular bookings" in Settings or for this event.`;
}

export async function assertRegularBookingAllowed(date: string): Promise<void> {
  const info = await getEventDayInfo(date);
  if (info.block_regular_bookings) {
    throw new RegularBookingBlockedError(info.event_names);
  }
}

export class RegularBookingBlockedError extends Error {
  event_names: string[];

  constructor(event_names: string[]) {
    super(regularBookingBlockedMessage(event_names));
    this.name = "RegularBookingBlockedError";
    this.event_names = event_names;
  }
}

export interface AppointmentConflict {
  id: number;
  identifier: string;
  scheduled_date: string;
  start_time: string;
  client_name: string;
}

export async function findRegularAppointmentConflicts(
  dateWindows: { start_date: string; end_date: string }[],
): Promise<AppointmentConflict[]> {
  const dates = expandDateWindows(dateWindows);
  if (dates.length === 0) return [];

  const placeholders = dates.map(() => "?").join(",");
  return query<AppointmentConflict>(
    `SELECT a.id, a.identifier, a.scheduled_date, a.start_time, cl.name as client_name
     FROM appointments a
     INNER JOIN clients cl ON cl.id = a.client_id
     WHERE a.scheduled_date IN (${placeholders})
       AND a.status != 'cancelled'
       AND (a.offering_slot_instance_id IS NULL OR a.offering_slot_instance_id = 0)`,
    dates,
  );
}
