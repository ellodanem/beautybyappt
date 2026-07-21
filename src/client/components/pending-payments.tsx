import { useState, useEffect, useCallback } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { useApp } from "../context";
import { api } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { formatMoney } from "../../shared/currency";
import { cn, formatTimeShort } from "@/lib/utils";
import type { Appointment } from "../types";

function Pill({ children, className }: { children: ComponentChildren; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold", className)}>
      {children}
    </span>
  );
}

export type PendingPayment = {
  id: number;
  client_id: number;
  staff_id: number | null;
  quoted_total: number;
  amount_paid: number;
  currency: string;
  notes: string;
  status: string;
  client_was_existing: boolean;
  client_reviewed_at: string | null;
  appointment_id: number | null;
  created_at: string;
  applied_at: string | null;
  client_name?: string;
  client_email?: string;
  client_phone?: string;
  staff_name?: string | null;
};

type ClientMatch = {
  id: number;
  name: string;
  email: string;
  phone: string;
  match: "email" | "phone" | "both";
};

function daysAgo(iso: string): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
}

function matchLabel(kind: ClientMatch["match"]): string {
  if (kind === "both") return "Email + phone";
  if (kind === "email") return "Email";
  return "Phone";
}

function ReviewClientDialog({
  pending,
  onClose,
  onReviewed,
}: {
  pending: PendingPayment;
  onClose: () => void;
  onReviewed: (updated: PendingPayment) => void;
}) {
  const { setError } = useApp();
  const [name, setName] = useState(pending.client_name || "");
  const [email, setEmail] = useState(pending.client_email || "");
  const [phone, setPhone] = useState(pending.client_phone || "");
  const [matches, setMatches] = useState<ClientMatch[]>([]);
  const [loadingMatches, setLoadingMatches] = useState(true);
  const [mergeClientId, setMergeClientId] = useState<number | null>(null);
  const [acknowledgePhone, setAcknowledgePhone] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadMatches = useCallback(async (nextEmail: string, nextPhone: string) => {
    setLoadingMatches(true);
    try {
      const params = new URLSearchParams();
      if (nextEmail.trim()) params.set("email", nextEmail.trim());
      if (nextPhone.trim()) params.set("phone", nextPhone.trim());
      const qs = params.toString();
      const res = await api<{ matches: ClientMatch[] }>(
        "GET",
        `/api/pending-payments/${pending.id}/review-preview${qs ? `?${qs}` : ""}`,
      );
      setMatches(res.matches);
      setMergeClientId((prev) => {
        if (prev != null && res.matches.some((m) => m.id === prev)) return prev;
        return null;
      });
      setAcknowledgePhone(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingMatches(false);
    }
  }, [pending.id, setError]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void loadMatches(email, phone);
    }, 350);
    return () => window.clearTimeout(handle);
  }, [email, phone, loadMatches]);

  const emailMatches = matches.filter((m) => m.match === "email" || m.match === "both");
  const phoneOnlyMatches = matches.filter((m) => m.match === "phone");
  const requiresMerge = emailMatches.length > 0 && mergeClientId == null;
  const requiresPhoneAck =
    mergeClientId == null && phoneOnlyMatches.length > 0 && emailMatches.length === 0 && !acknowledgePhone;

  const handleApprove = async () => {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (requiresMerge) {
      setError("Email matches an existing client — choose who to merge into, or change the email.");
      return;
    }
    if (requiresPhoneAck) {
      setError("Acknowledge the phone match, or merge into that client.");
      return;
    }

    setSaving(true);
    try {
      const res = await api<{ pending_payment: PendingPayment }>(
        "POST",
        `/api/pending-payments/${pending.id}/review`,
        {
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          merge_client_id: mergeClientId ?? undefined,
          acknowledge_phone_match:
            mergeClientId == null && phoneOnlyMatches.length > 0 ? true : undefined,
        },
      );
      onReviewed(res.pending_payment);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {pending.client_reviewed_at ? "Re-review client" : "Review client"}
          </DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Confirm payer details before applying this credit. Fix typos, merge duplicates, then approve.
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="review-name">Name</Label>
              <Input
                id="review-name"
                className="h-11"
                value={name}
                onChange={(e) => setName((e.target as HTMLInputElement).value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="review-email">Email</Label>
              <Input
                id="review-email"
                type="email"
                className="h-11"
                value={email}
                onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="review-phone">Phone</Label>
              <Input
                id="review-phone"
                className="h-11"
                value={phone}
                onChange={(e) => setPhone((e.target as HTMLInputElement).value)}
              />
            </div>

            <div className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Possible matches</p>
                {loadingMatches && (
                  <span className="text-xs text-muted-foreground">Checking…</span>
                )}
              </div>

              {!loadingMatches && matches.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No other clients match this email or phone.
                </p>
              )}

              {matches.length > 0 && (
                <ul className="space-y-2">
                  {matches.map((match) => {
                    const selected = mergeClientId === match.id;
                    return (
                      <li key={match.id}>
                        <button
                          type="button"
                          className={cn(
                            "w-full rounded-md border px-3 py-2 text-left transition-colors",
                            selected
                              ? "border-primary bg-primary/5"
                              : "border-input hover:bg-muted/60",
                          )}
                          onClick={() => {
                            setMergeClientId(selected ? null : match.id);
                            setAcknowledgePhone(false);
                          }}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">{match.name}</span>
                            <Pill className="border-transparent bg-secondary text-secondary-foreground">
                              {matchLabel(match.match)}
                            </Pill>
                            {selected && (
                              <Pill className="border-transparent bg-primary text-primary-foreground">
                                Merge into this
                              </Pill>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {[match.email, match.phone].filter(Boolean).join(" · ")}
                          </p>
                          {(match.name.trim().toLowerCase() !== name.trim().toLowerCase()) && (
                            <p className="mt-1 text-xs text-amber-800">
                              Name differs from form (“{match.name}” vs “{name || "blank"}”). Approving
                              will update the merged client with the fields above.
                            </p>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {emailMatches.length > 0 && mergeClientId == null && (
                <p className="text-sm text-amber-900">
                  Email already belongs to another client. Select a match to merge, or change the email.
                </p>
              )}

              {phoneOnlyMatches.length > 0 && emailMatches.length === 0 && mergeClientId == null && (
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={acknowledgePhone}
                    onChange={(e) => setAcknowledgePhone((e.target as HTMLInputElement).checked)}
                  />
                  <span>
                    Phone matches another client (possible shared number). Keep this as a separate
                    client, or tap a match above to merge.
                  </span>
                </label>
              )}

              {mergeClientId == null && matches.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Approving keeps client #{pending.client_id} with the details above.
                </p>
              )}
              {mergeClientId != null && (
                <p className="text-xs text-muted-foreground">
                  This credit will move onto the selected client. The form fields above become their
                  saved name, email, and phone.
                </p>
              )}
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={saving || requiresMerge || requiresPhoneAck || !name.trim()}
            onClick={handleApprove}
          >
            {saving ? "Saving…" : "Approve client"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApplyPendingDialog({
  pending,
  onClose,
  onApplied,
}: {
  pending: PendingPayment;
  onClose: () => void;
  onApplied: (appointmentId: number) => void;
}) {
  const { staffLookup, services, setError } = useApp();
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [clientApts, setClientApts] = useState<Appointment[]>([]);
  const [loadingApts, setLoadingApts] = useState(true);
  const [selectedAptId, setSelectedAptId] = useState("");
  const [staffId, setStaffId] = useState(pending.staff_id ? String(pending.staff_id) : "");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [startTime, setStartTime] = useState("09:00");
  const [duration, setDuration] = useState("60");
  const [customPrice, setCustomPrice] = useState(String(pending.quoted_total || pending.amount_paid));
  const [selectedServices, setSelectedServices] = useState<number[]>([]);
  const [travelFee, setTravelFee] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState(pending.notes || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoadingApts(true);
    api<{ appointments: Appointment[] }>("GET", `/api/clients/${pending.client_id}`)
      .then((res) => {
        const list = (res.appointments ?? []).filter(
          (apt) => apt.status !== "cancelled" && apt.status !== "no_show",
        );
        setClientApts(list);
        if (list.length === 0) setMode("new");
        else {
          setMode("existing");
          setSelectedAptId(String(list[0].id));
        }
      })
      .catch(() => {
        setClientApts([]);
        setMode("new");
      })
      .finally(() => setLoadingApts(false));
  }, [pending.client_id]);

  const toggleService = (id: number) => {
    setSelectedServices((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

  const serviceSum = services
    .filter((s) => selectedServices.includes(s.id))
    .reduce((sum, s) => sum + s.price, 0);
  const travel = parseFloat(travelFee) || 0;
  const total = (customPrice !== "" ? parseFloat(customPrice) || 0 : serviceSum) + travel;
  const applied = Math.min(pending.amount_paid, total);
  const balance = Math.max(0, Math.round((total - applied) * 100) / 100);

  const handleApply = async () => {
    setSaving(true);
    try {
      if (mode === "existing") {
        if (!selectedAptId) {
          setError("Select an appointment");
          setSaving(false);
          return;
        }
        const res = await api<{ appointment_id: number }>("POST", `/api/pending-payments/${pending.id}/apply`, {
          appointment_id: parseInt(selectedAptId, 10),
        });
        onApplied(res.appointment_id);
        return;
      }

      const res = await api<{ appointment_id: number }>("POST", `/api/pending-payments/${pending.id}/apply`, {
        staff_id: staffId ? parseInt(staffId, 10) : null,
        scheduled_date: date,
        start_time: startTime,
        duration_minutes: parseInt(duration, 10) || 60,
        service_ids: selectedServices,
        total_price: customPrice !== "" ? parseFloat(customPrice) || 0 : undefined,
        travel_fee: travel > 0 ? travel : undefined,
        service_address: address.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      onApplied(res.appointment_id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Apply payment (optional)</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Credit: {formatMoney(pending.amount_paid, pending.currency)}
              {pending.quoted_total > 0 && <> · Quoted {formatMoney(pending.quoted_total, pending.currency)}</>}
              . You can leave this open in the ledger and apply later.
            </p>

            <div className="space-y-2 rounded-lg border p-3">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="radio"
                  name="apply-mode"
                  className="mt-1"
                  checked={mode === "existing"}
                  disabled={loadingApts || clientApts.length === 0}
                  onChange={() => setMode("existing")}
                />
                <span className="text-sm">
                  <span className="font-medium">Link to existing appointment</span>
                  <span className="mt-0.5 block text-muted-foreground">
                    {loadingApts
                      ? "Loading…"
                      : clientApts.length === 0
                        ? "No upcoming appointments for this client"
                        : "Apply credit toward a booking already on the calendar"}
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="radio"
                  name="apply-mode"
                  className="mt-1"
                  checked={mode === "new"}
                  onChange={() => setMode("new")}
                />
                <span className="text-sm">
                  <span className="font-medium">Create new appointment</span>
                  <span className="mt-0.5 block text-muted-foreground">
                    Schedule now and apply this credit
                  </span>
                </span>
              </label>
            </div>

            {mode === "existing" && clientApts.length > 0 && (
              <div className="space-y-1.5">
                <Label>Appointment</Label>
                <select
                  className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={selectedAptId}
                  onChange={(e) => setSelectedAptId((e.target as HTMLSelectElement).value)}
                >
                  {clientApts.map((apt) => (
                    <option key={apt.id} value={apt.id}>
                      {apt.identifier} · {apt.scheduled_date} {formatTimeShort(apt.start_time)}
                      {apt.staff_name ? ` · ${apt.staff_name}` : ""}
                      {" · "}
                      paid {formatMoney(apt.amount_paid ?? 0, apt.currency || pending.currency)}
                      {" / "}
                      {formatMoney(apt.total_price, apt.currency || pending.currency)}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Will add {formatMoney(pending.amount_paid, pending.currency)} to amount paid on that booking.
                </p>
              </div>
            )}

            {mode === "new" && (
              <>
                <div className="space-y-1.5">
                  <Label>Staff</Label>
                  <select
                    className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={staffId}
                    onChange={(e) => setStaffId((e.target as HTMLSelectElement).value)}
                  >
                    <option value="">Unassigned</option>
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
                    <Label>Appointment total</Label>
                    <Input
                      type="number"
                      step="0.01"
                      className="h-11"
                      value={customPrice}
                      onChange={(e) => setCustomPrice((e.target as HTMLInputElement).value)}
                    />
                  </div>
                </div>
                {services.length > 0 && (
                  <div className="space-y-2">
                    <Label>Services (optional)</Label>
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
                  <Label>Travel fee (optional)</Label>
                  <Input type="number" step="0.01" className="h-11" value={travelFee} onChange={(e) => setTravelFee((e.target as HTMLInputElement).value)} />
                </div>
                {travel > 0 && (
                  <div className="space-y-1.5">
                    <Label>Service address</Label>
                    <Input className="h-11" value={address} onChange={(e) => setAddress((e.target as HTMLInputElement).value)} />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>Notes</Label>
                  <Input className="h-11" value={notes} onChange={(e) => setNotes((e.target as HTMLInputElement).value)} />
                </div>
                <p className="text-sm">
                  Apply {formatMoney(applied, pending.currency)}
                  {balance > 0 && <> · Balance due {formatMoney(balance, pending.currency)}</>}
                </p>
              </>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Leave open</Button>
          <Button disabled={saving || (mode === "existing" && !selectedAptId)} onClick={handleApply}>
            {saving ? "Saving…" : mode === "existing" ? "Apply credit" : "Create & apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CapturePendingDialog({
  pending,
  onClose,
  onCaptured,
}: {
  pending: PendingPayment;
  onClose: () => void;
  onCaptured: (appointmentId: number | null) => void;
}) {
  const { staffLookup, setError } = useApp();
  const [mode, setMode] = useState<"money_only" | "record_visit">("money_only");
  const [staffId, setStaffId] = useState(pending.staff_id ? String(pending.staff_id) : "");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const handleCapture = async () => {
    setSaving(true);
    try {
      const res = await api<{ appointment_id: number | null }>(
        "POST",
        `/api/pending-payments/${pending.id}/capture`,
        {
          mode,
          note: note.trim() || undefined,
          staff_id: mode === "record_visit" ? (staffId ? parseInt(staffId, 10) : null) : undefined,
          scheduled_date: mode === "record_visit" ? date : undefined,
        },
      );
      onCaptured(res.appointment_id ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open: boolean) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Capture payment</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Keep {formatMoney(pending.amount_paid, pending.currency)} without linking to an existing
              booking. Use this for walk-in cash, or when the visit was already completed another way.
            </p>

            <div className="space-y-2 rounded-lg border p-3">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="radio"
                  name="capture-mode"
                  className="mt-1"
                  checked={mode === "money_only"}
                  onChange={() => setMode("money_only")}
                />
                <span className="text-sm">
                  <span className="font-medium">Money only</span>
                  <span className="mt-0.5 block text-muted-foreground">
                    Record the payment. Does not add a visit.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="radio"
                  name="capture-mode"
                  className="mt-1"
                  checked={mode === "record_visit"}
                  onChange={() => setMode("record_visit")}
                />
                <span className="text-sm">
                  <span className="font-medium">Record a visit</span>
                  <span className="mt-0.5 block text-muted-foreground">
                    Create a completed appointment so it counts toward client visits
                  </span>
                </span>
              </label>
            </div>

            {mode === "record_visit" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Visit date</Label>
                  <Input
                    type="date"
                    className="h-11"
                    value={date}
                    onChange={(e: Event) => setDate((e.target as HTMLInputElement).value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Staff</Label>
                  <select
                    className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={staffId}
                    onChange={(e: Event) => setStaffId((e.target as HTMLSelectElement).value)}
                  >
                    <option value="">Unassigned</option>
                    {staffLookup.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="capture-note">Note (optional)</Label>
              <Input
                id="capture-note"
                className="h-11"
                placeholder="e.g. Walk-in cash · already completed"
                value={note}
                onChange={(e: Event) => setNote((e.target as HTMLInputElement).value)}
              />
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving} onClick={handleCapture}>
            {saving ? "Saving…" : mode === "record_visit" ? "Capture & record visit" : "Capture payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PendingPaymentsPage() {
  const { navigate, setError } = useApp();
  const [items, setItems] = useState<PendingPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewTarget, setReviewTarget] = useState<PendingPayment | null>(null);
  const [applyTarget, setApplyTarget] = useState<PendingPayment | null>(null);
  const [captureTarget, setCaptureTarget] = useState<PendingPayment | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ pending_payments: PendingPayment[] }>("GET", "/api/pending-payments?status=open");
      setItems(res.pending_payments);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => {
    void load();
  }, [load]);

  const markRefunded = async (id: number) => {
    const note = window.prompt("Refund note (optional) — mark as refunded only after you refund in Stripe:");
    if (note === null) return;
    try {
      await api("POST", `/api/pending-payments/${id}/mark-refunded`, { note: note.trim() || undefined });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Pending payments</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Open credits from payment links. Review the client first, then apply to a booking, capture
          the payment (with or without a visit), or mark refunded after Stripe.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Open credits ({items.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No open payments</p>
          ) : (
            <ul className="divide-y">
              {items.map((item) => {
                const age = daysAgo(item.created_at);
                const reviewed = Boolean(item.client_reviewed_at);
                return (
                  <li
                    key={item.id}
                    className={cn(
                      "flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between",
                      !reviewed && "bg-amber-50/60 -mx-2 px-2 rounded-md",
                      reviewed && item.client_was_existing && "bg-muted/40 -mx-2 px-2 rounded-md",
                    )}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{item.client_name || "Client"}</span>
                        {reviewed ? (
                          <Pill className="border-transparent bg-emerald-100 text-emerald-900">Approved</Pill>
                        ) : (
                          <Pill className="border-transparent bg-amber-100 text-amber-900">Needs review</Pill>
                        )}
                        {item.client_was_existing ? (
                          <Pill className="border-transparent bg-secondary text-secondary-foreground">Existing</Pill>
                        ) : (
                          <Pill>New</Pill>
                        )}
                        {age >= 14 && <Pill className="border-transparent bg-red-100 text-red-800">14+ days</Pill>}
                        {age >= 7 && age < 14 && <Pill className="border-transparent bg-amber-100 text-amber-900">7+ days</Pill>}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Paid {formatMoney(item.amount_paid, item.currency)}
                        {item.quoted_total > item.amount_paid + 0.009 && (
                          <> toward {formatMoney(item.quoted_total, item.currency)}</>
                        )}
                        {item.staff_name && <> · {item.staff_name}</>}
                        <> · {age === 0 ? "Today" : `${age}d ago`}</>
                      </p>
                      {(item.client_email || item.client_phone) && (
                        <p className="truncate text-xs text-muted-foreground">
                          {[item.client_email, item.client_phone].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      {item.notes && (
                        <p className="truncate text-xs text-muted-foreground">{item.notes}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant={reviewed ? "outline" : "default"}
                        onClick={() => setReviewTarget(item)}
                      >
                        {reviewed ? "Re-review" : "Review client"}
                      </Button>
                      <Button
                        size="sm"
                        variant={reviewed ? "default" : "outline"}
                        disabled={!reviewed}
                        title={reviewed ? undefined : "Approve the client before applying"}
                        onClick={() => setApplyTarget(item)}
                      >
                        Apply to appointment
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!reviewed}
                        title={reviewed ? undefined : "Approve the client before capturing"}
                        onClick={() => setCaptureTarget(item)}
                      >
                        Capture
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => markRefunded(item.id)}>
                        Mark refunded
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {reviewTarget && (
        <ReviewClientDialog
          pending={reviewTarget}
          onClose={() => setReviewTarget(null)}
          onReviewed={(updated) => {
            setReviewTarget(null);
            setItems((prev) => prev.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)));
          }}
        />
      )}

      {applyTarget && (
        <ApplyPendingDialog
          pending={applyTarget}
          onClose={() => setApplyTarget(null)}
          onApplied={(appointmentId) => {
            setApplyTarget(null);
            navigate(`/appointments/${appointmentId}`);
          }}
        />
      )}

      {captureTarget && (
        <CapturePendingDialog
          pending={captureTarget}
          onClose={() => setCaptureTarget(null)}
          onCaptured={(appointmentId) => {
            setCaptureTarget(null);
            if (appointmentId != null) {
              navigate(`/appointments/${appointmentId}`);
            } else {
              void load();
            }
          }}
        />
      )}
    </div>
  );
}
