import { useState, useMemo } from "preact/hooks";
import { useApp } from "../context";
import { formatTimeShort } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMoney } from "../../shared/currency";
import type { OfferingSlotInstance } from "../types";

interface BookOfferingSlotProps {
  slot: OfferingSlotInstance;
  onClose: () => void;
}

export function BookOfferingSlot({ slot, onClose }: BookOfferingSlotProps) {
  const {
    clientLookup, staffLookup, bookOfferingSlot, setError,
  } = useApp();

  const slotCurrency = slot.currency;

  const [clientId, setClientId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedAddons, setSelectedAddons] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const spotsLeft = slot.capacity - slot.booked_count;
  const isFull = spotsLeft <= 0;

  const totalPrice = useMemo(() => {
    let total = slot.base_price;
    for (const id of selectedAddons) {
      const addon = slot.addons.find((a) => a.id === id);
      if (addon) total += addon.price;
    }
    return total;
  }, [slot, selectedAddons]);

  const toggleAddon = (id: number) => {
    setSelectedAddons((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (!clientId) {
      setError("Select a client");
      return;
    }
    setSubmitting(true);
    try {
      await bookOfferingSlot(slot.id, {
        client_id: parseInt(clientId, 10),
        staff_id: staffId ? parseInt(staffId, 10) : null,
        addon_ids: selectedAddons,
        notes: notes.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Book a client</DialogTitle>
        </DialogHeader>
        <div className="space-y-1 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{slot.offering_name}</p>
          <p>{slot.slot_date} · {formatTimeShort(slot.start_time)} – {formatTimeShort(slot.end_time)}</p>
          <p>{spotsLeft} spot{spotsLeft === 1 ? "" : "s"} left</p>
        </div>

        {isFull ? (
          <p className="text-destructive">This time is full.</p>
        ) : (
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <Label>Client *</Label>
              <select
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={clientId}
                onChange={(e) => setClientId((e.target as HTMLSelectElement).value)}
                required
              >
                <option value="">Select client…</option>
                {clientLookup.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Staff (optional)</Label>
              <select
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={staffId}
                onChange={(e) => setStaffId((e.target as HTMLSelectElement).value)}
              >
                <option value="">Auto / unassigned</option>
                {staffLookup.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            {slot.addons.length > 0 && (
              <div className="space-y-2">
                <Label>Add-ons</Label>
                {slot.addons.map((addon) => (
                  <label key={addon.id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedAddons.includes(addon.id!)}
                      onChange={() => toggleAddon(addon.id!)}
                    />
                    <span>{addon.name}</span>
                    <span className="text-muted-foreground">+{formatMoney(addon.price, slotCurrency)}</span>
                  </label>
                ))}
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={notes} onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)} />
            </div>
            <p className="text-sm font-semibold">Total: {formatMoney(totalPrice, slotCurrency)}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" className="h-12 w-full text-base" disabled={submitting}>
                {submitting ? "Booking…" : "Book them in"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
