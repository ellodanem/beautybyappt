import { useState, useEffect } from "preact/hooks";
import { api } from "./api";
import { BusinessHeader } from "./components/business-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Branding } from "../shared/branding";
import { formatMoney } from "../shared/currency";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function formatTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

export function PublicBookSuccessPage({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [publicBranding, setPublicBranding] = useState<Branding | null>(null);
  const [appointment, setAppointment] = useState<{
    identifier: string;
    scheduled_date: string;
    start_time: string;
    end_time: string;
    total_price: number;
    deposit_amount: number;
    travel_fee: number;
    amount_paid: number;
    payment_status: string;
    currency?: string;
  } | null>(null);

  useEffect(() => {
    api<Branding>("GET", "/api/public/branding")
      .then(setPublicBranding)
      .catch(() => setPublicBranding({ business_name: "", business_tagline: "", logo_url: "" }));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (!sessionId) {
      setError("Missing payment session");
      setLoading(false);
      return;
    }

    api<{ appointment: {
      identifier: string;
      scheduled_date: string;
      start_time: string;
      end_time: string;
      total_price: number;
      deposit_amount: number;
      travel_fee: number;
      amount_paid: number;
      payment_status: string;
      currency?: string;
    } }>("GET", `/api/book/public/${token}/complete?session_id=${encodeURIComponent(sessionId)}`)
      .then((data) => setAppointment(data.appointment))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <p className="text-muted-foreground">Confirming your payment…</p>
      </div>
    );
  }

  if (error || !appointment) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="space-y-2 pt-6 text-center">
            <p className="text-destructive">{error || "Could not confirm booking"}</p>
            <a href={`/book/${token}`} className="text-sm text-primary underline">Back to booking</a>
          </CardContent>
        </Card>
      </div>
    );
  }

  const currency = appointment.currency || "USD";
  const travelFee = appointment.travel_fee ?? 0;
  const amountPaid = appointment.amount_paid ?? appointment.deposit_amount + travelFee;
  const showPaid = amountPaid > 0;
  const isPaidInFull = appointment.payment_status === "paid"
    || (amountPaid >= appointment.total_price && appointment.total_price > 0);
  const balanceDue = Math.max(0, appointment.total_price - amountPaid);

  return (
    <div className="min-h-screen bg-background p-4 pb-8">
      <div className="mx-auto max-w-md space-y-4 pt-8">
        {publicBranding && <BusinessHeader branding={publicBranding} />}
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl text-emerald-600">You&apos;re booked!</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-center text-sm">
            <p className="font-medium">Reference: {appointment.identifier}</p>
            <p>{formatDate(appointment.scheduled_date)}</p>
            <p>{formatTime(appointment.start_time)} – {formatTime(appointment.end_time)}</p>
            {showPaid && (
              <p className="font-semibold text-emerald-700">
                Paid: {formatMoney(amountPaid, currency)}
                {isPaidInFull ? (
                  <span className="block text-xs font-normal text-muted-foreground">
                    Paid in full
                  </span>
                ) : (
                  <span className="block text-xs font-normal text-muted-foreground">
                    Deposit{travelFee > 0 ? " + travel" : ""}
                    {balanceDue > 0 && <> · {formatMoney(balanceDue, currency)} due at appointment</>}
                  </span>
                )}
              </p>
            )}
            <p className="text-muted-foreground">Total appointment: {formatMoney(appointment.total_price, currency)}</p>
            <p className="pt-2 text-muted-foreground">We&apos;ll see you then!</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
