import { useEffect, useState } from "preact/hooks";
import { useApp } from "../context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateShort, formatTimeShort } from "@/lib/utils";
import { Send } from "lucide-preact";

type TestAppointment = {
  id: number;
  identifier: string;
  client_name: string;
  scheduled_date: string;
  start_time: string;
  status: string;
  offering_name: string | null;
};

function appointmentLabel(apt: TestAppointment): string {
  const event = apt.offering_name ? ` · ${apt.offering_name}` : "";
  return `${apt.identifier} · ${apt.client_name} · ${formatDateShort(apt.scheduled_date)} ${formatTimeShort(apt.start_time)} (${apt.status})${event}`;
}

export function TemplateTestSend({
  templateId,
  subject,
  body,
}: {
  templateId: number;
  subject: string;
  body: string;
}) {
  const { fetchEmailTestAppointments, sendTestEmailTemplate, setError } = useApp();
  const [open, setOpen] = useState(false);
  const [loadingAppointments, setLoadingAppointments] = useState(false);
  const [appointments, setAppointments] = useState<TestAppointment[]>([]);
  const [appointmentId, setAppointmentId] = useState("");
  const [toEmail, setToEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!open || appointments.length > 0) return;
    setLoadingAppointments(true);
    fetchEmailTestAppointments()
      .then((rows) => {
        setAppointments(rows);
        if (rows[0]) setAppointmentId(String(rows[0].id));
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoadingAppointments(false));
  }, [open, appointments.length, fetchEmailTestAppointments, setError]);

  const handleSend = async () => {
    const aptId = parseInt(appointmentId, 10);
    if (!aptId || !toEmail.trim()) return;
    setSending(true);
    setSent(false);
    setError(null);
    try {
      await sendTestEmailTemplate(templateId, {
        appointment_id: aptId,
        to: toEmail.trim(),
        subject,
        body,
      });
      setSent(true);
      window.setTimeout(() => setSent(false), 3000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Send className="mr-1 h-3.5 w-3.5" />
        Test send
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-dashed bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Test send</p>
        <Button type="button" size="sm" variant="ghost" className="h-8 px-2" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Preview this template with real booking data. Sends to your email with a [TEST] subject prefix — the client is not notified.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor={`test-apt-${templateId}`}>Sample booking</Label>
        {loadingAppointments ? (
          <p className="text-sm text-muted-foreground">Loading bookings…</p>
        ) : appointments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No bookings yet — create one first to preview templates.</p>
        ) : (
          <select
            id={`test-apt-${templateId}`}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={appointmentId}
            onChange={(e) => setAppointmentId((e.target as HTMLSelectElement).value)}
          >
            {appointments.map((apt) => (
              <option key={apt.id} value={apt.id}>{appointmentLabel(apt)}</option>
            ))}
          </select>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`test-to-${templateId}`}>Send to</Label>
        <Input
          id={`test-to-${templateId}`}
          type="email"
          placeholder="you@example.com"
          value={toEmail}
          onInput={(e) => setToEmail((e.target as HTMLInputElement).value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={sending || !appointmentId || !toEmail.trim() || appointments.length === 0}
          onClick={handleSend}
        >
          {sending ? "Sending…" : "Send test email"}
        </Button>
        {sent && <span className="text-sm text-emerald-600">Test sent</span>}
      </div>
    </div>
  );
}
