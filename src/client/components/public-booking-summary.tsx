import type { ComponentChildren } from "preact";
import { Calculator, Calendar, ClipboardList } from "lucide-preact";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDateShort, formatDurationMinutes, formatTimeRange } from "@/lib/public-booking-utils";

export interface PublicBookingSummaryAction {
  label: string;
  loadingLabel?: string;
  disabled?: boolean;
  loading?: boolean;
  formId?: string;
  onClick?: () => void;
}

interface PublicBookingSummaryProps {
  serviceName: string;
  serviceDescription?: string;
  durationMinutes?: number;
  serviceColor?: string;
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  price: ComponentChildren;
  action?: PublicBookingSummaryAction;
  className?: string;
}

function SummaryRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof ClipboardList;
  label: string;
  children: ComponentChildren;
}) {
  return (
    <div className="flex gap-3 py-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <div className="mt-1 text-sm text-foreground">{children}</div>
      </div>
    </div>
  );
}

export function PublicBookingSummary({
  serviceName,
  serviceDescription,
  durationMinutes,
  serviceColor,
  date,
  startTime,
  endTime,
  price,
  action,
  className,
}: PublicBookingSummaryProps) {
  const hasTime = Boolean(startTime && endTime);

  return (
    <aside className={cn("lg:sticky lg:top-6", className)}>
      <div className="rounded-xl border bg-card p-5 shadow-md">
        <SummaryRow icon={ClipboardList} label="Service">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-2">
              {serviceColor && (
                <span
                  className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: serviceColor }}
                />
              )}
              <p className="font-medium leading-snug">{serviceName}</p>
            </div>
            {durationMinutes != null && (
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {formatDurationMinutes(durationMinutes)}
              </span>
            )}
          </div>
          {serviceDescription?.trim() && (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{serviceDescription}</p>
          )}
        </SummaryRow>

        <div className="border-t" />

        <SummaryRow icon={Calendar} label="Date & Time">
          {date ? (
            <div className="space-y-0.5">
              <p>{formatDateShort(date)}</p>
              {hasTime && (
                <p className="text-muted-foreground">{formatTimeRange(startTime!, endTime!)}</p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">Pick a date</p>
          )}
        </SummaryRow>

        <div className="border-t" />

        <SummaryRow icon={Calculator} label="Total Price">
          <div className="text-xl font-bold text-primary">{price}</div>
        </SummaryRow>

        {action && (
          <Button
            type={action.formId ? "submit" : "button"}
            form={action.formId}
            className="mt-2 h-12 w-full text-base"
            disabled={action.disabled || action.loading}
            onClick={action.formId ? undefined : action.onClick}
          >
            {action.loading ? (action.loadingLabel ?? "Booking…") : action.label}
          </Button>
        )}
      </div>
    </aside>
  );
}
