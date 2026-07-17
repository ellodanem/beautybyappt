import type { CheckoutLineItem } from "./stripe.js";
import { getStripeFeeRate } from "./stripe-fee-settings.js";
import { grossUpLineAmounts, roundMoney } from "../shared/stripe-fees.js";

export type FeeAdjustedCheckout = {
  lineItems: CheckoutLineItem[];
  net_amount: number;
  gross_amount: number;
  fee_passthrough: boolean;
};

export async function maybeGrossUpLineItems(
  lineItems: CheckoutLineItem[],
  feePassthrough: boolean,
): Promise<FeeAdjustedCheckout> {
  const netAmount = roundMoney(lineItems.reduce((sum, item) => sum + Math.max(0, item.amount), 0));

  if (!feePassthrough || netAmount <= 0 || lineItems.length === 0) {
    return {
      lineItems,
      net_amount: netAmount,
      gross_amount: netAmount,
      fee_passthrough: false,
    };
  }

  const { percent, fixed } = await getStripeFeeRate();
  const grossAmounts = grossUpLineAmounts(
    lineItems.map((item) => item.amount),
    percent,
    fixed,
  );
  const grossAmount = roundMoney(grossAmounts.reduce((sum, n) => sum + n, 0));

  return {
    lineItems: lineItems.map((item, i) => ({
      ...item,
      amount: grossAmounts[i] ?? item.amount,
    })),
    net_amount: netAmount,
    gross_amount: grossAmount,
    fee_passthrough: true,
  };
}

export function feeCheckoutMetadata(adjusted: FeeAdjustedCheckout): Record<string, string> {
  return {
    net_amount: adjusted.net_amount.toFixed(2),
    gross_amount: adjusted.gross_amount.toFixed(2),
    fee_passthrough: adjusted.fee_passthrough ? "1" : "0",
  };
}

/** Prefer metadata net (when fee passthrough) over Stripe charge total. */
export function resolveNetPaidAmount(
  metadata: Record<string, string> | undefined,
  sessionAmountTotal: number | null | undefined,
  fallbackNet: number,
): number {
  const metaNet = parseFloat(metadata?.net_amount ?? "");
  if (Number.isFinite(metaNet) && metaNet > 0) {
    return roundMoney(metaNet);
  }
  if (sessionAmountTotal != null && Number.isFinite(sessionAmountTotal)) {
    return roundMoney(sessionAmountTotal / 100);
  }
  return roundMoney(fallbackNet);
}
