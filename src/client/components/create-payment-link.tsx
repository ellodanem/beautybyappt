import { useState, useEffect } from "preact/hooks";
import { useApp } from "../context";
import { Link2, Copy, Check } from "lucide-preact";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { formatMoney, getCurrency } from "../../shared/currency";

interface Props {
  onClose: () => void;
}

function parseAmount(value: string): number {
  if (value.trim() === "") return 0;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function CreatePaymentLink({ onClose }: Props) {
  const {
    createPaymentLink,
    staffLookup,
    defaultCurrency,
    currencyOptions,
    setError,
    stripeConfigured,
    stripePaymentsEnabled,
  } = useApp();
  const [staffId, setStaffId] = useState("");
  const [price, setPrice] = useState("");
  const [collect, setCollect] = useState<"full" | "deposit">("full");
  const [useDefaultCurrency, setUseDefaultCurrency] = useState(true);
  const [linkCurrency, setLinkCurrency] = useState(defaultCurrency);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [createdCurrency, setCreatedCurrency] = useState(defaultCurrency);
  const [createdPrice, setCreatedPrice] = useState(0);
  const [createdCollect, setCreatedCollect] = useState<"full" | "deposit">("full");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (useDefaultCurrency) setLinkCurrency(defaultCurrency);
  }, [defaultCurrency, useDefaultCurrency]);

  const activeCurrency = useDefaultCurrency ? defaultCurrency : linkCurrency;
  const currencyMeta = getCurrency(activeCurrency);
  const quotedTotal = parseAmount(price);
  const depositAmount = Math.round(quotedTotal * 0.5 * 100) / 100;
  const collectNow = collect === "deposit" ? depositAmount : quotedTotal;

  const handleCreate = async () => {
    if (quotedTotal <= 0) {
      setError("Enter a price greater than zero");
      return;
    }
    setSaving(true);
    try {
      const url = await createPaymentLink({
        quoted_total: quotedTotal,
        collect,
        staff_id: staffId ? parseInt(staffId, 10) : null,
        currency: useDefaultCurrency ? undefined : linkCurrency,
        notes,
      });
      setCreatedCurrency(activeCurrency);
      setCreatedPrice(quotedTotal);
      setCreatedCollect(collect);
      setCreatedUrl(url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const copyUrl = async () => {
    if (!createdUrl) return;
    await navigator.clipboard.writeText(createdUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareWhatsApp = () => {
    if (!createdUrl) return;
    const text = encodeURIComponent(`Your payment link:\n${createdUrl}`);
    window.open(`https://wa.me/?text=${text}`, "_blank", "noopener,noreferrer");
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            {createdUrl ? "Link ready" : "Create payment link"}
          </DialogTitle>
        </DialogHeader>

        <DialogBody>
          {createdUrl ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Share this link with your client.
                {createdCollect === "deposit" ? (
                  <> Deposit due now: {formatMoney(Math.round(createdPrice * 0.5 * 100) / 100, createdCurrency)} toward {formatMoney(createdPrice, createdCurrency)}.</>
                ) : (
                  <> Amount: {formatMoney(createdPrice, createdCurrency)}.</>
                )}
                {" "}After payment, it appears in Pending payments so you can schedule later. Link expires in 48 hours.
              </p>
              <div className="flex gap-2">
                <Input readOnly value={createdUrl} className="h-11 text-sm" />
                <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={copyUrl}>
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button className="h-11 flex-1" onClick={copyUrl}>Copy link</Button>
                <Button variant="outline" className="h-11 flex-1" onClick={shareWhatsApp}>Share on WhatsApp</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Price ({activeCurrency}) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  className="h-11"
                  placeholder="e.g. 170"
                  value={price}
                  onChange={(e) => setPrice((e.target as HTMLInputElement).value)}
                />
              </div>

              <div className="space-y-2 rounded-lg border p-3">
                <Label className="text-sm font-medium">Collect now</Label>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name="collect-mode"
                    className="mt-1"
                    checked={collect === "full"}
                    onChange={() => setCollect("full")}
                  />
                  <span className="text-sm">
                    <span className="font-medium">Full payment</span>
                    <span className="block text-muted-foreground">
                      {quotedTotal > 0 ? formatMoney(quotedTotal, activeCurrency) : "100% of price"}
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name="collect-mode"
                    className="mt-1"
                    checked={collect === "deposit"}
                    onChange={() => setCollect("deposit")}
                  />
                  <span className="text-sm">
                    <span className="font-medium">50% deposit</span>
                    <span className="block text-muted-foreground">
                      {quotedTotal > 0
                        ? `${formatMoney(depositAmount, activeCurrency)} now · balance later`
                        : "Half of price now"}
                    </span>
                  </span>
                </label>
              </div>

              <div className="space-y-1.5">
                <Label>Staff (optional)</Label>
                <select
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={staffId}
                  onChange={(e) => setStaffId((e.target as HTMLSelectElement).value)}
                >
                  <option value="">Assign later…</option>
                  {staffLookup.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2 rounded-lg border p-3">
                <Label className="text-sm font-medium">Currency</Label>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name="currency-mode"
                    className="mt-1"
                    checked={useDefaultCurrency}
                    onChange={() => setUseDefaultCurrency(true)}
                  />
                  <span className="text-sm">
                    <span className="font-medium">Business default</span>
                    <span className="block text-muted-foreground">{getCurrency(defaultCurrency).label} ({defaultCurrency})</span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name="currency-mode"
                    className="mt-1"
                    checked={!useDefaultCurrency}
                    onChange={() => setUseDefaultCurrency(false)}
                  />
                  <span className="text-sm">
                    <span className="font-medium">Set for this link</span>
                    {!useDefaultCurrency && (
                      <select
                        className="mt-2 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={linkCurrency}
                        onChange={(e) => setLinkCurrency((e.target as HTMLSelectElement).value)}
                      >
                        {currencyOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    )}
                  </span>
                </label>
              </div>

              <div className="space-y-1.5">
                <Label>Note to client</Label>
                <Textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
                  placeholder="e.g. Bridal glam deposit"
                />
              </div>

              {!stripeConfigured && (
                <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                  Add Stripe keys before clients can pay.
                </p>
              )}
              {stripeConfigured && !stripePaymentsEnabled && (
                <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                  Online payments are off in Settings.
                </p>
              )}

              {quotedTotal > 0 && (
                <p className="text-sm font-medium">
                  Client pays now: {formatMoney(collectNow, activeCurrency)}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">({currencyMeta.code})</span>
                </p>
              )}
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          {createdUrl ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button disabled={saving || quotedTotal <= 0} onClick={handleCreate}>
                {saving ? "Creating…" : "Create link"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
