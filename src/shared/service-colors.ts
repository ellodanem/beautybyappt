export const SERVICE_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#ef4444",
  "#14b8a6",
  "#6b7280",
] as const;

function normalizeColor(color: string): string {
  return color.trim().toLowerCase();
}

/** First palette color not already used; cycles if all are taken. */
export function pickUnusedServiceColor(usedColors: Iterable<string>): string {
  const used = new Set([...usedColors].map(normalizeColor).filter(Boolean));
  for (const color of SERVICE_COLORS) {
    if (!used.has(normalizeColor(color))) return color;
  }
  return SERVICE_COLORS[used.size % SERVICE_COLORS.length];
}
