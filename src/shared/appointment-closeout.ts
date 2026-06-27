export const CLOSEOUT_STATUSES = ["booked", "confirmed", "in_progress"] as const;

export type CloseOutStatus = (typeof CLOSEOUT_STATUSES)[number];

export function isCloseOutStatus(status: string): status is CloseOutStatus {
  return (CLOSEOUT_STATUSES as readonly string[]).includes(status);
}

export function parseAppointmentDateTime(date: string, time: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

export function appointmentHasEnded(
  scheduledDate: string,
  endTime: string,
  now: Date = new Date(),
): boolean {
  return now >= parseAppointmentDateTime(scheduledDate, endTime);
}

export function needsCloseOut(
  appointment: { status: string; scheduled_date: string; end_time: string },
  now: Date = new Date(),
): boolean {
  if (!isCloseOutStatus(appointment.status)) return false;
  return appointmentHasEnded(appointment.scheduled_date, appointment.end_time, now);
}
