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

interface Props {
  slot: SlotSummary;
  onClose: () => void;
  onBookClient?: () => void;
  preselectAppointmentIds?: number[];
}

export function ManageEventSlot({ slot, onClose, onBookClient, preselectAppointmentIds }: Props) {
  const {
    fetchOfferingSlotBookings, moveOfferingSlotBookings, setError, navigate,
  } = useApp();

  const [bookings, setBookings] = useState<OfferingSlotBooking[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [destinationSlots, setDestinationSlots] = useState<SlotSummary[]>([]);
  const [slotMeta, setSlotMeta] = useState({ capacity: slot.capacity, booked_count: slot.booked_count });
  const [targetSlotId, setTargetSlotId] = useState("");
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [bookingData, slotsData] = await Promise.all([
          fetchOfferingSlotBookings(slot.id),
          api<{ slots: OfferingSlotInstance[] }>(
            "GET",
            `/api/offerings/slots?start=${slot.slot_date}&end=${slot.slot_date}`,
          ),
        ]);
        if (cancelled) return;
        setBookings(bookingData.bookings);
        setSlotMeta({
          capacity: bookingData.slot.capacity,
          booked_count: bookingData.slot.booked_count,
        });
        const preselect = preselectAppointmentIds?.filter((id) =>
          bookingData.bookings.some((b) => b.id === id),
        );
        setSelectedIds(
          preselect && preselect.length > 0
            ? preselect
            : bookingData.bookings.map((b) => b.id),
        );
        setDestinationSlots(
          slotsData.slots
            .filter((s) => s.offering_id === slot.offering_id && s.id !== slot.id)
            .sort((a, b) => a.start_time.localeCompare(b.start_time)),
        );
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [slot.id, slot.slot_date, slot.offering_id, fetchOfferingSlotBookings, preselectAppointmentIds, setError]);

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
    setError(null);
    try {
      await moveOfferingSlotBookings(selectedTarget.id, selectedIds);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setMoving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open: boolean) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Event time · {formatTimeShort(slot.start_time)}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-1 pb-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{slot.offering_name}</p>
            <p>{slot.slot_date} · {formatTimeShort(slot.start_time)} – {formatTimeShort(slot.end_time)}</p>
            <p>{bookings.length}{slotMeta.capacity > 0 ? `/${slotMeta.capacity}` : ""} booked</p>
          </div>

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
                    selectedIds.length === bookings.length ? [] : bookings.map((b) => b.id),
                  )}
                >
                  {selectedIds.length === bookings.length ? "Clear" : "Select all"}
                </button>
              </div>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                {bookings.map((booking) => {
                  const checked = selectedIds.includes(booking.id);
                  return (
                    <label
                      key={booking.id}
                      className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60"
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={checked}
                        onChange={() => toggleId(booking.id)}
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
                          navigate(`/appointments/${booking.id}`);
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
