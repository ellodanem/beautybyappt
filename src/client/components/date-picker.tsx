import { useMemo } from "preact/hooks";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function isConsecutiveRange(dates: string[]): boolean {
  if (dates.length <= 1) return true;
  const sorted = [...dates].sort();
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = new Date(sorted[i - 1] + "T12:00:00");
    prev.setDate(prev.getDate() + 1);
    if (prev.toISOString().split("T")[0] !== sorted[i]) return false;
  }
  return true;
}

function formatDateOption(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const mobileFieldClass =
  "flex h-12 w-full rounded-md border border-input bg-background px-3 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

interface DatePickerProps {
  id?: string;
  value: string;
  onChange: (date: string) => void;
  availableDates: string[];
  disabled?: boolean;
  className?: string;
}

/** Native date picker — uses OS calendar on mobile, dropdown for sparse date lists. */
export function DatePicker({
  id,
  value,
  onChange,
  availableDates,
  disabled,
  className,
}: DatePickerProps) {
  const sorted = useMemo(
    () => [...new Set(availableDates)].sort(),
    [availableDates],
  );

  if (sorted.length === 0) return null;

  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const useNativeDate = isConsecutiveRange(sorted);

  if (useNativeDate) {
    return (
      <Input
        id={id}
        type="date"
        className={cn("h-12 text-base", className)}
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onInput={(e) => onChange((e.target as HTMLInputElement).value)}
      />
    );
  }

  return (
    <select
      id={id}
      className={cn(mobileFieldClass, className)}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
    >
      {sorted.map((date) => (
        <option key={date} value={date}>
          {formatDateOption(date)}
        </option>
      ))}
    </select>
  );
}
