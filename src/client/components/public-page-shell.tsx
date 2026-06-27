import type { ComponentChildren } from "preact";
import type { PlatformFooterConfig } from "../../shared/platform-branding";
import { PlatformFooter } from "./platform-footer";

interface PublicPageShellProps {
  children: ComponentChildren;
  platform: PlatformFooterConfig | null;
  contentClassName?: string;
  variant?: "default" | "booking";
}

export function PublicPageShell({
  children,
  platform,
  contentClassName = "flex-1 p-4 pb-8",
  variant = "default",
}: PublicPageShellProps) {
  return (
    <div
      className={
        variant === "booking"
          ? "flex min-h-screen flex-col bg-muted/40 bg-[radial-gradient(ellipse_at_bottom,_oklch(0.92_0.04_277)_0%,_transparent_55%)]"
          : "flex min-h-screen flex-col bg-background"
      }
    >
      <div className={contentClassName}>{children}</div>
      {platform && <PlatformFooter config={platform} />}
    </div>
  );
}
