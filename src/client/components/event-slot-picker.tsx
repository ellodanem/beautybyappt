import { formatTimeShort } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMoney } from "../../shared/currency";
import type { OfferingSlotInstance } from "../types";

interface Props {
  slots: OfferingSlotInstance[];
  onClose: () => void;
  onSelectSlot: (slot: OfferingSlotInstance) => void;
}

export function EventSlotPicker({ slots, onClose, onSelectSlot }: Props) {
  const openSlots = slots.filter((s) => s.booked_count < s.capacity);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Book event client</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Pick a time slot for {slots[0]?.offering_name ?? "your event"}. This is separate from everyday services.
        </p>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {openSlots.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">All slots are full for this day.</p>
          ) : (
            openSlots.map((slot) => {
              const spotsLeft = slot.capacity - slot.booked_count;
              return (
                <button
                  key={slot.id}
                  type="button"
                  className="flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5"
                  onClick={() => onSelectSlot(slot)}
                >
                  <div>
                    <p className="font-medium">{formatTimeShort(slot.start_time)} – {formatTimeShort(slot.end_time)}</p>
                    <p className="text-xs text-muted-foreground">{slot.offering_name}</p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-semibold">{formatMoney(slot.base_price, slot.currency)}</p>
                    <p className="text-xs text-muted-foreground">{spotsLeft} spot{spotsLeft === 1 ? "" : "s"} left</p>
                  </div>
                </button>
              );
            })
          )}
        </div>
        <Button variant="outline" className="w-full" onClick={onClose}>Cancel</Button>
      </DialogContent>
    </Dialog>
  );
}
