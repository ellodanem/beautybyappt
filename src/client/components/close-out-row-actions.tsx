import { useEffect, useState } from "preact/hooks";
import { Button } from "@/components/ui/button";
import { needsCloseOut } from "../../shared/appointment-closeout";
import type { Appointment, AppointmentStatus } from "../types";

export function useCloseOutClock(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);

  return now;
}

interface CloseOutRowActionsProps {
  appointment: Appointment;
  now: Date;
  onCloseOut: (status: AppointmentStatus) => Promise<void>;
  compact?: boolean;
}

export function CloseOutRowActions({ appointment, now, onCloseOut, compact = false }: CloseOutRowActionsProps) {
  const [saving, setSaving] = useState(false);

  if (!needsCloseOut(appointment, now)) return null;

  const handleCloseOut = async (status: "completed" | "no_show") => {
    setSaving(true);
    try {
      await onCloseOut(status);
    } finally {
      setSaving(false);
    }
  };

  if (compact) {
    return (
      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        <Button
          size="sm"
          className="h-6 bg-emerald-600 px-1.5 text-[10px] text-white hover:bg-emerald-700"
          disabled={saving}
          onClick={() => handleCloseOut("completed")}
        >
          Done
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-1.5 text-[10px]"
          disabled={saving}
          onClick={() => handleCloseOut("no_show")}
        >
          No show
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
        Close out
      </span>
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          className="h-7 bg-emerald-600 px-2 text-xs text-white hover:bg-emerald-700"
          disabled={saving}
          onClick={() => handleCloseOut("completed")}
        >
          Done
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          disabled={saving}
          onClick={() => handleCloseOut("no_show")}
        >
          No show
        </Button>
      </div>
    </div>
  );
}
