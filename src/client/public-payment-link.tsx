import { useState, useEffect } from "preact/hooks";
import { api } from "./api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "../shared/currency";
import { type PaymentChoice } from "../shared/payment";
import { parseRequiredBookingEmail } from "../shared/email";
import { BusinessHeader } from "./components/business-header";
import { PublicPageShell } from "./components/public-page-shell";
import { usePublicBranding } from "./hooks/use-public-branding";

interface PublicPaymentLink {
  quoted_total: number;
  deposit_amount: number;
  currency: string;
  notes: string;
  staff_name?: string | null;
  fee_passthrough?: boolean;
}

export function PublicPaymentLinkPage({ token }: { token: string }) {
  const [link, setLink] = useState<PublicPaymentLink | null>(null);
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [paymentChoiceAvailable, setPaymentChoiceAvailable] = useState(false);
  const [depositAmount, setDepositAmount] = useState(0);
  const [fullAmount, setFullAmount] = useState(0);
  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice>("full");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const publicPage = usePublicBranding();
  const publicBranding = publicPage?.branding ?? null;
  const platform = publicPage?.platform ?? null;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("cancelled") === "1") {
      setError("Payment was cancelled. You can try again.");
    }
  }, []);

  useEffect(() => {
    api<{
      payment_link: PublicPaymentLink;
      stripe_enabled: boolean;
      payment_choice_available: boolean;
      deposit_amount: number;
      full_amount: number;
    }>("GET", `/api/pay-link/public/${token}`)
      .then((data) => {
        setLink(data.payment_link);
        setStripeEnabled(data.stripe_enabled);
        setPaymentChoiceAvailable(data.payment_choice_available);
        setDepositAmount(data.deposit_amount);
        setFullAmount(data.full_amount);
        setPaymentChoice(data.payment_choice_available ? "deposit" : "full");
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [token]);

  const handlePay = async () => {
    if (!link) return;
    const parsed = parseRequiredBookingEmail(email);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    if (!name.trim()) {
      setError("Please enter your name");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<{ checkout_url?: string }>("POST", `/api/pay-link/public/${token}/confirm`, {
        name: name.trim(),
        phone: phone.trim(),
        email: parsed.email,
        payment_choice: paymentChoice,
      });
      if (res.checkout_url) {
        window.location.href = res.checkout_url;
        return;
      }
      setError("Could not start checkout");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <PublicPageShell platform={platform}>
        <p className="text-center text-muted-foreground">Loading…</p>
      </PublicPageShell>
    );
  }

  if (!link) {
    return (
      <PublicPageShell platform={platform}>
        <Card className="mx-auto max-w-md">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {error || "This payment link is not available."}
          </CardContent>
        </Card>
      </PublicPageShell>
    );
  }

  const payNow = paymentChoice === "deposit" && paymentChoiceAvailable ? depositAmount : fullAmount;

  return (
    <PublicPageShell platform={platform}>
      <div className="mx-auto max-w-md space-y-4 pt-4">
        {publicBranding ? (
          <BusinessHeader branding={publicBranding} subtitle="Complete your payment below" />
        ) : (
          <div className="text-center">
            <h1 className="text-xl font-bold tracking-tight">Payment</h1>
          </div>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Payment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {link.staff_name && (
              <p className="text-sm text-muted-foreground">With {link.staff_name}</p>
            )}
            <div className="rounded-lg bg-muted/50 p-3 text-sm">
              <p className="font-medium">{formatMoney(link.quoted_total, link.currency)}</p>
              {paymentChoiceAvailable && paymentChoice === "deposit" && (
                <p className="mt-1 text-muted-foreground">
                  Deposit now: {formatMoney(depositAmount, link.currency)} · Balance later
                </p>
              )}
              {link.notes && <p className="mt-2 text-muted-foreground">{link.notes}</p>}
              {link.fee_passthrough && (
                <p className="mt-2 text-xs text-muted-foreground">Card total includes processing.</p>
              )}
            </div>

            {!stripeEnabled && (
              <p className="text-sm text-amber-700">Online payments are temporarily unavailable.</p>
            )}

            {paymentChoiceAvailable && (
              <div className="space-y-2">
                <Label>Pay now</Label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={paymentChoice === "deposit"}
                    onChange={() => setPaymentChoice("deposit")}
                  />
                  Deposit {formatMoney(depositAmount, link.currency)}
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={paymentChoice === "full"}
                    onChange={() => setPaymentChoice("full")}
                  />
                  Full {formatMoney(fullAmount, link.currency)}
                </label>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input className="h-11" value={name} onChange={(e) => setName((e.target as HTMLInputElement).value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Email *</Label>
              <Input type="email" className="h-11" value={email} onChange={(e) => setEmail((e.target as HTMLInputElement).value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input className="h-11" value={phone} onChange={(e) => setPhone((e.target as HTMLInputElement).value)} />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button className="h-11 w-full" disabled={submitting || !stripeEnabled} onClick={handlePay}>
              {submitting ? "Redirecting…" : `Pay ${formatMoney(payNow, link.currency)}`}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Payment received — thank you. The business will follow up if needed.
            </p>
          </CardContent>
        </Card>
      </div>
    </PublicPageShell>
  );
}
