import { useState, useMemo, useRef } from "preact/hooks";
import { useApp } from "../context";
import { ChevronLeft, ChevronRight, Plus, X, Ban, Link2, CalendarDays } from "lucide-preact";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CreateAppointment } from "./create-appointment";
import { CreateBookingLink } from "./create-booking-link";
import { BookOfferingSlot } from "./book-offering-slot";
import { MobileNavTrigger } from "./mobile-nav-trigger";
import { StatusBadge } from "./status-badge";
import { CloseOutRowActions, useCloseOutClock } from "./close-out-row-actions";
import { CalendarAppointmentBlock } from "./calendar-appointment-block";
import { cn, formatTimeShort } from "@/lib/utils";
import { needsCloseOut } from "../../shared/appointment-closeout";
import type { Appointment, AppointmentStatus, BlockedSlot, OfferingSlotInstance, StaffLookup } from "../types";

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function formatHour(h: number): string {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

interface TimedLayoutItem {
  id: number;
  startMin: number;
  endMin: number;
}

function layoutCluster(cluster: TimedLayoutItem[]): Map<number, { column: number; totalColumns: number }> {
  const sorted = [...cluster].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const columns: TimedLayoutItem[][] = [];

  for (const item of sorted) {
    let placed = false;
    for (const col of columns) {
      const last = col[col.length - 1];
      if (last.endMin <= item.startMin) {
        col.push(item);
        placed = true;
        break;
      }
    }
    if (!placed) columns.push([item]);
  }

  const totalColumns = columns.length;
  const result = new Map<number, { column: number; totalColumns: number }>();
  for (let colIdx = 0; colIdx < columns.length; colIdx++) {
    for (const item of columns[colIdx]) {
      result.set(item.id, { column: colIdx, totalColumns });
    }
  }
  return result;
}

function layoutOverlappingTimedItems(items: TimedLayoutItem[]): Map<number, { column: number; totalColumns: number }> {
  if (items.length === 0) return new Map();

  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const result = new Map<number, { column: number; totalColumns: number }>();

  let cluster: TimedLayoutItem[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (cluster.length === 0) return;
    for (const [id, pos] of layoutCluster(cluster)) {
      result.set(id, pos);
    }
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const item of sorted) {
    if (cluster.length > 0 && item.startMin >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  flush();

  return result;
}

function getCalendarHours(slots: OfferingSlotInstance[]): number[] {
  let minH = 7;
  let maxH = 20;
  for (const slot of slots) {
    minH = Math.min(minH, Math.floor(timeToMinutes(slot.start_time) / 60));
    maxH = Math.max(maxH, Math.ceil(timeToMinutes(slot.end_time) / 60));
  }
  return Array.from({ length: maxH - minH + 1 }, (_, i) => i + minH);
}

type AgendaItem =
  | { kind: "appointment"; sortKey: number; appointment: Appointment }
  | { kind: "blocked"; sortKey: number; block: BlockedSlot; staffName: string; staffColor?: string }
  | { kind: "offering"; sortKey: number; slot: OfferingSlotInstance };

function buildAgendaItems(
  appointments: Appointment[],
  blocked: BlockedSlot[],
  offeringSlots: OfferingSlotInstance[],
  staffLookup: StaffLookup[],
  staffFilter: number | "all" | "unassigned",
): AgendaItem[] {
  const staffById = new Map(staffLookup.map((s) => [s.id, s]));
  const items: AgendaItem[] = [];

  for (const apt of appointments) {
    if (staffFilter === "unassigned") {
      if (apt.staff_id) continue;
    } else if (staffFilter !== "all" && apt.staff_id !== staffFilter) {
      continue;
    }
    items.push({ kind: "appointment", sortKey: timeToMinutes(apt.start_time), appointment: apt });
  }

  for (const block of blocked) {
    if (staffFilter === "unassigned") continue;
    if (staffFilter !== "all" && block.staff_id !== staffFilter) continue;
    const staff = staffById.get(block.staff_id);
    items.push({
      kind: "blocked",
      sortKey: timeToMinutes(block.start_time),
      block,
      staffName: staff?.name || "Staff",
      staffColor: staff?.color,
    });
  }

  if (staffFilter === "all" || staffFilter === "unassigned") {
    for (const slot of offeringSlots) {
      items.push({ kind: "offering", sortKey: timeToMinutes(slot.start_time), slot });
    }
  }

  return items.sort((a, b) => a.sortKey - b.sortKey);
}

function CalendarMobileAgenda({
  items,
  now,
  onOpenAppointment,
  onOpenOfferingSlot,
  onDeleteBlock,
  onCloseOut,
}: {
  items: AgendaItem[];
  now: Date;
  onOpenAppointment: (id: number) => void;
  onOpenOfferingSlot: (slot: OfferingSlotInstance) => void;
  onDeleteBlock: (id: number) => void;
  onCloseOut: (id: number, status: AppointmentStatus) => Promise<void>;
}) {
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nothing scheduled for this day
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        if (item.kind === "appointment") {
          const apt = item.appointment;
          const showCloseOut = needsCloseOut(apt, now);
          return (
            <div
              key={`apt-${apt.id}`}
              className={cn(
                "rounded-lg border bg-card p-4",
                showCloseOut && "border-amber-500/30 bg-amber-50/40",
              )}
            >
              <button
                type="button"
                className="w-full text-left"
                onClick={() => onOpenAppointment(apt.id)}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-muted-foreground">
                    {formatTimeShort(apt.start_time)} – {formatTimeShort(apt.end_time)}
                  </p>
                  {!showCloseOut && <StatusBadge status={apt.status} />}
                </div>
                <p className="mb-1.5 font-semibold leading-tight">{apt.client_name}</p>
                {apt.staff_name ? (
                  <p className="mb-1 flex items-center gap-1.5 text-sm">
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: apt.staff_color || "#7c3aed" }}
                    />
                    {apt.staff_name}
                  </p>
                ) : (
                  <p className="mb-1 text-sm text-muted-foreground">Unassigned</p>
                )}
                {(apt.offering_name || apt.service_name) && (
                  <p className="text-sm text-muted-foreground">{apt.offering_name || apt.service_name}</p>
                )}
              </button>
              {showCloseOut && (
                <div className="mt-3 border-t border-amber-500/20 pt-3">
                  <CloseOutRowActions
                    appointment={apt}
                    now={now}
                    onCloseOut={(status) => onCloseOut(apt.id, status)}
                  />
                </div>
              )}
            </div>
          );
        }

        if (item.kind === "blocked") {
          const { block, staffName, staffColor } = item;
          return (
            <div
              key={`block-${block.id}`}
              className="flex items-start justify-between gap-3 rounded-lg border border-dashed bg-muted/40 p-4"
            >
              <div className="min-w-0">
                <p className="mb-1 text-sm font-medium text-muted-foreground">
                  {formatTimeShort(block.start_time)} – {formatTimeShort(block.end_time)}
                </p>
                <p className="mb-1 flex items-center gap-1.5 text-sm font-medium">
                  {staffColor && (
                    <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: staffColor }} />
                  )}
                  {staffName}
                </p>
                <p className="text-sm text-muted-foreground">{block.reason || "Blocked"}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground"
                onClick={() => onDeleteBlock(block.id)}
                aria-label="Remove block"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          );
        }

        const { slot } = item;
        const full = slot.booked_count >= slot.capacity;
        return (
          <button
            key={`slot-${slot.id}`}
            type="button"
            className={cn(
              "w-full rounded-lg border-l-[3px] bg-card p-4 text-left transition-colors active:bg-muted/50",
              full && "opacity-60",
            )}
            style={{ borderLeftColor: slot.offering_color }}
            onClick={() => !full && onOpenOfferingSlot(slot)}
            disabled={full}
          >
            <p className="mb-1 text-sm font-medium text-muted-foreground">
              {formatTimeShort(slot.start_time)} – {formatTimeShort(slot.end_time)}
            </p>
            <p className="mb-1 font-semibold leading-tight">{slot.offering_name}</p>
            <p className="text-sm text-muted-foreground">
              {slot.booked_count}/{slot.capacity} booked
              {full ? " · Full" : " · Tap to book"}
            </p>
          </button>
        );
      })}
    </div>
  );
}

export function CalendarView() {
  const {
    calendarAppointments, calendarBlocked, calendarOfferingSlots, calendarEventDay,
    calendarDate, setCalendarDate,
    staffLookup, navigate, deleteBlockedSlot, addBlockedSlot, updateAppointment,
  } = useApp();
  const now = useCloseOutClock();
  const [showCreate, setShowCreate] = useState(false);
  const [showBookingLink, setShowBookingLink] = useState(false);
  const [showBlockForm, setShowBlockForm] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<OfferingSlotInstance | null>(null);
  const [blockStaff, setBlockStaff] = useState("");
  const [blockStart, setBlockStart] = useState("12:00");
  const [blockEnd, setBlockEnd] = useState("13:00");
  const [blockReason, setBlockReason] = useState("");
  const [mobileStaffFilter, setMobileStaffFilter] = useState<number | "all" | "unassigned">("all");
  const dateInputRef = useRef<HTMLInputElement>(null);

  const HOURS = useMemo(() => getCalendarHours(calendarOfferingSlots), [calendarOfferingSlots]);
  const regularBlocked = calendarEventDay.block_regular_bookings;
  const hasEventSlots = calendarOfferingSlots.length > 0;
  const hasUnassigned = calendarAppointments.some((a) => !a.staff_id);

  const agendaItems = useMemo(
    () => buildAgendaItems(calendarAppointments, calendarBlocked, calendarOfferingSlots, staffLookup, mobileStaffFilter),
    [calendarAppointments, calendarBlocked, calendarOfferingSlots, staffLookup, mobileStaffFilter],
  );

  const dateObj = new Date(calendarDate + "T00:00:00");
  const todayStr = new Date().toISOString().split("T")[0];
  const mobileDateLabel = dateObj.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  const shiftDay = (delta: number) => {
    const d = new Date(calendarDate + "T00:00:00");
    d.setDate(d.getDate() + delta);
    setCalendarDate(d.toISOString().split("T")[0]);
  };

  const openDatePicker = () => {
    const input = dateInputRef.current;
    if (!input) return;
    if (typeof input.showPicker === "function") {
      input.showPicker();
    } else {
      input.click();
    }
  };

  const dayStart = HOURS[0] * 60;
  const dayEnd = (HOURS[HOURS.length - 1] + 1) * 60;
  const totalMinutes = dayEnd - dayStart;
  const hourHeight = 64;
  const totalHeight = (totalMinutes / 60) * hourHeight;

  const handleAddBlock = async () => {
    if (!blockStaff) return;
    await addBlockedSlot({
      staff_id: parseInt(blockStaff),
      blocked_date: calendarDate,
      start_time: blockStart,
      end_time: blockEnd,
      reason: blockReason,
    });
    setShowBlockForm(false);
    setBlockReason("");
  };

  const datePickerInput = (
    <input
      ref={dateInputRef}
      type="date"
      value={calendarDate}
      className="sr-only"
      aria-label="Jump to date"
      onChange={(e) => setCalendarDate((e.target as HTMLInputElement).value)}
    />
  );

  return (
    <div className="flex h-full flex-col space-y-4 p-4 pb-8 md:p-6">
      {datePickerInput}
      {/* Mobile header */}
      <div className="space-y-3 md:hidden">
        <div className="flex items-center gap-2">
          <MobileNavTrigger />
          <h1 className="min-w-0 flex-1 text-xl font-bold tracking-tight">Calendar</h1>
          <Button size="sm" className="shrink-0" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5" />
            <span className="ml-1">New</span>
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => shiftDay(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <button
            type="button"
            onClick={openDatePicker}
            className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-sm font-semibold transition-colors hover:bg-muted"
          >
            <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{mobileDateLabel}</span>
          </button>
          <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => shiftDay(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => setCalendarDate(todayStr)}>
            Today
          </Button>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={() => setShowBlockForm(!showBlockForm)}>
            <Ban className="mr-1 h-3.5 w-3.5" /> Block
          </Button>
          <Button variant="outline" size="sm" className="flex-1" disabled={regularBlocked} onClick={() => setShowBookingLink(true)}>
            <Link2 className="mr-1 h-3.5 w-3.5" /> Link
          </Button>
        </div>
        {(staffLookup.length > 1 || hasUnassigned) && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                mobileStaffFilter === "all"
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background text-muted-foreground",
              )}
              onClick={() => setMobileStaffFilter("all")}
            >
              All
            </button>
            {staffLookup.map((member) => (
              <button
                key={member.id}
                type="button"
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  mobileStaffFilter === member.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background text-muted-foreground",
                )}
                onClick={() => setMobileStaffFilter(member.id)}
              >
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: member.color }} />
                {member.name}
              </button>
            ))}
            {hasUnassigned && (
              <button
                type="button"
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  mobileStaffFilter === "unassigned"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background text-muted-foreground",
                )}
                onClick={() => setMobileStaffFilter("unassigned")}
              >
                Unassigned
              </button>
            )}
          </div>
        )}
      </div>

      {/* Desktop header */}
      <div className="hidden items-center justify-between gap-2 md:flex">
        <div className="flex min-w-0 items-center gap-2">
          <MobileNavTrigger />
          <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCalendarDate(todayStr)}>Today</Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => shiftDay(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <button
            type="button"
            onClick={openDatePicker}
            title="Jump to date"
            className="flex min-w-[200px] items-center justify-center gap-1.5 rounded-md px-2 py-1 text-center text-sm font-semibold transition-colors hover:bg-muted"
          >
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            {dateObj.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" })}
          </button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => shiftDay(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowBlockForm(!showBlockForm)}>
            <Ban className="mr-1 h-3.5 w-3.5" /> Block Time
          </Button>
          <Button variant="outline" size="sm" disabled={regularBlocked} onClick={() => setShowBookingLink(true)}>
            <Link2 className="mr-1 h-3.5 w-3.5" /> Booking link
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" /> New Booking
          </Button>
        </div>
      </div>

      {regularBlocked && calendarEventDay.event_names.length > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 text-sm">
            <p className="font-semibold">{calendarEventDay.event_names.join(" · ")} day</p>
            <p className="text-muted-foreground">
              Use <strong>New Booking</strong> or tap a time in the <strong>Event times</strong> column.
            </p>
          </CardContent>
        </Card>
      )}

      {hasEventSlots && !regularBlocked && (
        <Card className="border-primary/20 bg-muted/30">
          <CardContent className="p-4 text-sm text-muted-foreground">
            <strong className="text-foreground">Event day.</strong> Book clients with <strong>New Booking</strong> or the Event times column.
          </CardContent>
        </Card>
      )}

      {showBlockForm && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-end">
            <div className="space-y-1 md:flex-1">
              <Label className="text-xs">Staff</Label>
              <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={blockStaff} onChange={(e) => setBlockStaff((e.target as HTMLSelectElement).value)}>
                <option value="">Select staff...</option>
                {staffLookup.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="flex gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Start</Label>
                <Input type="time" className="h-9 w-full min-w-0 sm:w-28" value={blockStart} onChange={(e) => setBlockStart((e.target as HTMLInputElement).value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">End</Label>
                <Input type="time" className="h-9 w-full min-w-0 sm:w-28" value={blockEnd} onChange={(e) => setBlockEnd((e.target as HTMLInputElement).value)} />
              </div>
            </div>
            <div className="space-y-1 md:flex-1">
              <Label className="text-xs">Reason</Label>
              <Input className="h-9" placeholder="e.g. Lunch break" value={blockReason} onChange={(e) => setBlockReason((e.target as HTMLInputElement).value)} />
            </div>
            <Button size="sm" className="w-full md:w-auto" onClick={handleAddBlock}>Add Block</Button>
          </CardContent>
        </Card>
      )}

      {showCreate && <CreateAppointment onClose={() => setShowCreate(false)} defaultDate={calendarDate} />}
      {showBookingLink && <CreateBookingLink onClose={() => setShowBookingLink(false)} defaultDate={calendarDate} />}
      {selectedSlot && <BookOfferingSlot slot={selectedSlot} onClose={() => setSelectedSlot(null)} />}

      <div className="md:hidden">
        <CalendarMobileAgenda
          items={agendaItems}
          now={now}
          onOpenAppointment={(id) => navigate(`/appointments/${id}`)}
          onOpenOfferingSlot={setSelectedSlot}
          onDeleteBlock={deleteBlockedSlot}
          onCloseOut={(id, status) => updateAppointment(id, { status })}
        />
      </div>

      <div className="hidden flex-1 overflow-x-auto rounded-lg border bg-card md:flex">
        {/* Time gutter */}
        <div className="w-16 flex-shrink-0 border-r bg-muted/30 pt-10">
          {HOURS.map((h) => (
            <div key={h} className="flex h-16 items-start justify-end pr-2 text-xs text-muted-foreground" style={{ height: hourHeight }}>
              {formatHour(h)}
            </div>
          ))}
        </div>

        {/* Offering slots column */}
        {calendarOfferingSlots.length > 0 && (
          <div className="flex min-w-[200px] flex-1 flex-col border-r bg-muted/10">
            <div className="border-b bg-muted/20 px-3 py-2.5 text-center">
              <span className="text-sm font-medium">Event times</span>
              <p className="text-[10px] text-muted-foreground">Tap a slot to book</p>
            </div>
            <div className="relative" style={{ height: totalHeight }}>
              {HOURS.map((h) => (
                <div
                  key={`off-h-${h}`}
                  className="absolute left-0 right-0 border-t border-dashed border-border/50"
                  style={{ top: ((h * 60 - dayStart) / totalMinutes) * totalHeight }}
                />
              ))}
              {calendarOfferingSlots.map((slot) => {
                const startMin = timeToMinutes(slot.start_time) - dayStart;
                const endMin = timeToMinutes(slot.end_time) - dayStart;
                const top = (startMin / totalMinutes) * totalHeight;
                const height = ((endMin - startMin) / totalMinutes) * totalHeight;
                const full = slot.booked_count >= slot.capacity;
                return (
                  <button
                    key={slot.id}
                    type="button"
                    className={cn(
                      "absolute inset-x-1 z-30 overflow-hidden rounded-md border-l-[3px] px-2 py-1 text-left text-xs transition-shadow hover:shadow-md",
                      full && "opacity-60",
                    )}
                    style={{
                      top,
                      height: Math.max(height, 36),
                      backgroundColor: `${slot.offering_color}18`,
                      borderLeftColor: slot.offering_color,
                    }}
                    onClick={() => !full && setSelectedSlot(slot)}
                    disabled={full}
                  >
                    <div className="font-medium">{formatTimeShort(slot.start_time)} – {formatTimeShort(slot.end_time)}</div>
                    <div className="truncate text-[10px] text-muted-foreground">{slot.offering_name}</div>
                    <div className="font-semibold">{slot.booked_count}/{slot.capacity}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Staff columns */}
        <div className="flex flex-1">
          {staffLookup.map((member) => {
            const memberAppts = calendarAppointments.filter((a) => a.staff_id === member.id);
            const memberBlocked = calendarBlocked.filter((b) => b.staff_id === member.id);
            const apptLayout = layoutOverlappingTimedItems(
              memberAppts.map((apt) => ({
                id: apt.id,
                startMin: timeToMinutes(apt.start_time) - dayStart,
                endMin: timeToMinutes(apt.end_time) - dayStart,
              })),
            );
            return (
              <div key={member.id} className="flex min-w-[180px] flex-1 flex-col border-r last:border-r-0">
                <div className="flex items-center justify-center gap-2 border-b bg-muted/20 px-3 py-2.5">
                  <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: member.color }} />
                  <span className="text-sm font-medium">{member.name}</span>
                </div>
                <div className="relative" style={{ height: totalHeight }}>
                  {HOURS.map((h) => (
                    <div
                      key={h}
                      className="absolute left-0 right-0 border-t border-dashed border-border/50"
                      style={{ top: ((h * 60 - dayStart) / totalMinutes) * totalHeight }}
                    />
                  ))}

                  {memberBlocked.map((block) => {
                    const startMin = timeToMinutes(block.start_time) - dayStart;
                    const endMin = timeToMinutes(block.end_time) - dayStart;
                    const top = (startMin / totalMinutes) * totalHeight;
                    const height = ((endMin - startMin) / totalMinutes) * totalHeight;
                    return (
                      <div
                        key={`b-${block.id}`}
                        className="absolute inset-x-1 z-10 flex items-center justify-between rounded bg-muted/60 px-2 text-xs text-muted-foreground"
                        style={{ top, height: Math.max(height, 20) }}
                      >
                        <span className="truncate">{block.reason || "Blocked"}</span>
                        <button
                          className="flex-shrink-0 rounded p-0.5 hover:bg-muted"
                          onClick={(e) => { e.stopPropagation(); deleteBlockedSlot(block.id); }}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}

                  {memberAppts.map((apt) => {
                    const startMin = timeToMinutes(apt.start_time) - dayStart;
                    const endMin = timeToMinutes(apt.end_time) - dayStart;
                    const top = (startMin / totalMinutes) * totalHeight;
                    const height = ((endMin - startMin) / totalMinutes) * totalHeight;
                    const position = apptLayout.get(apt.id);
                    return (
                      <CalendarAppointmentBlock
                        key={apt.id}
                        apt={apt}
                        now={now}
                        top={top}
                        height={height}
                        column={position?.column}
                        totalColumns={position?.totalColumns}
                        borderColor={member.color}
                        backgroundColor={`${member.color}14`}
                        onOpen={() => navigate(`/appointments/${apt.id}`)}
                        onCloseOut={(status) => updateAppointment(apt.id, { status })}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}

          {(() => {
            const unassigned = calendarAppointments.filter((a) => !a.staff_id);
            if (unassigned.length === 0) return null;
            const unassignedLayout = layoutOverlappingTimedItems(
              unassigned.map((apt) => ({
                id: apt.id,
                startMin: timeToMinutes(apt.start_time) - dayStart,
                endMin: timeToMinutes(apt.end_time) - dayStart,
              })),
            );
            return (
              <div className="flex min-w-[180px] flex-1 flex-col border-r last:border-r-0">
                <div className="flex items-center justify-center gap-2 border-b bg-muted/20 px-3 py-2.5">
                  <span className="inline-block h-3 w-3 rounded-full bg-muted-foreground/40" />
                  <span className="text-sm font-medium text-muted-foreground">Unassigned</span>
                </div>
                <div className="relative" style={{ height: totalHeight }}>
                  {HOURS.map((h) => (
                    <div key={h} className="absolute left-0 right-0 border-t border-dashed border-border/50" style={{ top: ((h * 60 - dayStart) / totalMinutes) * totalHeight }} />
                  ))}
                  {unassigned.map((apt) => {
                    const startMin = timeToMinutes(apt.start_time) - dayStart;
                    const endMin = timeToMinutes(apt.end_time) - dayStart;
                    const top = (startMin / totalMinutes) * totalHeight;
                    const height = ((endMin - startMin) / totalMinutes) * totalHeight;
                    const position = unassignedLayout.get(apt.id);
                    return (
                      <CalendarAppointmentBlock
                        key={apt.id}
                        apt={apt}
                        now={now}
                        top={top}
                        height={height}
                        column={position?.column}
                        totalColumns={position?.totalColumns}
                        borderColor="rgb(156 163 175 / 0.4)"
                        backgroundColor="rgb(243 244 246 / 0.5)"
                        onOpen={() => navigate(`/appointments/${apt.id}`)}
                        onCloseOut={(status) => updateAppointment(apt.id, { status })}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
