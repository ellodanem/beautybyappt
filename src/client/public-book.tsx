import { useState, useEffect } from "preact/hooks";
import { api } from "./api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "../shared/currency";
import {
  appointmentBalance,
  bookingLinkCheckoutAmount,
  type PaymentChoice,
} from "../shared/payment";
import { BusinessHeader } from "./components/business-header";
import { PublicPageShell } from "./components/public-page-shell";
import { usePublicBranding } from "./hooks/use-public-branding";

interface PublicLink {
  scheduled_date: string;
  start_time: string;
  end_time: string;
  total_price: number;
  deposit_amount: number;
  travel_fee: number;
  currency: string;
  notes: string;
  staff_name?: string;
}

interface PublicService {
  id: number;
  name: string;
  price: number;
}

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

export function PublicBookPage({ token }: { token: string }) {
  const [link, setLink] = useState<PublicLink | null>(null);
  const [services, setServices] = useState<PublicService[]>([]);
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [paymentRequired, setPaymentRequired] = useState(false);
  const [clientPaymentChoice, setClientPaymentChoice] = useState(false);
  const [requiresAddress, setRequiresAddress] = useState(false);
  const [serviceSubtotal, setServiceSubtotal] = useState(0);
  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice>("full");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<{
    identifier: string;
    scheduled_date: string;
    start_time: string;
    end_time: string;
  } | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const publicPage = usePublicBranding();
  const publicBranding = publicPage?.branding ?? null;
  const platform = publicPage?.platform ?? null;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("cancelled") === "1") {
      setError("Payment was cancelled — your spot is not reserved yet. You can try again.");
    }
  }, []);

  useEffect(() => {
    api<{
      booking_link: PublicLink;
      services: PublicService[];
      stripe_enabled: boolean;
      payment_required: boolean;
      client_payment_choice: boolean;
      requires_address: boolean;
      service_subtotal: number;
    }>("GET", `/api/book/public/${token}`)
      .then((data) => {
        setLink(data.booking_link);
        setServices(data.services);
        setStripeEnabled(data.stripe_enabled);
        setPaymentRequired(data.payment_required);
        setClientPaymentChoice(data.client_payment_choice);
        setRequiresAddress(data.requires_address);
        setServiceSubtotal(data.service_subtotal);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      setError("Name and phone are required");
      return;
    }
    if (requiresAddress && !address.trim()) {
      setError("Address is required for on-location appointments");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await api<{
        requires_payment?: boolean;
        checkout_url?: string;
        appointment?: {
          identifier: string;
          scheduled_date: string;
          start_time: string;
          end_time: string;
        };
      }>("POST", `/api/book/public/${token}/confirm`, {
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        address: address.trim(),
        payment_choice: paymentChoice,
      });

      if (res.requires_payment && res.checkout_url) {
        window.location.href = res.checkout_url;
        return;
      }

      if (res.appointment) {
        setConfirmed(res.appointment);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
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

  if (error && !link) {
    return (
      <PublicPageShell platform={platform} contentClassName="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center text-destructive">{error}</CardContent>
        </Card>
      </PublicPageShell>
    );
  }

  if (confirmed && link) {
    return (
      <PublicPageShell platform={platform}>
        <div className="mx-auto max-w-md space-y-4 pt-8">
          {publicBranding && <BusinessHeader branding={publicBranding} />}
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="text-xl text-emerald-600">You&apos;re booked!</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-center text-sm">
              <p className="font-medium">Reference: {confirmed.identifier}</p>
              <p>{formatDate(confirmed.scheduled_date)}</p>
              <p>{formatTime(confirmed.start_time)} – {formatTime(confirmed.end_time)}</p>
              <p className="pt-2 text-muted-foreground">We&apos;ll see you then!</p>
            </CardContent>
          </Card>
        </div>
      </PublicPageShell>
    );
  }

  if (!link) return null;

  const travelFee = link.travel_fee ?? 0;
  const checkoutTotal = bookingLinkCheckoutAmount(link, paymentChoice);
  const depositCheckoutTotal = bookingLinkCheckoutAmount(link, "deposit");
  const fullCheckoutTotal = bookingLinkCheckoutAmount(link, "full");
  const balanceDue = paymentChoice === "deposit"
    ? appointmentBalance(link.total_price, checkoutTotal)
    : 0;
  const stripeCheckout = stripeEnabled && paymentRequired;

  return (
    <PublicPageShell platform={platform} contentClassName="flex-1 p-4 pb-8">
      <div className="mx-auto max-w-md space-y-4 pt-4">
        {publicBranding ? (
          <BusinessHeader branding={publicBranding} subtitle="Complete your details below" />
        ) : (
          <div className="text-center">
            <h1 className="text-xl font-bold tracking-tight">Confirm your booking</h1>
            <p className="mt-1 text-sm text-muted-foreground">Complete your details below</p>
          </div>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Appointment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="font-medium">{formatDate(link.scheduled_date)}</p>
            <p>{formatTime(link.start_time)} – {formatTime(link.end_time)}</p>
            {link.staff_name && <p className="text-muted-foreground">With {link.staff_name}</p>}
            {services.length > 0 && (
              <ul className="mt-2 space-y-0.5 border-t pt-2">
                {services.map((s) => (
                  <li key={s.id} className="flex justify-between">
                    <span>{s.name}</span>
                    <span>{formatMoney(s.price, link.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
            {travelFee > 0 && (
              <>
                <p className="flex justify-between text-muted-foreground">
                  <span>Service</span>
                  <span>{formatMoney(serviceSubtotal, link.currency)}</span>
                </p>
                <p className="flex justify-between text-muted-foreground">
                  <span>Travel</span>
                  <span>{formatMoney(travelFee, link.currency)}</span>
                </p>
              </>
            )}
            <p className="flex justify-between border-t pt-2 font-semibold">
              <span>Total</span>
              <span>{formatMoney(link.total_price, link.currency)}</span>
            </p>
            {paymentRequired && (
              <p className="flex justify-between font-semibold text-primary">
                <span>Due now</span>
                <span>{formatMoney(checkoutTotal, link.currency)}</span>
              </p>
            )}
            {paymentRequired && balanceDue > 0 && (
              <p className="flex justify-between text-muted-foreground">
                <span>Balance at appointment</span>
                <span>{formatMoney(balanceDue, link.currency)}</span>
              </p>
            )}
            {link.notes && (
              <p className="mt-2 rounded-md bg-muted p-2 text-muted-foreground">{link.notes}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Your information</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-1.5">
                <Label htmlFor="name">Full name *</Label>
                <Input
                  id="name"
                  className="h-11"
                  value={name}
                  onInput={(e) => setName((e.target as HTMLInputElement).value)}
                  placeholder="Your name"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone *</Label>
                <Input
                  id="phone"
                  type="tel"
                  className="h-11"
                  value={phone}
                  onInput={(e) => setPhone((e.target as HTMLInputElement).value)}
                  placeholder="555-0100"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  className="h-11"
                  value={email}
                  onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
                  placeholder="you@example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="address">{requiresAddress ? "Address *" : "Address (optional)"}</Label>
                <Textarea
                  id="address"
                  rows={2}
                  value={address}
                  onInput={(e) => setAddress((e.target as HTMLTextAreaElement).value)}
                  placeholder={requiresAddress ? "Where we'll meet you" : "Location for your appointment"}
                  required={requiresAddress}
                />
              </div>

              {paymentRequired && clientPaymentChoice && (
                <div className="space-y-2 rounded-lg border p-3">
                  <Label className="text-sm font-medium">Payment</Label>
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
                        {formatMoney(fullCheckoutTotal, link.currency)} now
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
                        {formatMoney(depositCheckoutTotal, link.currency)} now
                        {travelFee > 0 && " (deposit + travel)"}
                      </span>
                    </span>
                  </label>
                </div>
              )}

              {paymentRequired && !stripeEnabled && (
                <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                  Online payment is not available yet — your booking will be confirmed without charge.
                </p>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button type="submit" className="h-12 w-full text-base" disabled={submitting}>
                {submitting
                  ? (stripeCheckout ? "Redirecting…" : "Confirming…")
                  : (stripeCheckout ? `Pay ${formatMoney(checkoutTotal, link.currency)}` : "Confirm booking")}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </PublicPageShell>
  );
}
