import { useEffect, useMemo, useState } from "preact/hooks";
import { useApp } from "../context";
import { api } from "../api";
import { formatTimeShort } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from "@/components/ui/dialog";
import type { OfferingSlotBooking, OfferingSlotInstance } from "../types";

type SlotSummary = Pick<
  OfferingSlotInstance,
  "id" | "offering_id" | "offering_name" | "offering_color" | "slot_date" | "start_time" | "end_time" | "capacity" | "booked_count"
>;

function normalizeTime(value: string): string {
  return value.slice(0, 5);
}

function sameId(a: number | string | null | undefined, b: number | string | null | undefined): boolean {
  if (a == null || b == null) return false;
  return Number(a) === Number(b);
}

interface Props {
  slot: SlotSummary;
  onClose: () => void;
  onBookClient?: () => void;
  /** Current appointment when opened from booking detail — always shown even if roster fetch lags. */
  seedBooking?: OfferingSlotBooking;
  preselectAppointmentIds?: number[];
}

export function ManageEventSlot({
  slot,
  onClose,
  onBookClient,
  seedBooking,
  preselectAppointmentIds,
}: Props) {
  const {
    fetchOfferingSlotBookings, moveOfferingSlotBookings, setError, navigate,
  } = useApp();

  const preselectKey = (preselectAppointmentIds ?? []).join(",");

  const [bookings, setBookings] = useState<OfferingSlotBooking[]>(seedBooking ? [seedBooking] : []);
  const [selectedIds, setSelectedIds] = useState<number[]>(
    preselectAppointmentIds?.length ? [...preselectAppointmentIds] : seedBooking ? [seedBooking.id] : [],
  );
  const [destinationSlots, setDestinationSlots] = useState<SlotSummary[]>([]);
  const [slotMeta, setSlotMeta] = useState({
    capacity: slot.capacity,
    booked_count: slot.booked_count,
    start_time: slot.start_time,
    end_time: slot.end_time,
  });
  const [targetSlotId, setTargetSlotId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);

      let daySlots: OfferingSlotInstance[] = [];
      try {
        const slotsData = await api<{ slots: OfferingSlotInstance[] }>(
          "GET",
          `/api/offerings/calendar?start=${slot.slot_date}&end=${slot.slot_date}`,
        );
        daySlots = slotsData.slots;
      } catch (err) {
        if (!cancelled) {
          const message = (err as Error).message;
          setLoadError(message);
          setError(message);
        }
        if (!cancelled) setLoading(false);
        return;
      }
      if (cancelled) return;

      const matched = daySlots.find((s) => (
        sameId(s.offering_id, slot.offering_id)
        && s.slot_date === slot.slot_date
        && normalizeTime(s.start_time) === normalizeTime(slot.start_time)
      )) ?? daySlots.find((s) => sameId(s.id, slot.id));

      const activeSlotId = matched ? Number(matched.id) : Number(slot.id);

      if (matched) {
        setSlotMeta({
          capacity: matched.capacity,
          booked_count: matched.booked_count,
          start_time: matched.start_time,
          end_time: matched.end_time,
        });
      }

      setDestinationSlots(
        daySlots
          .filter((s) => sameId(s.offering_id, slot.offering_id) && !sameId(s.id, activeSlotId))
          .sort((a, b) => a.start_time.localeCompare(b.start_time)),
      );

      try {
        const bookingData = await fetchOfferingSlotBookings(activeSlotId);
        if (cancelled) return;
        const roster = [...bookingData.bookings];
        if (seedBooking && !roster.some((b) => sameId(b.id, seedBooking.id))) {
          roster.unshift(seedBooking);
        }
        setBookings(roster);
        setSlotMeta({
          capacity: bookingData.slot.capacity,
          booked_count: bookingData.slot.booked_count,
          start_time: bookingData.slot.start_time,
          end_time: bookingData.slot.end_time,
        });
        const preselect = (preselectAppointmentIds ?? [])
          .map(Number)
          .filter((id) => roster.some((b) => sameId(b.id, id)));
        setSelectedIds(
          preselect.length > 0
            ? preselect
            : roster.map((b) => Number(b.id)),
        );
      } catch (err) {
        if (cancelled) return;
        const message = (err as Error).message;
        setLoadError(message);
        setError(message);
        if (seedBooking) {
          setBookings([seedBooking]);
          setSelectedIds([seedBooking.id]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [
    slot.id,
    slot.slot_date,
    slot.offering_id,
    slot.start_time,
    fetchOfferingSlotBookings,
    preselectKey,
    seedBooking?.id,
    setError,
  ]);

  const selectedTarget = useMemo(
    () => destinationSlots.find((s) => String(s.id) === targetSlotId) ?? null,
    [destinationSlots, targetSlotId],
  );
  const spotsLeftAtTarget = selectedTarget
    ? selectedTarget.capacity - selectedTarget.booked_count
    : 0;
  const canMove = selectedIds.length > 0
    && selectedTarget
    && selectedIds.length <= spotsLeftAtTarget
    && !moving;

  const spotsLeftHere = Math.max(0, slotMeta.capacity - bookings.length);

  const toggleId = (id: number) => {
    setSelectedIds((prev) => (
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    ));
  };

  const handleMove = async () => {
    if (!selectedTarget || selectedIds.length === 0) return;
    setMoving(true);
    setLoadError(null);
    setError(null);
    try {
      await moveOfferingSlotBookings(Number(selectedTarget.id), selectedIds.map(Number));
      onClose();
    } catch (err) {
      const message = (err as Error).message;
      setLoadError(message);
      setError(message);
    } finally {
      setMoving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open: boolean) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Event time · {formatTimeShort(slotMeta.start_time || slot.start_time)}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-1 pb-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{slot.offering_name}</p>
            <p>
              {slot.slot_date} · {formatTimeShort(slotMeta.start_time || slot.start_time)}
              {" – "}
              {formatTimeShort(slotMeta.end_time || slot.end_time)}
            </p>
            <p>
              {bookings.length}
              {slotMeta.capacity > 0 ? `/${slotMeta.capacity}` : ""}
              {" booked"}
            </p>
          </div>

          {loadError && (
            <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {loadError}
            </p>
          )}

          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading clients…</p>
          ) : bookings.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No clients booked at this time yet.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Clients at this time</p>
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => setSelectedIds(
                    selectedIds.length === bookings.length ? [] : bookings.map((b) => Number(b.id)),
                  )}
                >
                  {selectedIds.length === bookings.length ? "Clear" : "Select all"}
                </button>
              </div>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                {bookings.map((booking) => {
                  const bookingId = Number(booking.id);
                  const checked = selectedIds.some((id) => sameId(id, bookingId));
                  return (
                    <label
                      key={bookingId}
                      className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60"
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={checked}
                        onChange={() => toggleId(bookingId)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{booking.client_name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {booking.identifier}
                          {booking.client_phone ? ` · ${booking.client_phone}` : ""}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="shrink-0 text-xs text-primary hover:underline"
                        onClick={(e) => {
                          e.preventDefault();
                          onClose();
                          navigate(`/appointments/${bookingId}`);
                        }}
                      >
                        Open
                      </button>
                    </label>
                  );
                })}
              </div>

              <div className="space-y-2 border-t pt-3">
                <p className="text-sm font-medium">Move selected to</p>
                {destinationSlots.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No other times available for this event on this day.</p>
                ) : (
                  <>
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={targetSlotId}
                      onChange={(e: Event) => setTargetSlotId((e.target as HTMLSelectElement).value)}
                    >
                      <option value="">Pick a time…</option>
                      {destinationSlots.map((dest) => {
                        const open = dest.capacity - dest.booked_count;
                        return (
                          <option key={dest.id} value={dest.id} disabled={open <= 0}>
                            {formatTimeShort(dest.start_time)} · {open} open
                          </option>
                        );
                      })}
                    </select>
                    {selectedTarget && selectedIds.length > spotsLeftAtTarget && (
                      <p className="text-xs text-destructive">
                        Only {spotsLeftAtTarget} open spot{spotsLeftAtTarget === 1 ? "" : "s"} at that time.
                        Deselect {selectedIds.length - spotsLeftAtTarget} client
                        {selectedIds.length - spotsLeftAtTarget === 1 ? "" : "s"}.
                      </p>
                    )}
                    <Button className="w-full" disabled={!canMove} onClick={handleMove}>
                      {moving
                        ? "Moving…"
                        : `Move ${selectedIds.length || ""} client${selectedIds.length === 1 ? "" : "s"}`}
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
          {!loading && bookings.length > 0 && destinationSlots.length === 0 && (
            <p className="pt-2 text-xs text-muted-foreground">
              No other open times on this day for this event.
            </p>
          )}
        </DialogBody>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" className="w-full sm:w-auto" onClick={onClose}>Close</Button>
          {onBookClient && spotsLeftHere > 0 && (
            <Button className="w-full sm:w-auto" onClick={onBookClient}>
              Book a client
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
