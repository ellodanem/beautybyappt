import { Menu } from "lucide-preact";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useApp } from "../context";

export function MobileNavTrigger({ className }: { className?: string }) {
  const { openMobileMenu } = useApp();
  if (!openMobileMenu) return null;

  return (
    <Button
      variant="outline"
      size="icon"
      className={cn("h-9 w-9 shrink-0 md:hidden", className)}
      onClick={openMobileMenu}
      aria-label="Open menu"
    >
      <Menu className="h-5 w-5" />
    </Button>
  );
}
