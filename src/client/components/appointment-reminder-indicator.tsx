import { Bell } from "lucide-preact";
import { cn } from "@/lib/utils";
import {
  getReminderTooltip,
  hasAnyReminderSent,
  type AppointmentReminderFields,
} from "../../shared/appointment-reminders";

interface AppointmentReminderIndicatorProps {
  appointment: AppointmentReminderFields;
  className?: string;
}

export function AppointmentReminderIndicator({
  appointment,
  className,
}: AppointmentReminderIndicatorProps) {
  if (!hasAnyReminderSent(appointment)) return null;

  return (
    <span
      className={cn("inline-flex shrink-0 text-muted-foreground/70", className)}
      title={getReminderTooltip(appointment)}
      aria-label={getReminderTooltip(appointment)}
      onClick={(e) => e.stopPropagation()}
    >
      <Bell className="h-3 w-3" strokeWidth={2} />
    </span>
  );
}
