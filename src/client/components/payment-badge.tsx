import { Badge } from "@/components/ui/badge";
import { appointmentBalance, isPaymentTracked } from "../../shared/payment";
import { DualCurrencyAmount } from "./dual-currency-amount";
import type { Appointment } from "../types";

type PaymentDisplay =
  | { kind: "none" }
  | { kind: "paid" }
  | { kind: "deposit"; due: number; currency: string }
  | { kind: "unpaid"; due: number; currency: string };

export function getPaymentDisplay(apt: Appointment): PaymentDisplay {
  if (apt.status === "cancelled" || apt.status === "no_show") {
    return { kind: "none" };
  }

  const currency = apt.currency || "USD";
  const total = apt.total_price ?? 0;
  const paid = apt.amount_paid ?? 0;
  const deposit = apt.deposit_amount ?? 0;
  const balance = appointmentBalance(total, paid);

  if (!isPaymentTracked(deposit, paid, apt.payment_status)) {
    return { kind: "none" };
  }

  if (paid >= total && total > 0) {
    return { kind: "paid" };
  }
  if (paid > 0 && balance > 0) {
    return { kind: "deposit", due: balance, currency };
  }
  if (deposit > 0 && paid === 0) {
    return { kind: "unpaid", due: deposit, currency };
  }

  return { kind: "none" };
}

export function PaymentBadge({ appointment }: { appointment: Appointment }) {
  const display = getPaymentDisplay(appointment);

  if (display.kind === "none") {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  if (display.kind === "paid") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/60 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
      >
        Paid
      </Badge>
    );
  }

  if (display.kind === "deposit") {
    return (
      <div className="space-y-1">
        <Badge
          variant="outline"
          className="border-amber-500/60 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-400"
        >
          Deposit
        </Badge>
        <DualCurrencyAmount
          amount={display.due}
          currency={display.currency}
          suffix="due"
          primaryClassName="text-xs font-medium text-amber-700 dark:text-amber-400"
        />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Badge
        variant="outline"
        className="border-muted-foreground/40 text-muted-foreground"
      >
        Unpaid
      </Badge>
      <DualCurrencyAmount
        amount={display.due}
        currency={display.currency}
        suffix="deposit due"
        primaryClassName="text-xs font-medium text-muted-foreground"
      />
    </div>
  );
}
