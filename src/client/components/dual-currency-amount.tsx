import { cn } from "@/lib/utils";
import { convertCurrency, formatMoney, getPairedCurrency } from "../../shared/currency";

interface DualCurrencyAmountProps {
  amount: number;
  currency: string;
  suffix?: string;
  align?: "left" | "right";
  primaryClassName?: string;
  secondaryClassName?: string;
  priceStyle?: boolean;
}

export function DualCurrencyAmount({
  amount,
  currency,
  suffix,
  align = "left",
  primaryClassName,
  secondaryClassName,
  priceStyle = false,
}: DualCurrencyAmountProps) {
  const secondary = getPairedCurrency(currency);
  const converted = secondary ? convertCurrency(amount, currency, secondary) : null;
  const suffixText = suffix ? ` ${suffix}` : "";

  const primaryLabel = priceStyle
    ? `${formatMoney(amount, currency)} ${currency}`
    : `${currency} ${formatMoney(amount, currency)}${suffixText}`;

  const secondaryLabel = converted != null && secondary
    ? priceStyle
      ? `≈ ${formatMoney(converted, secondary)} ${secondary}`
      : `≈ ${secondary} ${formatMoney(converted, secondary)}${suffixText}`
    : null;

  return (
    <div className={cn(align === "right" && "text-right")}>
      <div className={primaryClassName}>{primaryLabel}</div>
      {secondaryLabel && (
        <div className={cn("text-[11px] text-muted-foreground", secondaryClassName)}>
          {secondaryLabel}
        </div>
      )}
    </div>
  );
}
