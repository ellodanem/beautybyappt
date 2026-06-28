export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  const email = normalizeEmail(value);
  return email.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function parseRequiredBookingEmail(
  value: string | undefined | null,
): { ok: true; email: string } | { ok: false; error: string } {
  const email = normalizeEmail(value ?? "");
  if (!email) return { ok: false, error: "Email is required" };
  if (!isValidEmail(email)) return { ok: false, error: "Enter a valid email address" };
  return { ok: true, email };
}
