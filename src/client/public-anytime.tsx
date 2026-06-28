import { useState, useEffect, useMemo, useRef } from "preact/hooks";

import { api } from "./api";

import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";

import { Label } from "@/components/ui/label";

import { Textarea } from "@/components/ui/textarea";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { cn } from "@/lib/utils";

import { formatMoney } from "../shared/currency";
import { addMinutes } from "../shared/offerings";
import {
  appointmentBalance,
  offeringCheckoutAmount,
  offeringClientHasPaymentChoice,
  resolveOfferingDeposit,
  type PaymentChoice,
} from "../shared/payment";
import { parseRequiredBookingEmail } from "../shared/email";

import { formatDateLong, formatTimeRange } from "@/lib/public-booking-utils";

import { DatePicker } from "./components/date-picker";

import { PublicPageShell } from "./components/public-page-shell";

import { PublicBookingTopBar } from "./components/public-booking-top-bar";

import { PublicBookingSummary } from "./components/public-booking-summary";

import { PublicServiceDetails } from "./components/public-service-details";

import { PublicTimeSlotPicker } from "./components/public-time-slot-picker";

import { useDetailsInView } from "./hooks/use-details-in-view";
import { usePublicBranding } from "./hooks/use-public-branding";

const BOOKING_FORM_ID = "booking-form";



interface PublicServiceAddon {
  id: number;
  name: string;
  price: number;
  extra_duration: number;
}

interface PublicService {
  id: number;
  name: string;
  slug: string;
  description: string;
  duration: number;
  price: number;
  color: string;
  category: string;
  allow_addons: number;
  addons: PublicServiceAddon[];
}



interface PublicSlot {

  start_time: string;

  end_time: string;

}



interface Props {

  serviceSlug?: string;

}



export function PublicAnytimePage({ serviceSlug }: Props) {

  const [services, setServices] = useState<PublicService[]>([]);

  const [currency, setCurrency] = useState("USD");

  const [dates, setDates] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice>("full");

  const publicPage = usePublicBranding();

  const publicBranding = publicPage?.branding ?? null;

  const platform = publicPage?.platform ?? null;

  const timezone = publicPage?.timezone ?? "America/St_Lucia";

  const detailsRef = useRef<HTMLDivElement>(null);



  const [selectedServiceId, setSelectedServiceId] = useState<number | null>(null);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const [slots, setSlots] = useState<PublicSlot[]>([]);

  const [loadingSlots, setLoadingSlots] = useState(false);

  const [selectedStartTime, setSelectedStartTime] = useState<string | null>(null);

  const [name, setName] = useState("");

  const [phone, setPhone] = useState("");

  const [email, setEmail] = useState("");

  const [address, setAddress] = useState("");

  const [notes, setNotes] = useState("");
  const [selectedAddonIds, setSelectedAddonIds] = useState<number[]>([]);

  const [confirmed, setConfirmed] = useState<{

    identifier: string;

    scheduled_date: string;

    start_time: string;

    end_time: string;

    total_price: number;

    service_name: string;

  } | null>(null);



  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("cancelled") === "1") {
      setError("Payment was cancelled — your spot is not reserved yet. You can try again.");
    }
  }, []);



  useEffect(() => {

    const endpoint = serviceSlug

      ? `/api/anytime/public/${encodeURIComponent(serviceSlug)}`

      : "/api/anytime/public";



    api<{

      services?: PublicService[];

      service?: PublicService;

      currency: string;

      dates: string[];

      stripe_enabled: boolean;

    }>("GET", endpoint)

      .then((data) => {

        const list = data.services ?? (data.service ? [data.service] : []);

        setServices(list);

        setCurrency(data.currency);

        setDates(data.dates);

        setStripeEnabled(data.stripe_enabled);

        if (list.length === 1) setSelectedServiceId(list[0].id);

        if (data.dates.length > 0) setSelectedDate(data.dates[0]);

      })

      .catch((err) => setError((err as Error).message))

      .finally(() => setLoading(false));

  }, [serviceSlug]);



  const selectedService = useMemo(
    () => services.find((svc) => svc.id === selectedServiceId) ?? null,
    [services, selectedServiceId],
  );

  const selectedSlot = useMemo(
    () => slots.find((slot) => slot.start_time === selectedStartTime) ?? null,
    [slots, selectedStartTime],
  );
  const detailsInView = useDetailsInView(detailsRef, Boolean(selectedSlot));

  const serviceAddons = selectedService?.addons ?? [];

  const extrasSubtotal = useMemo(
    () => serviceAddons
      .filter((addon) => selectedAddonIds.includes(addon.id))
      .reduce((sum, addon) => sum + addon.price, 0),
    [serviceAddons, selectedAddonIds],
  );

  const extraDuration = useMemo(
    () => serviceAddons
      .filter((addon) => selectedAddonIds.includes(addon.id))
      .reduce((sum, addon) => sum + addon.extra_duration, 0),
    [serviceAddons, selectedAddonIds],
  );

  const bookingTotal = (selectedService?.price ?? 0) + extrasSubtotal;

  const displayEndTime = selectedSlot && selectedService
    ? addMinutes(selectedSlot.start_time, selectedService.duration + extraDuration)
    : selectedSlot?.end_time ?? null;



  useEffect(() => {

    if (!selectedServiceId || !selectedDate) {

      setSlots([]);

      setSelectedStartTime(null);

      return;

    }



    let cancelled = false;

    setLoadingSlots(true);

    setSelectedStartTime(null);



    api<{ date: string; slots: PublicSlot[] }>(

      "GET",

      `/api/anytime/public/availability?date=${encodeURIComponent(selectedDate)}&service_id=${selectedServiceId}`,

    )

      .then((data) => {

        if (!cancelled) setSlots(data.slots);

      })

      .catch(() => {

        if (!cancelled) setSlots([]);

      })

      .finally(() => {

        if (!cancelled) setLoadingSlots(false);

      });



    return () => { cancelled = true; };

  }, [selectedServiceId, selectedDate]);



  const handleServiceChange = (serviceId: number) => {
    setSelectedServiceId(serviceId);
    setSelectedStartTime(null);
    setSelectedAddonIds([]);
    setError(null);
  };

  const toggleAddon = (addonId: number) => {
    setSelectedAddonIds((prev) => (
      prev.includes(addonId) ? prev.filter((id) => id !== addonId) : [...prev, addonId]
    ));
  };



  const handleDateChange = (date: string) => {

    setSelectedDate(date);

    setSelectedStartTime(null);

    setError(null);

  };



  const scrollToDetails = () => {

    detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  };



  const handleSubmit = async (e: Event) => {

    e.preventDefault();

    if (!selectedService || !selectedDate || !selectedStartTime) {

      setError("Pick a service, day, and time");

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

          service_name: string;

        };

      }>("POST", "/api/anytime/public/book", {

        service_id: selectedService.id,

        scheduled_date: selectedDate,

        start_time: selectedStartTime,

        name: name.trim(),

        phone: phone.trim(),

        email: emailCheck.email,

        address: address.trim(),

        notes: notes.trim(),

        addon_ids: selectedAddonIds,

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



  if (error && services.length === 0) {

    return (

      <PublicPageShell platform={platform} variant="booking" contentClassName="flex flex-1 items-center justify-center p-4">

        <Card className="w-full max-w-md">

          <CardContent className="pt-6 text-center text-destructive">{error}</CardContent>

        </Card>

      </PublicPageShell>

    );

  }



  if (confirmed) {

    return (

      <PublicPageShell platform={platform} variant="booking">

        <div className="mx-auto max-w-md space-y-4 px-4 pt-8">

          <Card>

            <CardHeader className="text-center">

              <CardTitle className="text-xl text-emerald-600">You&apos;re booked!</CardTitle>

            </CardHeader>

            <CardContent className="space-y-2 text-center text-sm">

              <p className="font-medium">Reference: {confirmed.identifier}</p>

              <p className="font-semibold">{confirmed.service_name}</p>

              <p>{formatDateLong(confirmed.scheduled_date)}</p>

              <p>{formatTimeRange(confirmed.start_time, confirmed.end_time)}</p>

              <p className="font-semibold">{formatMoney(confirmed.total_price, currency)}</p>

              <p className="pt-2 text-muted-foreground">We&apos;ll see you then!</p>

            </CardContent>

          </Card>

        </div>

      </PublicPageShell>

    );

  }



  if (services.length === 0) {

    return (

      <PublicPageShell platform={platform} variant="booking" contentClassName="flex flex-1 items-center justify-center p-4">

        <Card className="w-full max-w-md">

          <CardContent className="py-8 text-center text-sm text-muted-foreground">

            No services are available to book right now.

          </CardContent>

        </Card>

      </PublicPageShell>

    );

  }



  const pageTitle = (serviceSlug || services.length === 1) && selectedService
    ? selectedService.name
    : "Book an appointment";

  const pageDescription = (serviceSlug || services.length === 1) && selectedService?.description?.trim()
    ? selectedService.description
    : "Pick a service, day, and time that works for you.";

  const depositAmount = resolveOfferingDeposit(bookingTotal);

  const clientPaymentChoice = offeringClientHasPaymentChoice(bookingTotal, depositAmount);

  const checkoutTotal = offeringCheckoutAmount(bookingTotal, depositAmount, paymentChoice);

  const depositCheckoutTotal = offeringCheckoutAmount(bookingTotal, depositAmount, "deposit");

  const fullCheckoutTotal = offeringCheckoutAmount(bookingTotal, depositAmount, "full");

  const balanceDue = paymentChoice === "deposit"
    ? appointmentBalance(bookingTotal, checkoutTotal)
    : 0;

  const stripeCheckout = stripeEnabled && bookingTotal > 0;

  const submitLabel = stripeCheckout
    ? (submitting ? "Redirecting…" : `Pay ${formatMoney(checkoutTotal, currency)}`)
    : (submitting ? "Booking…" : "Book appointment");

  const summaryAction = detailsInView
    ? { label: submitLabel, formId: BOOKING_FORM_ID, loading: submitting }
    : { label: "Continue", onClick: scrollToDetails, disabled: !selectedSlot };

  return (

    <PublicPageShell platform={platform} variant="booking" contentClassName="flex-1 pb-28 lg:pb-8">

      {publicBranding && <PublicBookingTopBar branding={publicBranding} />}



      <div className="mx-auto max-w-5xl px-4 pt-6">

        <div className="mb-6 max-w-2xl">

          {(serviceSlug || services.length === 1) && selectedService?.category && (
            <div className="mb-2 flex items-center gap-2">
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: selectedService.color }}
              />
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {selectedService.category}
              </span>
            </div>
          )}

          <h1 className="text-2xl font-bold tracking-tight">{pageTitle}</h1>

          {pageDescription && (

            <p className="mt-2 text-sm text-muted-foreground">{pageDescription}</p>

          )}

        </div>



        {services.length > 1 && (

          <div className="mb-6 space-y-2">

            <Label>Pick a service *</Label>

            <div className="grid gap-2 sm:grid-cols-2">

              {services.map((svc) => (

                <button

                  key={svc.id}

                  type="button"

                  className={cn(

                    "flex items-center gap-3 rounded-xl border bg-card p-3 text-left text-sm transition-colors",

                    selectedServiceId === svc.id ? "border-primary bg-primary/5 shadow-sm" : "hover:border-primary/50",

                  )}

                  onClick={() => handleServiceChange(svc.id)}

                >

                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: svc.color }} />

                  <div className="min-w-0 flex-1">

                    <p className="font-medium">{svc.name}</p>

                    <p className="text-xs text-muted-foreground">

                      {svc.duration} min · {formatMoney(svc.price, currency)}

                    </p>

                  </div>

                </button>

              ))}

            </div>

            {selectedService && (
              <PublicServiceDetails
                className="mt-3"
                name={selectedService.name}
                description={selectedService.description}
                category={selectedService.category}
                duration={selectedService.duration}
                price={selectedService.price}
                currency={currency}
                color={selectedService.color}
              />
            )}

          </div>

        )}



        {selectedService && (

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-8">

            <div className="space-y-6">

              <div className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">

                <Label htmlFor="booking-date" className="text-base font-semibold">Pick a day *</Label>

                <div className="mt-3">

                  <DatePicker

                    id="booking-date"

                    value={selectedDate ?? dates[0]}

                    availableDates={dates}

                    onChange={handleDateChange}

                  />

                </div>

              </div>



              <PublicTimeSlotPicker

                timezone={timezone}

                loading={loadingSlots}

                slots={slots.map((slot) => ({

                  key: slot.start_time,

                  start_time: slot.start_time,

                  end_time: slot.end_time,

                }))}

                selectedKey={selectedStartTime}

                onSelect={(key) => {

                  setSelectedStartTime(key);

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

                          <Label htmlFor="email">Email *</Label>

                          <Input

                            id="email"

                            type="email"

                            className="h-11"

                            value={email}

                            onInput={(e) => setEmail((e.target as HTMLInputElement).value)}

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

                            placeholder="Preferences or special requests"

                          />

                        </div>

                        {bookingTotal > 0 && clientPaymentChoice && (
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

                        {serviceAddons.length > 0 && (
                          <div className="space-y-2 rounded-md border p-3">
                            <p className="text-sm font-medium">Add extras</p>
                            {serviceAddons.map((addon) => (
                              <label key={addon.id} className="flex cursor-pointer items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={selectedAddonIds.includes(addon.id)}
                                  onChange={() => toggleAddon(addon.id)}
                                />
                                <span className="flex-1">{addon.name}</span>
                                <span className="text-muted-foreground">+{formatMoney(addon.price, currency)}</span>
                              </label>
                            ))}
                          </div>
                        )}

                        {bookingTotal > 0 && balanceDue > 0 && paymentChoice === "deposit" && (
                          <p className="text-sm text-muted-foreground">
                            Balance at appointment: {formatMoney(balanceDue, currency)}
                          </p>
                        )}

                        {bookingTotal > 0 && !stripeEnabled && (
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

              serviceName={selectedService.name}

              serviceDescription={selectedService.description}

              durationMinutes={selectedService.duration}

              serviceColor={selectedService.color}

              date={selectedDate}

              startTime={selectedSlot?.start_time ?? null}
              endTime={displayEndTime}
              price={formatMoney(bookingTotal, currency)}

              action={summaryAction}

            />

          </div>

        )}

      </div>



      {selectedService && selectedSlot && (

        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-4 backdrop-blur-sm lg:hidden">

          <div className="mx-auto flex max-w-md items-center gap-3">

            <div className="min-w-0 flex-1">

              <p className="truncate text-sm font-medium">{selectedService.name}</p>

              <p className="text-sm font-bold text-primary">{formatMoney(bookingTotal, currency)}</p>

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


