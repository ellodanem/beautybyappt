import { formatOffsetLabel, utcOffsetHoursForTimezone } from "../../shared/locale";

export function formatTimeShort(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

export function formatTimeRange(start: string, end: string): string {
  return `${formatTimeShort(start)} – ${formatTimeShort(end)}`;
}

export function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function formatDurationMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

export function timezoneDisplayLabel(timezone: string): string {
  const city = timezone.split("/").pop()?.replace(/_/g, " ") ?? timezone;
  const offset = formatOffsetLabel(utcOffsetHoursForTimezone(timezone));
  return `${city} (${offset})`;
}

export type TimeOfDay = "morning" | "afternoon" | "evening";

export function timeOfDay(startTime: string): TimeOfDay {
  const hour = parseInt(startTime.split(":")[0], 10);
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

export const TIME_OF_DAY_LABELS: Record<TimeOfDay, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

export function groupByTimeOfDay<T extends { start_time: string }>(
  items: T[],
): { period: TimeOfDay; items: T[] }[] {
  const groups: Record<TimeOfDay, T[]> = { morning: [], afternoon: [], evening: [] };
  for (const item of items) {
    groups[timeOfDay(item.start_time)].push(item);
  }
  return (["morning", "afternoon", "evening"] as const)
    .filter((period) => groups[period].length > 0)
    .map((period) => ({ period, items: groups[period] }));
}
