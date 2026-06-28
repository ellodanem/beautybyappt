import { useState, useEffect } from "preact/hooks";
import { api } from "./api";
import { BusinessHeader } from "./components/business-header";
import { PublicPageShell } from "./components/public-page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePublicBranding } from "./hooks/use-public-branding";
import { formatMoney } from "../shared/currency";
import { formatDateLong, formatTimeRange } from "@/lib/public-booking-utils";

export function PublicAnytimeSuccessPage({ serviceSlug }: { serviceSlug?: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const publicPage = usePublicBranding();
  const publicBranding = publicPage?.branding ?? null;
  const platform = publicPage?.platform ?? null;
  const [appointment, setAppointment] = useState<{
    identifier: string;
    scheduled_date: string;
    start_time: string;
    end_time: string;
    total_price: number;
    deposit_amount: number;
    amount_paid: number;
    payment_status: string;
    currency: string;
    service_name: string;
  } | null>(null);

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
      amount_paid: number;
      payment_status: string;
      currency: string;
      service_name: string;
    } }>(
      "GET",
      `/api/anytime/public/complete?session_id=${encodeURIComponent(sessionId)}`,
    )
      .then((data) => setAppointment(data.appointment))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const backHref = serviceSlug
    ? `/anytime/${encodeURIComponent(serviceSlug)}`
    : "/anytime";

  if (loading) {
    return (
      <PublicPageShell platform={platform} contentClassName="flex flex-1 items-center justify-center p-4">
        <p className="text-muted-foreground">Confirming your payment…</p>
      </PublicPageShell>
    );
  }

  if (error || !appointment) {
    return (
      <PublicPageShell platform={platform} contentClassName="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="space-y-2 pt-6 text-center">
            <p className="text-destructive">{error || "Could not confirm booking"}</p>
            <a href={backHref} className="text-sm text-primary underline">Back to booking</a>
          </CardContent>
        </Card>
      </PublicPageShell>
    );
  }

  const currency = appointment.currency || "USD";
  const amountPaid = appointment.amount_paid ?? 0;
  const showPaid = amountPaid > 0;
  const isPaidInFull = appointment.payment_status === "paid"
    || (amountPaid >= appointment.total_price && appointment.total_price > 0);
  const balanceDue = Math.max(0, appointment.total_price - amountPaid);

  return (
    <PublicPageShell platform={platform}>
      <div className="mx-auto max-w-md space-y-4 pt-8">
        {publicBranding && <BusinessHeader branding={publicBranding} />}
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl text-emerald-600">You&apos;re booked!</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-center text-sm">
            <p className="font-medium">Reference: {appointment.identifier}</p>
            <p className="font-semibold">{appointment.service_name}</p>
            <p>{formatDateLong(appointment.scheduled_date)}</p>
            <p>{formatTimeRange(appointment.start_time, appointment.end_time)}</p>
            {showPaid && (
              <p className="font-semibold text-emerald-700">
                Paid: {formatMoney(amountPaid, currency)}
                {isPaidInFull ? (
                  <span className="block text-xs font-normal text-muted-foreground">Paid in full</span>
                ) : (
                  <span className="block text-xs font-normal text-muted-foreground">
                    Deposit
                    {balanceDue > 0 && <> · {formatMoney(balanceDue, currency)} due at appointment</>}
                  </span>
                )}
              </p>
            )}
            <p className="text-muted-foreground">
              Total appointment: {formatMoney(appointment.total_price, currency)}
            </p>
            <p className="pt-2 text-muted-foreground">We&apos;ll see you then!</p>
          </CardContent>
        </Card>
      </div>
    </PublicPageShell>
  );
}
