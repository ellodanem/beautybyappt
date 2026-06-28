import { Badge } from "@/components/ui/badge";
import { formatMoney } from "../../shared/currency";
import type { Appointment } from "../types";

export function AppointmentExtrasChips({ appointment }: { appointment: Appointment }) {
  const offeringAddons = appointment.appointment_offering_addons ?? [];
  const serviceAddons = appointment.appointment_service_addons ?? [];
  const addons = offeringAddons.length > 0 ? offeringAddons : serviceAddons;
  if (addons.length === 0) return null;

  const currency = appointment.currency || "USD";
  const tooltip = addons
    .filter((a) => a.name)
    .map((a) => `${a.name} (${formatMoney(a.price, currency)})`)
    .join(", ");

  return (
    <div className="mt-1 flex flex-wrap gap-1" title={tooltip || undefined}>
      {addons.map((addon) => (
        <Badge
          key={addon.id}
          variant="outline"
          className="px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
        >
          {addon.name}
        </Badge>
      ))}
    </div>
  );
}
