import { useState, useEffect, useMemo } from "preact/hooks";
import { api } from "./api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatMoney } from "../shared/currency";
import { DualCurrencyAmount } from "./components/dual-currency-amount";
import { BusinessHeader } from "./components/business-header";
import { DatePicker } from "./components/date-picker";
import type { Branding } from "../shared/branding";

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

export function PublicOfferPage({ slug }: { slug: string }) {
  const [offering, setOffering] = useState<PublicOffering | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [dates, setDates] = useState<string[]>([]);
  const [slots, setSlots] = useState<PublicSlot[]>([]);
  const [addons, setAddons] = useState<PublicAddon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [publicBranding, setPublicBranding] = useState<Branding | null>(null);

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
    api<Branding>("GET", "/api/public/branding")
      .then(setPublicBranding)
      .catch(() => setPublicBranding({ business_name: "", business_tagline: "", logo_url: "" }));
  }, []);

  useEffect(() => {
    api<{
      offering: PublicOffering;
      currency: string;
      dates: string[];
      slots: PublicSlot[];
      addons: PublicAddon[];
    }>("GET", `/api/offer/public/${encodeURIComponent(slug)}`)
      .then((data) => {
        setOffering(data.offering);
        setCurrency(data.currency);
        setDates(data.dates);
        setSlots(data.slots);
        setAddons(data.addons);
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
          offering_name?: string;
        };
      }>("POST", `/api/offer/public/${encodeURIComponent(slug)}/book`, {
        slot_instance_id: selectedSlotId,
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        address: address.trim(),
        addon_ids: selectedAddons,
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

  if (error && !offering) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center text-destructive">{error}</CardContent>
        </Card>
      </div>
    );
  }

  if (confirmed && offering) {
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
              {confirmed.offering_name && <p className="font-semibold">{confirmed.offering_name}</p>}
              <p>{formatDateLong(confirmed.scheduled_date)}</p>
              <p>{formatTime(confirmed.start_time)} – {formatTime(confirmed.end_time)}</p>
              <DualCurrencyAmount amount={confirmed.total_price} currency={currency} primaryClassName="font-semibold" />
              <p className="pt-2 text-muted-foreground">We&apos;ll see you then!</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!offering) return null;

  const openSlots = daySlots.filter((s) => !s.is_full);

  return (
    <div className="min-h-screen bg-background p-4 pb-28">
      <div className="mx-auto max-w-md space-y-4 pt-4">
        {publicBranding ? (
          <BusinessHeader branding={publicBranding} />
        ) : null}

        <div className="text-center">
          <span
            className="mb-2 inline-block h-3 w-3 rounded-full"
            style={{ backgroundColor: offering.color }}
          />
          <h1 className="text-xl font-bold tracking-tight">{offering.name}</h1>
          {offering.description && (
            <p className="mt-2 text-sm text-muted-foreground">{offering.description}</p>
          )}
          {offering.detailed_description && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{offering.detailed_description}</p>
          )}
          <DualCurrencyAmount
            amount={offering.base_price}
            currency={currency}
            primaryClassName="text-sm font-medium"
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
          <>
            {dates.length > 1 && (
              <div className="space-y-2">
                <Label htmlFor="offer-date">Pick a day</Label>
                <DatePicker
                  id="offer-date"
                  value={selectedDate ?? dates[0]}
                  availableDates={dates}
                  onChange={handleDateChange}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>Pick a time *</Label>
              {daySlots.length === 0 ? (
                <p className="text-sm text-muted-foreground">No times on this day.</p>
              ) : openSlots.length === 0 ? (
                <p className="text-sm text-muted-foreground">All times are full on this day.</p>
              ) : (
                <div className="grid gap-2">
                  {daySlots.map((slot) => (
                    <button
                      key={slot.id}
                      type="button"
                      disabled={slot.is_full}
                      className={cn(
                        "flex items-center justify-between rounded-lg border p-3 text-left text-sm transition-colors",
                        selectedSlotId === slot.id ? "border-primary bg-primary/5" : "hover:border-primary/50",
                        slot.is_full && "cursor-not-allowed opacity-50",
                      )}
                      onClick={() => {
                        if (slot.is_full) return;
                        setSelectedSlotId(slot.id);
                        setSelectedAddons([]);
                        setError(null);
                      }}
                    >
                      <div>
                        <p className="font-medium">{formatTime(slot.start_time)} – {formatTime(slot.end_time)}</p>
                        {slot.is_full
                          ? <p className="text-xs text-destructive">Full</p>
                          : <p className="text-xs text-muted-foreground">{slot.spots_left} spot{slot.spots_left === 1 ? "" : "s"} left</p>}
                      </div>
                      <DualCurrencyAmount amount={offering.base_price} currency={currency} align="right" primaryClassName="font-semibold text-sm" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedSlot && addons.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Add extras</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
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
                </CardContent>
              </Card>
            )}

            {selectedSlot && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Your details</CardTitle>
                </CardHeader>
                <CardContent>
                  <form className="space-y-4" onSubmit={handleSubmit}>
                    <div className="rounded-md bg-muted/50 p-3 text-sm">
                      <p className="font-medium">{formatDateLong(selectedSlot.slot_date)}</p>
                      <p>{formatTime(selectedSlot.start_time)} – {formatTime(selectedSlot.end_time)}</p>
                      <DualCurrencyAmount amount={totalPrice} currency={currency} primaryClassName="mt-1 font-semibold" />
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
                        placeholder="Skin tone, look preferences…"
                      />
                    </div>
                    {error && <p className="text-sm text-destructive">{error}</p>}
                    <Button type="submit" className="h-12 w-full text-base" disabled={submitting}>
                      {submitting ? "Booking…" : "Book my spot"}
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
