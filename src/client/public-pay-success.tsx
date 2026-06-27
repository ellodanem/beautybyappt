import { useState, useEffect } from "preact/hooks";
import { api } from "./api";
import { BusinessHeader } from "./components/business-header";
import { PublicPageShell } from "./components/public-page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePublicBranding } from "./hooks/use-public-branding";
import { formatMoney } from "../shared/currency";
import { appointmentBalance } from "../shared/payment";

export function PublicPaySuccessPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const publicPage = usePublicBranding();
  const publicBranding = publicPage?.branding ?? null;
  const platform = publicPage?.platform ?? null;
  const [result, setResult] = useState<{
    appointment: {
      identifier: string;
      total_price: number;
      amount_paid: number;
      payment_status: string;
      currency: string;
    };
    amount_credited: number;
  } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (!sessionId) {
      setError("Missing payment session");
      setLoading(false);
      return;
    }

    api<{
      appointment: {
        identifier: string;
        total_price: number;
        amount_paid: number;
        payment_status: string;
        currency: string;
      };
      amount_credited: number;
    }>("GET", `/api/payments/complete?session_id=${encodeURIComponent(sessionId)}`)
      .then(setResult)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <PublicPageShell platform={platform} contentClassName="flex flex-1 items-center justify-center p-4">
        <p className="text-muted-foreground">Confirming your payment…</p>
      </PublicPageShell>
    );
  }

  if (error || !result) {
    return (
      <PublicPageShell platform={platform} contentClassName="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="space-y-2 pt-6 text-center">
            <p className="text-destructive">{error || "Could not confirm payment"}</p>
          </CardContent>
        </Card>
      </PublicPageShell>
    );
  }

  const { appointment, amount_credited: amountCredited } = result;
  const currency = appointment.currency || "USD";
  const balanceDue = appointmentBalance(appointment.total_price, appointment.amount_paid);
  const paidInFull = appointment.payment_status === "paid" || balanceDue <= 0;

  return (
    <PublicPageShell platform={platform}>
      <div className="mx-auto max-w-md space-y-4 pt-8">
        {publicBranding && <BusinessHeader branding={publicBranding} />}
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl text-emerald-600">Payment received</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-center text-sm">
            <p className="font-medium">Reference: {appointment.identifier}</p>
            <p className="font-semibold text-emerald-700">
              Paid: {formatMoney(amountCredited, currency)}
            </p>
            {paidInFull ? (
              <p className="text-muted-foreground">Your booking is paid in full.</p>
            ) : (
              <p className="text-muted-foreground">
                {formatMoney(balanceDue, currency)} remaining on this booking.
              </p>
            )}
            <p className="pt-2 text-muted-foreground">Thank you!</p>
          </CardContent>
        </Card>
      </div>
    </PublicPageShell>
  );
}
