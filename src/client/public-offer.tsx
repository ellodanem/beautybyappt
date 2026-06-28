import { useState, useEffect, useMemo, useRef } from "preact/hooks";

import { api } from "./api";

import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";

import { Label } from "@/components/ui/label";

import { Textarea } from "@/components/ui/textarea";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { cn } from "@/lib/utils";

import { formatMoney } from "../shared/currency";

import {
  appointmentBalance,
  offeringCheckoutAmount,
  offeringClientHasPaymentChoice,
  resolveOfferingDeposit,
  type PaymentChoice,
} from "../shared/payment";

import { parseRequiredBookingEmail } from "../shared/email";

import { DualCurrencyAmount } from "./components/dual-currency-amount";

import { formatDateLong, formatTimeRange } from "@/lib/public-booking-utils";

import { DatePicker } from "./components/date-picker";

import { PublicPageShell } from "./components/public-page-shell";

import { PublicBookingTopBar } from "./components/public-booking-top-bar";

import { PublicBookingSummary } from "./components/public-booking-summary";

import { PublicTimeSlotPicker } from "./components/public-time-slot-picker";

import { useDetailsInView } from "./hooks/use-details-in-view";
import { usePublicBranding } from "./hooks/use-public-branding";

const BOOKING_FORM_ID = "booking-form";



interface PublicOffering {

  name: string;

  slug: string;

  description: string;

  detailed_description: string;

  color: string;

  base_price: number;

  duration: number;

  category: string;

}



interface PublicSlot {

  id: number;

  slot_date: string;

  start_time: string;

  end_time: string;

  capacity: number;

  booked_count: number;

  spots_left: number;

  is_full: boolean;

}



interface PublicAddon {

  id: number;

  name: string;

  price: number;

  extra_duration: number;

}



export function PublicOfferPage({ slug }: { slug: string }) {

  const [offering, setOffering] = useState<PublicOffering | null>(null);

  const [currency, setCurrency] = useState("USD");

  const [dates, setDates] = useState<string[]>([]);

  const [slots, setSlots] = useState<PublicSlot[]>([]);

  const [addons, setAddons] = useState<PublicAddon[]>([]);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);

  const [stripeEnabled, setStripeEnabled] = useState(false);

  const [paymentRequired, setPaymentRequired] = useState(false);

  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice>("full");

  const publicPage = usePublicBranding();

  const publicBranding = publicPage?.branding ?? null;

  const platform = publicPage?.platform ?? null;

  const timezone = publicPage?.timezone ?? "America/St_Lucia";

  const detailsRef = useRef<HTMLDivElement>(null);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);

  const [selectedAddons, setSelectedAddons] = useState<number[]>([]);

  const [name, setName] = useState("");

  const [phone, setPhone] = useState("");

  const [email, setEmail] = useState("");

  const [address, setAddress] = useState("");

  const [notes, setNotes] = useState("");

  const [confirmed, setConfirmed] = useState<{

    identifier: string;

    scheduled_date: string;

    start_time: string;

    end_time: string;

    total_price: number;

    offering_name?: string;

  } | null>(null);



  useEffect(() => {

    const params = new URLSearchParams(window.location.search);

    if (params.get("cancelled") === "1") {

      setError("Payment was cancelled — your spot is not reserved yet. You can try again.");

    }

  }, []);



  useEffect(() => {

    api<{

      offering: PublicOffering;

      currency: string;

      dates: string[];

      slots: PublicSlot[];

      addons: PublicAddon[];

      stripe_enabled: boolean;

      payment_required: boolean;

    }>("GET", `/api/offer/public/${encodeURIComponent(slug)}`)

      .then((data) => {

        setOffering(data.offering);

        setCurrency(data.currency);

        setDates(data.dates);

        setSlots(data.slots);

        setAddons(data.addons);

        setStripeEnabled(data.stripe_enabled);

        setPaymentRequired(data.payment_required);

        if (data.dates.length > 0) setSelectedDate(data.dates[0]);

      })

      .catch((err) => setError((err as Error).message))

      .finally(() => setLoading(false));

  }, [slug]);



  const daySlots = useMemo(

    () => slots.filter((s) => s.slot_date === selectedDate),

    [slots, selectedDate],

  );



  const selectedSlot = slots.find((s) => s.id === selectedSlotId) ?? null;
  const detailsInView = useDetailsInView(detailsRef, Boolean(selectedSlot));

  const totalPrice = useMemo(() => {

    if (!offering) return 0;

    let total = offering.base_price;

    for (const id of selectedAddons) {

      const addon = addons.find((a) => a.id === id);

      if (addon) total += addon.price;

    }

    return total;

  }, [offering, selectedAddons, addons]);



  const toggleAddon = (id: number) => {

    setSelectedAddons((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));

  };



  const handleDateChange = (date: string) => {

    setSelectedDate(date);

    setSelectedSlotId(null);

    setSelectedAddons([]);

  };



  const scrollToDetails = () => {

    detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  };



  const handleSubmit = async (e: Event) => {

    e.preventDefault();

    if (!selectedSlotId) {

      setError("Pick a time slot");

      return;

    }

    if (!name.trim() || !phone.trim()) {

      setError("Name and phone are required");

      return;

    }

    const emailCheck = parseRequiredBookingEmail(email);

    if (!emailCheck.ok) {

      setError(emailCheck.error);

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

          total_price: number;

          offering_name?: string;

        };

      }>("POST", `/api/offer/public/${encodeURIComponent(slug)}/book`, {

        slot_instance_id: selectedSlotId,

        name: name.trim(),

        phone: phone.trim(),

        email: emailCheck.email,

        address: address.trim(),

        addon_ids: selectedAddons,

        notes: notes.trim(),

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

      <PublicPageShell platform={platform} variant="booking" contentClassName="flex flex-1 items-center justify-center p-4">

        <p className="text-muted-foreground">Loading…</p>

      </PublicPageShell>

    );

  }



  if (error && !offering) {

    return (

      <PublicPageShell platform={platform} variant="booking" contentClassName="flex flex-1 items-center justify-center p-4">

        <Card className="w-full max-w-md">

          <CardContent className="pt-6 text-center text-destructive">{error}</CardContent>

        </Card>

      </PublicPageShell>

    );

  }



  if (confirmed && offering) {

    return (

      <PublicPageShell platform={platform} variant="booking">

        <div className="mx-auto max-w-md space-y-4 px-4 pt-8">

          <Card>

            <CardHeader className="text-center">

              <CardTitle className="text-xl text-emerald-600">You&apos;re booked!</CardTitle>

            </CardHeader>

            <CardContent className="space-y-2 text-center text-sm">

              <p className="font-medium">Reference: {confirmed.identifier}</p>

              {confirmed.offering_name && <p className="font-semibold">{confirmed.offering_name}</p>}

              <p>{formatDateLong(confirmed.scheduled_date)}</p>

              <p>{formatTimeRange(confirmed.start_time, confirmed.end_time)}</p>

              <DualCurrencyAmount amount={confirmed.total_price} currency={currency} primaryClassName="font-semibold" />

              <p className="pt-2 text-muted-foreground">We&apos;ll see you then!</p>

            </CardContent>

          </Card>

        </div>

      </PublicPageShell>

    );

  }



  if (!offering) return null;



  const depositAmount = resolveOfferingDeposit(totalPrice);

  const clientPaymentChoice = offeringClientHasPaymentChoice(totalPrice, depositAmount);

  const checkoutTotal = offeringCheckoutAmount(totalPrice, depositAmount, paymentChoice);

  const depositCheckoutTotal = offeringCheckoutAmount(totalPrice, depositAmount, "deposit");

  const fullCheckoutTotal = offeringCheckoutAmount(totalPrice, depositAmount, "full");

  const balanceDue = paymentChoice === "deposit"

    ? appointmentBalance(totalPrice, checkoutTotal)

    : 0;

  const stripeCheckout = stripeEnabled && totalPrice > 0;

  const submitLabel = stripeCheckout

    ? (submitting ? "Redirecting…" : `Pay ${formatMoney(checkoutTotal, currency)}`)

    : (submitting ? "Booking…" : "Book my spot");

  const openSlots = daySlots.filter((s) => !s.is_full);

  const summaryDate = selectedSlot?.slot_date ?? selectedDate;

  const summaryPrice = (

    <DualCurrencyAmount amount={selectedSlot ? totalPrice : offering.base_price} currency={currency} primaryClassName="text-xl font-bold text-primary" />

  );

  const summaryAction = detailsInView

    ? { label: submitLabel, formId: BOOKING_FORM_ID, loading: submitting }

    : { label: "Continue", onClick: scrollToDetails, disabled: !selectedSlot };

  return (

    <PublicPageShell platform={platform} variant="booking" contentClassName="flex-1 pb-28 lg:pb-8">

      {publicBranding && <PublicBookingTopBar branding={publicBranding} />}



      <div className="mx-auto max-w-5xl px-4 pt-6">

        <div className="mb-6 max-w-2xl">

          <div className="mb-2 flex items-center gap-2">

            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: offering.color }} />

            {offering.category && (

              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{offering.category}</span>

            )}

          </div>

          <h1 className="text-2xl font-bold tracking-tight">{offering.name}</h1>

          {offering.description && (

            <p className="mt-2 text-sm text-muted-foreground">{offering.description}</p>

          )}

          {offering.detailed_description && (

            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{offering.detailed_description}</p>

          )}

          <DualCurrencyAmount

            amount={offering.base_price}

            currency={currency}

            primaryClassName="mt-3 text-sm font-medium"

            suffix={`· ${offering.duration} min`}

          />

        </div>



        {dates.length === 0 ? (

          <Card>

            <CardContent className="py-8 text-center text-sm text-muted-foreground">

              No open times right now. Check back later or contact us directly.

            </CardContent>

          </Card>

        ) : (

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-8">

            <div className="space-y-6">

              {dates.length > 1 && (

                <div className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">

                  <Label htmlFor="offer-date" className="text-base font-semibold">Pick a day</Label>

                  <div className="mt-3">

                    <DatePicker

                      id="offer-date"

                      value={selectedDate ?? dates[0]}

                      availableDates={dates}

                      onChange={handleDateChange}

                    />

                  </div>

                </div>

              )}



              <PublicTimeSlotPicker

                timezone={timezone}

                emptyMessage={

                  daySlots.length === 0

                    ? "No times on this day."

                    : openSlots.length === 0

                      ? "All times are full on this day."

                      : "No open times on this day."

                }

                slots={daySlots.map((slot) => ({

                  key: String(slot.id),

                  start_time: slot.start_time,

                  end_time: slot.end_time,

                  disabled: slot.is_full,

                }))}

                selectedKey={selectedSlotId != null ? String(selectedSlotId) : null}

                onSelect={(key) => {

                  const slot = daySlots.find((s) => String(s.id) === key);

                  if (!slot || slot.is_full) return;

                  setSelectedSlotId(slot.id);

                  setSelectedAddons([]);

                  setError(null);

                }}

              />



              {selectedSlot && (

                <div ref={detailsRef} id="booking-details" className="scroll-mt-24">

                  <Card>

                    <CardHeader className="pb-2">

                      <CardTitle className="text-base">Your details</CardTitle>

                    </CardHeader>

                    <CardContent>

                      <form id={BOOKING_FORM_ID} className="space-y-4" onSubmit={handleSubmit}>

                        <div className="space-y-1.5">

                          <Label htmlFor="name">Full name *</Label>

                          <Input

                            id="name"

                            className="h-11"

                            value={name}

                            onInput={(e) => setName((e.target as HTMLInputElement).value)}

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

                          <Label htmlFor="address">Address (optional)</Label>

                          <Textarea

                            id="address"

                            rows={2}

                            value={address}

                            onInput={(e) => setAddress((e.target as HTMLTextAreaElement).value)}

                            placeholder="Where we'll meet you"

                          />

                        </div>

                        <div className="space-y-1.5">

                          <Label htmlFor="notes">Notes (optional)</Label>

                          <Textarea

                            id="notes"

                            rows={2}

                            value={notes}

                            onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}

                            placeholder="Skin tone, look preferences…"

                          />

                        </div>

                        {totalPrice > 0 && clientPaymentChoice && (
                          <div className="space-y-2 rounded-md border p-3">
                            <p className="text-sm font-medium">Payment</p>
                            <label className="flex cursor-pointer items-start gap-2 text-sm">
                              <input
                                type="radio"
                                name="payment_choice"
                                checked={paymentChoice === "full"}
                                onChange={() => setPaymentChoice("full")}
                              />
                              <span>
                                <span className="font-medium">Pay in full</span>
                                <span className="block text-muted-foreground">
                                  {formatMoney(fullCheckoutTotal, currency)} now
                                </span>
                              </span>
                            </label>
                            <label className="flex cursor-pointer items-start gap-2 text-sm">
                              <input
                                type="radio"
                                name="payment_choice"
                                checked={paymentChoice === "deposit"}
                                onChange={() => setPaymentChoice("deposit")}
                              />
                              <span>
                                <span className="font-medium">Pay deposit</span>
                                <span className="block text-muted-foreground">
                                  {formatMoney(depositCheckoutTotal, currency)} now
                                </span>
                              </span>
                            </label>
                          </div>
                        )}

                        {addons.length > 0 && (
                          <div className="space-y-2 rounded-md border p-3">
                            <p className="text-sm font-medium">Add extras</p>
                            {addons.map((addon) => (
                              <label key={addon.id} className="flex cursor-pointer items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={selectedAddons.includes(addon.id)}
                                  onChange={() => toggleAddon(addon.id)}
                                />
                                <span className="flex-1">{addon.name}</span>
                                <span className="text-muted-foreground">+{formatMoney(addon.price, currency)}</span>
                              </label>
                            ))}
                          </div>
                        )}

                        {totalPrice > 0 && balanceDue > 0 && paymentChoice === "deposit" && (
                          <p className="text-sm text-muted-foreground">
                            Balance at appointment: {formatMoney(balanceDue, currency)}
                          </p>
                        )}

                        {totalPrice > 0 && !stripeEnabled && (
                          <p className="text-sm text-amber-700">
                            Online payment is not enabled — contact the business to complete your booking.
                          </p>
                        )}

                        {error && <p className="text-sm text-destructive">{error}</p>}

                      </form>

                    </CardContent>

                  </Card>

                </div>

              )}

            </div>



            <PublicBookingSummary

              className="hidden lg:block"

              serviceName={offering.name}

              durationMinutes={offering.duration}

              serviceColor={offering.color}

              date={summaryDate}

              startTime={selectedSlot?.start_time ?? null}

              endTime={selectedSlot?.end_time ?? null}

              price={summaryPrice}

              action={summaryAction}

            />

          </div>

        )}

      </div>



      {selectedSlot && (

        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-4 backdrop-blur-sm lg:hidden">

          <div className="mx-auto flex max-w-md items-center gap-3">

            <div className="min-w-0 flex-1">

              <p className="truncate text-sm font-medium">{offering.name}</p>

              <DualCurrencyAmount amount={totalPrice} currency={currency} primaryClassName="text-sm font-bold text-primary" />

            </div>

            {detailsInView ? (
              <Button
                type="submit"
                form={BOOKING_FORM_ID}
                className="h-11 shrink-0 px-6"
                disabled={submitting}
              >
                {submitLabel}
              </Button>
            ) : (
              <Button type="button" className="h-11 shrink-0 px-6" onClick={scrollToDetails}>
                Continue
              </Button>
            )}

          </div>

        </div>

      )}

    </PublicPageShell>

  );

}


