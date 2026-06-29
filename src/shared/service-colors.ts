export const SERVICE_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#ef4444",
  "#14b8a6",
  "#6b7280",
  "#f97316",
  "#06b6d4",
  "#84cc16",
  "#6366f1",
  "#f43f5e",
  "#a855f7",
  "#059669",
  "#0ea5e9",
] as const;

export function normalizeColor(color: string): string {
  return color.trim().toLowerCase();
}

export function isPresetColor(color: string): boolean {
  const normalized = normalizeColor(color);
  return SERVICE_COLORS.some((c) => normalizeColor(c) === normalized);
}

/** First palette color not already used; cycles if all are taken. */
export function pickUnusedServiceColor(usedColors: Iterable<string>): string {
  const used = new Set([...usedColors].map(normalizeColor).filter(Boolean));
  for (const color of SERVICE_COLORS) {
    if (!used.has(normalizeColor(color))) return color;
  }
  return SERVICE_COLORS[used.size % SERVICE_COLORS.length];
}
