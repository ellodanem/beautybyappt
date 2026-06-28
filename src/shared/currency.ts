export const SUPPORTED_CURRENCIES = [
  { code: "USD", label: "US Dollar", symbol: "$", locale: "en-US" },
  { code: "XCD", label: "East Caribbean Dollar", symbol: "$", locale: "en-LC" },
  { code: "EUR", label: "Euro", symbol: "€", locale: "de-DE" },
  { code: "GBP", label: "British Pound", symbol: "£", locale: "en-GB" },
  { code: "CAD", label: "Canadian Dollar", symbol: "$", locale: "en-CA" },
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]["code"];

export const DEFAULT_CURRENCY: CurrencyCode = "USD";

const currencyMap = new Map(SUPPORTED_CURRENCIES.map((c) => [c.code, c]));

export function isValidCurrency(code: string): code is CurrencyCode {
  return currencyMap.has(code as CurrencyCode);
}

export function getCurrency(code: string) {
  return currencyMap.get(code as CurrencyCode) ?? currencyMap.get(DEFAULT_CURRENCY)!;
}

export function formatMoney(amount: number, currencyCode: string): string {
  const { code, locale } = getCurrency(currencyCode);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: code }).format(amount);
  } catch {
    return `${getCurrency(currencyCode).symbol}${amount.toFixed(2)}`;
  }
}

export function currencyOptions() {
  return SUPPORTED_CURRENCIES.map((c) => ({ value: c.code, label: `${c.code} - ${c.label}` }));
}

/** USD to XCD conversion (matches Stripe / bank settlement rate). */
export const USD_TO_XCD_RATE = 2.7890;

export function getPairedCurrency(currencyCode: string): CurrencyCode | null {
  if (currencyCode === "USD") return "XCD";
  if (currencyCode === "XCD") return "USD";
  return null;
}

export function convertCurrency(amount: number, from: string, to: string): number {
  if (from === to) return amount;
  if (from === "USD" && to === "XCD") {
    return Math.round(amount * USD_TO_XCD_RATE * 100) / 100;
  }
  if (from === "XCD" && to === "USD") {
    return Math.round((amount / USD_TO_XCD_RATE) * 100) / 100;
  }
  return amount;
}
