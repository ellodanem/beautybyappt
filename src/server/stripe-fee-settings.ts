import { get, run } from "./db.js";
import {
  DEFAULT_STRIPE_FEE_FIXED,
  DEFAULT_STRIPE_FEE_PERCENT,
} from "../shared/stripe-fees.js";

const ENABLED_KEY = "stripe_fee_passthrough_enabled";
const PERCENT_KEY = "stripe_fee_percent";
const FIXED_KEY = "stripe_fee_fixed";

export type StripeFeeSettings = {
  fee_passthrough_enabled: boolean;
  fee_percent: number;
  fee_fixed: number;
};

export async function getStripeFeePassthroughEnabled(): Promise<boolean> {
  const row = await get<{ value: string }>("SELECT value FROM _meta WHERE key = ?", [ENABLED_KEY]);
  if (!row) return false;
  return row.value === "1" || row.value === "true";
}

export async function setStripeFeePassthroughEnabled(enabled: boolean): Promise<void> {
  await run("INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)", [
    ENABLED_KEY,
    enabled ? "1" : "0",
  ]);
}

export async function getStripeFeeRate(): Promise<{ percent: number; fixed: number }> {
  const [percentRow, fixedRow] = await Promise.all([
    get<{ value: string }>("SELECT value FROM _meta WHERE key = ?", [PERCENT_KEY]),
    get<{ value: string }>("SELECT value FROM _meta WHERE key = ?", [FIXED_KEY]),
  ]);

  let percent = parseFloat(percentRow?.value ?? "");
  let fixed = parseFloat(fixedRow?.value ?? "");

  if (!Number.isFinite(percent) || percent <= 0 || percent >= 1) {
    percent = DEFAULT_STRIPE_FEE_PERCENT;
  }
  if (!Number.isFinite(fixed) || fixed < 0) {
    fixed = DEFAULT_STRIPE_FEE_FIXED;
  }

  return { percent, fixed };
}

export async function setStripeFeeRate(percent: number, fixed: number): Promise<void> {
  const p = Number.isFinite(percent) && percent > 0 && percent < 1
    ? percent
    : DEFAULT_STRIPE_FEE_PERCENT;
  const f = Number.isFinite(fixed) && fixed >= 0 ? fixed : DEFAULT_STRIPE_FEE_FIXED;
  await run("INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)", [PERCENT_KEY, String(p)]);
  await run("INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)", [FIXED_KEY, String(f)]);
}

export async function getStripeFeeSettings(): Promise<StripeFeeSettings> {
  const [enabled, rate] = await Promise.all([
    getStripeFeePassthroughEnabled(),
    getStripeFeeRate(),
  ]);
  return {
    fee_passthrough_enabled: enabled,
    fee_percent: rate.percent,
    fee_fixed: rate.fixed,
  };
}

/** Snapshot whether a newly created link/checkout should pass fees through. */
export async function snapshotFeePassthrough(): Promise<boolean> {
  return getStripeFeePassthroughEnabled();
}
