import type { Branding } from "../../shared/branding";
import { businessDisplayName } from "../../shared/branding";
import { BusinessLogo } from "./business-header";

interface PublicBookingTopBarProps {
  branding: Pick<Branding, "business_name" | "logo_url">;
}

export function PublicBookingTopBar({ branding }: PublicBookingTopBarProps) {
  const name = businessDisplayName(branding.business_name);

  return (
    <header className="border-b bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
        <BusinessLogo branding={branding} size="sm" />
        <span className="truncate text-base font-semibold tracking-tight">{name}</span>
      </div>
    </header>
  );
}
