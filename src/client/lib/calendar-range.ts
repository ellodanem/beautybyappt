export type CalendarViewMode = "day" | "week" | "month";

export function formatDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getWeekDays(date: string): string[] {
  const d = new Date(date + "T00:00:00");
  const start = new Date(d);
  start.setDate(d.getDate() - d.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(start);
    x.setDate(start.getDate() + i);
    return formatDateISO(x);
  });
}

export function getCalendarRange(date: string, view: CalendarViewMode): { start: string; end: string } {
  if (view === "day") return { start: date, end: date };

  if (view === "week") {
    const days = getWeekDays(date);
    return { start: days[0], end: days[6] };
  }

  const d = new Date(date + "T00:00:00");
  const year = d.getFullYear();
  const month = d.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());
  const gridEnd = new Date(last);
  gridEnd.setDate(last.getDate() + (6 - last.getDay()));
  return { start: formatDateISO(gridStart), end: formatDateISO(gridEnd) };
}

export interface MonthCell {
  date: string;
  inMonth: boolean;
}

export function getMonthGrid(date: string): MonthCell[] {
  const d = new Date(date + "T00:00:00");
  const year = d.getFullYear();
  const month = d.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const cells: MonthCell[] = [];

  for (let i = first.getDay() - 1; i >= 0; i--) {
    const x = new Date(first);
    x.setDate(first.getDate() - i - 1);
    cells.push({ date: formatDateISO(x), inMonth: false });
  }

  for (let day = 1; day <= last.getDate(); day++) {
    cells.push({ date: formatDateISO(new Date(year, month, day)), inMonth: true });
  }

  const trailing = (7 - (cells.length % 7)) % 7;
  for (let i = 1; i <= trailing; i++) {
    const x = new Date(last);
    x.setDate(last.getDate() + i);
    cells.push({ date: formatDateISO(x), inMonth: false });
  }

  return cells;
}

export function formatViewLabel(date: string, view: CalendarViewMode): string {
  const d = new Date(date + "T00:00:00");
  if (view === "day") {
    return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });
  }
  if (view === "week") {
    const days = getWeekDays(date);
    const start = new Date(days[0] + "T00:00:00");
    const end = new Date(days[6] + "T00:00:00");
    const sameMonth = start.getMonth() === end.getMonth();
    const sameYear = start.getFullYear() === end.getFullYear();
    if (sameMonth) {
      return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.getDate()}, ${end.getFullYear()}`;
    }
    if (sameYear) {
      return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${end.getFullYear()}`;
    }
    return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  }
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
