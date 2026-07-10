import { useState, useEffect, useMemo } from "preact/hooks";
import { Plus, X } from "lucide-preact";
import { useApp } from "../context";
import { api } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { cn, formatTimeShort } from "@/lib/utils";
import { formatMoney } from "../../shared/currency";
import { CreateClient } from "./create-client";
import type { OfferingSlotInstance, EventDayInfo, AppointmentServiceLineInput } from "../types";

interface Props {
  onClose: () => void;
  defaultDate?: string;
}

type CatalogLine = {
  key: string;
  kind: "catalog";
  serviceId: number;
  price: number;
};

type CustomLine = {
  key: string;
  kind: "custom";
  name: string;
  duration: number;
  price: number;
};

type BookingLine = CatalogLine | CustomLine;

function offeringCoversDate(dateSummary: string, date: string): boolean {
  if (!dateSummary) return false;
  for (const part of dateSummary.split(", ")) {
    const trimmed = part.trim();
    if (trimmed.includes("–")) {
      const [start, end] = trimmed.split("–");
      if (date >= start.trim() && date <= end.trim()) return true;
    } else if (trimmed === date) {
      return true;
    }
  }
  return false;
}

let customLineSeq = 0;

export function CreateAppointment({ onClose, defaultDate }: Props) {
  const {
    addAppointment, clientLookup, staffLookup, services, setError,
    bookOfferingSlot, defaultCurrency, offerings, navigate,
  } = useApp();

  const [clientId, setClientId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState(defaultDate || new Date().toISOString().split("T")[0]);
  const [startTime, setStartTime] = useState("09:00");
  const [bookingLines, setBookingLines] = useState<BookingLine[]>([]);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customDuration, setCustomDuration] = useState("60");
  const [customPrice, setCustomPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [addTravelFee, setAddTravelFee] = useState(false);
  const [travelFeeAmount, setTravelFeeAmount] = useState("");
  const [serviceAddress, setServiceAddress] = useState("");
  const [saving, setSaving] = useState(false);

  const [daySlots, setDaySlots] = useState<OfferingSlotInstance[]>([]);
  const [eventDay, setEventDay] = useState<EventDayInfo>({
    is_event_day: false,
    block_regular_bookings: false,
    event_names: [],
  });
  const [loadingDay, setLoadingDay] = useState(true);
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [selectedAddons, setSelectedAddons] = useState<number[]>([]);
  const [showCreateClient, setShowCreateClient] = useState(false);
  const [bookingMode, setBookingMode] = useState<"event" | "regular">("regular");

  useEffect(() => {
    let cancelled = false;
    setLoadingDay(true);
    setSelectedSlotId(null);
    setSelectedAddons([]);

    (async () => {
      try {
        const [calData, slotsData] = await Promise.all([
          api<{ event_day: EventDayInfo }>("GET", `/api/calendar?start=${date}&end=${date}`),
          api<{ slots: OfferingSlotInstance[] }>("GET", `/api/offerings/calendar?start=${date}&end=${date}`),
        ]);
        if (cancelled) return;
        setEventDay(calData.event_day ?? {
          is_event_day: false,
          block_regular_bookings: false,
          event_names: [],
        });
        setDaySlots(slotsData.slots);
      } catch {
        if (!cancelled) {
          setDaySlots([]);
          setEventDay({ is_event_day: false, block_regular_bookings: false, event_names: [] });
        }
      } finally {
        if (!cancelled) setLoadingDay(false);
      }
    })();

    return () => { cancelled = true; };
  }, [date]);

  const hasEventSlots = daySlots.length > 0;
  const selectedSlot = daySlots.find((s) => s.id === selectedSlotId) ?? null;
  const eventCurrency = selectedSlot?.currency ?? daySlots[0]?.currency ?? defaultCurrency;
  const regularBlocked = eventDay.block_regular_bookings && eventDay.is_event_day;
  const draftEventsOnDate = offerings.filter(
    (o) => o.status === "draft" && offeringCoversDate(o.date_summary, date),
  );
  const showDraftWarning = !hasEventSlots && draftEventsOnDate.length > 0;
  const canSubmitEvent = hasEventSlots;
  const canSubmitRegular = !regularBlocked && !showDraftWarning;
  const eventOnlyMode = hasEventSlots && regularBlocked;
  const dualBookingMode = canSubmitEvent && canSubmitRegular;
  const showEventSection = canSubmitEvent && (!dualBookingMode || bookingMode === "event");
  const showRegularSection = canSubmitRegular && (!dualBookingMode || bookingMode === "regular");

  useEffect(() => {
    if (canSubmitEvent && !canSubmitRegular) {
      setBookingMode("event");
    } else if (canSubmitRegular && !canSubmitEvent) {
      setBookingMode("regular");
    }
  }, [date, canSubmitEvent, canSubmitRegular]);

  const selectedServiceIds = useMemo(
    () => new Set(
      bookingLines
        .filter((line): line is CatalogLine => line.kind === "catalog")
        .map((line) => line.serviceId),
    ),
    [bookingLines],
  );

  const toggleService = (id: number) => {
    setBookingLines((prev) => {
      if (prev.some((line) => line.kind === "catalog" && line.serviceId === id)) {
        return prev.filter((line) => !(line.kind === "catalog" && line.serviceId === id));
      }
      const svc = services.find((s) => s.id === id);
      if (!svc) return prev;
      return [...prev, {
        key: `catalog-${id}`,
        kind: "catalog" as const,
        serviceId: id,
        price: svc.price,
      }];
    });
  };

  const setCatalogPrice = (serviceId: number, priceText: string) => {
    const parsed = parseFloat(priceText);
    setBookingLines((prev) => prev.map((line) => {
      if (line.kind !== "catalog" || line.serviceId !== serviceId) return line;
      return { ...line, price: Number.isFinite(parsed) ? Math.max(0, parsed) : 0 };
    }));
  };

  const resetCatalogPrice = (serviceId: number) => {
    const svc = services.find((s) => s.id === serviceId);
    if (!svc) return;
    setCatalogPrice(serviceId, String(svc.price));
  };

  const removeLine = (key: string) => {
    setBookingLines((prev) => prev.filter((line) => line.key !== key));
  };

  const addCustomService = () => {
    const name = customName.trim();
    const duration = parseInt(customDuration, 10);
    const price = parseFloat(customPrice);
    if (!name) { setError("Enter a name for the one-time service"); return; }
    if (!Number.isFinite(duration) || duration <= 0) { setError("Enter a valid duration"); return; }
    if (!Number.isFinite(price) || price < 0) { setError("Enter a valid price"); return; }
    customLineSeq += 1;
    setBookingLines((prev) => [...prev, {
      key: `custom-${customLineSeq}`,
      kind: "custom" as const,
      name,
      duration,
      price,
    }]);
    setCustomName("");
    setCustomDuration("60");
    setCustomPrice("");
    setShowCustomForm(false);
  };

  const toggleAddon = (id: number) => {
    setSelectedAddons((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  };

  const serviceSubtotal = bookingLines.reduce((sum, line) => sum + line.price, 0);
  const parsedTravelFee = addTravelFee && travelFeeAmount !== "" ? parseFloat(travelFeeAmount) || 0 : 0;
  const totalPrice = serviceSubtotal + parsedTravelFee;
  const totalDuration = bookingLines.reduce((sum, line) => {
    if (line.kind === "custom") return sum + line.duration;
    const svc = services.find((s) => s.id === line.serviceId);
    return sum + (svc?.duration ?? 0);
  }, 0);
  const hasCustomPrice = bookingLines.some((line) => {
    if (line.kind !== "catalog") return false;
    const svc = services.find((s) => s.id === line.serviceId);
    return svc != null && line.price !== svc.price;
  });

  const eventTotalPrice = useMemo(() => {
    if (!selectedSlot) return 0;
    let total = selectedSlot.base_price;
    for (const id of selectedAddons) {
      const addon = selectedSlot.addons.find((a) => a.id === id);
      if (addon) total += addon.price;
    }
    return total;
  }, [selectedSlot, selectedAddons]);

  const handleRegularSubmit = async () => {
    if (!clientId) { setError("Please select a client"); return; }
    setSaving(true);
    try {
      const servicesPayload: AppointmentServiceLineInput[] = bookingLines.map((line) => {
        if (line.kind === "catalog") {
          return { service_id: line.serviceId, price: line.price };
        }
        return { name: line.name, price: line.price, duration: line.duration };
      });
      await addAppointment({
        client_id: parseInt(clientId),
        staff_id: staffId ? parseInt(staffId) : null,
        scheduled_date: date,
        start_time: startTime,
        notes,
        services: servicesPayload,
        travel_fee: parsedTravelFee > 0 ? parsedTravelFee : undefined,
        service_address: serviceAddress.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleEventSubmit = async () => {
    if (!clientId) { setError("Please select a client"); return; }
    if (!selectedSlotId) { setError("Pick an event time slot"); return; }
    setSaving(true);
    try {
      await bookOfferingSlot(selectedSlotId, {
        client_id: parseInt(clientId, 10),
        staff_id: staffId ? parseInt(staffId, 10) : null,
        addon_ids: selectedAddons,
        notes: notes.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const eventName = daySlots[0]?.offering_name ?? eventDay.event_names[0] ?? "Special event";
  const showForm = canSubmitEvent || canSubmitRegular;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader className="space-y-3">
          <DialogTitle>{eventOnlyMode ? "Book event client" : "New Booking"}</DialogTitle>
          {dualBookingMode && !loadingDay && (
            <div className="flex rounded-lg border bg-muted/40 p-1" role="tablist" aria-label="Booking type">
              <button
                type="button"
                role="tab"
                aria-selected={bookingMode === "event"}
                className={cn(
                  "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  bookingMode === "event"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground",
                )}
                onClick={() => setBookingMode("event")}
              >
                Event client
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={bookingMode === "regular"}
                className={cn(
                  "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  bookingMode === "regular"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground",
                )}
                onClick={() => setBookingMode("regular")}
              >
                Everyday booking
              </button>
            </div>
          )}
        </DialogHeader>

        <DialogBody>
        {loadingDay ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading availability…</p>
        ) : (
          <div className="space-y-4 pb-4">
            {hasEventSlots && (
              <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                <span
                  className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                  style={{ backgroundColor: daySlots[0]?.offering_color }}
                />
                <strong>{eventName}</strong>
                <span className="text-muted-foreground">
                  {dualBookingMode
                    ? bookingMode === "event"
                      ? " — pick a time slot below"
                      : " — book an everyday service below"
                    : canSubmitRegular
                      ? " — book an event slot below, or an everyday service further down"
                      : " — pick a time slot below"}
                </span>
              </div>
            )}

            {showDraftWarning && (
              <div className="rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                <strong>{draftEventsOnDate.map((o) => o.name).join(", ")}</strong> is scheduled for this date but isn&apos;t live yet.
                {" "}Save &amp; go live in Services to book event clients.
                <Button
                  variant="link"
                  className="h-auto p-0 pl-1 text-amber-900 underline dark:text-amber-100"
                  onClick={() => { onClose(); navigate("/offers"); }}
                >
                  Go to Services
                </Button>
              </div>
            )}

            {regularBlocked && !hasEventSlots && !showDraftWarning && (
              <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                Regular services aren&apos;t available on this date
                {eventDay.event_names.length > 0 && <> ({eventDay.event_names.join(", ")})</>}.
              </p>
            )}

            {showForm && (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Client *</Label>
                    <div className="flex gap-1.5">
                      <select
                        className="flex h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={clientId}
                        onChange={(e) => setClientId((e.target as HTMLSelectElement).value)}
                      >
                        <option value="">Select client...</option>
                        {clientLookup.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 shrink-0"
                        title="Add new client"
                        onClick={() => setShowCreateClient(true)}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Staff</Label>
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={staffId}
                      onChange={(e) => setStaffId((e.target as HTMLSelectElement).value)}
                    >
                      <option value="">Unassigned</option>
                      {staffLookup.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Date</Label>
                  <Input type="date" value={date} onChange={(e) => setDate((e.target as HTMLInputElement).value)} />
                </div>
              </>
            )}

            {showEventSection && (
              <div className="space-y-2">
                <Label>Event time *</Label>
                <div className="max-h-48 space-y-2 overflow-y-auto">
                  {daySlots.map((slot) => {
                    const spotsLeft = slot.capacity - slot.booked_count;
                    const isFull = spotsLeft <= 0;
                    const isSelected = selectedSlotId === slot.id;
                    return (
                      <button
                        key={slot.id}
                        type="button"
                        disabled={isFull}
                        className={cn(
                          "flex w-full items-center justify-between rounded-lg border p-3 text-left text-sm transition-colors",
                          isSelected ? "border-primary bg-primary/5" : "hover:border-primary/50",
                          isFull && "cursor-not-allowed opacity-50",
                        )}
                        onClick={() => {
                          setSelectedSlotId(slot.id);
                          setSelectedAddons([]);
                        }}
                      >
                        <div>
                          <p className="font-medium">{formatTimeShort(slot.start_time)} – {formatTimeShort(slot.end_time)}</p>
                          {isFull
                            ? <p className="text-xs text-destructive">Full</p>
                            : <p className="text-xs text-muted-foreground">{spotsLeft} spot{spotsLeft === 1 ? "" : "s"} left</p>}
                        </div>
                        <p className="font-semibold">{formatMoney(slot.base_price, slot.currency ?? defaultCurrency)}</p>
                      </button>
                    );
                  })}
                </div>

                {selectedSlot && selectedSlot.addons.length > 0 && (
                  <div className="space-y-2">
                    <Label>Add-ons</Label>
                    {selectedSlot.addons.map((addon) => (
                      <label key={addon.id} className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedAddons.includes(addon.id!)}
                          onChange={() => toggleAddon(addon.id!)}
                        />
                        <span>{addon.name}</span>
                        <span className="text-muted-foreground">+{formatMoney(addon.price, eventCurrency)}</span>
                      </label>
                    ))}
                  </div>
                )}

                {selectedSlot && (
                  <p className="text-sm font-semibold">
                    Total: {formatMoney(eventTotalPrice, eventCurrency)}
                  </p>
                )}
              </div>
            )}

            {showRegularSection && (
              <>
                <div className="space-y-1.5">
                  <Label>Start time</Label>
                  <Input type="time" value={startTime} onChange={(e) => setStartTime((e.target as HTMLInputElement).value)} />
                </div>

                <div className="space-y-1.5">
                  <Label>Everyday services</Label>
                  <div className="flex flex-wrap gap-2.5">
                    {services.filter((s) => s.active).map((svc) => (
                      <button
                        key={svc.id}
                        type="button"
                        className={cn(
                          "flex min-h-10 items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
                          selectedServiceIds.has(svc.id)
                            ? "border-primary bg-primary/5 text-primary"
                            : "border-border bg-background text-muted-foreground hover:border-primary/50",
                        )}
                        onClick={() => toggleService(svc.id)}
                      >
                        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: svc.color }} />
                        {svc.name}
                        <span className="text-xs opacity-70">{svc.duration}m &middot; {formatMoney(svc.price, defaultCurrency)}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      className={cn(
                        "min-h-10 rounded-full border border-dashed px-3.5 py-2 text-sm font-medium transition-colors",
                        showCustomForm
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
                      )}
                      onClick={() => setShowCustomForm((open) => !open)}
                    >
                      + One-time service
                    </button>
                  </div>

                  {showCustomForm && (
                    <div className="mt-2 space-y-2 rounded-lg border border-dashed p-3">
                      <div className="flex items-center justify-between">
                        <Label>One-time service</Label>
                        <button
                          type="button"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                          onClick={() => setShowCustomForm(false)}
                          aria-label="Close one-time service form"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <Input
                        placeholder="Service name"
                        value={customName}
                        onChange={(e) => setCustomName((e.target as HTMLInputElement).value)}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Duration (min)</Label>
                          <Input
                            type="number"
                            min={1}
                            value={customDuration}
                            onChange={(e) => setCustomDuration((e.target as HTMLInputElement).value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Price</Label>
                          <Input
                            type="number"
                            step="0.01"
                            min={0}
                            placeholder="0.00"
                            value={customPrice}
                            onChange={(e) => setCustomPrice((e.target as HTMLInputElement).value)}
                          />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">Only for this booking — not added to your service list</p>
                      <Button type="button" size="sm" onClick={addCustomService}>Add to booking</Button>
                    </div>
                  )}

                  {bookingLines.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <Label>This booking</Label>
                      <div className="divide-y rounded-lg border">
                        {bookingLines.map((line) => {
                          if (line.kind === "catalog") {
                            const svc = services.find((s) => s.id === line.serviceId);
                            if (!svc) return null;
                            const overridden = line.price !== svc.price;
                            return (
                              <div key={line.key} className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
                                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: svc.color }} />
                                <span className="min-w-0 flex-1 font-medium">{svc.name}</span>
                                <span className="text-xs text-muted-foreground">{svc.duration} min</span>
                                {overridden && (
                                  <span className="text-xs text-muted-foreground line-through">
                                    {formatMoney(svc.price, defaultCurrency)}
                                  </span>
                                )}
                                <Input
                                  type="number"
                                  step="0.01"
                                  min={0}
                                  className="h-9 w-24"
                                  value={Number.isFinite(line.price) ? String(line.price) : ""}
                                  onChange={(e) => setCatalogPrice(line.serviceId, (e.target as HTMLInputElement).value)}
                                  aria-label={`Price for ${svc.name}`}
                                />
                                {overridden ? (
                                  <>
                                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                                      Custom price
                                    </span>
                                    <button
                                      type="button"
                                      className="min-h-9 px-1 text-xs text-muted-foreground underline hover:text-foreground"
                                      onClick={() => resetCatalogPrice(line.serviceId)}
                                    >
                                      Reset
                                    </button>
                                  </>
                                ) : null}
                                <button
                                  type="button"
                                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                                  onClick={() => removeLine(line.key)}
                                  aria-label={`Remove ${svc.name}`}
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            );
                          }

                          return (
                            <div key={line.key} className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
                              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-dashed border-muted-foreground" />
                              <span className="min-w-0 flex-1 font-medium">{line.name}</span>
                              <span className="text-xs text-muted-foreground">{line.duration} min</span>
                              <span className="font-medium">{formatMoney(line.price, defaultCurrency)}</span>
                              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                One-time
                              </span>
                              <button
                                type="button"
                                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                                onClick={() => removeLine(line.key)}
                                aria-label={`Remove ${line.name}`}
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-xs font-medium text-primary">
                        Total: {totalDuration} min
                        {parsedTravelFee > 0 ? (
                          <> · {formatMoney(serviceSubtotal, defaultCurrency)} + {formatMoney(parsedTravelFee, defaultCurrency)} travel = {formatMoney(totalPrice, defaultCurrency)}</>
                        ) : (
                          <> · {formatMoney(totalPrice, defaultCurrency)}</>
                        )}
                      </p>
                      {(hasCustomPrice || bookingLines.some((l) => l.kind === "custom")) && (
                        <p className="text-xs text-muted-foreground">Catalog prices unchanged</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-2 rounded-lg border p-3">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={addTravelFee}
                      onChange={(e) => setAddTravelFee((e.target as HTMLInputElement).checked)}
                    />
                    <span className="text-sm">
                      <span className="font-medium">Add travel fee</span>
                      <span className="mt-0.5 block text-muted-foreground">On-location / mobile appointment</span>
                    </span>
                  </label>
                  {addTravelFee && (
                    <>
                      <Input
                        type="number"
                        step="0.01"
                        min={0}
                        placeholder="e.g. 25"
                        value={travelFeeAmount}
                        onChange={(e) => setTravelFeeAmount((e.target as HTMLInputElement).value)}
                      />
                      <Textarea
                        rows={2}
                        placeholder="Service location (optional)"
                        value={serviceAddress}
                        onChange={(e) => setServiceAddress((e.target as HTMLTextAreaElement).value)}
                      />
                    </>
                  )}
                </div>
              </>
            )}

            {showForm && (
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea rows={3} placeholder="Special requests, preferences..." value={notes} onChange={(e) => setNotes((e.target as HTMLTextAreaElement).value)} />
              </div>
            )}
          </div>
        )}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {showEventSection && !loadingDay && (
            <Button disabled={saving || !selectedSlotId} onClick={handleEventSubmit}>
              {saving ? "Booking..." : "Book event client"}
            </Button>
          )}
          {showRegularSection && !loadingDay && (
            <Button disabled={saving} onClick={handleRegularSubmit}>
              {saving ? "Booking..." : "Create Booking"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      {showCreateClient && (
        <CreateClient
          onClose={() => setShowCreateClient(false)}
          onCreated={(client) => setClientId(String(client.id))}
        />
      )}
    </Dialog>
  );
}
