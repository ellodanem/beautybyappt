import { cn, formatTimeShort } from "@/lib/utils";
import { needsCloseOut } from "../../shared/appointment-closeout";
import { CloseOutRowActions } from "./close-out-row-actions";
import type { Appointment, AppointmentStatus } from "../types";

interface CalendarAppointmentBlockProps {
  apt: Appointment;
  now: Date;
  top: number;
  height: number;
  borderColor: string;
  backgroundColor: string;
  column?: number;
  totalColumns?: number;
  onOpen: () => void;
  onCloseOut: (status: AppointmentStatus) => Promise<void>;
}

export function CalendarAppointmentBlock({
  apt,
  now,
  top,
  height,
  borderColor,
  backgroundColor,
  column = 0,
  totalColumns = 1,
  onOpen,
  onCloseOut,
}: CalendarAppointmentBlockProps) {
  const showCloseOut = needsCloseOut(apt, now);
  const services = apt.appointment_services?.map((s) => s.service_name).filter(Boolean).join(", ");
  const blockHeight = Math.max(height, showCloseOut ? 72 : 28);
  const sideBySide = totalColumns > 1;
  const widthPct = 100 / totalColumns;

  return (
    <div
      className={cn(
        "absolute z-20 overflow-hidden rounded-md border-l-[3px] text-left transition-shadow",
        !sideBySide && "inset-x-1",
        showCloseOut && "ring-1 ring-amber-500/25",
      )}
      style={{
        top,
        height: blockHeight,
        ...(sideBySide
          ? {
              left: `calc(${(column / totalColumns) * 100}% + 4px)`,
              width: `calc(${widthPct}% - 6px)`,
            }
          : {}),
        backgroundColor: showCloseOut ? "rgb(255 251 235 / 0.95)" : backgroundColor,
        borderLeftColor: showCloseOut ? "#f59e0b" : borderColor,
      }}
    >
      <button
        type="button"
        className="w-full px-2 py-1 text-left hover:shadow-md"
        onClick={onOpen}
      >
        <div className="text-[10px] font-medium text-muted-foreground">
          {formatTimeShort(apt.start_time)} - {formatTimeShort(apt.end_time)}
        </div>
        <div className="truncate text-xs font-semibold">{apt.client_name}</div>
        {apt.offering_name && blockHeight > 52 && (
          <div className="truncate text-[10px] text-muted-foreground">{apt.offering_name}</div>
        )}
        {services && blockHeight > 62 && (
          <div className="truncate text-[10px] text-muted-foreground">{services}</div>
        )}
        {!showCloseOut && blockHeight > 40 && (
          <div className="text-[10px] font-medium">${apt.total_price.toFixed(2)}</div>
        )}
      </button>
      {showCloseOut && (
        <div className="px-2 pb-1.5">
          <CloseOutRowActions
            appointment={apt}
            now={now}
            onCloseOut={onCloseOut}
            compact
          />
        </div>
      )}
    </div>
  );
}
