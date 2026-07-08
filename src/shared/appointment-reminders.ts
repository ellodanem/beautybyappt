export type ReminderWindow = "24h" | "2h";

export interface AppointmentReminderStatusItem {
  rule_id: number;
  template_name: string;
  hours_before: number;
  sent_at: string | null;
}

export interface AppointmentReminderFields {
  reminder_24h_sent_at?: string | null;
  reminder_2h_sent_at?: string | null;
  uses_custom_reminders?: boolean;
  appointment_reminders?: AppointmentReminderStatusItem[];
}

export interface ReminderSettings {
  remind_24h_enabled: boolean;
  remind_2h_enabled: boolean;
}

export interface ReminderDetailRow {
  key: string;
  label: string;
  sentAt: string | null;
}

const REMINDER_LABELS: Record<ReminderWindow, string> = {
  "24h": "24h reminder",
  "2h": "2h reminder",
};

export function formatReminderTiming(hoursBefore: number): string {
  if (hoursBefore >= 24 && hoursBefore % 24 === 0) {
    const days = hoursBefore / 24;
    return `${days} day${days === 1 ? "" : "s"} before`;
  }
  return `${hoursBefore} hour${hoursBefore === 1 ? "" : "s"} before`;
}

export function getReminderSentAt(
  apt: AppointmentReminderFields,
  window: ReminderWindow,
): string | null {
  const value = window === "24h" ? apt.reminder_24h_sent_at : apt.reminder_2h_sent_at;
  return value?.trim() ? value : null;
}

function getLegacyReminderDetailRows(
  apt: AppointmentReminderFields,
  settings: ReminderSettings,
): ReminderDetailRow[] {
  const windows: ReminderWindow[] = ["24h", "2h"];
  return windows.map((window) => ({
    key: window,
    label: REMINDER_LABELS[window],
    sentAt: getReminderSentAt(apt, window),
  })).filter((row) => {
    const enabled = row.key === "24h" ? settings.remind_24h_enabled : settings.remind_2h_enabled;
    return enabled || row.sentAt != null;
  });
}

export function getReminderDetailRows(
  apt: AppointmentReminderFields,
  settings: ReminderSettings,
): ReminderDetailRow[] {
  if (apt.appointment_reminders?.length) {
    return apt.appointment_reminders.map((item) => ({
      key: String(item.rule_id),
      label: apt.uses_custom_reminders
        ? item.template_name
        : item.hours_before === 24
          ? "24h reminder"
          : item.hours_before === 2
            ? "2h reminder"
            : item.template_name,
      sentAt: item.sent_at,
    }));
  }

  return getLegacyReminderDetailRows(apt, settings);
}

function itemSentAt(item: AppointmentReminderStatusItem): string | null {
  return item.sent_at?.trim() ? item.sent_at : null;
}

export function hasAnyReminderSent(apt: AppointmentReminderFields): boolean {
  if (apt.appointment_reminders?.some((item) => itemSentAt(item))) return true;
  return Boolean(getReminderSentAt(apt, "24h") || getReminderSentAt(apt, "2h"));
}

export function getReminderTooltip(apt: AppointmentReminderFields): string {
  if (apt.appointment_reminders?.length) {
    const sent = apt.appointment_reminders.filter((item) => itemSentAt(item));
    if (sent.length > 0) {
      return sent.map((item) => (
        apt.uses_custom_reminders
          ? item.template_name
          : (item.hours_before === 24 ? "24h reminder" : item.hours_before === 2 ? "2h reminder" : item.template_name)
      )).join(" · ");
    }
  }

  const parts: ReminderWindow[] = [];
  if (getReminderSentAt(apt, "24h")) parts.push("24h");
  if (getReminderSentAt(apt, "2h")) parts.push("2h");
  return parts.map((window) => `${window} reminder`).join(" · ");
}

export function shouldShowReminderDetail(
  apt: AppointmentReminderFields,
  settings: ReminderSettings,
  status: string,
): boolean {
  if (hasAnyReminderSent(apt)) return true;
  if (apt.appointment_reminders && apt.appointment_reminders.length > 0) {
    return ["booked", "confirmed", "in_progress"].includes(status);
  }
  if (!settings.remind_24h_enabled && !settings.remind_2h_enabled) return false;
  return ["booked", "confirmed", "in_progress"].includes(status);
}
