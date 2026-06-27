export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function addMinutes(time: string, minutes: number): string {
  const total = timeToMinutes(time) + minutes;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function generateTimeSlots(
  start: string,
  end: string,
  intervalMinutes: number,
): { start_time: string; end_time: string }[] {
  if (intervalMinutes <= 0) return [];
  const slots: { start_time: string; end_time: string }[] = [];
  let current = start;
  while (timeToMinutes(current) + intervalMinutes <= timeToMinutes(end)) {
    const slotEnd = addMinutes(current, intervalMinutes);
    slots.push({ start_time: current, end_time: slotEnd });
    current = slotEnd;
  }
  return slots;
}

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = Date.now().toString(36).slice(-4);
  return base ? `${base}-${suffix}` : `offering-${suffix}`;
}

export function expandDateWindows(
  windows: { start_date: string; end_date: string }[],
): string[] {
  const dates = new Set<string>();
  for (const window of windows) {
    const start = new Date(`${window.start_date}T12:00:00`);
    const end = new Date(`${window.end_date}T12:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) continue;
    const cursor = new Date(start);
    while (cursor <= end) {
      dates.add(cursor.toISOString().split("T")[0]);
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return [...dates].sort();
}

export function countSlotInstances(
  dateWindows: { start_date: string; end_date: string }[],
  timeSlots: { start_time: string; end_time: string }[],
  capacityPerSlot: number,
): { days: number; slotsPerDay: number; totalSlots: number; maxBookings: number } {
  const days = expandDateWindows(dateWindows).length;
  const slotsPerDay = timeSlots.length;
  const totalSlots = days * slotsPerDay;
  return {
    days,
    slotsPerDay,
    totalSlots,
    maxBookings: totalSlots * capacityPerSlot,
  };
}

export type DateScheduleMode = "specific" | "range";

export const MAX_SPECIFIC_DAYS = 14;

export function inferDateScheduleMode(
  windows: { start_date: string; end_date: string }[],
): DateScheduleMode {
  const filled = windows.filter((w) => w.start_date && w.end_date);
  if (filled.some((w) => w.start_date !== w.end_date)) return "range";
  return "specific";
}

function formatDisplayDate(isoDate: string, style: "short" | "medium" = "medium"): string {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-US", style === "short"
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateWindowsSummary(
  windows: { start_date: string; end_date: string }[],
): string {
  const filled = windows.filter((w) => w.start_date && w.end_date);
  if (filled.length === 0) return "";

  const dayCount = expandDateWindows(filled).length;
  const dayLabel = dayCount === 1 ? "1 day" : `${dayCount} days`;

  if (inferDateScheduleMode(filled) === "range" && filled.length === 1) {
    const w = filled[0];
    if (w.start_date === w.end_date) {
      return `${formatDisplayDate(w.start_date)} (${dayLabel})`;
    }
    return `${formatDisplayDate(w.start_date)} – ${formatDisplayDate(w.end_date)} (${dayLabel})`;
  }

  const dates = expandDateWindows(filled);
  if (dates.length <= 4) {
    return `${dates.map((d) => formatDisplayDate(d, "short")).join(" · ")} (${dayLabel})`;
  }
  return `${formatDisplayDate(dates[0])} – ${formatDisplayDate(dates[dates.length - 1])} (${dayLabel})`;
}

export function windowsToRange(
  windows: { start_date: string; end_date: string }[],
): { start_date: string; end_date: string } {
  const dates = expandDateWindows(windows);
  if (dates.length === 0) return { start_date: "", end_date: "" };
  return { start_date: dates[0], end_date: dates[dates.length - 1] };
}

export function rangeToDayWindows(
  start: string,
  end: string,
): { start_date: string; end_date: string }[] {
  return expandDateWindows([{ start_date: start, end_date: end }]).map((d) => ({
    start_date: d,
    end_date: d,
  }));
}

export function canUseSpecificMode(
  windows: { start_date: string; end_date: string }[],
): boolean {
  return expandDateWindows(windows).length <= MAX_SPECIFIC_DAYS;
}
