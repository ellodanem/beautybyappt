import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { get, run } from "./db.js";

const RESEND_API = "https://api.resend.com";

export type NotificationEnv = {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
};

function isEmailConfigured(env: NotificationEnv): boolean {
  return Boolean(env.RESEND_API_KEY?.trim());
}

export type EmailDomainStatus = "" | "not_started" | "pending" | "verified" | "failed" | "temporary_failure";

export interface DnsRecord {
  record: string;
  name: string;
  type: string;
  value: string;
  priority?: number;
  status?: string;
  ttl?: string;
}

export interface EmailDomainSettings {
  resend_configured: boolean;
  domain: string;
  domain_id: string;
  status: EmailDomainStatus;
  from_address: string;
  records: DnsRecord[];
  can_send_from_domain: boolean;
}

async function getMetaValue(key: string): Promise<string> {
  const row = await get<{ value: string }>("SELECT value FROM _meta WHERE key = ?", [key]);
  return row?.value ?? "";
}

async function setMetaValue(key: string, value: string): Promise<void> {
  await run("INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)", [key, value]);
}

function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (d.endsWith(".")) d = d.slice(0, -1);
  return d;
}

function isValidDomain(domain: string): boolean {
  if (!domain || domain.length > 253) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain);
}

function normalizeResendStatus(status: string | undefined): EmailDomainStatus {
  if (!status) return "not_started";
  if (status === "verified") return "verified";
  if (status === "failed" || status === "temporary_failure") return status as EmailDomainStatus;
  return "pending";
}

async function resendRequest<T>(
  env: NotificationEnv,
  path: string,
  method: "GET" | "POST" | "DELETE" = "GET",
  body?: unknown,
): Promise<{ data?: T; error?: string }> {
  if (!isEmailConfigured(env)) {
    return { error: "Resend is not configured (RESEND_API_KEY missing)" };
  }

  const res = await fetch(`${RESEND_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const json = await res.json().catch(() => ({})) as T & { message?: string };
  if (!res.ok) {
    return { error: json.message || `Resend error ${res.status}` };
  }
  return { data: json };
}

function parseStoredRecords(raw: string): DnsRecord[] {
  try {
    const parsed = JSON.parse(raw || "[]") as DnsRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function persistDomainState(
  domain: string,
  domainId: string,
  status: EmailDomainStatus,
  records: DnsRecord[],
): Promise<void> {
  await setMetaValue("email_domain", domain);
  await setMetaValue("resend_domain_id", domainId);
  await setMetaValue("email_domain_status", status);
  await setMetaValue("email_domain_records", JSON.stringify(records));
}

export async function getEmailDomainSettings(env: NotificationEnv): Promise<EmailDomainSettings> {
  const domain = await getMetaValue("email_domain");
  const domainId = await getMetaValue("resend_domain_id");
  const status = (await getMetaValue("email_domain_status")) as EmailDomainStatus;
  const fromAddress = await getMetaValue("email_from_address");
  const records = parseStoredRecords(await getMetaValue("email_domain_records"));

  return {
    resend_configured: isEmailConfigured(env),
    domain,
    domain_id: domainId,
    status,
    from_address: fromAddress,
    records,
    can_send_from_domain: status === "verified" && Boolean(fromAddress.trim()),
  };
}

export async function getConfiguredFromAddress(env: NotificationEnv): Promise<string> {
  const settings = await getEmailDomainSettings(env);
  if (settings.can_send_from_domain) {
    return settings.from_address.trim();
  }
  return env.EMAIL_FROM?.trim() || "onboarding@resend.dev";
}

function fromAddressMatchesDomain(fromAddress: string, domain: string): boolean {
  const email = fromAddress.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 1) return false;
  const emailDomain = email.slice(at + 1);
  return emailDomain === domain || emailDomain.endsWith(`.${domain}`);
}

async function refreshDomainFromResend(env: NotificationEnv): Promise<{ error?: string; settings?: EmailDomainSettings }> {
  const domainId = await getMetaValue("resend_domain_id");
  const domain = await getMetaValue("email_domain");
  if (!domainId) return { error: "No domain connected" };

  const { data, error } = await resendRequest<{
    id: string;
    name: string;
    status: string;
    records?: DnsRecord[];
  }>(env, `/domains/${domainId}`);

  if (error || !data) return { error: error || "Failed to fetch domain" };

  const status = normalizeResendStatus(data.status);
  const records = data.records ?? parseStoredRecords(await getMetaValue("email_domain_records"));
  await persistDomainState(data.name || domain, data.id, status, records);

  return { settings: await getEmailDomainSettings(env) };
}

export async function connectEmailDomain(
  env: NotificationEnv,
  domainInput: string,
): Promise<{ error?: string; settings?: EmailDomainSettings }> {
  const domain = normalizeDomain(domainInput);
  if (!isValidDomain(domain)) {
    return { error: "Enter a valid domain (e.g. send.yourbusiness.com)" };
  }

  const { data, error } = await resendRequest<{
    id: string;
    name: string;
    status: string;
    records: DnsRecord[];
  }>(env, "/domains", "POST", { name: domain });

  if (error || !data) return { error: error || "Failed to create domain" };

  const status = normalizeResendStatus(data.status);
  await persistDomainState(data.name, data.id, status, data.records ?? []);
  await setMetaValue("email_from_address", "");

  return { settings: await getEmailDomainSettings(env) };
}

export async function verifyEmailDomain(env: NotificationEnv): Promise<{ error?: string; settings?: EmailDomainSettings }> {
  const domainId = await getMetaValue("resend_domain_id");
  if (!domainId) return { error: "Connect a domain first" };

  const { error: verifyError } = await resendRequest(env, `/domains/${domainId}/verify`, "POST");
  if (verifyError) return { error: verifyError };

  return refreshDomainFromResend(env);
}

export async function setEmailFromAddress(
  env: NotificationEnv,
  fromAddress: string,
): Promise<{ error?: string; settings?: EmailDomainSettings }> {
  const email = fromAddress.trim().toLowerCase();
  if (!email) {
    await setMetaValue("email_from_address", "");
    return { settings: await getEmailDomainSettings(env) };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Enter a valid email address" };
  }

  const settings = await getEmailDomainSettings(env);
  if (settings.status !== "verified") {
    return { error: "Verify your domain before setting a from address" };
  }
  if (!fromAddressMatchesDomain(email, settings.domain)) {
    return { error: `From address must use your connected domain (${settings.domain})` };
  }

  await setMetaValue("email_from_address", email);
  return { settings: await getEmailDomainSettings(env) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerEmailDomainRoutes(app: OpenAPIHono<any>) {
  const DnsRecordSchema = z.object({
    record: z.string(),
    name: z.string(),
    type: z.string(),
    value: z.string(),
    priority: z.number().optional(),
    status: z.string().optional(),
    ttl: z.string().optional(),
  });

  const EmailDomainSchema = z.object({
    resend_configured: z.boolean(),
    domain: z.string(),
    domain_id: z.string(),
    status: z.string(),
    from_address: z.string(),
    records: z.array(DnsRecordSchema),
    can_send_from_domain: z.boolean(),
  });

  const ErrorSchema = z.object({ error: z.string() });

  app.openapi(createRoute({
    method: "get",
    path: "/api/settings/email-domain",
    responses: {
      200: {
        description: "Email domain connect status",
        content: { "application/json": { schema: EmailDomainSchema } },
      },
    },
  }), async (c) => {
    return c.json(await getEmailDomainSettings(c.env as NotificationEnv), 200);
  });

  app.openapi(createRoute({
    method: "post",
    path: "/api/settings/email-domain",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({ domain: z.string().min(1) }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Domain registered with Resend",
        content: { "application/json": { schema: EmailDomainSchema } },
      },
      400: { description: "Invalid", content: { "application/json": { schema: ErrorSchema } } },
    },
  }), async (c) => {
    const { domain } = c.req.valid("json");
    const result = await connectEmailDomain(c.env as NotificationEnv, domain);
    if (result.error) return c.json({ error: result.error }, 400);
    return c.json(result.settings!, 200);
  });

  app.openapi(createRoute({
    method: "post",
    path: "/api/settings/email-domain/verify",
    responses: {
      200: {
        description: "Verification triggered",
        content: { "application/json": { schema: EmailDomainSchema } },
      },
      400: { description: "Invalid", content: { "application/json": { schema: ErrorSchema } } },
    },
  }), async (c) => {
    const result = await verifyEmailDomain(c.env as NotificationEnv);
    if (result.error) return c.json({ error: result.error }, 400);
    return c.json(result.settings!, 200);
  });

  app.openapi(createRoute({
    method: "post",
    path: "/api/settings/email-domain/refresh",
    responses: {
      200: {
        description: "Status refreshed from Resend",
        content: { "application/json": { schema: EmailDomainSchema } },
      },
      400: { description: "Invalid", content: { "application/json": { schema: ErrorSchema } } },
    },
  }), async (c) => {
    const result = await refreshDomainFromResend(c.env as NotificationEnv);
    if (result.error) return c.json({ error: result.error }, 400);
    return c.json(result.settings!, 200);
  });

  app.openapi(createRoute({
    method: "put",
    path: "/api/settings/email-domain/from",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({ from_address: z.string() }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "From address updated",
        content: { "application/json": { schema: EmailDomainSchema } },
      },
      400: { description: "Invalid", content: { "application/json": { schema: ErrorSchema } } },
    },
  }), async (c) => {
    const { from_address } = c.req.valid("json");
    const result = await setEmailFromAddress(c.env as NotificationEnv, from_address);
    if (result.error) return c.json({ error: result.error }, 400);
    return c.json(result.settings!, 200);
  });
}
