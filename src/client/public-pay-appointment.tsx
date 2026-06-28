import { useState, useEffect } from "preact/hooks";
import { api } from "./api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "../shared/currency";
import { appointmentBalance, type PaymentChoice } from "../shared/payment";
import { BusinessHeader } from "./components/business-header";
import { PublicPageShell } from "./components/public-page-shell";
import { usePublicBranding } from "./hooks/use-public-branding";

interface PublicPayData {
  appointment: {
    identifier: string;
    scheduled_date: string;
    start_time: string;
    end_time: string;
    total_price: number;
    deposit_amount: number;
    amount_paid: number;
    currency: string;
    client_name: string | null;
    staff_name: string | null;
    offering_name: string | null;
    service_name: string | null;
  };
  payment_choice_available: boolean;
  deposit_amount: number;
  full_amount: number;
  balance_due: number;
  continue_checkout_url: string | null;
  status: string;
}

function formatDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function formatTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

export function PublicPayAppointmentPage({ token }: { token: string }) {
  const [data, setData] = useState<PublicPayData | null>(null);
  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice>("full");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const publicPage = usePublicBranding();
  const publicBranding = publicPage?.branding ?? null;
  const platform = publicPage?.platform ?? null;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("cancelled") === "1") {
      setError("Payment was cancelled. You can try again when ready.");
    }
  }, []);

  useEffect(() => {
    api<PublicPayData>("GET", `/api/pay/public/${token}`)
      .then(setData)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [token]);

  const handleBook = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<{ checkout_url: string }>("POST", `/api/pay/public/${token}/checkout`, {
        payment_choice: paymentChoice,
      });
      window.location.href = res.checkout_url;
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <PublicPageShell platform={platform} contentClassName="flex flex-1 items-center justify-center p-4">
        <p className="text-muted-foreground">Loading…</p>
      </PublicPageShell>
    );
  }

  if (error && !data) {
    return (
      <PublicPageShell platform={platform} contentClassName="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center text-destructive">{error}</CardContent>
        </Card>
      </PublicPageShell>
    );
  }

  if (!data) return null;

  const apt = data.appointment;
  const currency = apt.currency || "USD";
  const serviceLabel = apt.offering_name || apt.service_name || "Appointment";
  const checkoutAmount = paymentChoice === "deposit" ? data.deposit_amount : data.full_amount;
  const balanceAfter = paymentChoice === "deposit"
    ? appointmentBalance(apt.total_price, checkoutAmount)
    : 0;

  return (
    <PublicPageShell platform={platform} contentClassName="flex-1 p-4 pb-8">
      <div className="mx-auto max-w-md space-y-4 pt-4">
        {publicBranding ? (
          <BusinessHeader branding={publicBranding} subtitle="Complete your booking" />
        ) : (
          <div className="text-center">
            <h1 className="text-xl font-bold tracking-tight">Complete your booking</h1>
            <p className="mt-1 text-sm text-muted-foreground">{apt.identifier}</p>
          </div>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{serviceLabel}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {apt.client_name && <p className="font-medium">{apt.client_name}</p>}
            <p>{formatDate(apt.scheduled_date)}</p>
            <p>{formatTime(apt.start_time)} – {formatTime(apt.end_time)}</p>
            {apt.staff_name && <p className="text-muted-foreground">With {apt.staff_name}</p>}
            <p className="flex justify-between border-t pt-2 font-semibold">
              <span>Total</span>
              <span>{formatMoney(apt.total_price, currency)}</span>
            </p>
            {apt.amount_paid > 0 && (
              <p className="flex justify-between text-muted-foreground">
                <span>Already paid</span>
                <span>{formatMoney(apt.amount_paid, currency)}</span>
              </p>
            )}
            <p className="flex justify-between font-semibold text-primary">
              <span>Due now</span>
              <span>{formatMoney(checkoutAmount, currency)}</span>
            </p>
            {balanceAfter > 0 && (
              <p className="flex justify-between text-muted-foreground">
                <span>Balance at appointment</span>
                <span>{formatMoney(balanceAfter, currency)}</span>
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Payment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.payment_choice_available && (
              <div className="space-y-2 rounded-lg border p-3">
                <Label className="text-sm font-medium">How would you like to pay?</Label>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name="payment-choice"
                    className="mt-1"
                    checked={paymentChoice === "full"}
                    onChange={() => setPaymentChoice("full")}
                  />
                  <span className="text-sm">
                    <span className="font-medium">Pay in full</span>
                    <span className="block text-muted-foreground">
                      {formatMoney(data.full_amount, currency)} now
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name="payment-choice"
                    className="mt-1"
                    checked={paymentChoice === "deposit"}
                    onChange={() => setPaymentChoice("deposit")}
                  />
                  <span className="text-sm">
                    <span className="font-medium">Pay deposit</span>
                    <span className="block text-muted-foreground">
                      {formatMoney(data.deposit_amount, currency)} now
                    </span>
                  </span>
                </label>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button
              type="button"
              className="h-12 w-full text-base"
              disabled={submitting}
              onClick={handleBook}
            >
              {submitting
                ? "Redirecting…"
                : `Book · ${formatMoney(checkoutAmount, currency)}`}
            </Button>
          </CardContent>
        </Card>
      </div>
    </PublicPageShell>
  );
}
