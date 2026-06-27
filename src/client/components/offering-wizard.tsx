import { useState, useEffect } from "preact/hooks";
import { useApp } from "../context";
import { api } from "../api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, Plus, Trash2, Rocket, Check, Copy, Archive } from "lucide-preact";
import { ShareOfferingLink } from "./share-offering-link";
import {
  generateTimeSlots,
  countSlotInstances,
  expandDateWindows,
  inferDateScheduleMode,
  formatDateWindowsSummary,
  windowsToRange,
  rangeToDayWindows,
  canUseSpecificMode,
  MAX_SPECIFIC_DAYS,
  type DateScheduleMode,
} from "../../shared/offerings";
import { formatMoney, getCurrency } from "../../shared/currency";
import { cn, formatTimeShort } from "@/lib/utils";
import type { OfferingAddon, OfferingDateWindow, OfferingDetail, OfferingTimeSlot } from "../types";

const STEPS = ["Name it", "Your days", "Your times", "Price & extras", "All set"];

function snapshotAddons(addons: OfferingAddon[]): OfferingAddon[] {
  return addons.map((a) => ({ ...a }));
}

function pricingChanged(
  basePrice: number,
  addons: OfferingAddon[],
  savedBasePrice: number,
  savedAddons: OfferingAddon[],
): boolean {
  if (basePrice !== savedBasePrice) return true;
  for (const orig of savedAddons) {
    if (orig.id == null) continue;
    const current = addons.find((a) => a.id === orig.id);
    if (!current) return true;
    if (current.price !== orig.price) return true;
  }
  return false;
}

function applyCarnivalPreset(
  setGenStart: (v: string) => void,
  setGenEnd: (v: string) => void,
  setGenInterval: (v: number) => void,
  setCapacityPerSlot: (v: number) => void,
) {
  setGenStart("05:00");
  setGenEnd("12:00");
  setGenInterval(60);
  setCapacityPerSlot(4);
}

interface WizardProps {
  offeringId?: number;
}

export function EventOfferWizard({ offeringId }: WizardProps) {
  const {
    navigate, createOffering, updateOffering, goLiveOffering,
    duplicateOffering, archiveOffering, deleteOffering,
    setError, defaultCurrency, currencyOptions, blockRegularOnEventDays,
  } = useApp();

  const [step, setStep] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(!!offeringId);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState<OfferingDetail["status"]>("draft");
  const [savedId, setSavedId] = useState<number | null>(offeringId ?? null);
  const [goLiveConflicts, setGoLiveConflicts] = useState<{ identifier: string; client_name: string; scheduled_date: string; start_time: string }[] | null>(null);
  const [priceConfirmOpen, setPriceConfirmOpen] = useState(false);
  const [bookedAppointmentCount, setBookedAppointmentCount] = useState(0);
  const [maxBookedPerSlot, setMaxBookedPerSlot] = useState(0);
  const [canDelete, setCanDelete] = useState(false);
  const [deleteBlockedReason, setDeleteBlockedReason] = useState<string | null>(null);
  const [upcomingAppointmentCount, setUpcomingAppointmentCount] = useState(0);
  const [savedBasePrice, setSavedBasePrice] = useState(0);
  const [savedAddons, setSavedAddons] = useState<OfferingAddon[]>([]);
  const [blockRegularBookings, setBlockRegularBookings] = useState(true);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [detailedDescription, setDetailedDescription] = useState("");
  const [color, setColor] = useState("#ec4899");

  const [dateScheduleMode, setDateScheduleMode] = useState<DateScheduleMode>("specific");
  const [dateWindows, setDateWindows] = useState<OfferingDateWindow[]>([
    { start_date: "", end_date: "" },
    { start_date: "", end_date: "" },
  ]);

  const [genStart, setGenStart] = useState("05:00");
  const [genEnd, setGenEnd] = useState("12:00");
  const [genInterval, setGenInterval] = useState(60);

  const [capacityPerSlot, setCapacityPerSlot] = useState(4);
  const [basePrice, setBasePrice] = useState(150);
  const [duration, setDuration] = useState(60);
  const [useDefaultCurrency, setUseDefaultCurrency] = useState(true);
  const [offeringCurrency, setOfferingCurrency] = useState(defaultCurrency);

  const [addons, setAddons] = useState<OfferingAddon[]>([
    { name: "Lashes", price: 25, extra_duration: 0 },
    { name: "Gems", price: 15, extra_duration: 0 },
  ]);

  useEffect(() => {
    if (useDefaultCurrency) setOfferingCurrency(defaultCurrency);
  }, [defaultCurrency, useDefaultCurrency]);

  useEffect(() => {
    if (!offeringId) {
      setBlockRegularBookings(blockRegularOnEventDays);
    }
  }, [offeringId, blockRegularOnEventDays]);

  const activeCurrency = useDefaultCurrency ? defaultCurrency : offeringCurrency;

  useEffect(() => {
    if (!offeringId) return;
    setLoading(true);
    api<{
      offering: OfferingDetail;
      date_windows: OfferingDateWindow[];
      time_slots: OfferingTimeSlot[];
      addons: OfferingAddon[];
      booked_appointment_count?: number;
      max_booked_per_slot?: number;
      can_delete?: boolean;
      delete_blocked_reason?: string | null;
      upcoming_appointment_count?: number;
    }>("GET", `/api/offerings/${offeringId}`)
      .then((data) => {
        const o = data.offering;
        setName(o.name);
        setSlug(o.slug);
        setDescription(o.description);
        setDetailedDescription(o.detailed_description ?? "");
        if (o.description || o.detailed_description) setShowAdvanced(true);
        setColor(o.color);
        const loadedWindows = data.date_windows.length
          ? data.date_windows
          : [{ start_date: "", end_date: "" }];
        setDateWindows(loadedWindows);
        setDateScheduleMode(inferDateScheduleMode(loadedWindows));
        if (data.time_slots[0]) {
          setGenStart(data.time_slots[0].start_time);
          const last = data.time_slots[data.time_slots.length - 1];
          setGenEnd(last.end_time);
        }
        setCapacityPerSlot(o.capacity_per_slot);
        setBasePrice(o.base_price);
        setDuration(o.duration);
        const loadedCurrency = o.currency || defaultCurrency;
        setUseDefaultCurrency(loadedCurrency === defaultCurrency);
        setOfferingCurrency(loadedCurrency);
        const loadedAddons = data.addons.length ? data.addons : [];
        setAddons(loadedAddons);
        setSavedBasePrice(o.base_price);
        setSavedAddons(snapshotAddons(loadedAddons));
        setBookedAppointmentCount(data.booked_appointment_count ?? 0);
        setMaxBookedPerSlot(data.max_booked_per_slot ?? 0);
        setCanDelete(data.can_delete ?? false);
        setDeleteBlockedReason(data.delete_blocked_reason ?? null);
        setUpcomingAppointmentCount(data.upcoming_appointment_count ?? 0);
        setStatus(o.status);
        if (o.status === "archived") setStep(4);
        setSavedId(o.id);
        setBlockRegularBookings(
          o.block_regular_bookings !== null ? o.block_regular_bookings : blockRegularOnEventDays,
        );
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [offeringId, setError, defaultCurrency]);

  const resolvedTimeSlots = generateTimeSlots(genStart, genEnd, genInterval);
  const validWindows = dateWindows.filter((w) => w.start_date && w.end_date);
  const preview = countSlotInstances(validWindows, resolvedTimeSlots, capacityPerSlot);

  const buildPayload = () => ({
    name: name.trim(),
    description: description.trim(),
    detailed_description: detailedDescription.trim(),
    category: "Seasonal",
    color,
    staff_ids: [] as number[],
    date_windows: validWindows,
    time_slots: resolvedTimeSlots,
    capacity_per_slot: capacityPerSlot,
    base_price: basePrice,
    duration,
    currency: activeCurrency,
    block_regular_bookings: blockRegularBookings,
    addons: addons.filter((a) => a.name.trim()).map((a) => ({
      ...(a.id != null ? { id: a.id } : {}),
      name: a.name.trim(),
      price: a.price,
      extra_duration: 0,
    })),
  });

  const buildLivePayload = (confirmPriceChanges = false) => ({
    name: name.trim(),
    description: description.trim(),
    detailed_description: detailedDescription.trim(),
    color,
    base_price: basePrice,
    duration,
    capacity_per_slot: capacityPerSlot,
    block_regular_bookings: blockRegularBookings,
    addons: addons.filter((a) => a.name.trim()).map((a) => ({
      ...(a.id != null ? { id: a.id } : {}),
      name: a.name.trim(),
      price: a.price,
      extra_duration: 0,
    })),
    ...(confirmPriceChanges ? { confirm_price_changes: true } : {}),
  });

  const refreshAfterSave = async (id: number) => {
    const detail = await api<{
      offering: OfferingDetail;
      addons: OfferingAddon[];
      booked_appointment_count?: number;
      max_booked_per_slot?: number;
    }>("GET", `/api/offerings/${id}`);
    const loadedAddons = detail.addons.length ? detail.addons : [];
    setAddons(loadedAddons);
    setSavedBasePrice(detail.offering.base_price);
    setSavedAddons(snapshotAddons(loadedAddons));
    setCapacityPerSlot(detail.offering.capacity_per_slot);
    setBookedAppointmentCount(detail.booked_appointment_count ?? 0);
    setMaxBookedPerSlot(detail.max_booked_per_slot ?? 0);
    setPriceConfirmOpen(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleSaveLive = async (confirmPriceChanges = false) => {
    if (!savedId) return;
    if (!name.trim()) {
      setError("Give your event a name first");
      setStep(0);
      return;
    }

    if (
      !confirmPriceChanges
      && bookedAppointmentCount > 0
      && pricingChanged(basePrice, addons, savedBasePrice, savedAddons)
    ) {
      setPriceConfirmOpen(true);
      return;
    }

    setSaving(true);
    setSaved(false);
    try {
      await updateOffering(savedId, buildLivePayload(confirmPriceChanges));
      await refreshAfterSave(savedId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = async () => {
    if (!savedId) return;
    setSaving(true);
    try {
      const newId = await duplicateOffering(savedId);
      navigate(`/offers/event/${newId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!savedId) return;
    if (!confirm("Archive this event? The public booking page will stop working. Existing appointments stay on your calendar.")) {
      return;
    }
    setSaving(true);
    try {
      await archiveOffering(savedId);
      setStatus("archived");
      navigate("/offers");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!savedId || !canDelete) return;
    const label = name.trim() || "this event";
    const message = upcomingAppointmentCount > 0
      ? `Delete "${label}"? This will permanently remove ${upcomingAppointmentCount} upcoming appointment${upcomingAppointmentCount === 1 ? "" : "s"}. This cannot be undone.`
      : `Delete "${label}"? This cannot be undone.`;
    if (!confirm(message)) return;

    setSaving(true);
    try {
      await deleteOffering(savedId);
      navigate("/offers");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleGoLive = async () => {
    if (!name.trim()) {
      setError("Give your event a name first");
      setStep(0);
      return;
    }
    if (validWindows.length === 0) {
      setError("Pick at least one day");
      setStep(1);
      return;
    }
    if (resolvedTimeSlots.length === 0) {
      setError("Check your times — start must be before end");
      setStep(2);
      return;
    }

    setSaving(true);
    try {
      const payload = buildPayload();
      let id = savedId;
      if (id && status === "draft") {
        await updateOffering(id, payload);
      } else if (!id) {
        id = await createOffering(payload);
        setSavedId(id);
      }
      if (id) {
        const conflicts = await goLiveOffering(id);
        setStatus("live");
        const detail = await api<{ offering: OfferingDetail }>("GET", `/api/offerings/${id}`);
        setSlug(detail.offering.slug);
        if (conflicts.length > 0) {
          setGoLiveConflicts(conflicts);
        } else {
          navigate("/calendar");
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const updateDate = (index: number, value: string) => {
    setDateWindows((prev) => prev.map((w, i) => (
      i === index ? { start_date: value, end_date: value } : w
    )));
  };

  const updateRangeStart = (value: string) => {
    setDateWindows((prev) => {
      const end = prev[0]?.end_date || value;
      const nextEnd = value && end && value > end ? value : end;
      return [{ start_date: value, end_date: nextEnd }];
    });
  };

  const updateRangeEnd = (value: string) => {
    setDateWindows((prev) => {
      const start = prev[0]?.start_date || value;
      const nextStart = value && start && value < start ? value : start;
      return [{ start_date: nextStart, end_date: value }];
    });
  };

  const switchToRangeMode = () => {
    if (dateScheduleMode === "range") return;
    setDateScheduleMode("range");
    setDateWindows([windowsToRange(dateWindows)]);
  };

  const switchToSpecificMode = () => {
    if (dateScheduleMode === "specific") return;
    if (!canUseSpecificMode(dateWindows)) {
      setError(`Use a date range for periods longer than ${MAX_SPECIFIC_DAYS} days`);
      return;
    }
    setDateScheduleMode("specific");
    const filled = dateWindows.filter((w) => w.start_date && w.end_date);
    if (filled.length === 1 && filled[0].start_date !== filled[0].end_date) {
      setDateWindows(rangeToDayWindows(filled[0].start_date, filled[0].end_date));
    } else if (expandDateWindows(dateWindows).length > 0) {
      setDateWindows(
        expandDateWindows(dateWindows).map((d) => ({ start_date: d, end_date: d })),
      );
    } else {
      setDateWindows([
        { start_date: "", end_date: "" },
        { start_date: "", end_date: "" },
      ]);
    }
  };

  const handleNext = () => {
    if (step === 1 && validWindows.length === 0) {
      setError(dateScheduleMode === "range"
        ? "Pick a start and end date"
        : "Pick at least one day");
      return;
    }
    setStep((s) => s + 1);
  };

  const addAddon = () => setAddons((prev) => [...prev, { name: "", price: 0, extra_duration: 0 }]);
  const updateAddon = (index: number, field: "name" | "price", value: string | number) => {
    setAddons((prev) => prev.map((a, i) => (i === index ? { ...a, [field]: value } : a)));
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center p-8 text-muted-foreground">Loading…</div>;
  }

  const isDraft = status === "draft";
  const isLive = status === "live";
  const isArchived = status === "archived";
  const detailsEditable = isDraft || isLive;
  const scheduleLocked = !isDraft;
  const capacityEditable = isLive;
  const progress = `${step + 1} of ${STEPS.length}`;
  const canSaveLive = isLive && [0, 2, 3, 4].includes(step);
  const canManage = (isLive || isArchived) && step === 4;
  const showDelete = !!savedId && (isDraft || isLive || isArchived);

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 pb-24 md:p-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/offers")}>
        <ChevronLeft className="mr-1 h-4 w-4" /> Back
      </Button>

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{progress}</p>
        <h1 className="text-2xl font-bold tracking-tight">
          {scheduleLocked ? name : offeringId ? "Your event" : "Special event"}
        </h1>
        {isLive && (
          <p className="mt-1 text-sm text-emerald-600">
            You&apos;re live — edit the name, descriptions, prices, capacity, and extras below. Dates and times are locked.
            {bookedAppointmentCount > 0 && (
              <> {bookedAppointmentCount} client{bookedAppointmentCount === 1 ? "" : "s"} booked so far.</>
            )}
          </p>
        )}
        {isArchived && (
          <p className="mt-1 text-sm text-muted-foreground">
            This event is archived — the booking page is off. Duplicate it to run again next year.
          </p>
        )}
        {!isDraft && !isLive && (
          <p className="mt-1 text-sm text-muted-foreground">{status}</p>
        )}
        {saved && isLive && (
          <p className="mt-1 text-sm font-medium text-emerald-600">Changes saved.</p>
        )}
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">{STEPS[step]}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 0 && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="ev-name">Event name *</Label>
                <Input
                  id="ev-name"
                  className="h-12 text-base"
                  disabled={!detailsEditable}
                  value={name}
                  onInput={(e) => setName((e.target as HTMLInputElement).value)}
                  placeholder="Carnival Beauty Hub 2026"
                />
              </div>
              {detailsEditable && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="ev-description">Short description</Label>
                    <Input
                      id="ev-description"
                      value={description}
                      onInput={(e) => setDescription((e.target as HTMLInputElement).value)}
                      placeholder="One-line summary for your calendar and booking page"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ev-detailed-description">Detailed description</Label>
                    <Textarea
                      id="ev-detailed-description"
                      rows={4}
                      value={detailedDescription}
                      onInput={(e) => setDetailedDescription((e.target as HTMLTextAreaElement).value)}
                      placeholder="Tell clients what to expect — schedule, what's included, parking, etc."
                    />
                  </div>
                </>
              )}
              {detailsEditable && (
                <button
                  type="button"
                  className="text-sm text-primary underline-offset-2 hover:underline"
                  onClick={() => setShowAdvanced((v) => !v)}
                >
                  {showAdvanced ? "Hide extra options" : "More options (optional)"}
                </button>
              )}
              {showAdvanced && detailsEditable && (
                <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Color on calendar</Label>
                    <Input type="color" className="h-10 w-full" value={color} onInput={(e) => setColor((e.target as HTMLInputElement).value)} />
                  </div>
                </div>
              )}
            </>
          )}

          {step === 1 && (
            <>
              {scheduleLocked && (
                <p className="text-sm text-muted-foreground">
                  {isLive
                    ? "Dates can't be changed while your event is live."
                    : "These dates are locked."}
                </p>
              )}
              {!scheduleLocked && (
                <p className="text-sm text-muted-foreground">When does this run?</p>
              )}
              {!scheduleLocked && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className={cn(
                      "rounded-lg border p-3 text-left text-sm transition-colors",
                      dateScheduleMode === "specific"
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-input hover:bg-muted/50",
                    )}
                    onClick={switchToSpecificMode}
                  >
                    <span className="font-medium">Specific days</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      e.g. Carnival Mon &amp; Tue
                    </span>
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "rounded-lg border p-3 text-left text-sm transition-colors",
                      dateScheduleMode === "range"
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-input hover:bg-muted/50",
                    )}
                    onClick={switchToRangeMode}
                  >
                    <span className="font-medium">Date range</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      e.g. Jul 1–19 promo
                    </span>
                  </button>
                </div>
              )}
              {dateScheduleMode === "range" ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>From</Label>
                      <Input
                        type="date"
                        className="h-12 text-base"
                        disabled={scheduleLocked}
                        value={dateWindows[0]?.start_date ?? ""}
                        onInput={(e) => updateRangeStart((e.target as HTMLInputElement).value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>To</Label>
                      <Input
                        type="date"
                        className="h-12 text-base"
                        disabled={scheduleLocked}
                        value={dateWindows[0]?.end_date ?? ""}
                        min={dateWindows[0]?.start_date || undefined}
                        onInput={(e) => updateRangeEnd((e.target as HTMLInputElement).value)}
                      />
                    </div>
                  </div>
                  {!scheduleLocked && (
                    <p className="text-xs text-muted-foreground">
                      Same hours and pricing apply every day in this range.
                    </p>
                  )}
                </>
              ) : (
                <>
                  {!scheduleLocked && (
                    <p className="text-xs text-muted-foreground">
                      Tap each day you&apos;re open.
                    </p>
                  )}
                  {dateWindows.map((window, i) => (
                    <div key={i} className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Day {i + 1}</Label>
                      <Input
                        type="date"
                        className="h-12 text-base"
                        disabled={scheduleLocked}
                        value={window.start_date}
                        onInput={(e) => updateDate(i, (e.target as HTMLInputElement).value)}
                      />
                    </div>
                  ))}
                  {!scheduleLocked && dateWindows.length < MAX_SPECIFIC_DAYS && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDateWindows((p) => [...p, { start_date: "", end_date: "" }])}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" /> Add another day
                    </Button>
                  )}
                </>
              )}
              {validWindows.length > 0 && (
                <p className="rounded-lg bg-muted/50 p-3 text-sm">
                  {formatDateWindowsSummary(validWindows)}
                  {dateScheduleMode === "range" && preview.days > 0 && (
                    <> · same hours each day</>
                  )}
                </p>
              )}
            </>
          )}

          {step === 2 && (
            <>
              {scheduleLocked && isLive && (
                <p className="text-sm text-muted-foreground">
                  Times can&apos;t be changed while your event is live.
                  {capacityEditable && (
                    <> You can still adjust how many clients fit each time slot
                      {maxBookedPerSlot > 0 && (
                        <> — minimum <strong>{maxBookedPerSlot}</strong> because that&apos;s the most booked in any slot</>
                      )}.
                    </>
                  )}
                </p>
              )}
              {!scheduleLocked && (
                <Button
                  variant="outline"
                  className="h-11 w-full"
                  onClick={() => applyCarnivalPreset(setGenStart, setGenEnd, setGenInterval, setCapacityPerSlot)}
                >
                  Use Carnival preset (5am–12pm, hourly, 4 per slot)
                </Button>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>From</Label>
                  <Input type="time" className="h-12" disabled={scheduleLocked} value={genStart} onInput={(e) => setGenStart((e.target as HTMLInputElement).value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Until</Label>
                  <Input type="time" className="h-12" disabled={scheduleLocked} value={genEnd} onInput={(e) => setGenEnd((e.target as HTMLInputElement).value)} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>How many clients per time slot?</Label>
                <Input
                  type="number"
                  min={Math.max(1, maxBookedPerSlot)}
                  className="h-12 text-base"
                  disabled={scheduleLocked && !capacityEditable}
                  value={capacityPerSlot}
                  onInput={(e) => {
                    const next = parseInt((e.target as HTMLInputElement).value, 10) || 1;
                    setCapacityPerSlot(Math.max(next, maxBookedPerSlot, 1));
                  }}
                />
                {capacityEditable && maxBookedPerSlot > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Can&apos;t go below {maxBookedPerSlot} — {maxBookedPerSlot} spot{maxBookedPerSlot === 1 ? "" : "s"} already booked in at least one time slot.
                  </p>
                )}
              </div>
              <p className="rounded-lg bg-muted/50 p-3 text-sm">
                <strong>{resolvedTimeSlots.length}</strong> time slots per day
                {validWindows.length > 0 && (
                  <> · <strong>{preview.totalSlots}</strong> total across your days</>
                )}
              </p>
            </>
          )}

          {step === 3 && (
            <>
              {isLive && bookedAppointmentCount > 0 && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  {bookedAppointmentCount} client{bookedAppointmentCount === 1 ? "" : "s"} already booked.
                  Price changes apply to <strong>future</strong> bookings only — existing appointments keep their totals.
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Base price ({activeCurrency})</Label>
                  <Input type="number" min={0} className="h-12 text-base" disabled={!detailsEditable} value={basePrice} onInput={(e) => setBasePrice(parseFloat((e.target as HTMLInputElement).value) || 0)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Minutes per client</Label>
                  <Input type="number" min={15} className="h-12" disabled={!detailsEditable} value={duration} onInput={(e) => setDuration(parseInt((e.target as HTMLInputElement).value, 10) || 60)} />
                </div>
              </div>
              {detailsEditable && !scheduleLocked && (
                <div className="space-y-2 rounded-lg border p-3">
                  <Label className="text-sm font-medium">Pricing currency</Label>
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="radio"
                      name="offering-currency-mode"
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
                      name="offering-currency-mode"
                      className="mt-1"
                      checked={!useDefaultCurrency}
                      onChange={() => setUseDefaultCurrency(false)}
                    />
                    <span className="text-sm">
                      <span className="font-medium">Set for this event</span>
                      {!useDefaultCurrency && (
                        <select
                          className="mt-2 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={offeringCurrency}
                          onChange={(e) => setOfferingCurrency((e.target as HTMLSelectElement).value)}
                        >
                          {currencyOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      )}
                    </span>
                  </label>
                  {!useDefaultCurrency && activeCurrency !== defaultCurrency && (
                    <p className="text-xs text-muted-foreground">
                      Event prices are in {activeCurrency}. Everyday services stay in {defaultCurrency}.
                    </p>
                  )}
                </div>
              )}
              {scheduleLocked && activeCurrency !== defaultCurrency && (
                <p className="text-xs text-muted-foreground">
                  Prices for this event are in {activeCurrency} (not your everyday {defaultCurrency}).
                </p>
              )}
              <div className="space-y-2">
                <Label>Extras clients can add (optional)</Label>
                {addons.map((addon, i) => (
                  <div key={addon.id ?? i} className="flex gap-2">
                    <Input placeholder="e.g. Lashes" className="h-11" disabled={!detailsEditable} value={addon.name} onInput={(e) => updateAddon(i, "name", (e.target as HTMLInputElement).value)} />
                    <Input type="number" placeholder={`+${activeCurrency}`} className="h-11 w-24" disabled={!detailsEditable} value={addon.price} onInput={(e) => updateAddon(i, "price", parseFloat((e.target as HTMLInputElement).value) || 0)} />
                    {detailsEditable && addons.length > 1 && (
                      <Button variant="ghost" size="icon" onClick={() => setAddons((p) => p.filter((_, j) => j !== i))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                {detailsEditable && (
                  <Button variant="outline" size="sm" onClick={addAddon}><Plus className="mr-1 h-3.5 w-3.5" /> Add extra</Button>
                )}
              </div>
            </>
          )}

          {step === 4 && (
            <div className="space-y-3 text-sm">
              <p className="text-lg font-semibold">{name || "Your event"}</p>
              <p>{formatDateWindowsSummary(validWindows) || "No days yet"}</p>
              <p>{resolvedTimeSlots.length} times per day · {capacityPerSlot} clients each</p>
              <p>Starting at {formatMoney(basePrice, activeCurrency)} {activeCurrency}</p>
              {addons.filter((a) => a.name).length > 0 && (
                <p>Extras: {addons.filter((a) => a.name).map((a) => `${a.name} +${formatMoney(a.price, activeCurrency)}`).join(", ")}</p>
              )}
              {isDraft && (
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-muted/30 p-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={blockRegularBookings}
                    onChange={(e) => setBlockRegularBookings((e.target as HTMLInputElement).checked)}
                  />
                  <span>
                    <span className="font-medium">Only event clients on these days</span>
                    <span className="mt-0.5 block text-muted-foreground">
                      Block bridal and other regular bookings on these dates. Book through event times instead.
                    </span>
                  </span>
                </label>
              )}
              {isLive && (
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-muted/30 p-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={blockRegularBookings}
                    onChange={(e) => setBlockRegularBookings((e.target as HTMLInputElement).checked)}
                  />
                  <span>
                    <span className="font-medium">Only event clients on these days</span>
                    <span className="mt-0.5 block text-muted-foreground">
                      Block bridal and other regular bookings on these dates.
                    </span>
                  </span>
                </label>
              )}
              {isLive && slug && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <p className="mb-2 text-sm font-medium">Share the booking page with clients.</p>
                  <ShareOfferingLink slug={slug} name={name || "event"} variant="button" />
                </div>
              )}
              {canManage && (
                <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                  <p className="text-sm font-medium">Need a fresh start?</p>
                  <p className="text-sm text-muted-foreground">
                    Duplicate copies your prices and times into a new draft — just update the dates.
                    Archive turns off the booking page without deleting appointments.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={saving} onClick={handleDuplicate}>
                      <Copy className="mr-1 h-4 w-4" /> Duplicate for next year
                    </Button>
                    {isLive && (
                      <Button type="button" variant="outline" size="sm" disabled={saving} onClick={handleArchive}>
                        <Archive className="mr-1 h-4 w-4" /> Archive event
                      </Button>
                    )}
                  </div>
                </div>
              )}
              {showDelete && (
                <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                  <p className="text-sm font-medium text-destructive">Delete event</p>
                  {canDelete ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        {upcomingAppointmentCount > 0
                          ? `Permanently remove this event and ${upcomingAppointmentCount} upcoming appointment${upcomingAppointmentCount === 1 ? "" : "s"}.`
                          : "Permanently remove this event. Use this to scrap a setup and start over."}
                      </p>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={saving}
                        onClick={handleDelete}
                      >
                        <Trash2 className="mr-1 h-4 w-4" /> Delete permanently
                      </Button>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">{deleteBlockedReason}</p>
                  )}
                </div>
              )}
              {isDraft && (
                <p className="text-muted-foreground">Tap the button below — your calendar will be ready for those days.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="outline" className="h-11" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          <ChevronLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <div className="flex flex-wrap gap-2">
          {canSaveLive && (
            <Button className="h-11 px-6" variant={step === STEPS.length - 1 ? "default" : "outline"} disabled={saving} onClick={() => handleSaveLive()}>
              <Check className="mr-1 h-4 w-4" />
              {saving ? "Saving…" : saved ? "Saved" : "Save changes"}
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button className="h-11 px-6" onClick={handleNext}>
              Next <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <>
              {isDraft && (
                <Button className="h-12 px-8 text-base" disabled={saving} onClick={handleGoLive}>
                  <Rocket className="mr-2 h-5 w-5" />
                  {saving ? "Setting up…" : "Save & go live"}
                </Button>
              )}
              {isLive && (
                <Button variant="outline" className="h-12" onClick={() => navigate("/calendar")}>Open calendar</Button>
              )}
            </>
          )}
        </div>
      </div>

      {priceConfirmOpen && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="space-y-3 p-4 text-sm">
            <p className="font-semibold text-amber-900">
              {bookedAppointmentCount} client{bookedAppointmentCount === 1 ? "" : "s"} already booked at the current price
            </p>
            <p className="text-amber-800">
              New prices will apply to future bookings only. Existing appointments keep what they paid.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={saving} onClick={() => handleSaveLive(true)}>
                {saving ? "Saving…" : "Update prices anyway"}
              </Button>
              <Button variant="outline" onClick={() => setPriceConfirmOpen(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {goLiveConflicts && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="space-y-3 p-4 text-sm">
            <p className="font-semibold text-amber-900">Heads up — you already have regular bookings on these days:</p>
            <ul className="list-inside list-disc text-amber-800">
              {goLiveConflicts.map((c) => (
                <li key={c.identifier}>{c.client_name} · {c.scheduled_date} {formatTimeShort(c.start_time)} ({c.identifier})</li>
              ))}
            </ul>
            <p className="text-amber-800">They weren&apos;t removed. Review them on the calendar.</p>
            <Button className="w-full" onClick={() => navigate("/calendar")}>Open calendar</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Keep old export name for any lingering imports
export { EventOfferWizard as OfferingWizard };
