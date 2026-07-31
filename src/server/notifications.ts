import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { get, query, run } from "./db.js";
import { runtimeEnv } from "./runtime-env.js";
import { getBranding } from "./branding.js";
import { formatMoney } from "../shared/currency.js";
import { PLATFORM_NAME } from "../shared/branding.js";
import { getBusinessUtcOffsetHours } from "./business-locale.js";
import {
  emailNotConfiguredReason,
  getEmailProvider,
  isEmailConfigured,
  sendProviderEmail,
  type EmailEnv,
  type EmailProvider,
} from "./email-providers.js";
import { processScheduledNotifications } from "./notification-rules.js";
import { appBaseUrl, type StripeEnv } from "./stripe.js";

export type NotificationEnv = EmailEnv;

export interface NotificationSettings {
  email_enabled: boolean;
  sms_enabled: boolean;
  whatsapp_enabled: boolean;
  email_reply_to: string;
  email_configured: boolean;
  email_provider: EmailProvider;
  remind_24h_enabled: boolean;
  remind_2h_enabled: boolean;
  staff_booking_email_enabled: boolean;
}

interface AppointmentNotificationContext {
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
  payment_status: string;
  client_name: string;
  client_email: string;
  client_phone: string;
  client_address: string;
  staff_id: number | null;
  staff_name: string | null;
  staff_email: string | null;
  offering_name: string | null;
  service_names: string[];
}

type SchedulableContext = {
  env: NotificationEnv;
  executionCtx?: { waitUntil(p: Promise<unknown>): void };
};

const TEMPLATE_CONFIRMATION = "booking_confirmation";
const TEMPLATE_STAFF_BOOKING = "staff_booking_notification";
const TEMPLATE_REMINDER_24H = "reminder_24h";
const TEMPLATE_REMINDER_2H = "reminder_2h";

const ACTIVE_APPOINTMENT_STATUSES = ["booked", "confirmed", "in_progress"];

type ReminderWindow = {
  template: string;
  sentColumn: "reminder_24h_sent_at" | "reminder_2h_sent_at";
  settingKey: "remind_24h_enabled" | "remind_2h_enabled";
  hoursBefore: number;
  windowHalfHours: number;
  label: string;
};

const REMINDER_WINDOWS: ReminderWindow[] = [
  {
    template: TEMPLATE_REMINDER_24H,
    sentColumn: "reminder_24h_sent_at",
    settingKey: "remind_24h_enabled",
    hoursBefore: 24,
    windowHalfHours: 1,
    label: "tomorrow",
  },
  {
    template: TEMPLATE_REMINDER_2H,
    sentColumn: "reminder_2h_sent_at",
    settingKey: "remind_2h_enabled",
    hoursBefore: 2,
    windowHalfHours: 0.5,
    label: "in 2 hours",
  },
];

function metaFlag(key: string, defaultValue = false): Promise<boolean> {
  return get<{ value: string }>("SELECT value FROM _meta WHERE key = ?", [key]).then((row) => {
    if (!row) return defaultValue;
    return row.value === "1" || row.value === "true";
  });
}

async function getMetaValue(key: string): Promise<string> {
  const row = await get<{ value: string }>("SELECT value FROM _meta WHERE key = ?", [key]);
  return row?.value ?? "";
}

async function setMetaValue(key: string, value: string): Promise<void> {
  await run("INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)", [key, value]);
}

export async function getNotificationSettings(env: NotificationEnv): Promise<NotificationSettings> {
  return {
    email_enabled: await metaFlag("notify_email_enabled", true),
    sms_enabled: await metaFlag("notify_sms_enabled", false),
    whatsapp_enabled: await metaFlag("notify_whatsapp_enabled", false),
    email_reply_to: await getMetaValue("email_reply_to"),
    email_configured: await isEmailConfigured(env),
    email_provider: await getEmailProvider(),
    remind_24h_enabled: await metaFlag("remind_24h_enabled", true),
    remind_2h_enabled: await metaFlag("remind_2h_enabled", true),
    staff_booking_email_enabled: await metaFlag("notify_staff_booking_email_enabled", true),
  };
}

function appointmentUtcMs(scheduledDate: string, startTime: string, utcOffsetHours: number): number {
  const [y, mo, d] = scheduledDate.split("-").map(Number);
  const [h, mi] = startTime.split(":").map(Number);
  return Date.UTC(y, mo - 1, d, h - utcOffsetHours, mi);
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

async function loadAppointmentContext(appointmentId: number): Promise<AppointmentNotificationContext | null> {
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
    payment_status: string;
    client_name: string;
    client_email: string;
    client_phone: string;
    client_address: string;
    staff_id: number | null;
    staff_name: string | null;
    staff_email: string | null;
    offering_name: string | null;
  }>(
    `SELECT a.id, a.identifier, a.scheduled_date, a.start_time, a.end_time,
            a.total_price, a.currency, a.deposit_amount, a.amount_paid, a.travel_fee,
            a.service_address, a.payment_status,
            cl.name as client_name, cl.email as client_email, cl.phone as client_phone,
            cl.address as client_address,
            a.staff_id, s.name as staff_name, s.email as staff_email,
            o.name as offering_name
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

async function alreadySent(appointmentId: number, template: string): Promise<boolean> {
  const row = await get<{ id: number }>(
    `SELECT id FROM notification_log
     WHERE appointment_id = ? AND template = ? AND status IN ('sent', 'placeholder')
     LIMIT 1`,
    [appointmentId, template],
  );
  return Boolean(row);
}

/** Staff notify: treat skipped as done so webhook + success page don't re-log forever. */
async function alreadyHandledStaffBooking(appointmentId: number): Promise<boolean> {
  const row = await get<{ id: number }>(
    `SELECT id FROM notification_log
     WHERE appointment_id = ? AND template = ? AND status IN ('sent', 'placeholder', 'skipped')
     LIMIT 1`,
    [appointmentId, TEMPLATE_STAFF_BOOKING],
  );
  return Boolean(row);
}

async function logNotification(
  appointmentId: number,
  channel: string,
  recipient: string,
  template: string,
  status: string,
  providerId?: string,
  errorMessage = "",
): Promise<void> {
  await run(
    `INSERT INTO notification_log (appointment_id, channel, recipient, template, status, provider_id, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [appointmentId, channel, recipient, template, status, providerId ?? null, errorMessage],
  );
}

function serviceSubtotal(ctx: AppointmentNotificationContext): number {
  return Math.max(0, ctx.total_price - ctx.travel_fee);
}

function locationLine(ctx: AppointmentNotificationContext): string {
  const address = ctx.service_address.trim() || ctx.client_address.trim();
  return address ? `Location: ${address}` : "";
}

function appointmentBalance(ctx: AppointmentNotificationContext): number {
  return Math.max(0, ctx.total_price - ctx.amount_paid);
}

/** True when client paid something but still owes the rest (deposit scenario). */
function hasOutstandingBalance(ctx: AppointmentNotificationContext): boolean {
  return ctx.amount_paid > 0 && appointmentBalance(ctx) > 0;
}

function buildConfirmationText(
  ctx: AppointmentNotificationContext,
  branding: { business_name: string; business_tagline: string },
  includeReceipt: boolean,
): { subject: string; text: string; html: string } {
  const businessName = branding.business_name.trim() || PLATFORM_NAME;
  const dateLabel = formatAppointmentDate(ctx.scheduled_date);
  const timeLabel = `${formatAppointmentTime(ctx.start_time)} – ${formatAppointmentTime(ctx.end_time)}`;
  const currency = ctx.currency || "USD";

  const lines: string[] = [
    `Hi ${ctx.client_name},`,
    "",
    `Your appointment with ${businessName} is confirmed.`,
    "",
    `Reference: ${ctx.identifier}`,
    `Date: ${dateLabel}`,
    `Time: ${timeLabel}`,
  ];

  if (ctx.staff_name) lines.push(`With: ${ctx.staff_name}`);
  if (ctx.offering_name) lines.push(`Event: ${ctx.offering_name}`);
  if (ctx.service_names.length > 0) lines.push(`Services: ${ctx.service_names.join(", ")}`);

  const serviceTotal = serviceSubtotal(ctx);
  lines.push(`Services total: ${formatMoney(serviceTotal, currency)}`);
  if (ctx.travel_fee > 0) {
    lines.push(`Travel fee: ${formatMoney(ctx.travel_fee, currency)}`);
  }
  lines.push(`Total: ${formatMoney(ctx.total_price, currency)}`);

  const loc = locationLine(ctx);
  if (loc) {
    lines.push("");
    lines.push(loc);
  }

  if (includeReceipt && ctx.amount_paid > 0) {
    lines.push("");
    lines.push(`Payment received: ${formatMoney(ctx.amount_paid, currency)}`);
    const balance = Math.max(0, ctx.total_price - ctx.amount_paid);
    if (balance > 0) {
      lines.push(`Balance due at appointment: ${formatMoney(balance, currency)}`);
    }
  }

  if (branding.business_tagline.trim()) {
    lines.push("");
    lines.push(branding.business_tagline.trim());
  }

  lines.push("");
  lines.push(`— ${businessName}`);

  const subject = `Booking confirmed — ${dateLabel}`;

  const htmlParts = lines
    .filter((line) => line !== "")
    .map((line) => {
      if (line.startsWith("Hi ")) return `<p>${escapeHtml(line)}</p>`;
      if (line.startsWith("— ")) return `<p style="color:#666;margin-top:24px">${escapeHtml(line)}</p>`;
      return `<p style="margin:4px 0">${escapeHtml(line)}</p>`;
    });

  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111;max-width:520px;margin:0 auto;padding:24px">
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(businessName)}</h1>
${htmlParts.join("\n")}
</body></html>`;

  return { subject, text: lines.join("\n"), html };
}

function buildShortConfirmationText(
  ctx: AppointmentNotificationContext,
  branding: { business_name: string },
  includeReceipt: boolean,
): string {
  const businessName = branding.business_name.trim() || PLATFORM_NAME;
  const dateLabel = formatAppointmentDate(ctx.scheduled_date);
  const timeLabel = formatAppointmentTime(ctx.start_time);
  const parts = [
    `${businessName}: You're booked!`,
    `${dateLabel} at ${timeLabel}.`,
    `Ref ${ctx.identifier}.`,
  ];
  const loc = locationLine(ctx);
  if (loc) parts.push(loc.replace("Location: ", "At "));
  if (includeReceipt && ctx.amount_paid > 0) {
    parts.push(`Paid ${formatMoney(ctx.amount_paid, ctx.currency || "USD")}.`);
  }
  return parts.join(" ");
}

function buildReminderText(
  ctx: AppointmentNotificationContext,
  branding: { business_name: string; business_tagline: string },
  window: ReminderWindow,
): { subject: string; text: string; html: string } {
  const businessName = branding.business_name.trim() || PLATFORM_NAME;
  const dateLabel = formatAppointmentDate(ctx.scheduled_date);
  const timeLabel = `${formatAppointmentTime(ctx.start_time)} – ${formatAppointmentTime(ctx.end_time)}`;
  const currency = ctx.currency || "USD";
  const whenLabel = window.hoursBefore === 24 ? "tomorrow" : "in about 2 hours";

  const lines: string[] = [
    `Hi ${ctx.client_name},`,
    "",
    `Reminder: your appointment with ${businessName} is ${whenLabel}.`,
    "",
    `Reference: ${ctx.identifier}`,
    `Date: ${dateLabel}`,
    `Time: ${timeLabel}`,
  ];

  if (ctx.staff_name) lines.push(`With: ${ctx.staff_name}`);
  if (ctx.offering_name) lines.push(`Event: ${ctx.offering_name}`);
  if (ctx.service_names.length > 0) lines.push(`Services: ${ctx.service_names.join(", ")}`);

  const loc = locationLine(ctx);
  if (loc) {
    lines.push("");
    lines.push(loc);
    if (ctx.travel_fee > 0 || ctx.service_address.trim()) {
      lines.push("Please ensure someone is available at the location.");
    }
  }

  let balanceHtml = "";
  if (hasOutstandingBalance(ctx)) {
    const balance = appointmentBalance(ctx);
    const paidLabel = ctx.deposit_amount > 0 ? "deposit" : "payment";
    lines.push("");
    lines.push(`Payment received: ${formatMoney(ctx.amount_paid, currency)} (${paidLabel})`);
    lines.push(`Balance due at appointment: ${formatMoney(balance, currency)}`);
    lines.push("Please bring payment for the remaining balance.");
    balanceHtml = `<div style="margin:16px 0;padding:12px 16px;background:#fef3c7;border:1px solid #fcd34d;border-radius:8px">
<p style="margin:0 0 8px;font-weight:600">Balance due</p>
<p style="margin:4px 0">Payment received: ${escapeHtml(formatMoney(ctx.amount_paid, currency))} (${paidLabel})</p>
<p style="margin:4px 0;font-weight:600">Balance due at appointment: ${escapeHtml(formatMoney(balance, currency))}</p>
<p style="margin:8px 0 0;font-size:14px">Please bring payment for the remaining balance.</p>
</div>`;
  }

  if (branding.business_tagline.trim()) {
    lines.push("");
    lines.push(branding.business_tagline.trim());
  }

  lines.push("");
  lines.push(`— ${businessName}`);

  const balanceSuffix = hasOutstandingBalance(ctx)
    ? ` — ${formatMoney(appointmentBalance(ctx), currency)} balance due`
    : "";
  const subject = window.hoursBefore === 24
    ? `Reminder: appointment tomorrow${balanceSuffix} — ${dateLabel}`
    : `Reminder: appointment in 2 hours${balanceSuffix} — ${formatAppointmentTime(ctx.start_time)}`;

  const htmlParts = lines
    .filter((line) => line !== "")
    .map((line) => {
      if (line.startsWith("Payment received:") || line.startsWith("Balance due at appointment:") || line.startsWith("Please bring payment")) {
        return "";
      }
      if (line.startsWith("Hi ")) return `<p>${escapeHtml(line)}</p>`;
      if (line.startsWith("— ")) return `<p style="color:#666;margin-top:24px">${escapeHtml(line)}</p>`;
      if (line.startsWith("Reminder:")) return `<p style="font-weight:600">${escapeHtml(line)}</p>`;
      return `<p style="margin:4px 0">${escapeHtml(line)}</p>`;
    })
    .filter(Boolean);

  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111;max-width:520px;margin:0 auto;padding:24px">
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(businessName)}</h1>
${htmlParts.join("\n")}
${balanceHtml}
</body></html>`;

  return { subject, text: lines.join("\n"), html };
}

function buildShortReminderText(
  ctx: AppointmentNotificationContext,
  branding: { business_name: string },
  window: ReminderWindow,
): string {
  const businessName = branding.business_name.trim() || PLATFORM_NAME;
  const dateLabel = formatAppointmentDate(ctx.scheduled_date);
  const timeLabel = formatAppointmentTime(ctx.start_time);
  const whenLabel = window.hoursBefore === 24 ? "tomorrow" : "in 2 hrs";
  const parts = [
    `${businessName} reminder: appt ${whenLabel}.`,
    `${dateLabel} at ${timeLabel}.`,
    `Ref ${ctx.identifier}.`,
  ];
  const loc = locationLine(ctx);
  if (loc) parts.push(loc.replace("Location: ", "At "));
  if (hasOutstandingBalance(ctx)) {
    const balance = appointmentBalance(ctx);
    parts.push(`Paid ${formatMoney(ctx.amount_paid, ctx.currency || "USD")}. Balance ${formatMoney(balance, ctx.currency || "USD")} due.`);
  }
  return parts.join(" ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function paymentStatusLabel(ctx: AppointmentNotificationContext): string {
  const currency = ctx.currency || "USD";
  if (ctx.amount_paid <= 0) {
    if (ctx.deposit_amount > 0) {
      return `Unpaid — deposit ${formatMoney(ctx.deposit_amount, currency)} expected`;
    }
    return "Unpaid";
  }
  const balance = appointmentBalance(ctx);
  if (balance > 0) {
    return `Deposit paid ${formatMoney(ctx.amount_paid, currency)} — ${formatMoney(balance, currency)} due`;
  }
  return `Paid in full ${formatMoney(ctx.amount_paid, currency)}`;
}

function buildStaffBookingText(
  ctx: AppointmentNotificationContext,
  branding: { business_name: string },
  dashboardUrl: string,
): { subject: string; text: string; html: string } {
  const businessName = branding.business_name.trim() || PLATFORM_NAME;
  const dateLabel = formatAppointmentDate(ctx.scheduled_date);
  const timeLabel = `${formatAppointmentTime(ctx.start_time)} – ${formatAppointmentTime(ctx.end_time)}`;
  const currency = ctx.currency || "USD";
  const greetingName = ctx.staff_name?.trim() || "there";

  const lines: string[] = [
    `Hi ${greetingName},`,
    "",
    `New booking for ${businessName}.`,
    "",
    `Reference: ${ctx.identifier}`,
    `Client: ${ctx.client_name}`,
  ];

  if (ctx.client_phone.trim()) lines.push(`Phone: ${ctx.client_phone.trim()}`);
  if (ctx.client_email.trim()) lines.push(`Email: ${ctx.client_email.trim()}`);

  lines.push(`Date: ${dateLabel}`);
  lines.push(`Time: ${timeLabel}`);

  if (ctx.offering_name) lines.push(`Event: ${ctx.offering_name}`);
  if (ctx.service_names.length > 0) lines.push(`Services: ${ctx.service_names.join(", ")}`);
  if (ctx.staff_name) lines.push(`Assigned to: ${ctx.staff_name}`);

  const serviceTotal = serviceSubtotal(ctx);
  lines.push(`Services total: ${formatMoney(serviceTotal, currency)}`);
  if (ctx.travel_fee > 0) {
    lines.push(`Travel fee: ${formatMoney(ctx.travel_fee, currency)}`);
  }
  lines.push(`Total: ${formatMoney(ctx.total_price, currency)}`);
  lines.push(`Payment: ${paymentStatusLabel(ctx)}`);

  const loc = locationLine(ctx);
  if (loc) {
    lines.push("");
    lines.push(loc);
  }

  if (dashboardUrl) {
    lines.push("");
    lines.push(`View appointment: ${dashboardUrl}`);
  }

  lines.push("");
  lines.push(`— ${businessName}`);

  const subject = `New booking — ${ctx.client_name} · ${dateLabel}`;

  const htmlParts = lines
    .filter((line) => line !== "")
    .map((line) => {
      if (line.startsWith("Hi ")) return `<p>${escapeHtml(line)}</p>`;
      if (line.startsWith("New booking")) return `<p style="font-weight:600">${escapeHtml(line)}</p>`;
      if (line.startsWith("View appointment:")) {
        const url = line.replace("View appointment: ", "");
        return `<p style="margin:16px 0"><a href="${escapeHtml(url)}" style="color:#111">Open in dashboard</a></p>`;
      }
      if (line.startsWith("— ")) return `<p style="color:#666;margin-top:24px">${escapeHtml(line)}</p>`;
      return `<p style="margin:4px 0">${escapeHtml(line)}</p>`;
    });

  const html = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111;max-width:520px;margin:0 auto;padding:24px">
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(businessName)}</h1>
${htmlParts.join("\n")}
</body></html>`;

  return { subject, text: lines.join("\n"), html };
}

async function resolveStaffNotificationEmails(
  ctx: AppointmentNotificationContext,
): Promise<string[]> {
  const emails = new Set<string>();
  const assigned = ctx.staff_email?.trim().toLowerCase();
  if (assigned) {
    emails.add(assigned);
  } else {
    const admins = await query<{ email: string }>(
      `SELECT email FROM staff
       WHERE active = 1 AND is_admin = 1
         AND email IS NOT NULL AND TRIM(email) != ''`,
    );
    for (const row of admins) {
      const email = row.email.trim().toLowerCase();
      if (email) emails.add(email);
    }
  }

  const clientEmail = ctx.client_email.trim().toLowerCase();
  if (clientEmail) emails.delete(clientEmail);

  return [...emails];
}

export async function sendStaffBookingNotification(
  env: NotificationEnv,
  appointmentId: number,
): Promise<void> {
  if (await alreadyHandledStaffBooking(appointmentId)) return;

  const settings = await getNotificationSettings(env);
  if (!settings.email_enabled || !settings.staff_booking_email_enabled) return;

  const ctx = await loadAppointmentContext(appointmentId);
  if (!ctx) return;

  const recipients = await resolveStaffNotificationEmails(ctx);
  if (recipients.length === 0) {
    await logNotification(
      appointmentId,
      "email",
      "",
      TEMPLATE_STAFF_BOOKING,
      "skipped",
      undefined,
      "No staff email on assigned artist (or admin fallback)",
    );
    return;
  }

  const branding = await getBranding();
  const dashboardUrl = `${appBaseUrl(env)}/appointments/${ctx.id}`;
  const { subject, text, html } = buildStaffBookingText(ctx, branding, dashboardUrl);
  const notConfiguredReason = emailNotConfiguredReason(settings.email_provider);

  for (const email of recipients) {
    const result = await sendProviderEmail(
      env,
      email,
      branding.business_name.trim(),
      settings.email_reply_to,
      subject,
      text,
      html,
    );
    if (result.skipped) {
      await logNotification(appointmentId, "email", email, TEMPLATE_STAFF_BOOKING, "skipped", undefined, notConfiguredReason);
    } else if (result.error) {
      await logNotification(appointmentId, "email", email, TEMPLATE_STAFF_BOOKING, "failed", undefined, result.error);
    } else {
      await logNotification(appointmentId, "email", email, TEMPLATE_STAFF_BOOKING, "sent", result.providerId);
    }
  }
}

export async function sendBookingConfirmation(
  env: NotificationEnv,
  appointmentId: number,
  options?: { receipt?: boolean },
): Promise<void> {
  if (await alreadySent(appointmentId, TEMPLATE_CONFIRMATION)) return;

  const ctx = await loadAppointmentContext(appointmentId);
  if (!ctx) return;

  const settings = await getNotificationSettings(env);
  const branding = await getBranding();
  const includeReceipt = options?.receipt ?? ctx.amount_paid > 0;
  const { subject, text, html } = buildConfirmationText(ctx, branding, includeReceipt);
  const shortText = buildShortConfirmationText(ctx, branding, includeReceipt);
  const notConfiguredReason = emailNotConfiguredReason(settings.email_provider);

  if (settings.email_enabled) {
    const email = ctx.client_email.trim();
    if (!email) {
      await logNotification(appointmentId, "email", "", TEMPLATE_CONFIRMATION, "skipped", undefined, "No client email");
    } else {
      const result = await sendProviderEmail(
        env,
        email,
        branding.business_name.trim(),
        settings.email_reply_to,
        subject,
        text,
        html,
      );
      if (result.skipped) {
        await logNotification(appointmentId, "email", email, TEMPLATE_CONFIRMATION, "skipped", undefined, notConfiguredReason);
      } else if (result.error) {
        await logNotification(appointmentId, "email", email, TEMPLATE_CONFIRMATION, "failed", undefined, result.error);
      } else {
        await logNotification(appointmentId, "email", email, TEMPLATE_CONFIRMATION, "sent", result.providerId);
      }
    }
  }

  if (settings.sms_enabled) {
    const phone = ctx.client_phone.trim();
    if (!phone) {
      await logNotification(appointmentId, "sms", "", TEMPLATE_CONFIRMATION, "skipped", undefined, "No client phone");
    } else {
      console.log(`[notifications] SMS placeholder → ${phone}: ${shortText}`);
      await logNotification(appointmentId, "sms", phone, TEMPLATE_CONFIRMATION, "placeholder", undefined, "Twilio not configured");
    }
  }

  if (settings.whatsapp_enabled) {
    const phone = ctx.client_phone.trim();
    if (!phone) {
      await logNotification(appointmentId, "whatsapp", "", TEMPLATE_CONFIRMATION, "skipped", undefined, "No client phone");
    } else {
      console.log(`[notifications] WhatsApp placeholder → ${phone}: ${shortText}`);
      await logNotification(appointmentId, "whatsapp", phone, TEMPLATE_CONFIRMATION, "placeholder", undefined, "WhatsApp Business API not configured");
    }
  }
}

async function markReminderSent(
  appointmentId: number,
  sentColumn: ReminderWindow["sentColumn"],
): Promise<void> {
  await run(
    `UPDATE appointments SET ${sentColumn} = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
    [appointmentId],
  );
}

async function sendAppointmentReminder(
  env: NotificationEnv,
  appointmentId: number,
  window: ReminderWindow,
): Promise<"sent" | "skipped" | "failed"> {
  if (await alreadySent(appointmentId, window.template)) return "skipped";

  const ctx = await loadAppointmentContext(appointmentId);
  if (!ctx) return "skipped";

  const settings = await getNotificationSettings(env);
  const branding = await getBranding();
  const { subject, text, html } = buildReminderText(ctx, branding, window);
  const shortText = buildShortReminderText(ctx, branding, window);
  const notConfiguredReason = emailNotConfiguredReason(settings.email_provider);

  let delivered = false;
  let hadFailure = false;

  if (settings.email_enabled) {
    const email = ctx.client_email.trim();
    if (!email) {
      await logNotification(appointmentId, "email", "", window.template, "skipped", undefined, "No client email");
    } else {
      const result = await sendProviderEmail(
        env,
        email,
        branding.business_name.trim(),
        settings.email_reply_to,
        subject,
        text,
        html,
      );
      if (result.skipped) {
        await logNotification(appointmentId, "email", email, window.template, "skipped", undefined, notConfiguredReason);
        delivered = true;
      } else if (result.error) {
        await logNotification(appointmentId, "email", email, window.template, "failed", undefined, result.error);
        hadFailure = true;
      } else {
        await logNotification(appointmentId, "email", email, window.template, "sent", result.providerId);
        delivered = true;
      }
    }
  }

  if (settings.sms_enabled) {
    const phone = ctx.client_phone.trim();
    if (!phone) {
      await logNotification(appointmentId, "sms", "", window.template, "skipped", undefined, "No client phone");
    } else {
      console.log(`[notifications] SMS reminder placeholder → ${phone}: ${shortText}`);
      await logNotification(appointmentId, "sms", phone, window.template, "placeholder", undefined, "Twilio not configured");
      delivered = true;
    }
  }

  if (settings.whatsapp_enabled) {
    const phone = ctx.client_phone.trim();
    if (!phone) {
      await logNotification(appointmentId, "whatsapp", "", window.template, "skipped", undefined, "No client phone");
    } else {
      console.log(`[notifications] WhatsApp reminder placeholder → ${phone}: ${shortText}`);
      await logNotification(appointmentId, "whatsapp", phone, window.template, "placeholder", undefined, "WhatsApp Business API not configured");
      delivered = true;
    }
  }

  if (delivered) {
    await markReminderSent(appointmentId, window.sentColumn);
    return "sent";
  }
  return hadFailure ? "failed" : "skipped";
}

export interface ReminderRunResult {
  checked: number;
  sent: number;
  sent_24h: number;
  sent_2h: number;
  skipped: number;
  failed: number;
}

export async function processAppointmentReminders(env: NotificationEnv): Promise<ReminderRunResult> {
  const { processScheduledNotifications } = await import("./notification-rules.js");
  const result = await processScheduledNotifications(env as NotificationEnv & import("./stripe.js").StripeEnv);
  return {
    checked: result.checked,
    sent: result.sent,
    sent_24h: result.sent_24h,
    sent_2h: result.sent_2h,
    skipped: result.skipped,
    failed: result.failed,
  };
}

export function scheduleBookingConfirmation(
  ctx: SchedulableContext,
  appointmentId: number | null | undefined,
  options?: { receipt?: boolean },
): void {
  if (!appointmentId) return;
  const env = runtimeEnv(ctx.env);
  const task = Promise.all([
    sendBookingConfirmation(env, appointmentId, options),
    sendStaffBookingNotification(env, appointmentId),
  ]).then(() => undefined);
  if (ctx.executionCtx) {
    ctx.executionCtx.waitUntil(task);
  } else {
    void task.catch((err) => console.error("[notifications] confirmation failed:", err));
  }

  // Push to Google Calendar when connected (covers all booking create paths).
  void import("./calendar-sync.js").then(({ scheduleGoogleCalendarAppointmentSync }) => {
    scheduleGoogleCalendarAppointmentSync(ctx, appointmentId);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerNotificationRoutes(app: OpenAPIHono<any>) {
  const NotificationSettingsSchema = z.object({
    email_enabled: z.boolean(),
    sms_enabled: z.boolean(),
    whatsapp_enabled: z.boolean(),
    email_reply_to: z.string(),
    email_configured: z.boolean(),
    email_provider: z.enum(["google", "resend", "smtp"]),
    remind_24h_enabled: z.boolean(),
    remind_2h_enabled: z.boolean(),
    staff_booking_email_enabled: z.boolean(),
  });

  const getSettings = createRoute({
    method: "get",
    path: "/api/settings/notifications",
    responses: {
      200: {
        description: "Notification channel settings",
        content: { "application/json": { schema: NotificationSettingsSchema } },
      },
    },
  });

  app.openapi(getSettings, async (c) => {
    return c.json(await getNotificationSettings(runtimeEnv(c.env) as NotificationEnv), 200);
  });

  const updateSettings = createRoute({
    method: "put",
    path: "/api/settings/notifications",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              email_enabled: z.boolean().optional(),
              sms_enabled: z.boolean().optional(),
              whatsapp_enabled: z.boolean().optional(),
              email_reply_to: z.string().optional(),
              remind_24h_enabled: z.boolean().optional(),
              remind_2h_enabled: z.boolean().optional(),
              staff_booking_email_enabled: z.boolean().optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Updated",
        content: { "application/json": { schema: NotificationSettingsSchema } },
      },
    },
  });

  app.openapi(updateSettings, async (c) => {
    const body = c.req.valid("json");
    if (body.email_enabled !== undefined) {
      await setMetaValue("notify_email_enabled", body.email_enabled ? "1" : "0");
    }
    if (body.sms_enabled !== undefined) {
      await setMetaValue("notify_sms_enabled", body.sms_enabled ? "1" : "0");
    }
    if (body.whatsapp_enabled !== undefined) {
      await setMetaValue("notify_whatsapp_enabled", body.whatsapp_enabled ? "1" : "0");
    }
    if (body.email_reply_to !== undefined) {
      await setMetaValue("email_reply_to", body.email_reply_to.trim());
    }
    if (body.remind_24h_enabled !== undefined) {
      await setMetaValue("remind_24h_enabled", body.remind_24h_enabled ? "1" : "0");
    }
    if (body.remind_2h_enabled !== undefined) {
      await setMetaValue("remind_2h_enabled", body.remind_2h_enabled ? "1" : "0");
    }
    if (body.staff_booking_email_enabled !== undefined) {
      await setMetaValue("notify_staff_booking_email_enabled", body.staff_booking_email_enabled ? "1" : "0");
    }
    return c.json(await getNotificationSettings(runtimeEnv(c.env) as NotificationEnv), 200);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runReminders = async (c: any) => {
    const env = runtimeEnv(c.env) as NotificationEnv & StripeEnv & { CRON_SECRET?: string };
    const configuredSecret = env.CRON_SECRET?.trim();
    if (configuredSecret) {
      const auth = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "")
        || c.req.header("X-Cron-Secret")
        || "";
      if (auth !== configuredSecret) {
        return c.json({ error: "Unauthorized" }, 401);
      }
    }

    const result = await processScheduledNotifications(env, c.req.url);
    return c.json(result, 200);
  };

  app.get("/api/cron/reminders", runReminders);
  app.post("/api/cron/reminders", runReminders);
}
