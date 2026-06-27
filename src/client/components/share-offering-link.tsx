import { useState } from "preact/hooks";
import { Copy, Check, Share2 } from "lucide-preact";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function publicOfferUrl(slug: string): string {
  return `${window.location.origin}/offer/${slug}`;
}

interface ShareOfferingLinkProps {
  slug: string;
  name: string;
  disabled?: boolean;
  variant?: "icon" | "button";
  onClick?: (e: Event) => void;
}

export function ShareOfferingLink({
  slug,
  name,
  disabled,
  variant = "icon",
  onClick,
}: ShareOfferingLinkProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = publicOfferUrl(slug);

  const handleOpen = (e: Event) => {
    e.stopPropagation();
    onClick?.(e);
    if (disabled) return;
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
        <Button type="button" variant="outline" className="h-12" disabled={disabled} onClick={handleOpen}>
          <Share2 className="mr-2 h-5 w-5" /> Share booking page
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
        disabled={disabled}
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

export function ShareDialog({
  open,
  onClose,
  name,
  url,
  copied,
  onCopy,
  onWhatsApp,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  url: string;
  copied: boolean;
  onCopy: () => void;
  onWhatsApp: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Share {name}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Clients can pick a time and book themselves from this link.
        </p>
        <div className="flex gap-2">
          <input
            readOnly
            className="flex h-10 min-w-0 flex-1 rounded-md border border-input bg-muted px-3 text-sm"
            value={url}
          />
          <Button type="button" variant="outline" size="icon" onClick={onCopy}>
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
        <Button type="button" className="h-11 w-full" onClick={onWhatsApp}>
          Share on WhatsApp
        </Button>
      </DialogContent>
    </Dialog>
  );
}
