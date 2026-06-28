import { cn } from "@/lib/utils";
import { formatMoney } from "../../shared/currency";
import { formatDurationMinutes } from "@/lib/public-booking-utils";

interface PublicServiceDetailsProps {
  name: string;
  description?: string;
  category?: string;
  duration: number;
  price: number;
  currency: string;
  color: string;
  className?: string;
}

export function PublicServiceDetails({
  name,
  description,
  category,
  duration,
  price,
  currency,
  color,
  className,
}: PublicServiceDetailsProps) {
  const hasDescription = Boolean(description?.trim());
  const hasCategory = Boolean(category?.trim());

  if (!hasDescription && !hasCategory) return null;

  return (
    <div className={cn("rounded-xl border bg-muted/30 p-4 sm:p-5", className)}>
      <div className="flex items-start gap-3">
        <span
          className="mt-1 h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <div className="min-w-0 flex-1">
          {hasCategory && (
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {category}
            </p>
          )}
          <p className={cn("font-semibold", hasCategory && "mt-0.5")}>{name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatDurationMinutes(duration)} · {formatMoney(price, currency)}
          </p>
          {hasDescription && (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
