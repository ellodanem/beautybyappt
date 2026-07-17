/** International card worst-case defaults (Stripe-style % + fixed). */
export const DEFAULT_STRIPE_FEE_PERCENT = 0.039;
export const DEFAULT_STRIPE_FEE_FIXED = 0.3;

/**
 * Gross up a net (merchant keep) amount so after Stripe fees the business nets ≈ net.
 * Uses ceil-to-cent to prefer slight overcharge vs undershoot.
 */
export function grossUpAmount(
  net: number,
  percent: number = DEFAULT_STRIPE_FEE_PERCENT,
  fixed: number = DEFAULT_STRIPE_FEE_FIXED,
): number {
  if (!Number.isFinite(net) || net <= 0) return 0;
  const p = Number.isFinite(percent) && percent > 0 && percent < 1 ? percent : DEFAULT_STRIPE_FEE_PERCENT;
  const f = Number.isFinite(fixed) && fixed >= 0 ? fixed : DEFAULT_STRIPE_FEE_FIXED;
  const raw = (net + f) / (1 - p);
  return Math.ceil(raw * 100) / 100;
}

export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Scale line-item nets to a single grossed-up session total.
 * Fixed fee is applied once on the sum (not per line).
 */
export function grossUpLineAmounts(
  amounts: number[],
  percent: number = DEFAULT_STRIPE_FEE_PERCENT,
  fixed: number = DEFAULT_STRIPE_FEE_FIXED,
): number[] {
  if (amounts.length === 0) return [];
  const netSum = roundMoney(amounts.reduce((sum, n) => sum + Math.max(0, n), 0));
  if (netSum <= 0) return amounts.map(() => 0);

  const grossSum = grossUpAmount(netSum, percent, fixed);
  const scaled: number[] = [];
  let allocated = 0;

  for (let i = 0; i < amounts.length; i++) {
    const net = Math.max(0, amounts[i] ?? 0);
    if (i === amounts.length - 1) {
      scaled.push(roundMoney(grossSum - allocated));
    } else {
      const share = roundMoney((net / netSum) * grossSum);
      scaled.push(share);
      allocated = roundMoney(allocated + share);
    }
  }

  return scaled;
}
