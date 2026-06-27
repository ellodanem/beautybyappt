/** Stripe REST helpers for Cloudflare Workers (fetch-based, no SDK). */

export type StripeEnv = {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  APP_URL?: string;
};

export function isStripeConfigured(env: StripeEnv): boolean {
  return Boolean(env.STRIPE_SECRET_KEY?.trim());
}

export function appBaseUrl(env: StripeEnv, requestUrl?: string): string {
  if (env.APP_URL?.trim()) return env.APP_URL.replace(/\/$/, "");
  if (requestUrl) {
    const url = new URL(requestUrl);
    return `${url.protocol}//${url.host}`;
  }
  return "http://localhost:5173";
}

/** Convert major currency units to Stripe's smallest unit (cents for USD). */
export function toStripeUnitAmount(amount: number, _currency: string): number {
  return Math.max(0, Math.round(amount * 100));
}

async function stripeRequest<T>(
  env: StripeEnv,
  method: string,
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const secret = env.STRIPE_SECRET_KEY?.trim();
  if (!secret) throw new Error("Stripe is not configured");

  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  };

  let url = `https://api.stripe.com/v1${path}`;
  if (params) {
    const body = new URLSearchParams(params).toString();
    if (method === "GET") {
      url += `?${body}`;
    } else {
      init.body = body;
    }
  }

  const res = await fetch(url, init);
  const data = await res.json() as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(data.error?.message || `Stripe error ${res.status}`);
  }
  return data;
}

export type StripeCheckoutSession = {
  id: string;
  url: string | null;
  payment_status: string;
  payment_intent: string | { id: string } | null;
  metadata?: Record<string, string>;
  amount_total?: number | null;
  currency?: string | null;
};

export type CheckoutLineItem = {
  name: string;
  description?: string;
  amount: number;
};

export async function createCheckoutSession(
  env: StripeEnv,
  opts: {
    currency: string;
    lineItems: CheckoutLineItem[];
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
  },
): Promise<StripeCheckoutSession> {
  if (opts.lineItems.length === 0) throw new Error("At least one line item is required");

  const currency = opts.currency.toLowerCase();
  const params: Record<string, string> = {
    mode: "payment",
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
  };

  opts.lineItems.forEach((item, index) => {
    params[`line_items[${index}][quantity]`] = "1";
    params[`line_items[${index}][price_data][currency]`] = currency;
    params[`line_items[${index}][price_data][unit_amount]`] = String(toStripeUnitAmount(item.amount, opts.currency));
    params[`line_items[${index}][price_data][product_data][name]`] = item.name;
    if (item.description) {
      params[`line_items[${index}][price_data][product_data][description]`] = item.description;
    }
  });

  for (const [key, value] of Object.entries(opts.metadata)) {
    params[`metadata[${key}]`] = value;
  }

  return stripeRequest<StripeCheckoutSession>(env, "POST", "/checkout/sessions", params);
}

export async function createDepositCheckoutSession(
  env: StripeEnv,
  opts: {
    amount: number;
    currency: string;
    productName: string;
    description: string;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
  },
): Promise<StripeCheckoutSession> {
  return createCheckoutSession(env, {
    currency: opts.currency,
    lineItems: [{ name: opts.productName, description: opts.description, amount: opts.amount }],
    successUrl: opts.successUrl,
    cancelUrl: opts.cancelUrl,
    metadata: opts.metadata,
  });
}

export async function retrieveCheckoutSession(
  env: StripeEnv,
  sessionId: string,
): Promise<StripeCheckoutSession> {
  return stripeRequest<StripeCheckoutSession>(env, "GET", `/checkout/sessions/${sessionId}`, {
    "expand[]": "payment_intent",
  });
}

export async function verifyStripeWebhook(
  payload: string,
  signatureHeader: string | undefined,
  secret: string | undefined,
): Promise<boolean> {
  if (!signatureHeader || !secret) return false;

  const parts = signatureHeader.split(",").reduce<Record<string, string>>((acc, part) => {
    const [key, value] = part.split("=");
    if (key && value) acc[key.trim()] = value.trim();
    return acc;
  }, {});

  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const age = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
  if (age > 300) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");

  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export type StripeWebhookEvent = {
  type: string;
  data: { object: StripeCheckoutSession };
};

export function parseStripeWebhookEvent(payload: string): StripeWebhookEvent {
  return JSON.parse(payload) as StripeWebhookEvent;
}

export function paymentIntentId(session: StripeCheckoutSession): string | null {
  if (!session.payment_intent) return null;
  return typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent.id;
}
