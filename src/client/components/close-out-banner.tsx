import { useState } from "preact/hooks";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { needsCloseOut } from "../../shared/appointment-closeout";
import type { Appointment, AppointmentStatus } from "../types";
import { useCloseOutClock } from "./close-out-row-actions";

interface CloseOutBannerProps {
  appointment: Appointment;
  onCloseOut: (status: AppointmentStatus) => Promise<void>;
}

export function CloseOutBanner({ appointment, onCloseOut }: CloseOutBannerProps) {
  const now = useCloseOutClock();
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

  return (
    <Card className="border-amber-500/35 bg-amber-50/70 dark:bg-amber-950/20">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-amber-950 dark:text-amber-100">Ready to close out?</p>
          <p className="text-sm text-muted-foreground">This appointment has ended.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={saving}
            onClick={() => handleCloseOut("completed")}
          >
            Completed
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={() => handleCloseOut("no_show")}
          >
            No show
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
