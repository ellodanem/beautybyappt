import type { ComponentChildren } from "preact";
import { Check, Globe } from "lucide-preact";
import { cn } from "@/lib/utils";
import {
  formatTimeShort,
  groupByTimeOfDay,
  TIME_OF_DAY_LABELS,
  timezoneDisplayLabel,
} from "@/lib/public-booking-utils";

interface TimeSlot {
  key: string;
  start_time: string;
  end_time: string;
  disabled?: boolean;
  meta?: ComponentChildren;
}

interface PublicTimeSlotPickerProps {
  timezone?: string;
  loading?: boolean;
  emptyMessage?: string;
  slots: TimeSlot[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

function SlotSkeletons() {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-11 animate-pulse rounded-full bg-muted" />
      ))}
    </div>
  );
}

export function PublicTimeSlotPicker({
  timezone,
  loading,
  emptyMessage = "No open times on this day.",
  slots,
  selectedKey,
  onSelect,
}: PublicTimeSlotPickerProps) {
  const grouped = groupByTimeOfDay(slots);

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Choose Time</h2>
          {timezone && (
            <p className="mt-0.5 text-xs text-muted-foreground">Times shown in business timezone</p>
          )}
        </div>
        {timezone && (
          <div className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground">
            <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{timezoneDisplayLabel(timezone)}</span>
          </div>
        )}
      </div>

      <div className="mt-4">
        {loading ? (
          <SlotSkeletons />
        ) : slots.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </p>
        ) : (
          <div className="space-y-5">
            {grouped.map(({ period, items }) => (
              <div key={period}>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {TIME_OF_DAY_LABELS[period]}
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {items.map((slot) => {
                    const selected = selectedKey === slot.key;
                    return (
                      <button
                        key={slot.key}
                        type="button"
                        disabled={slot.disabled}
                        className={cn(
                          "relative flex min-h-11 items-center justify-center rounded-full border px-3 py-2 text-sm font-medium transition-all",
                          selected
                            ? "border-primary bg-primary text-primary-foreground shadow-sm"
                            : "border-border bg-background hover:border-primary/50 hover:bg-primary/5",
                          slot.disabled && "cursor-not-allowed opacity-50",
                        )}
                        onClick={() => {
                          if (slot.disabled) return;
                          onSelect(slot.key);
                        }}
                      >
                        {selected && (
                          <Check className="absolute left-2.5 h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        <span className={cn(selected && "pl-4")}>{formatTimeShort(slot.start_time)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
