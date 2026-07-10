import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { get, query, run } from "./db.js";
import { runtimeEnv } from "./runtime-env.js";
import { getBranding } from "./branding.js";
import { formatMoney, getCurrency } from "../shared/currency.js";
import { PLATFORM_NAME } from "../shared/branding.js";
import { appointmentBalance } from "../shared/payment.js";
import {
  emailNotConfiguredReason,
  getEmailProvider,
  isEmailConfigured,
  sendProviderEmail,
  type EmailEnv,
} from "./email-providers.js";
import { getNotificationSettings } from "./notifications.js";
import { resolvePaymentLinkUrl, templateReferencesPaymentLink } from "./appointment-payments.js";
import type { StripeEnv } from "./stripe.js";
import { isValidEmail, normalizeEmail } from "../shared/email.js";

export const EMAIL_TEMPLATE_PLACEHOLDERS = [
  "{client_name}",
  "{business_name}",
  "{business_tagline}",
  "{reference}",
  "{date}",
  "{time}",
  "{staff_name}",
  "{services}",
  "{event_name}",
  "{location}",
  "{currency}",
  "{currency_symbol}",
  "{total}",
  "{amount_paid}",
  "{balance_due}",
  "{payment_link}",
  "{payment_link_url}",
] as const;

export interface EmailTemplate {
  id: number;
  slug: string;
  name: string;
  subject: string;
  body: string;
  is_builtin: boolean;
  created_at: string;
  updated_at: string;
}

interface AppointmentTemplateContext {
  id: number;
  identifier: string;
  scheduled_date: string;
  start_time: string;
  end_time: string;
  total_price: number;
  currency: string;
  deposit_amount: number;
  amount_paid: number;
  travel_fee: number;
  service_address: string;
  client_name: string;
  client_email: string;
  client_address: string;
  staff_name: string | null;
  offering_name: string | null;
  service_names: string[];
}

const BUILTIN_PAYMENT_REMINDER = {
  slug: "payment_reminder",
  name: "Payment reminder",
  subject: "Payment reminder — {reference}",
  body: `Hi {client_name},

This is a friendly reminder that you have a balance of {balance_due} due for your appointment with {business_name}.

Reference: {reference}
Date: {date}
Time: {time}
Total: {total}
Amount paid: {amount_paid}
Balance due: {balance_due}

{payment_link}

Please let us know if you have any questions.

— {business_name}`,
};

const BUILTIN_APPOINTMENT_REMINDER = {
  slug: "appointment_reminder",
  name: "Appointment reminder",
  subject: "Reminder: your appointment — {date}",
  body: `Hi {client_name},

Reminder: your appointment with {business_name} is coming up.

Reference: {reference}
Date: {date}
Time: {time}
{event_name}
{services}
{location}

{balance_due}

{business_tagline}

— {business_name}`,
};

function rowToTemplate(row: {
  id: number;
  slug: string;
  name: string;
  subject: string;
  body: string;
  is_builtin: number;
  created_at: string;
  updated_at: string;
}): EmailTemplate {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    subject: row.subject,
    body: row.body,
    is_builtin: row.is_builtin === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function ensureBuiltinEmailTemplates(): Promise<void> {
  await run(
    `INSERT OR IGNORE INTO email_templates (slug, name, subject, body, is_builtin)
     VALUES (?, ?, ?, ?, 1)`,
    [BUILTIN_PAYMENT_REMINDER.slug, BUILTIN_PAYMENT_REMINDER.name, BUILTIN_PAYMENT_REMINDER.subject, BUILTIN_PAYMENT_REMINDER.body],
  );
  await run(
    `INSERT OR IGNORE INTO email_templates (slug, name, subject, body, is_builtin)
     VALUES (?, ?, ?, ?, 1)`,
    [
      BUILTIN_APPOINTMENT_REMINDER.slug,
      BUILTIN_APPOINTMENT_REMINDER.name,
      BUILTIN_APPOINTMENT_REMINDER.subject,
      BUILTIN_APPOINTMENT_REMINDER.body,
    ],
  );
}

export async function listEmailTemplates(): Promise<EmailTemplate[]> {
  await ensureBuiltinEmailTemplates();
  const rows = await query<{
    id: number;
    slug: string;
    name: string;
    subject: string;
    body: string;
    is_builtin: number;
    created_at: string;
    updated_at: string;
  }>("SELECT * FROM email_templates ORDER BY is_builtin DESC, name ASC");
  return rows.map(rowToTemplate);
}

export async function getEmailTemplateById(id: number): Promise<EmailTemplate | null> {
  const row = await get<{
    id: number;
    slug: string;
    name: string;
    subject: string;
    body: string;
    is_builtin: number;
    created_at: string;
    updated_at: string;
  }>("SELECT * FROM email_templates WHERE id = ?", [id]);
  return row ? rowToTemplate(row) : null;
}

function slugifyName(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || "template";
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let n = 2;
  while (await get<{ id: number }>("SELECT id FROM email_templates WHERE slug = ?", [slug])) {
    slug = `${base}_${n}`;
    n += 1;
  }
  return slug;
}

function formatAppointmentDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatAppointmentTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadAppointmentTemplateContext(appointmentId: number): Promise<AppointmentTemplateContext | null> {
  const apt = await get<{
    id: number;
    identifier: string;
    scheduled_date: string;
    start_time: string;
    end_time: string;
    total_price: number;
    currency: string;
    deposit_amount: number;
    amount_paid: number;
    travel_fee: number;
    service_address: string;
    client_name: string;
    client_email: string;
    client_address: string;
    staff_name: string | null;
    offering_name: string | null;
  }>(
    `SELECT a.id, a.identifier, a.scheduled_date, a.start_time, a.end_time,
            a.total_price, a.currency, a.deposit_amount, a.amount_paid, a.travel_fee,
            a.service_address,
            cl.name as client_name, cl.email as client_email, cl.address as client_address,
            s.name as staff_name, o.name as offering_name
     FROM appointments a
     LEFT JOIN clients cl ON cl.id = a.client_id
     LEFT JOIN staff s ON s.id = a.staff_id
     LEFT JOIN offering_slot_instances si ON si.id = a.offering_slot_instance_id
     LEFT JOIN offerings o ON o.id = si.offering_id
     WHERE a.id = ?`,
    [appointmentId],
  );
  if (!apt) return null;

  const services = await query<{ name: string }>(
    `SELECT COALESCE(NULLIF(aps.service_name, ''), s.name) as name
     FROM appointment_services aps
     LEFT JOIN services s ON s.id = aps.service_id
     WHERE aps.appointment_id = ?`,
    [appointmentId],
  );

  return {
    ...apt,
    travel_fee: apt.travel_fee ?? 0,
    service_names: services.map((s) => s.name),
  };
}

function buildPlaceholderMap(
  ctx: AppointmentTemplateContext,
  branding: { business_name: string; business_tagline: string },
  paymentLinkUrl: string | null,
): Record<string, string> {
  const businessName = branding.business_name.trim() || PLATFORM_NAME;
  const currency = ctx.currency || "USD";
  const balance = appointmentBalance(ctx.total_price, ctx.amount_paid);
  const location = ctx.service_address.trim() || ctx.client_address.trim();
  const timeLabel = `${formatAppointmentTime(ctx.start_time)} – ${formatAppointmentTime(ctx.end_time)}`;

  return {
    client_name: ctx.client_name,
    business_name: businessName,
    business_tagline: branding.business_tagline.trim(),
    reference: ctx.identifier,
    date: formatAppointmentDate(ctx.scheduled_date),
    time: timeLabel,
    staff_name: ctx.staff_name?.trim() ?? "",
    services: ctx.service_names.length > 0 ? `Services: ${ctx.service_names.join(", ")}` : "",
    event_name: ctx.offering_name?.trim() ? `Event: ${ctx.offering_name.trim()}` : "",
    location: location ? `Location: ${location}` : "",
    currency,
    currency_symbol: getCurrency(currency).symbol,
    total: formatMoney(ctx.total_price, currency),
    amount_paid: formatMoney(ctx.amount_paid, currency),
    balance_due: formatMoney(balance, currency),
    payment_link: paymentLinkUrl ? `Pay here: ${paymentLinkUrl}` : "",
    payment_link_url: paymentLinkUrl ?? "",
  };
}

function applyPlaceholders(text: string, placeholders: Record<string, string>): string {
  return text.replace(/\{([a-z_]+)\}/g, (match, key: string) => placeholders[key] ?? match);
}

function textToHtml(text: string, businessName: string): string {
  const lines = text.split("\n");
  const htmlParts = lines
    .map((line) => {
      if (line.trim() === "") return `<p style="margin:0 0 16px 0">&nbsp;</p>`;
      if (line.startsWith("— ")) return `<p style="color:#666;margin-top:24px">${escapeHtml(line)}</p>`;
      if (line.startsWith("Hi ")) return `<p style="margin:0 0 8px 0">${escapeHtml(line)}</p>`;
      if (line.startsWith("Pay here:")) {
        const url = line.replace(/^Pay here:\s*/, "");
        return `<p style="margin:12px 0"><a href="${escapeHtml(url)}" style="color:#2563eb">${escapeHtml(line)}</a></p>`;
      }
      if (/^https?:\/\//.test(line.trim())) {
        const url = line.trim();
        return `<p style="margin:12px 0"><a href="${escapeHtml(url)}" style="color:#2563eb">${escapeHtml(url)}</a></p>`;
      }
      return `<p style="margin:0 0 4px 0">${escapeHtml(line)}</p>`;
    });

  return `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111;max-width:520px;margin:0 auto;padding:24px">
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(businessName)}</h1>
${htmlParts.join("\n")}
</body></html>`;
}

export function renderEmailTemplate(
  template: Pick<EmailTemplate, "subject" | "body">,
  ctx: AppointmentTemplateContext,
  branding: { business_name: string; business_tagline: string },
  paymentLinkUrl: string | null,
): { subject: string; text: string; html: string } {
  const placeholders = buildPlaceholderMap(ctx, branding, paymentLinkUrl);
  const subject = applyPlaceholders(template.subject, placeholders);
  const text = applyPlaceholders(template.body, placeholders);
  const businessName = branding.business_name.trim() || PLATFORM_NAME;
  const html = textToHtml(text, businessName);
  return { subject, text, html };
}

async function logTemplateNotification(
  appointmentId: number,
  recipient: string,
  templateSlug: string,
  status: string,
  providerId?: string,
  errorMessage = "",
): Promise<void> {
  await run(
    `INSERT INTO notification_log (appointment_id, channel, recipient, template, status, provider_id, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [appointmentId, "email", recipient, templateSlug, status, providerId ?? null, errorMessage],
  );
}

export interface EmailTestAppointmentOption {
  id: number;
  identifier: string;
  client_name: string;
  scheduled_date: string;
  start_time: string;
  status: string;
  offering_name: string | null;
}

export async function listEmailTestAppointments(limit = 80): Promise<EmailTestAppointmentOption[]> {
  const rows = await query<{
    id: number;
    identifier: string;
    client_name: string;
    scheduled_date: string;
    start_time: string;
    status: string;
    offering_name: string | null;
  }>(
    `SELECT a.id, a.identifier, cl.name as client_name, a.scheduled_date, a.start_time, a.status,
            o.name as offering_name
     FROM appointments a
     LEFT JOIN clients cl ON cl.id = a.client_id
     LEFT JOIN offering_slot_instances si ON si.id = a.offering_slot_instance_id
     LEFT JOIN offerings o ON o.id = si.offering_id
     ORDER BY a.scheduled_date DESC, a.start_time DESC
     LIMIT ?`,
    [limit],
  );
  return rows.map((row) => ({
    id: row.id,
    identifier: row.identifier,
    client_name: row.client_name || "Unknown client",
    scheduled_date: row.scheduled_date,
    start_time: row.start_time,
    status: row.status,
    offering_name: row.offering_name,
  }));
}

async function deliverTemplateEmail(
  env: EmailEnv & StripeEnv,
  options: {
    appointmentId: number;
    template: Pick<EmailTemplate, "slug" | "subject" | "body">;
    to: string;
    requestUrl?: string;
    logStatus: string;
    subjectPrefix?: string;
    requireNotificationsEnabled?: boolean;
    autoCreatePaymentLink?: boolean;
  },
): Promise<{ ok: boolean; error?: string }> {
  const to = normalizeEmail(options.to);
  if (!isValidEmail(to)) return { ok: false, error: "Enter a valid email address" };

  if (!(await isEmailConfigured(env))) {
    return { ok: false, error: emailNotConfiguredReason(await getEmailProvider()) };
  }

  const settings = await getNotificationSettings(env);
  if (options.requireNotificationsEnabled && !settings.email_enabled) {
    return { ok: false, error: "Email notifications are disabled in Settings" };
  }

  const ctx = await loadAppointmentTemplateContext(options.appointmentId);
  if (!ctx) return { ok: false, error: "Appointment not found" };

  const branding = await getBranding();
  const templateWantsPaymentLink = templateReferencesPaymentLink(options.template);
  const paymentLinkUrl = await resolvePaymentLinkUrl(env, options.appointmentId, options.requestUrl, {
    autoCreate: (options.autoCreatePaymentLink ?? true) && templateWantsPaymentLink,
    addNote: false,
  });
  const rendered = renderEmailTemplate(options.template, ctx, branding, paymentLinkUrl);
  const subjectPrefix = options.subjectPrefix ?? "";
  const subject = `${subjectPrefix}${rendered.subject}`;
  const notConfiguredReason = emailNotConfiguredReason(await getEmailProvider());

  const result = await sendProviderEmail(
    env,
    to,
    branding.business_name.trim(),
    settings.email_reply_to,
    subject,
    rendered.text,
    rendered.html,
  );

  if (result.skipped) {
    await logTemplateNotification(options.appointmentId, to, options.template.slug, "skipped", undefined, notConfiguredReason);
    return { ok: false, error: notConfiguredReason };
  }
  if (result.error) {
    await logTemplateNotification(options.appointmentId, to, options.template.slug, "failed", undefined, result.error);
    return { ok: false, error: result.error };
  }

  await logTemplateNotification(options.appointmentId, to, options.template.slug, options.logStatus, result.providerId);
  return { ok: true };
}

export async function sendAppointmentTemplateEmail(
  env: EmailEnv & StripeEnv,
  appointmentId: number,
  templateId: number,
  requestUrl?: string,
): Promise<{ ok: boolean; error?: string }> {
  const template = await getEmailTemplateById(templateId);
  if (!template) return { ok: false, error: "Template not found" };

  const ctx = await loadAppointmentTemplateContext(appointmentId);
  if (!ctx) return { ok: false, error: "Appointment not found" };

  const email = ctx.client_email.trim();
  if (!email) return { ok: false, error: "Client has no email address" };

  const result = await deliverTemplateEmail(env, {
    appointmentId,
    template,
    to: email,
    requestUrl,
    logStatus: "sent",
    requireNotificationsEnabled: true,
  });
  if (result.ok) {
    const { markReminderSentForManualTemplate } = await import("./notification-rules.js");
    await markReminderSentForManualTemplate(appointmentId, templateId);
  }
  return result;
}

export async function sendTestTemplateEmail(
  env: EmailEnv & StripeEnv,
  templateId: number,
  appointmentId: number,
  toEmail: string,
  requestUrl?: string,
  overrides?: { subject?: string; body?: string },
): Promise<{ ok: boolean; error?: string }> {
  const template = await getEmailTemplateById(templateId);
  if (!template) return { ok: false, error: "Template not found" };

  const draftTemplate = {
    slug: template.slug,
    subject: overrides?.subject?.trim() || template.subject,
    body: overrides?.body?.trim() || template.body,
  };

  return deliverTemplateEmail(env, {
    appointmentId,
    template: draftTemplate,
    to: toEmail,
    requestUrl,
    logStatus: "test",
    subjectPrefix: "[TEST] ",
    requireNotificationsEnabled: false,
    autoCreatePaymentLink: false,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerEmailTemplateRoutes(app: OpenAPIHono<any>) {
  const EmailTemplateSchema = z.object({
    id: z.number().int(),
    slug: z.string(),
    name: z.string(),
    subject: z.string(),
    body: z.string(),
    is_builtin: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
  });

  const listRoute = createRoute({
    method: "get",
    path: "/api/settings/email-templates",
    responses: {
      200: {
        description: "Email templates",
        content: {
          "application/json": {
            schema: z.object({ templates: z.array(EmailTemplateSchema), placeholders: z.array(z.string()) }),
          },
        },
      },
    },
  });

  app.openapi(listRoute, async (c) => {
    const templates = await listEmailTemplates();
    return c.json({ templates, placeholders: [...EMAIL_TEMPLATE_PLACEHOLDERS] }, 200);
  });

  const createRoute_ = createRoute({
    method: "post",
    path: "/api/settings/email-templates",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              name: z.string().min(1).max(120),
              subject: z.string().min(1).max(200),
              body: z.string().min(1).max(10000),
            }),
          },
        },
      },
    },
    responses: {
      201: {
        description: "Created",
        content: { "application/json": { schema: EmailTemplateSchema } },
      },
    },
  });

  app.openapi(createRoute_, async (c) => {
    const body = c.req.valid("json");
    const slug = await uniqueSlug(slugifyName(body.name));
    await run(
      `INSERT INTO email_templates (slug, name, subject, body, is_builtin, updated_at)
       VALUES (?, ?, ?, ?, 0, datetime('now'))`,
      [slug, body.name.trim(), body.subject, body.body],
    );
    const created = await get<{
      id: number;
      slug: string;
      name: string;
      subject: string;
      body: string;
      is_builtin: number;
      created_at: string;
      updated_at: string;
    }>("SELECT * FROM email_templates WHERE slug = ?", [slug]);
    return c.json(rowToTemplate(created!), 201);
  });

  const updateRoute = createRoute({
    method: "put",
    path: "/api/settings/email-templates/{id}",
    request: {
      params: z.object({ id: z.coerce.number().int() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              name: z.string().min(1).max(120).optional(),
              subject: z.string().min(1).max(200).optional(),
              body: z.string().min(1).max(10000).optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Updated",
        content: { "application/json": { schema: EmailTemplateSchema } },
      },
      404: { description: "Not found" },
    },
  });

  app.openapi(updateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const existing = await getEmailTemplateById(id);
    if (!existing) return c.json({ error: "Template not found" }, 404);

    const body = c.req.valid("json");
    const name = body.name?.trim() ?? existing.name;
    const subject = body.subject ?? existing.subject;
    const templateBody = body.body ?? existing.body;

    let slug = existing.slug;
    if (!existing.is_builtin && body.name && body.name.trim() !== existing.name) {
      slug = await uniqueSlug(slugifyName(body.name));
    }

    await run(
      `UPDATE email_templates SET slug = ?, name = ?, subject = ?, body = ?, updated_at = datetime('now') WHERE id = ?`,
      [slug, name, subject, templateBody, id],
    );

    const updated = await getEmailTemplateById(id);
    return c.json(updated!, 200);
  });

  const deleteRoute = createRoute({
    method: "delete",
    path: "/api/settings/email-templates/{id}",
    request: {
      params: z.object({ id: z.coerce.number().int() }),
    },
    responses: {
      200: { description: "Deleted", content: { "application/json": { schema: z.object({ ok: z.boolean() }) } } },
      400: { description: "Cannot delete built-in template" },
      404: { description: "Not found" },
    },
  });

  app.openapi(deleteRoute, async (c) => {
    const { id } = c.req.valid("param");
    const existing = await getEmailTemplateById(id);
    if (!existing) return c.json({ error: "Template not found" }, 404);
    if (existing.is_builtin) return c.json({ error: "Built-in templates cannot be deleted" }, 400);
    await run("DELETE FROM email_templates WHERE id = ?", [id]);
    return c.json({ ok: true }, 200);
  });

  const testAppointmentsRoute = createRoute({
    method: "get",
    path: "/api/settings/email-templates/test-appointments",
    responses: {
      200: {
        description: "Appointments for template test sends",
        content: {
          "application/json": {
            schema: z.object({
              appointments: z.array(z.object({
                id: z.number().int(),
                identifier: z.string(),
                client_name: z.string(),
                scheduled_date: z.string(),
                start_time: z.string(),
                status: z.string(),
                offering_name: z.string().nullable(),
              })),
            }),
          },
        },
      },
    },
  });

  app.openapi(testAppointmentsRoute, async (c) => {
    const appointments = await listEmailTestAppointments();
    return c.json({ appointments }, 200);
  });

  const testSendRoute = createRoute({
    method: "post",
    path: "/api/settings/email-templates/{id}/test",
    request: {
      params: z.object({ id: z.coerce.number().int() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({
              appointment_id: z.number().int(),
              to: z.string().min(3).max(200),
              subject: z.string().max(200).optional(),
              body: z.string().max(10000).optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: { description: "Test sent", content: { "application/json": { schema: z.object({ ok: z.boolean() }) } } },
      400: { description: "Send failed" },
      404: { description: "Not found" },
    },
  });

  app.openapi(testSendRoute, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const env = runtimeEnv(c.env) as EmailEnv & StripeEnv;
    const result = await sendTestTemplateEmail(
      env,
      id,
      body.appointment_id,
      body.to,
      c.req.url,
      { subject: body.subject, body: body.body },
    );
    if (!result.ok) {
      return c.json({ error: result.error ?? "Failed to send test email" }, 400);
    }
    return c.json({ ok: true }, 200);
  });

  const sendRoute = createRoute({
    method: "post",
    path: "/api/appointments/{id}/send-email",
    request: {
      params: z.object({ id: z.coerce.number().int() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({ template_id: z.number().int() }),
          },
        },
      },
    },
    responses: {
      200: { description: "Sent", content: { "application/json": { schema: z.object({ ok: z.boolean() }) } } },
      400: { description: "Send failed" },
      404: { description: "Not found" },
    },
  });

  app.openapi(sendRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { template_id } = c.req.valid("json");
    const env = runtimeEnv(c.env) as EmailEnv & StripeEnv;
    const result = await sendAppointmentTemplateEmail(env, id, template_id, c.req.url);
    if (!result.ok) {
      return c.json({ error: result.error ?? "Failed to send email" }, 400);
    }
    return c.json({ ok: true }, 200);
  });
}
