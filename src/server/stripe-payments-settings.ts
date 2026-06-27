import { get, run } from "./db.js";
import { isStripeConfigured, type StripeEnv } from "./stripe.js";

const META_KEY = "stripe_payments_enabled";

export async function getStripePaymentsEnabled(): Promise<boolean> {
  const row = await get<{ value: string }>("SELECT value FROM _meta WHERE key = ?", [META_KEY]);
  if (!row) return false;
  return row.value === "1" || row.value === "true";
}

export async function setStripePaymentsEnabled(enabled: boolean): Promise<void> {
  await run("INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)", [META_KEY, enabled ? "1" : "0"]);
}

export async function isStripePaymentsActive(env: StripeEnv): Promise<boolean> {
  if (!isStripeConfigured(env)) return false;
  return getStripePaymentsEnabled();
}
