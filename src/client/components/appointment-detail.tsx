import { useEffect, useState } from "preact/hooks";
import { useApp } from "../context";
import { ArrowLeft, Trash2, Send, Clock, User, Copy, Check } from "lucide-preact";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "./status-badge";
import { MobileNavTrigger } from "./mobile-nav-trigger";
import { PaymentBadge } from "./payment-badge";
import { CloseOutBanner } from "./close-out-banner";
import { formatDateShort, formatTimeShort } from "@/lib/utils";
import { formatMoney } from "../../shared/currency";
import { appointmentBalance, computeDefaultDeposit } from "../../shared/payment";
import type { Appointment, OfferingAddon } from "../types";

function parseAmount(value: string): number {
  if (value.trim() === "") return 0;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function getEffectiveTotal(
  apt: Appointment,
  totalPrice: string,
  selectedAddonIds: number[],
  extrasDirty: boolean,
  offeringAddons: OfferingAddon[],
  offeringBasePrice: number,
): number {
  if (apt.offering_id && extrasDirty) {
    const extrasSubtotal = offeringAddons
      .filter((addon) => addon.id != null && selectedAddonIds.includes(addon.id))
      .reduce((sum, addon) => sum + addon.price, 0);
    return offeringBasePrice + extrasSubtotal + (apt.travel_fee ?? 0);
  }
  return parseAmount(totalPrice);
}

function isCustomDeposit(total: number, deposit: number): boolean {
  if (deposit <= 0) return false;
  return Math.abs(deposit - computeDefaultDeposit(total)) > 0.009;
}

export function AppointmentDetail() {
  const {
    selectedAppointment: apt, navigate, updateAppointment, updateAppointmentAddons, deleteAppointment,
    addAppointmentNote, deleteAppointmentNote, staffLookup, defaultCurrency,
    stripeConfigured, stripePaymentsEnabled, sendAppointmentPaymentLink, setError,
  } = useApp();
  const [noteText, setNoteText] = useState("");
  const [totalPrice, setTotalPrice] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [depositOverridden, setDepositOverridden] = useState(false);
  const [customDeposit, setCustomDeposit] = useState("");
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentSaved, setPaymentSaved] = useState(false);
  const [paymentLinkSending, setPaymentLinkSending] = useState(false);
  const [paymentLinkCopied, setPaymentLinkCopied] = useState(false);
  const [lastPaymentLinkUrl, setLastPaymentLinkUrl] = useState<string | null>(null);
  const [selectedAddonIds, setSelectedAddonIds] = useState<number[]>([]);
  const [extrasSaving, setExtrasSaving] = useState(false);
  const [extrasSaved, setExtrasSaved] = useState(false);

  useEffect(() => {
    if (!apt) return;
    setTotalPrice(String(apt.total_price ?? 0));
    const total = apt.total_price ?? 0;
    const savedDeposit = apt.deposit_amount ?? 0;
    setDepositOverridden(isCustomDeposit(total, savedDeposit));
    setCustomDeposit(savedDeposit > 0 ? String(savedDeposit) : "");
    setAmountPaid(apt.amount_paid ? String(apt.amount_paid) : "");
    setPaymentSaved(false);
    setPaymentLinkCopied(false);
    setLastPaymentLinkUrl(null);
    setSelectedAddonIds((apt.appointment_offering_addons ?? []).map((a) => a.offering_addon_id));
    setExtrasSaved(false);
  }, [apt?.id, apt?.total_price, apt?.deposit_amount, apt?.amount_paid, apt?.appointment_offering_addons]);

  const offeringAddons = apt?.offering_addons ?? [];
  const offeringBasePrice = apt?.offering_base_price ?? 0;
  const assignedAddonIds = (apt?.appointment_offering_addons ?? []).map((a) => a.offering_addon_id);
  const extrasDirty = apt
    ? selectedAddonIds.length !== assignedAddonIds.length
      || selectedAddonIds.some((id) => !assignedAddonIds.includes(id))
    : false;
  const effectiveTotal = apt
    ? getEffectiveTotal(apt, totalPrice, selectedAddonIds, extrasDirty, offeringAddons, offeringBasePrice)
    : 0;
  const autoDeposit = computeDefaultDeposit(effectiveTotal);

  if (!apt) return null;

  const currency = apt.currency || defaultCurrency;
  const previewTotal = effectiveTotal;
  const previewDeposit = depositOverridden ? parseAmount(customDeposit) : autoDeposit;
  const previewPaid = parseAmount(amountPaid);
  const previewBalance = appointmentBalance(previewTotal, previewPaid);

  const paymentPreview: Appointment = {
    ...apt,
    total_price: previewTotal,
    deposit_amount: previewDeposit,
    amount_paid: previewPaid,
    payment_status: previewDeposit > 0 || previewPaid > 0 ? "deposit_paid" : "not_required",
    currency,
  };

  const paymentDirty =
    previewTotal !== (apt.total_price ?? 0)
    || previewDeposit !== (apt.deposit_amount ?? 0)
    || previewPaid !== (apt.amount_paid ?? 0);

  const stripePaymentsReady = stripeConfigured && stripePaymentsEnabled;
  const canSendPaymentLink =
    stripePaymentsReady
    && previewTotal > 0
    && previewBalance > 0
    && !paymentDirty;

  const paymentLinkDisabledReason = !stripePaymentsReady
    ? "Enable Stripe payments in Settings"
    : paymentDirty
      ? "Save payment changes first"
      : previewTotal <= 0
        ? "No amount to collect"
        : previewBalance <= 0
          ? "Fully paid"
          : null;

  const extrasSubtotal = offeringAddons
    .filter((addon) => addon.id != null && selectedAddonIds.includes(addon.id))
    .reduce((sum, addon) => sum + addon.price, 0);
  const serviceTotal = offeringBasePrice + extrasSubtotal + (apt.travel_fee ?? 0);

  const toggleAddon = (addonId: number) => {
    setSelectedAddonIds((prev) => (
      prev.includes(addonId) ? prev.filter((id) => id !== addonId) : [...prev, addonId]
    ));
    setExtrasSaved(false);
  };

  const handleStatusChange = (status: string) => updateAppointment(apt.id, { status } as Partial<typeof apt>);
  const handleStaffChange = (staffId: string) => updateAppointment(apt.id, { staff_id: staffId ? parseInt(staffId) : null } as Partial<typeof apt>);

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    await addAppointmentNote(apt.id, noteText.trim());
    setNoteText("");
  };

  const handleSavePayment = async () => {
    setPaymentSaving(true);
    setPaymentSaved(false);
    try {
      await updateAppointment(apt.id, {
        total_price: previewTotal,
        deposit_amount: previewDeposit,
        amount_paid: previewPaid,
      });
      setPaymentSaved(true);
    } finally {
      setPaymentSaving(false);
    }
  };

  const handleSendPaymentLink = async () => {
    setPaymentLinkSending(true);
    setPaymentLinkCopied(false);
    setError(null);
    try {
      const res = await sendAppointmentPaymentLink(apt.id);
      setLastPaymentLinkUrl(res.checkout_url);
      setPaymentLinkCopied(true);
      window.setTimeout(() => setPaymentLinkCopied(false), 2500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPaymentLinkSending(false);
    }
  };

  const handleCopyPaymentLink = async () => {
    if (!lastPaymentLinkUrl) return;
    try {
      await navigator.clipboard.writeText(lastPaymentLinkUrl);
      setPaymentLinkCopied(true);
      window.setTimeout(() => setPaymentLinkCopied(false), 2500);
    } catch {
      setError("Could not copy to clipboard");
    }
  };

  const handleSaveExtras = async () => {
    setExtrasSaving(true);
    setExtrasSaved(false);
    try {
      await updateAppointmentAddons(apt.id, selectedAddonIds);
      setExtrasSaved(true);
    } finally {
      setExtrasSaving(false);
    }
  };

  return (
    <div className="space-y-6 p-4 pb-8 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <MobileNavTrigger />
        <Button variant="ghost" size="sm" className="shrink-0" onClick={() => navigate("/appointments")}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <h1 className="min-w-0 flex-1 text-xl font-bold md:text-2xl">{apt.identifier}</h1>
        <StatusBadge status={apt.status} />
        <Button variant="destructive" size="sm" onClick={() => deleteAppointment(apt.id)}>
          <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
        </Button>
      </div>

      <CloseOutBanner
        appointment={apt}
        onCloseOut={(status) => updateAppointment(apt.id, { status })}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Booking Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="h-3 w-3" /> Date & Time</Label>
                  <p className="text-sm font-medium">{formatDateShort(apt.scheduled_date)} at {formatTimeShort(apt.start_time)} - {formatTimeShort(apt.end_time)}</p>
                </div>
                <div className="space-y-1">
                  <Label className="flex items-center gap-1.5 text-xs text-muted-foreground"><User className="h-3 w-3" /> Client</Label>
                  <button className="text-sm font-medium text-primary hover:underline" onClick={() => navigate(`/clients/${apt.client_id}`)}>
                    {apt.client_name}
                  </button>
                  {apt.client_phone && <p className="text-xs text-muted-foreground">{apt.client_phone}</p>}
                </div>
              </div>
              <Separator />
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Staff</Label>
                  <select className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={apt.staff_id || ""} onChange={(e) => handleStaffChange((e.target as HTMLSelectElement).value)}>
                    <option value="">Unassigned</option>
                    {staffLookup.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <select className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={apt.status} onChange={(e) => handleStatusChange((e.target as HTMLSelectElement).value)}>
                    <option value="booked">Booked</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="no_show">No Show</option>
                  </select>
                </div>
              </div>
              {(apt.travel_fee ?? 0) > 0 && (
                <p className="text-sm text-muted-foreground">
                  Includes {formatMoney(apt.travel_fee ?? 0, currency)} travel fee in total
                </p>
              )}
              {apt.service_address && (
                <p className="text-sm text-muted-foreground">Location: {apt.service_address}</p>
              )}
              {apt.notes && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Notes</Label>
                  <p className="text-sm">{apt.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle>Payment</CardTitle>
              <PaymentBadge appointment={paymentPreview} />
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Send a Stripe payment link for the balance due, or record cash and transfer payments manually below.
              </p>
              {apt.pending_payment && previewBalance > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Pending Stripe link for {formatMoney(apt.pending_payment.amount, apt.pending_payment.currency || currency)}.
                  Sending a new link will replace the previous one.
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="payment-total" className="text-xs text-muted-foreground">Total ({currency})</Label>
                  <Input
                    id="payment-total"
                    type="number"
                    min="0"
                    step="0.01"
                    value={totalPrice}
                    onInput={(e) => { setTotalPrice((e.target as HTMLInputElement).value); setPaymentSaved(false); }}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {apt.offering_id ? "Updates when you save extras, or override here" : "Include extras here"}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="payment-deposit" className="text-xs text-muted-foreground">Deposit expected ({currency})</Label>
                  <Input
                    id="payment-deposit"
                    type="number"
                    min="0"
                    step="0.01"
                    readOnly={!depositOverridden}
                    className={!depositOverridden ? "bg-muted/50" : undefined}
                    value={depositOverridden ? customDeposit : String(autoDeposit)}
                    onInput={(e) => {
                      setDepositOverridden(true);
                      setCustomDeposit((e.target as HTMLInputElement).value);
                      setPaymentSaved(false);
                    }}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {depositOverridden ? (
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={() => {
                          setDepositOverridden(false);
                          setCustomDeposit("");
                          setPaymentSaved(false);
                        }}
                      >
                        Reset to 50%
                      </button>
                    ) : (
                      <>
                        50% of total (default)
                        {" · "}
                        <button
                          type="button"
                          className="text-primary hover:underline"
                          onClick={() => {
                            setDepositOverridden(true);
                            setCustomDeposit(String(autoDeposit));
                            setPaymentSaved(false);
                          }}
                        >
                          Custom amount
                        </button>
                      </>
                    )}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="payment-paid" className="text-xs text-muted-foreground">Amount paid ({currency})</Label>
                  <Input
                    id="payment-paid"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0"
                    value={amountPaid}
                    onInput={(e) => { setAmountPaid((e.target as HTMLInputElement).value); setPaymentSaved(false); }}
                  />
                  <p className="text-[11px] text-muted-foreground">Deposit + any extras paid so far</p>
                </div>
              </div>
              <div className="rounded-md border bg-muted/30 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">Balance due</span>
                  <span className="font-semibold">
                    {currency} {formatMoney(previewBalance, currency)}
                  </span>
                </div>
                {previewPaid > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {currency} {formatMoney(previewPaid, currency)} received of {formatMoney(previewTotal, currency)} total
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" disabled={!paymentDirty || paymentSaving} onClick={handleSavePayment}>
                  {paymentSaving ? "Saving…" : "Save payment"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canSendPaymentLink || paymentLinkSending}
                  onClick={handleSendPaymentLink}
                  title={paymentLinkDisabledReason ?? undefined}
                >
                  <Send className="mr-1 h-3.5 w-3.5" />
                  {paymentLinkSending ? "Creating…" : "Send payment link"}
                </Button>
                {lastPaymentLinkUrl && (
                  <Button size="sm" variant="ghost" onClick={handleCopyPaymentLink}>
                    {paymentLinkCopied ? (
                      <Check className="mr-1 h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="mr-1 h-3.5 w-3.5" />
                    )}
                    {paymentLinkCopied ? "Copied" : "Copy link"}
                  </Button>
                )}
                {paymentSaved && !paymentDirty && (
                  <span className="text-sm text-emerald-600">Saved</span>
                )}
                {paymentLinkCopied && !paymentLinkSending && (
                  <span className="text-sm text-emerald-600">Link copied</span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {apt.offering_id ? "Service & Extras" : "Services"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {apt.offering_id ? (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{apt.offering_name}</span>
                    <span>{formatMoney(offeringBasePrice, currency)}</span>
                  </div>
                  {offeringAddons.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Extras</p>
                      {offeringAddons.map((addon) => (
                        <label
                          key={addon.id}
                          className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={addon.id != null && selectedAddonIds.includes(addon.id)}
                            onChange={() => addon.id != null && toggleAddon(addon.id)}
                          />
                          <span className="flex-1">{addon.name}</span>
                          <span className="text-muted-foreground">+{formatMoney(addon.price, currency)}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No extras available for this offering.</p>
                  )}
                  <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Service total</span>
                      <span className="font-semibold">{formatMoney(extrasDirty ? serviceTotal : apt.total_price, currency)}</span>
                    </div>
                    {(apt.travel_fee ?? 0) > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Includes {formatMoney(apt.travel_fee ?? 0, currency)} travel fee
                      </p>
                    )}
                  </div>
                  {offeringAddons.length > 0 && (
                    <div className="flex items-center gap-3">
                      <Button size="sm" disabled={!extrasDirty || extrasSaving} onClick={handleSaveExtras}>
                        {extrasSaving ? "Saving…" : "Save extras"}
                      </Button>
                      {extrasSaved && !extrasDirty && (
                        <span className="text-sm text-emerald-600">Saved</span>
                      )}
                    </div>
                  )}
                </>
              ) : (!apt.appointment_services || apt.appointment_services.length === 0) ? (
                <p className="text-sm text-muted-foreground">No services added</p>
              ) : (
                <div className="space-y-2">
                  {apt.appointment_services.map((svc) => (
                    <div key={svc.id} className="flex items-center justify-between text-sm">
                      <span>{svc.service_name || `Service #${svc.service_id}`}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{svc.duration}min</span>
                        <span className="font-medium">{formatMoney(svc.price, currency)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="Add a note..."
                  value={noteText}
                  onChange={(e) => setNoteText((e.target as HTMLInputElement).value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddNote()}
                />
                <Button variant="outline" size="icon" onClick={handleAddNote}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              {(!apt.appointment_notes || apt.appointment_notes.length === 0) ? (
                <p className="text-sm text-muted-foreground">No notes yet</p>
              ) : (
                <div className="space-y-2">
                  {apt.appointment_notes.map((note) => (
                    <div key={note.id} className="rounded-md border bg-muted/30 p-2.5">
                      <p className="text-sm">{note.content}</p>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground">{new Date(note.created_at).toLocaleString()}</span>
                        <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-destructive" onClick={() => deleteAppointmentNote(note.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
