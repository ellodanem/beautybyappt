export const DEFAULT_DEPOSIT_RATE = 0.5;
export const MIN_DEPOSIT_RATE = 0.5;
export const MAX_DEPOSIT_RATE = 1;

export type PaymentChoice = "full" | "deposit";

export function computeDefaultDeposit(
  total: number,
  rate: number = DEFAULT_DEPOSIT_RATE,
): number {
  if (total <= 0) return 0;
  return Math.round(total * rate * 100) / 100;
}

export function serviceSubtotal(total: number, travelFee = 0): number {
  return Math.max(0, total - travelFee);
}

export function minDepositAmount(total: number, travelFee = 0): number {
  return computeDefaultDeposit(serviceSubtotal(total, travelFee), MIN_DEPOSIT_RATE);
}

export function maxDepositAmount(total: number, travelFee = 0): number {
  return serviceSubtotal(total, travelFee);
}

export function clampDepositAmount(
  deposit: number,
  total: number,
  travelFee = 0,
): number {
  const max = maxDepositAmount(total, travelFee);
  if (max <= 0) return 0;
  const min = minDepositAmount(total, travelFee);
  return Math.round(Math.min(max, Math.max(min, deposit)) * 100) / 100;
}

export function resolveLinkDeposit(
  deposit: number | undefined,
  total: number,
  travelFee = 0,
): number {
  const service = serviceSubtotal(total, travelFee);
  if (service <= 0) return 0;
  const amount = deposit ?? computeDefaultDeposit(service);
  return clampDepositAmount(amount, total, travelFee);
}

export function clientHasPaymentChoice(link: {
  total_price: number;
  deposit_amount: number;
  travel_fee?: number;
}): boolean {
  const travelFee = link.travel_fee ?? 0;
  const service = serviceSubtotal(link.total_price, travelFee);
  return service > 0 && link.deposit_amount < service - 0.009;
}

export function bookingLinkCheckoutAmount(
  link: { total_price: number; deposit_amount: number; travel_fee?: number },
  choice: PaymentChoice,
): number {
  const travelFee = link.travel_fee ?? 0;
  if (choice === "full") return link.total_price;
  return link.deposit_amount + travelFee;
}

export function linkRequiresPayment(link: { total_price: number }): boolean {
  return link.total_price > 0;
}

export function offeringRequiresPayment(total: number): boolean {
  return total > 0;
}

export function resolveOfferingDeposit(total: number): number {
  return computeDefaultDeposit(total);
}

export function offeringClientHasPaymentChoice(total: number, deposit: number): boolean {
  return total > 0 && deposit < total - 0.009;
}

export function offeringCheckoutAmount(
  total: number,
  deposit: number,
  choice: PaymentChoice,
): number {
  if (choice === "full") return total;
  return deposit;
}

export function appointmentBalance(total: number, amountPaid: number): number {
  return Math.max(0, total - amountPaid);
}

export function appointmentHasPaymentChoice(apt: {
  total_price: number;
  deposit_amount: number;
  amount_paid: number;
}): boolean {
  if ((apt.amount_paid ?? 0) > 0) return false;
  const balance = appointmentBalance(apt.total_price, apt.amount_paid ?? 0);
  const deposit = apt.deposit_amount ?? 0;
  return deposit > 0 && deposit < balance - 0.009;
}

export function appointmentCheckoutAmount(
  apt: { total_price: number; deposit_amount: number; amount_paid: number },
  choice: PaymentChoice,
): number {
  const balance = appointmentBalance(apt.total_price, apt.amount_paid ?? 0);
  if (choice === "full") return balance;
  if ((apt.amount_paid ?? 0) > 0) return balance;
  return Math.min(apt.deposit_amount ?? 0, balance);
}

export function derivePaymentStatus(
  total: number,
  deposit: number,
  amountPaid: number,
): string {
  if (deposit <= 0 && amountPaid <= 0) return "not_required";
  if (amountPaid >= total && total > 0) return "paid";
  if (amountPaid > 0) return "deposit_paid";
  if (deposit > 0) return "unpaid";
  return "not_required";
}

export function isPaymentTracked(
  deposit: number,
  amountPaid: number,
  paymentStatus?: string | null,
): boolean {
  if (deposit > 0 || amountPaid > 0) return true;
  return paymentStatus === "deposit_paid" || paymentStatus === "paid";
}
