import { useState, useEffect, useMemo } from "preact/hooks";
import { Plus } from "lucide-preact";
import { useApp } from "../context";
import { api } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn, formatTimeShort } from "@/lib/utils";
import { formatMoney } from "../../shared/currency";
import { CreateClient } from "./create-client";
import type { OfferingSlotInstance, EventDayInfo } from "../types";

interface Props {
  onClose: () => void;
  defaultDate?: string;
}

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

export function CreateAppointment({ onClose, defaultDate }: Props) {
  const {
    addAppointment, clientLookup, staffLookup, services, setError,
    bookOfferingSlot, defaultCurrency, offerings, navigate,
  } = useApp();

  const [clientId, setClientId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState(defaultDate || new Date().toISOString().split("T")[0]);
  const [startTime, setStartTime] = useState("09:00");
  const [selectedServices, setSelectedServices] = useState<number[]>([]);
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

  const eventMode = daySlots.length > 0;
  const selectedSlot = daySlots.find((s) => s.id === selectedSlotId) ?? null;
  const eventCurrency = selectedSlot?.currency ?? daySlots[0]?.currency ?? defaultCurrency;
  const regularBlocked = eventDay.block_regular_bookings && eventDay.is_event_day;
  const draftEventsOnDate = offerings.filter(
    (o) => o.status === "draft" && offeringCoversDate(o.date_summary, date),
  );
  const showDraftWarning = !eventMode && draftEventsOnDate.length > 0;

  const toggleService = (id: number) => {
    setSelectedServices((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

  const toggleAddon = (id: number) => {
    setSelectedAddons((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  };

  const serviceSubtotal = services
    .filter((s) => selectedServices.includes(s.id))
    .reduce((sum, s) => sum + s.price, 0);

  const parsedTravelFee = addTravelFee && travelFeeAmount !== "" ? parseFloat(travelFeeAmount) || 0 : 0;
  const totalPrice = serviceSubtotal + parsedTravelFee;

  const totalDuration = services
    .filter((s) => selectedServices.includes(s.id))
    .reduce((sum, s) => sum + s.duration, 0);

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
      await addAppointment({
        client_id: parseInt(clientId),
        staff_id: staffId ? parseInt(staffId) : null,
        scheduled_date: date,
        start_time: startTime,
        notes,
        service_ids: selectedServices,
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
  const canSubmitRegular = !regularBlocked && !showDraftWarning && !eventMode;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{eventMode ? "Book event client" : "New Booking"}</DialogTitle>
        </DialogHeader>

        {loadingDay ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading availability…</p>
        ) : (
          <div className="space-y-4">
            {eventMode && (
              <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                <span
                  className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                  style={{ backgroundColor: daySlots[0]?.offering_color }}
                />
                <strong>{eventName}</strong>
                <span className="text-muted-foreground"> — pick a time slot below</span>
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

            {regularBlocked && !eventMode && !showDraftWarning && (
              <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
                Regular services aren&apos;t available on this date
                {eventDay.event_names.length > 0 && <> ({eventDay.event_names.join(", ")})</>}.
              </p>
            )}

            {(eventMode || canSubmitRegular) && (
              <>
                <div className="grid grid-cols-2 gap-3">
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

            {eventMode && (
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

            {canSubmitRegular && (
              <>
                <div className="space-y-1.5">
                  <Label>Start Time</Label>
                  <Input type="time" value={startTime} onChange={(e) => setStartTime((e.target as HTMLInputElement).value)} />
                </div>

                <div className="space-y-1.5">
                  <Label>Everyday services</Label>
                  <div className="flex flex-wrap gap-2">
                    {services.filter((s) => s.active).map((svc) => (
                      <button
                        key={svc.id}
                        type="button"
                        className={cn(
                          "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                          selectedServices.includes(svc.id)
                            ? "border-primary bg-primary/5 text-primary"
                            : "border-border bg-background text-muted-foreground hover:border-primary/50",
                        )}
                        onClick={() => toggleService(svc.id)}
                      >
                        <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: svc.color }} />
                        {svc.name}
                        <span className="text-[10px] opacity-70">{svc.duration}m &middot; {formatMoney(svc.price, defaultCurrency)}</span>
                      </button>
                    ))}
                  </div>
                  {selectedServices.length > 0 && (
                    <p className="text-xs font-medium text-primary">
                      Total: {totalDuration} min
                      {parsedTravelFee > 0 ? (
                        <> · {formatMoney(serviceSubtotal, defaultCurrency)} + {formatMoney(parsedTravelFee, defaultCurrency)} travel = {formatMoney(totalPrice, defaultCurrency)}</>
                      ) : (
                        <> · {formatMoney(totalPrice, defaultCurrency)}</>
                      )}
                    </p>
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

            {(eventMode || canSubmitRegular) && (
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea rows={3} placeholder="Special requests, preferences..." value={notes} onChange={(e) => setNotes((e.target as HTMLTextAreaElement).value)} />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {eventMode && !loadingDay && (
            <Button disabled={saving || !selectedSlotId} onClick={handleEventSubmit}>
              {saving ? "Booking..." : "Book event client"}
            </Button>
          )}
          {canSubmitRegular && !loadingDay && (
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
