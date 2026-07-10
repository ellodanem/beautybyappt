export type AppointmentListScope = "upcoming" | "completed";

export const UPCOMING_APPOINTMENT_STATUSES = ["booked", "confirmed", "in_progress"] as const;
export const COMPLETED_APPOINTMENT_STATUSES = ["completed", "cancelled", "no_show"] as const;

export function statusesForScope(scope: AppointmentListScope): readonly string[] {
  return scope === "upcoming"
    ? UPCOMING_APPOINTMENT_STATUSES
    : COMPLETED_APPOINTMENT_STATUSES;
}

export function isValidAppointmentListScope(value: string): value is AppointmentListScope {
  return value === "upcoming" || value === "completed";
}
