import { useState, useEffect } from "preact/hooks";
import { useApp } from "../context";
import { Link2, Copy, Check } from "lucide-preact";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatMoney, getCurrency } from "../../shared/currency";
import {
  clampDepositAmount,
  computeDefaultDeposit,
  maxDepositAmount,
  minDepositAmount,
} from "../../shared/payment";

interface Props {
  onClose: () => void;
  defaultDate?: string;
}

function parseAmount(value: string): number {
  if (value.trim() === "") return 0;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function CreateBookingLink({ onClose, defaultDate }: Props) {
  const { createBookingLink, staffLookup, services, defaultCurrency, currencyOptions, setError, stripeConfigured, stripePaymentsEnabled } = useApp();
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState(defaultDate || new Date().toISOString().split("T")[0]);
  const [startTime, setStartTime] = useState("09:00");
  const [duration, setDuration] = useState("60");
  const [customPrice, setCustomPrice] = useState("");
  const [depositOverridden, setDepositOverridden] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [addTravelFee, setAddTravelFee] = useState(false);
  const [travelFeeAmount, setTravelFeeAmount] = useState("");
  const [useDefaultCurrency, setUseDefaultCurrency] = useState(true);
  const [linkCurrency, setLinkCurrency] = useState(defaultCurrency);
  const [selectedServices, setSelectedServices] = useState<number[]>([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [createdCurrency, setCreatedCurrency] = useState(defaultCurrency);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (useDefaultCurrency) setLinkCurrency(defaultCurrency);
  }, [defaultCurrency, useDefaultCurrency]);

  const activeCurrency = useDefaultCurrency ? defaultCurrency : linkCurrency;
  const currencyMeta = getCurrency(activeCurrency);

  const toggleService = (id: number) => {
    setSelectedServices((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

  const computedPrice = customPrice !== ""
    ? parseFloat(customPrice) || 0
    : services.filter((s) => selectedServices.includes(s.id)).reduce((sum, s) => sum + s.price, 0);

  const serviceSubtotal = computedPrice;
  const parsedTravel = addTravelFee && travelFeeAmount !== "" ? parseFloat(travelFeeAmount) || 0 : 0;
  const grandTotal = serviceSubtotal + parsedTravel;
  const minDeposit = minDepositAmount(grandTotal, parsedTravel);
  const maxDeposit = maxDepositAmount(grandTotal, parsedTravel);
  const defaultDeposit = computeDefaultDeposit(serviceSubtotal);
  const parsedDeposit = serviceSubtotal > 0
    ? (depositOverridden ? parseAmount(depositAmount) : defaultDeposit)
    : 0;
  const effectiveDeposit = serviceSubtotal > 0
    ? clampDepositAmount(parsedDeposit, grandTotal, parsedTravel)
    : 0;

  useEffect(() => {
    if (serviceSubtotal <= 0) {
      setDepositOverridden(false);
      setDepositAmount("");
      return;
    }
    if (!depositOverridden) {
      setDepositAmount(String(defaultDeposit));
    }
  }, [serviceSubtotal, defaultDeposit, depositOverridden]);

  const setDepositFromRate = (rate: number) => {
    const amount = clampDepositAmount(
      computeDefaultDeposit(serviceSubtotal, rate),
      grandTotal,
      parsedTravel,
    );
    setDepositOverridden(true);
    setDepositAmount(String(amount));
  };

  const handleCreate = async () => {
    if (!staffId) { setError("Please select staff"); return; }
    setSaving(true);
    try {
      const url = await createBookingLink({
        staff_id: parseInt(staffId, 10),
        scheduled_date: date,
        start_time: startTime,
        duration_minutes: parseInt(duration, 10) || 60,
        total_price: customPrice !== "" ? parseFloat(customPrice) || 0 : undefined,
        deposit_amount: effectiveDeposit > 0 ? effectiveDeposit : undefined,
        travel_fee: parsedTravel > 0 ? parsedTravel : undefined,
        currency: useDefaultCurrency ? undefined : linkCurrency,
        service_ids: selectedServices,
        notes,
      });
      setCreatedCurrency(activeCurrency);
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
    const text = encodeURIComponent(`Your booking link:\n${createdUrl}`);
    window.open(`https://wa.me/?text=${text}`, "_blank", "noopener,noreferrer");
  };

  const depositPercent = serviceSubtotal > 0
    ? Math.round((effectiveDeposit / serviceSubtotal) * 100)
    : 0;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            {createdUrl ? "Link ready" : "Create booking link"}
          </DialogTitle>
        </DialogHeader>

        {createdUrl ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Share this link with your client. Total: {formatMoney(grandTotal, createdCurrency)}
              {parsedTravel > 0 && <> (includes {formatMoney(parsedTravel, createdCurrency)} travel)</>}
              {effectiveDeposit > 0 && (
                <> · Client can pay in full or a {depositPercent}% deposit ({formatMoney(effectiveDeposit, createdCurrency)})</>
              )}.
              Link expires in 48 hours.
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
              <Label>Staff *</Label>
              <select
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={staffId}
                onChange={(e) => setStaffId((e.target as HTMLSelectElement).value)}
              >
                <option value="">Select staff…</option>
                {staffLookup.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" className="h-11" value={date} onChange={(e) => setDate((e.target as HTMLInputElement).value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Start time</Label>
                <Input type="time" className="h-11" value={startTime} onChange={(e) => setStartTime((e.target as HTMLInputElement).value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Duration (min)</Label>
                <Input type="number" className="h-11" value={duration} onChange={(e) => setDuration((e.target as HTMLInputElement).value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Price ({activeCurrency})</Label>
                <Input
                  type="number"
                  step="0.01"
                  className="h-11"
                  placeholder={computedPrice > 0 ? String(computedPrice) : "Auto"}
                  value={customPrice}
                  onChange={(e) => setCustomPrice((e.target as HTMLInputElement).value)}
                />
              </div>
            </div>

            <div className="space-y-2 rounded-lg border p-3">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={addTravelFee}
                  onChange={(e) => setAddTravelFee((e.target as HTMLInputElement).checked)}
                />
                <span className="text-sm">
                  <span className="font-medium">Add travel fee</span>
                  <span className="mt-0.5 block text-muted-foreground">
                    On-location / mobile makeup. Client must enter their address.
                  </span>
                </span>
              </label>
              {addTravelFee && (
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  className="h-11"
                  placeholder="e.g. 25"
                  value={travelFeeAmount}
                  onChange={(e) => setTravelFeeAmount((e.target as HTMLInputElement).value)}
                />
              )}
            </div>

            {serviceSubtotal > 0 && (
              <div className="space-y-2 rounded-lg border p-3">
                <Label>Deposit amount</Label>
                <p className="text-xs text-muted-foreground">
                  Clients can pay in full or this deposit (50%–100% of service). Travel is always due at checkout.
                </p>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    min={minDeposit}
                    max={maxDeposit}
                    className="h-11"
                    value={depositAmount}
                    onChange={(e) => {
                      setDepositOverridden(true);
                      setDepositAmount((e.target as HTMLInputElement).value);
                    }}
                  />
                  <Button type="button" variant="outline" className="h-11 shrink-0" onClick={() => setDepositFromRate(0.5)}>
                    50%
                  </Button>
                  <Button type="button" variant="outline" className="h-11 shrink-0" onClick={() => setDepositFromRate(1)}>
                    Full
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {depositPercent}% of service ({formatMoney(minDeposit, activeCurrency)}–{formatMoney(maxDeposit, activeCurrency)})
                </p>
              </div>
            )}

            {!stripeConfigured && serviceSubtotal > 0 && (
              <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                Add Stripe keys to <code className="text-foreground">.dev.vars</code> to collect payments online. Links can still be created now.
              </p>
            )}
            {stripeConfigured && !stripePaymentsEnabled && serviceSubtotal > 0 && (
              <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                Online payments are off in Settings. Clients can confirm booking links without paying until you enable them.
              </p>
            )}

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

            {services.length > 0 && (
              <div className="space-y-2">
                <Label>Services (optional)</Label>
                <p className="text-xs text-muted-foreground">Service catalog prices are in {activeCurrency}. Override the price above if needed.</p>
                <div className="flex flex-wrap gap-2">
                  {services.filter((s) => s.active).map((svc) => (
                    <button
                      key={svc.id}
                      type="button"
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                        selectedServices.includes(svc.id)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input hover:bg-muted",
                      )}
                      onClick={() => toggleService(svc.id)}
                    >
                      {svc.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Note to client</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes((e.target as HTMLTextAreaElement).value)} placeholder="e.g. Early slot before the event" />
            </div>
            <p className="text-sm font-medium">
              {parsedTravel > 0 ? (
                <>
                  Service: {formatMoney(serviceSubtotal, activeCurrency)}
                  {" · "}Travel: {formatMoney(parsedTravel, activeCurrency)}
                  {" · "}Total: {formatMoney(grandTotal, activeCurrency)}
                </>
              ) : (
                <>Total: {formatMoney(grandTotal, activeCurrency)}</>
              )}
              {effectiveDeposit > 0 && (
                <span className="ml-2 text-xs font-normal text-primary">
                  · Deposit option {formatMoney(effectiveDeposit + parsedTravel, activeCurrency)}
                  {effectiveDeposit < serviceSubtotal && (
                    <> · Full {formatMoney(grandTotal, activeCurrency)}</>
                  )}
                </span>
              )}
              <span className="ml-1 text-xs font-normal text-muted-foreground">({currencyMeta.code})</span>
            </p>
          </div>
        )}

        <DialogFooter>
          {createdUrl ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button disabled={saving} onClick={handleCreate}>
                {saving ? "Creating…" : "Create link"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
