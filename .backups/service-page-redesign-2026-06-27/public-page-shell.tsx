import type { ComponentChildren } from "preact";
import type { PlatformFooterConfig } from "../../shared/platform-branding";
import { PlatformFooter } from "./platform-footer";

interface PublicPageShellProps {
  children: ComponentChildren;
  platform: PlatformFooterConfig | null;
  contentClassName?: string;
}

export function PublicPageShell({
  children,
  platform,
  contentClassName = "flex-1 p-4 pb-8",
}: PublicPageShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className={contentClassName}>{children}</div>
      {platform && <PlatformFooter config={platform} />}
    </div>
  );
}
