export type ReminderWindow = "24h" | "2h";

export interface AppointmentReminderFields {
  reminder_24h_sent_at?: string | null;
  reminder_2h_sent_at?: string | null;
}

export interface ReminderSettings {
  remind_24h_enabled: boolean;
  remind_2h_enabled: boolean;
}

export interface ReminderDetailRow {
  window: ReminderWindow;
  label: string;
  enabled: boolean;
  sentAt: string | null;
}

const REMINDER_LABELS: Record<ReminderWindow, string> = {
  "24h": "24h reminder",
  "2h": "2h reminder",
};

export function getReminderSentAt(
  apt: AppointmentReminderFields,
  window: ReminderWindow,
): string | null {
  const value = window === "24h" ? apt.reminder_24h_sent_at : apt.reminder_2h_sent_at;
  return value?.trim() ? value : null;
}

export function hasAnyReminderSent(apt: AppointmentReminderFields): boolean {
  return Boolean(getReminderSentAt(apt, "24h") || getReminderSentAt(apt, "2h"));
}

export function getReminderTooltip(apt: AppointmentReminderFields): string {
  const parts: ReminderWindow[] = [];
  if (getReminderSentAt(apt, "24h")) parts.push("24h");
  if (getReminderSentAt(apt, "2h")) parts.push("2h");
  return parts.map((window) => `${window} reminder`).join(" · ");
}

export function getReminderDetailRows(
  apt: AppointmentReminderFields,
  settings: ReminderSettings,
): ReminderDetailRow[] {
  const windows: ReminderWindow[] = ["24h", "2h"];
  return windows.map((window) => ({
    window,
    label: REMINDER_LABELS[window],
    enabled: window === "24h" ? settings.remind_24h_enabled : settings.remind_2h_enabled,
    sentAt: getReminderSentAt(apt, window),
  }));
}

export function shouldShowReminderDetail(
  apt: AppointmentReminderFields,
  settings: ReminderSettings,
  status: string,
): boolean {
  if (hasAnyReminderSent(apt)) return true;
  if (!settings.remind_24h_enabled && !settings.remind_2h_enabled) return false;
  return ["booked", "confirmed", "in_progress"].includes(status);
}
