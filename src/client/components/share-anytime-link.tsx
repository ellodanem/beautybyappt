import { useState } from "preact/hooks";
import { Share2 } from "lucide-preact";
import { Button } from "@/components/ui/button";
import { ShareDialog } from "./share-offering-link";

export function publicAnytimeUrl(serviceSlug?: string): string {
  const base = `${window.location.origin}/anytime`;
  return serviceSlug ? `${base}/${encodeURIComponent(serviceSlug)}` : base;
}

interface ShareAnytimeLinkProps {
  name: string;
  serviceSlug?: string;
  variant?: "icon" | "button";
  buttonLabel?: string;
  onClick?: (e: Event) => void;
}

export function ShareAnytimeLink({
  name,
  serviceSlug,
  variant = "icon",
  buttonLabel = "Share anytime",
  onClick,
}: ShareAnytimeLinkProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = publicAnytimeUrl(serviceSlug);

  const handleOpen = (e: Event) => {
    e.stopPropagation();
    onClick?.(e);
    setOpen(true);
    setCopied(false);
  };

  const copyUrl = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareWhatsApp = () => {
    const text = encodeURIComponent(`Book ${name}: ${url}`);
    window.open(`https://wa.me/?text=${text}`, "_blank", "noopener,noreferrer");
  };

  if (variant === "button") {
    return (
      <>
        <Button type="button" variant="outline" className="h-12 px-4 text-base" onClick={handleOpen}>
          <Share2 className="mr-2 h-5 w-5" /> {buttonLabel}
        </Button>
        <ShareDialog
          open={open}
          onClose={() => setOpen(false)}
          name={name}
          url={url}
          copied={copied}
          onCopy={copyUrl}
          onWhatsApp={shareWhatsApp}
        />
      </>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0 text-muted-foreground"
        aria-label={`Share booking page for ${name}`}
        title="Share public booking page"
        onClick={handleOpen}
      >
        <Share2 className="h-4 w-4" />
      </Button>
      <ShareDialog
        open={open}
        onClose={() => setOpen(false)}
        name={name}
        url={url}
        copied={copied}
        onCopy={copyUrl}
        onWhatsApp={shareWhatsApp}
      />
    </>
  );
}
