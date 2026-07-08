import { Mail } from "lucide-preact";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTimeShort } from "@/lib/utils";
import {
  getReminderDetailRows,
  shouldShowReminderDetail,
  type AppointmentReminderFields,
  type ReminderSettings,
} from "../../shared/appointment-reminders";

interface AppointmentRemindersCardProps {
  appointment: AppointmentReminderFields & { status: string };
  settings: ReminderSettings;
}

export function AppointmentRemindersCard({
  appointment,
  settings,
}: AppointmentRemindersCardProps) {
  if (!shouldShowReminderDetail(appointment, settings, appointment.status)) {
    return null;
  }

  const rows = getReminderDetailRows(appointment, settings);

  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Notifications</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {rows.map((row) => (
          <div key={row.key} className="flex items-start gap-2 text-sm">
            <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <span className="text-muted-foreground">{row.label}</span>
              {row.sentAt ? (
                <span className="text-emerald-700 dark:text-emerald-400">
                  {" — sent "}
                  {formatDateTimeShort(row.sentAt)}
                </span>
              ) : (
                <span className="text-muted-foreground/70"> — not yet</span>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
