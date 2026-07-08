import { get, query, run } from "./db.js";
import { getBranding } from "./branding.js";
import { getBusinessUtcOffsetHours } from "./business-locale.js";
import {
  emailNotConfiguredReason,
  getEmailProvider,
  sendProviderEmail,
  type EmailEnv,
} from "./email-providers.js";
import { getNotificationSettings } from "./notifications.js";
import { resolvePaymentLinkUrl, templateReferencesPaymentLink } from "./appointment-payments.js";
import {
  ensureBuiltinEmailTemplates,
  getEmailTemplateById,
  renderEmailTemplate,
} from "./email-templates.js";
import type { StripeEnv } from "./stripe.js";

export interface NotificationRule {
  id: number;
  offering_id: number | null;
  email_template_id: number;
  email_template_name: string;
  hours_before: number;
  channel: string;
  active: boolean;
  sort_order: number;
}

export interface NotificationRuleInput {
  id?: number;
  email_template_id: number;
  hours_before: number;
  channel?: string;
  active?: boolean;
  sort_order?: number;
}

const ACTIVE_APPOINTMENT_STATUSES = ["booked", "confirmed", "in_progress"];

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

const GLOBAL_DEFAULT_RULES = [
  { hours_before: 24, sort_order: 0 },
  { hours_before: 2, sort_order: 1 },
] as const;

function rowToRule(row: {
  id: number;
  offering_id: number | null;
  email_template_id: number;
  email_template_name: string;
  hours_before: number;
  channel: string;
  active: number;
  sort_order: number;
}): NotificationRule {
  return {
    id: row.id,
    offering_id: row.offering_id,
    email_template_id: row.email_template_id,
    email_template_name: row.email_template_name,
    hours_before: row.hours_before,
    channel: row.channel,
    active: row.active === 1,
    sort_order: row.sort_order,
  };
}

async function getBuiltinTemplateId(slug: string): Promise<number | null> {
  const row = await get<{ id: number }>("SELECT id FROM email_templates WHERE slug = ?", [slug]);
  return row?.id ?? null;
}

export async function ensureAppointmentReminderTemplate(): Promise<number | null> {
  await ensureBuiltinEmailTemplates();
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
  return getBuiltinTemplateId(BUILTIN_APPOINTMENT_REMINDER.slug);
}

export async function ensureDefaultGlobalNotificationRules(): Promise<void> {
  const templateId = await ensureAppointmentReminderTemplate();
  if (!templateId) return;

  for (const rule of GLOBAL_DEFAULT_RULES) {
    const existing = await get<{ id: number }>(
      `SELECT id FROM notification_rules
       WHERE offering_id IS NULL AND hours_before = ? AND channel = 'email'`,
      [rule.hours_before],
    );
    if (!existing) {
      await run(
        `INSERT INTO notification_rules (offering_id, email_template_id, hours_before, channel, active, sort_order)
         VALUES (NULL, ?, ?, 'email', 1, ?)`,
        [templateId, rule.hours_before, rule.sort_order],
      );
    }
  }
}

export async function loadOfferingNotificationRules(offeringId: number): Promise<NotificationRule[]> {
  const rows = await query<{
    id: number;
    offering_id: number | null;
    email_template_id: number;
    email_template_name: string;
    hours_before: number;
    channel: string;
    active: number;
    sort_order: number;
  }>(
    `SELECT nr.id, nr.offering_id, nr.email_template_id, et.name as email_template_name,
            nr.hours_before, nr.channel, nr.active, nr.sort_order
     FROM notification_rules nr
     JOIN email_templates et ON et.id = nr.email_template_id
     WHERE nr.offering_id = ?
     ORDER BY nr.sort_order ASC, nr.hours_before DESC, nr.id ASC`,
    [offeringId],
  );
  return rows.map(rowToRule);
}

export async function syncOfferingNotificationRules(
  offeringId: number,
  rules: NotificationRuleInput[],
): Promise<void> {
  await run("DELETE FROM notification_rules WHERE offering_id = ?", [offeringId]);

  const kept = rules.filter((rule) => rule.email_template_id > 0 && rule.hours_before > 0);
  for (let i = 0; i < kept.length; i++) {
    const rule = kept[i];
    await run(
      `INSERT INTO notification_rules (offering_id, email_template_id, hours_before, channel, active, sort_order, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        offeringId,
        rule.email_template_id,
        Math.round(rule.hours_before),
        rule.channel?.trim() || "email",
        rule.active === false ? 0 : 1,
        rule.sort_order ?? i,
      ],
    );
  }
}

export async function copyOfferingNotificationRules(sourceId: number, targetId: number): Promise<void> {
  const sourceRules = await query<{
    email_template_id: number;
    hours_before: number;
    channel: string;
    active: number;
    sort_order: number;
  }>(
    `SELECT email_template_id, hours_before, channel, active, sort_order
     FROM notification_rules WHERE offering_id = ? ORDER BY sort_order ASC, hours_before DESC`,
    [sourceId],
  );

  await syncOfferingNotificationRules(
    targetId,
    sourceRules.map((rule) => ({
      email_template_id: rule.email_template_id,
      hours_before: rule.hours_before,
      channel: rule.channel,
      active: rule.active === 1,
      sort_order: rule.sort_order,
    })),
  );
}

async function offeringHasCustomRules(offeringId: number): Promise<boolean> {
  const row = await get<{ count: number }>(
    "SELECT COUNT(*) as count FROM notification_rules WHERE offering_id = ? AND active = 1",
    [offeringId],
  );
  return (row?.count ?? 0) > 0;
}

async function loadActiveRulesForAppointment(offeringId: number | null): Promise<NotificationRule[]> {
  await ensureDefaultGlobalNotificationRules();

  if (offeringId && await offeringHasCustomRules(offeringId)) {
    const rules = await loadOfferingNotificationRules(offeringId);
    return rules.filter((rule) => rule.active);
  }

  const rows = await query<{
    id: number;
    offering_id: number | null;
    email_template_id: number;
    email_template_name: string;
    hours_before: number;
    channel: string;
    active: number;
    sort_order: number;
  }>(
    `SELECT nr.id, nr.offering_id, nr.email_template_id, et.name as email_template_name,
            nr.hours_before, nr.channel, nr.active, nr.sort_order
     FROM notification_rules nr
     JOIN email_templates et ON et.id = nr.email_template_id
     WHERE nr.offering_id IS NULL AND nr.active = 1
     ORDER BY nr.sort_order ASC, nr.hours_before DESC, nr.id ASC`,
  );
  return rows.map(rowToRule);
}

function appointmentUtcMs(scheduledDate: string, startTime: string, utcOffsetHours: number): number {
  const [y, mo, d] = scheduledDate.split("-").map(Number);
  const [h, mi] = startTime.split(":").map(Number);
  return Date.UTC(y, mo - 1, d, h - utcOffsetHours, mi);
}

function windowHalfHours(hoursBefore: number): number {
  if (hoursBefore >= 24) return 12;
  if (hoursBefore >= 12) return 1;
  if (hoursBefore >= 2) return 0.5;
  return 0.25;
}

function globalRuleEnabled(
  hoursBefore: number,
  settings: { remind_24h_enabled: boolean; remind_2h_enabled: boolean },
): boolean {
  if (hoursBefore === 24) return settings.remind_24h_enabled;
  if (hoursBefore === 2) return settings.remind_2h_enabled;
  return true;
}

async function alreadySentForRule(appointmentId: number, ruleId: number): Promise<boolean> {
  const row = await get<{ appointment_id: number }>(
    `SELECT appointment_id FROM appointment_notification_sent
     WHERE appointment_id = ? AND rule_id = ?`,
    [appointmentId, ruleId],
  );
  return Boolean(row);
}

export interface AppointmentReminderStatusItem {
  rule_id: number;
  template_name: string;
  hours_before: number;
  sent_at: string | null;
}

function reminderItemsForRules(
  rules: NotificationRule[],
  sentByRule: Map<number, string>,
  settings: { remind_24h_enabled: boolean; remind_2h_enabled: boolean },
): AppointmentReminderStatusItem[] {
  return rules
    .map((rule) => ({
      rule_id: rule.id,
      template_name: rule.email_template_name,
      hours_before: rule.hours_before,
      sent_at: sentByRule.get(rule.id) ?? null,
    }))
    .filter((item, index) => {
      const rule = rules[index];
      const enabled = rule.offering_id != null
        ? rule.active
        : globalRuleEnabled(rule.hours_before, settings);
      return enabled || item.sent_at != null;
    });
}

export async function buildAppointmentReminderStatus(
  appointmentId: number,
  offeringId: number | null,
  settings: { remind_24h_enabled: boolean; remind_2h_enabled: boolean },
): Promise<{ uses_custom_reminders: boolean; appointment_reminders: AppointmentReminderStatusItem[] }> {
  const uses_custom_reminders = offeringId != null && await offeringHasCustomRules(offeringId);
  const rules = await loadActiveRulesForAppointment(offeringId);
  const sentRows = await query<{ rule_id: number; sent_at: string }>(
    `SELECT rule_id, sent_at FROM appointment_notification_sent WHERE appointment_id = ?`,
    [appointmentId],
  );
  const sentByRule = new Map(sentRows.map((row) => [row.rule_id, row.sent_at]));
  return {
    uses_custom_reminders,
    appointment_reminders: reminderItemsForRules(rules, sentByRule, settings),
  };
}

export async function attachReminderStatusToAppointments(
  appointments: Record<string, unknown>[],
  settings: { remind_24h_enabled: boolean; remind_2h_enabled: boolean },
): Promise<void> {
  if (appointments.length === 0) return;

  const aptIds = appointments.map((apt) => apt.id as number);
  const placeholders = aptIds.map(() => "?").join(",");
  const sentRows = await query<{ appointment_id: number; rule_id: number; sent_at: string }>(
    `SELECT appointment_id, rule_id, sent_at
     FROM appointment_notification_sent
     WHERE appointment_id IN (${placeholders})`,
    aptIds,
  );
  const sentByApt = new Map<number, Map<number, string>>();
  for (const row of sentRows) {
    let ruleMap = sentByApt.get(row.appointment_id);
    if (!ruleMap) {
      ruleMap = new Map();
      sentByApt.set(row.appointment_id, ruleMap);
    }
    ruleMap.set(row.rule_id, row.sent_at);
  }

  const offeringIds = [
    ...new Set(
      appointments
        .map((apt) => apt.offering_id as number | null | undefined)
        .filter((id): id is number => typeof id === "number" && id > 0),
    ),
  ];

  const customOfferingIds = new Set<number>();
  if (offeringIds.length > 0) {
    const offeringPlaceholders = offeringIds.map(() => "?").join(",");
    const customRows = await query<{ offering_id: number }>(
      `SELECT DISTINCT offering_id
       FROM notification_rules
       WHERE offering_id IN (${offeringPlaceholders}) AND active = 1`,
      offeringIds,
    );
    for (const row of customRows) customOfferingIds.add(row.offering_id);
  }

  const globalRules = await loadActiveRulesForAppointment(null);
  const rulesByOffering = new Map<number, NotificationRule[]>();
  for (const offeringId of customOfferingIds) {
    const rules = await loadOfferingNotificationRules(offeringId);
    rulesByOffering.set(offeringId, rules.filter((rule) => rule.active));
  }

  for (const apt of appointments) {
    const appointmentId = apt.id as number;
    const offeringId = apt.offering_id as number | null | undefined;
    const uses_custom_reminders = typeof offeringId === "number" && customOfferingIds.has(offeringId);
    const rules = uses_custom_reminders && offeringId
      ? (rulesByOffering.get(offeringId) ?? [])
      : globalRules;
    const sentByRule = sentByApt.get(appointmentId) ?? new Map<number, string>();

    apt.uses_custom_reminders = uses_custom_reminders;
    apt.appointment_reminders = reminderItemsForRules(rules, sentByRule, settings);
  }
}

async function markRuleSent(appointmentId: number, ruleId: number): Promise<void> {
  await run(
    `INSERT OR IGNORE INTO appointment_notification_sent (appointment_id, rule_id, sent_at)
     VALUES (?, ?, datetime('now'))`,
    [appointmentId, ruleId],
  );

  const rule = await get<{ hours_before: number }>("SELECT hours_before FROM notification_rules WHERE id = ?", [ruleId]);
  if (!rule) return;
  if (rule.hours_before === 24) {
    await run(
      `UPDATE appointments SET reminder_24h_sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      [appointmentId],
    );
  } else if (rule.hours_before === 2) {
    await run(
      `UPDATE appointments SET reminder_2h_sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
      [appointmentId],
    );
  }
}

async function logRuleNotification(
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

async function loadAppointmentTemplateContext(appointmentId: number) {
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
    `SELECT s.name FROM appointment_services aps
     JOIN services s ON s.id = aps.service_id
     WHERE aps.appointment_id = ?`,
    [appointmentId],
  );

  return {
    ...apt,
    travel_fee: apt.travel_fee ?? 0,
    service_names: services.map((s) => s.name),
  };
}

async function sendRuleEmail(
  env: EmailEnv & StripeEnv,
  appointmentId: number,
  rule: NotificationRule,
  requestUrl?: string,
): Promise<"sent" | "skipped" | "failed"> {
  if (await alreadySentForRule(appointmentId, rule.id)) return "skipped";

  const template = await getEmailTemplateById(rule.email_template_id);
  if (!template) return "skipped";

  const ctx = await loadAppointmentTemplateContext(appointmentId);
  if (!ctx) return "skipped";

  const email = ctx.client_email.trim();
  if (!email) {
    await logRuleNotification(appointmentId, "", template.slug, "skipped", undefined, "No client email");
    return "skipped";
  }

  const settings = await getNotificationSettings(env);
  if (!settings.email_enabled) {
    await logRuleNotification(appointmentId, email, template.slug, "skipped", undefined, "Email notifications disabled");
    return "skipped";
  }

  const branding = await getBranding();
  const paymentLinkUrl = await resolvePaymentLinkUrl(env, appointmentId, requestUrl, {
    autoCreate: templateReferencesPaymentLink(template),
    addNote: false,
  });
  const { subject, text, html } = renderEmailTemplate(template, ctx, branding, paymentLinkUrl);
  const notConfiguredReason = emailNotConfiguredReason(await getEmailProvider());

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
    await logRuleNotification(appointmentId, email, template.slug, "skipped", undefined, notConfiguredReason);
    return "skipped";
  }
  if (result.error) {
    await logRuleNotification(appointmentId, email, template.slug, "failed", undefined, result.error);
    return "failed";
  }

  await logRuleNotification(appointmentId, email, template.slug, "sent", result.providerId);
  await markRuleSent(appointmentId, rule.id);
  return "sent";
}

export interface ScheduledNotificationResult {
  checked: number;
  sent: number;
  sent_24h: number;
  sent_2h: number;
  skipped: number;
  failed: number;
}

export async function processScheduledNotifications(
  env: EmailEnv & StripeEnv,
  requestUrl?: string,
): Promise<ScheduledNotificationResult> {
  const settings = await getNotificationSettings(env);
  const utcOffset = await getBusinessUtcOffsetHours();
  const now = Date.now();

  const allRuleHours = await query<{ hours_before: number }>(
    "SELECT hours_before FROM notification_rules WHERE active = 1",
  );
  const maxHoursBefore = Math.max(48, ...allRuleHours.map((row) => row.hours_before));
  const lookAheadDays = Math.ceil(maxHoursBefore / 24) + 2;
  const endDate = new Date();
  endDate.setUTCDate(endDate.getUTCDate() + lookAheadDays);
  const endDateIso = endDate.toISOString().slice(0, 10);

  const appointments = await query<{
    id: number;
    scheduled_date: string;
    start_time: string;
    status: string;
    offering_id: number | null;
  }>(
    `SELECT a.id, a.scheduled_date, a.start_time, a.status, si.offering_id
     FROM appointments a
     LEFT JOIN offering_slot_instances si ON si.id = a.offering_slot_instance_id
     WHERE a.status IN ('booked', 'confirmed', 'in_progress')
       AND a.scheduled_date >= date('now')
       AND a.scheduled_date <= ?`,
    [endDateIso],
  );

  const result: ScheduledNotificationResult = {
    checked: appointments.length,
    sent: 0,
    sent_24h: 0,
    sent_2h: 0,
    skipped: 0,
    failed: 0,
  };

  const rulesCache = new Map<string, NotificationRule[]>();

  for (const apt of appointments) {
    if (!ACTIVE_APPOINTMENT_STATUSES.includes(apt.status)) continue;

    const aptMs = appointmentUtcMs(apt.scheduled_date, apt.start_time, utcOffset);
    const hoursUntil = (aptMs - now) / 3_600_000;
    if (hoursUntil < 0) continue;

    const cacheKey = apt.offering_id ? `offering:${apt.offering_id}` : "global";
    let rules = rulesCache.get(cacheKey);
    if (!rules) {
      rules = await loadActiveRulesForAppointment(apt.offering_id);
      rulesCache.set(cacheKey, rules);
    }

    for (const rule of rules) {
      if (rule.offering_id == null && !globalRuleEnabled(rule.hours_before, settings)) continue;
      if (rule.channel !== "email") continue;

      const halfWindow = windowHalfHours(rule.hours_before);
      const inWindow = hoursUntil <= rule.hours_before + halfWindow
        && hoursUntil > rule.hours_before - halfWindow;
      if (!inWindow) continue;

      const outcome = await sendRuleEmail(env, apt.id, rule, requestUrl);
      if (outcome === "sent") {
        result.sent += 1;
        if (rule.hours_before === 24) result.sent_24h += 1;
        if (rule.hours_before === 2) result.sent_2h += 1;
      } else if (outcome === "failed") {
        result.failed += 1;
      } else {
        result.skipped += 1;
      }
    }
  }

  if (result.sent > 0) {
    console.log(`[reminders] sent=${result.sent} (24h=${result.sent_24h}, 2h=${result.sent_2h})`);
  }

  return result;
}
