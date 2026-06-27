import { useState, useEffect, useMemo } from "preact/hooks";
import { api } from "./api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatMoney } from "../shared/currency";
import { BusinessHeader } from "./components/business-header";
import { DatePicker } from "./components/date-picker";
import type { Branding } from "../shared/branding";

interface PublicService {
  id: number;
  name: string;
  slug: string;
  description: string;
  duration: number;
  price: number;
  color: string;
  category: string;
}

interface PublicSlot {
  start_time: string;
  end_time: string;
}

function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function formatTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
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
  const [publicBranding, setPublicBranding] = useState<Branding | null>(null);

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
  const [confirmed, setConfirmed] = useState<{
    identifier: string;
    scheduled_date: string;
    start_time: string;
    end_time: string;
    total_price: number;
    service_name: string;
  } | null>(null);

  useEffect(() => {
    api<Branding>("GET", "/api/public/branding")
      .then(setPublicBranding)
      .catch(() => setPublicBranding({ business_name: "", business_tagline: "", logo_url: "" }));
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
    }>("GET", endpoint)
      .then((data) => {
        const list = data.services ?? (data.service ? [data.service] : []);
        setServices(list);
        setCurrency(data.currency);
        setDates(data.dates);
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
    setError(null);
  };

  const handleDateChange = (date: string) => {
    setSelectedDate(date);
    setSelectedStartTime(null);
    setError(null);
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

    setSubmitting(true);
    setError(null);
    try {
      const res = await api<{
        appointment: {
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
        email: email.trim(),
        address: address.trim(),
        notes: notes.trim(),
      });
      setConfirmed(res.appointment);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (error && services.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center text-destructive">{error}</CardContent>
        </Card>
      </div>
    );
  }

  if (confirmed) {
    return (
      <div className="min-h-screen bg-background p-4 pb-8">
        <div className="mx-auto max-w-md space-y-4 pt-8">
          {publicBranding && <BusinessHeader branding={publicBranding} />}
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="text-xl text-emerald-600">You&apos;re booked!</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-center text-sm">
              <p className="font-medium">Reference: {confirmed.identifier}</p>
              <p className="font-semibold">{confirmed.service_name}</p>
              <p>{formatDateLong(confirmed.scheduled_date)}</p>
              <p>{formatTime(confirmed.start_time)} – {formatTime(confirmed.end_time)}</p>
              <p className="font-semibold">{formatMoney(confirmed.total_price, currency)}</p>
              <p className="pt-2 text-muted-foreground">We&apos;ll see you then!</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (services.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No services are available to book right now.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 pb-28">
      <div className="mx-auto max-w-md space-y-4 pt-4">
        {publicBranding ? <BusinessHeader branding={publicBranding} /> : null}

        <div className="text-center">
          <h1 className="text-xl font-bold tracking-tight">
            {serviceSlug && selectedService ? selectedService.name : "Book an appointment"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {serviceSlug && selectedService?.description
              ? selectedService.description
              : "Pick a service, day, and time that works for you."}
          </p>
        </div>

        {services.length > 1 && (
          <div className="space-y-2">
            <Label>Pick a service *</Label>
            <div className="grid gap-2">
              {services.map((svc) => (
                <button
                  key={svc.id}
                  type="button"
                  className={cn(
                    "flex items-center gap-3 rounded-lg border p-3 text-left text-sm transition-colors",
                    selectedServiceId === svc.id ? "border-primary bg-primary/5" : "hover:border-primary/50",
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
          </div>
        )}

        {selectedService && (
          <>
            {services.length === 1 && (
              <Card>
                <CardContent className="flex items-center gap-3 p-4">
                  <span className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: selectedService.color }} />
                  <div>
                    <p className="font-semibold">{selectedService.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {selectedService.duration} min · {formatMoney(selectedService.price, currency)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="space-y-2">
              <Label htmlFor="booking-date">Pick a day *</Label>
              <DatePicker
                id="booking-date"
                value={selectedDate ?? dates[0]}
                availableDates={dates}
                onChange={handleDateChange}
              />
            </div>

            <div className="space-y-2">
              <Label>Pick a time *</Label>
              {loadingSlots ? (
                <p className="text-sm text-muted-foreground">Loading times…</p>
              ) : slots.length === 0 ? (
                <p className="text-sm text-muted-foreground">No open times on this day.</p>
              ) : (
                <div className="grid gap-2">
                  {slots.map((slot) => (
                    <button
                      key={slot.start_time}
                      type="button"
                      className={cn(
                        "flex items-center justify-between rounded-lg border p-3 text-left text-sm transition-colors",
                        selectedStartTime === slot.start_time ? "border-primary bg-primary/5" : "hover:border-primary/50",
                      )}
                      onClick={() => {
                        setSelectedStartTime(slot.start_time);
                        setError(null);
                      }}
                    >
                      <p className="font-medium">{formatTime(slot.start_time)} – {formatTime(slot.end_time)}</p>
                      <span className="font-semibold">{formatMoney(selectedService.price, currency)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedSlot && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Your details</CardTitle>
                </CardHeader>
                <CardContent>
                  <form className="space-y-4" onSubmit={handleSubmit}>
                    <div className="rounded-md bg-muted/50 p-3 text-sm">
                      <p className="font-medium">{selectedService.name}</p>
                      <p>{formatDateLong(selectedDate!)}</p>
                      <p>{formatTime(selectedSlot.start_time)} – {formatTime(selectedSlot.end_time)}</p>
                      <p className="mt-1 font-semibold">{formatMoney(selectedService.price, currency)}</p>
                    </div>
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
                    {error && <p className="text-sm text-destructive">{error}</p>}
                    <Button type="submit" className="h-12 w-full text-base" disabled={submitting}>
                      {submitting ? "Booking…" : "Book appointment"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
