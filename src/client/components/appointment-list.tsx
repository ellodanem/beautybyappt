import { useMemo, useState } from "preact/hooks";

import { useApp } from "../context";

import { Plus, Search, Trash2 } from "lucide-preact";

import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";

import { Card, CardContent } from "@/components/ui/card";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { StatusBadge } from "./status-badge";

import { PaymentBadge } from "./payment-badge";

import { DualCurrencyAmount } from "./dual-currency-amount";

import { Pagination } from "./pagination";

import { CreateAppointment } from "./create-appointment";

import { MobileNavTrigger } from "./mobile-nav-trigger";

import { cn, formatDateShort, formatTimeShort } from "@/lib/utils";
import { needsCloseOut } from "../../shared/appointment-closeout";
import { CloseOutRowActions, useCloseOutClock } from "./close-out-row-actions";
import { AppointmentExtrasChips } from "./appointment-extras-chips";
import type { Appointment, AppointmentStatus } from "../types";



interface ServiceGroup {
  name: string;
  color: string;
  appointments: Appointment[];
}

function getServiceGroupMeta(apt: Appointment): { name: string; color: string } {
  if (apt.offering_name) {
    return { name: apt.offering_name, color: apt.offering_color || "#7c3aed" };
  }
  if (apt.service_name) {
    return { name: apt.service_name, color: apt.service_color || "#6b7280" };
  }
  if (apt.appointment_services?.[0]?.service_name) {
    return {
      name: apt.appointment_services[0].service_name,
      color: apt.service_color || "#6b7280",
    };
  }
  return { name: "Other", color: "#6b7280" };
}

function groupByServiceType(appointments: Appointment[]): ServiceGroup[] {
  const groups = new Map<string, ServiceGroup>();
  for (const apt of appointments) {
    const { name, color } = getServiceGroupMeta(apt);
    const existing = groups.get(name);
    if (existing) existing.appointments.push(apt);
    else groups.set(name, { name, color, appointments: [apt] });
  }
  return [...groups.values()].sort((a, b) => {
    if (a.name === "Other") return 1;
    if (b.name === "Other") return -1;
    return a.name.localeCompare(b.name);
  });
}



const BOILERPLATE_NOTE = /^(Offering:|Public booking|Booked via)/;

function getAppointmentListNote(apt: Appointment): string | null {
  const activity = apt.latest_note?.trim();
  if (activity) return activity;

  if (!apt.notes?.trim()) return null;
  const userLines = apt.notes
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !BOILERPLATE_NOTE.test(line));
  const text = userLines.join(" · ").trim();
  return text || null;
}



function AppointmentMobileCard({

  apt,

  now,

  onOpen,

  onDelete,

  onCloseOut,

}: {

  apt: Appointment;

  now: Date;

  onOpen: () => void;

  onDelete: () => void;

  onCloseOut: (status: AppointmentStatus) => Promise<void>;

}) {

  const showCloseOut = needsCloseOut(apt, now);

  return (

    <div

      role="button"

      tabIndex={0}

      className={cn(
        "cursor-pointer rounded-lg border bg-card p-4 transition-colors active:bg-muted/50",
        showCloseOut && "border-amber-500/30 bg-amber-50/40",
      )}

      onClick={onOpen}

      onKeyDown={(e) => {

        if (e.key === "Enter" || e.key === " ") {

          e.preventDefault();

          onOpen();

        }

      }}

    >

      <div className="mb-2 flex items-start justify-between gap-2">

        <div className="min-w-0">
          <p className="font-semibold leading-tight">{apt.client_name}</p>
          <AppointmentExtrasChips appointment={apt} />
        </div>

        <StatusBadge status={apt.status} />

      </div>

      <p className="mb-1.5 text-sm text-muted-foreground">

        {formatDateShort(apt.scheduled_date)} · {formatTimeShort(apt.start_time)}

      </p>

      <p className="mb-3 flex items-center gap-1.5 text-sm">

        {apt.staff_name ? (

          <>

            <span

              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"

              style={{ backgroundColor: apt.staff_color || "#7c3aed" }}

            />

            <span>{apt.staff_name}</span>

          </>

        ) : (

          <span className="text-muted-foreground">Unassigned</span>

        )}

      </p>

      {(() => {
        const note = getAppointmentListNote(apt);
        return note ? (
          <p className="mb-3 line-clamp-2 text-xs text-muted-foreground" title={note}>
            {note}
          </p>
        ) : null;
      })()}

      {showCloseOut && (
        <div className="mb-3">
          <CloseOutRowActions appointment={apt} now={now} onCloseOut={onCloseOut} />
        </div>
      )}

      <div className="flex items-end justify-between gap-3">

        <PaymentBadge appointment={apt} />

        <div className="flex shrink-0 items-center gap-1">

          <DualCurrencyAmount

            amount={apt.total_price}

            currency={apt.currency || "USD"}

            align="right"

            priceStyle

            primaryClassName="text-sm font-medium whitespace-nowrap"

          />

          <Button

            variant="ghost"

            size="icon"

            className="h-8 w-8 text-muted-foreground hover:text-destructive"

            onClick={(e) => {

              e.stopPropagation();

              onDelete();

            }}

            aria-label="Delete appointment"

          >

            <Trash2 className="h-4 w-4" />

          </Button>

        </div>

      </div>

    </div>

  );

}



export function AppointmentList() {

  const {

    appointments, appointmentsPag, setAppointmentsPage,

    appointmentsSearch, setAppointmentsSearch,

    appointmentsStatusFilter, setAppointmentsStatusFilter,

    deleteAppointment, navigate, updateAppointment,

  } = useApp();

  const [showCreate, setShowCreate] = useState(false);
  const now = useCloseOutClock();



  const groupedAppointments = useMemo(

    () => groupByServiceType(appointments),

    [appointments],

  );



  return (

    <div className="space-y-4 p-4 pb-8 md:p-6">

      <div className="flex items-center gap-2">

        <MobileNavTrigger />

        <h1 className="min-w-0 flex-1 text-xl font-bold tracking-tight md:text-2xl">Appointments</h1>

        <Button size="sm" className="shrink-0" onClick={() => setShowCreate(true)}>

          <Plus className="h-3.5 w-3.5 md:mr-1" />

          <span className="hidden sm:inline">New Booking</span>

          <span className="sm:hidden">New</span>

        </Button>

      </div>



      {showCreate && <CreateAppointment onClose={() => setShowCreate(false)} />}



      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">

        <div className="relative flex-1">

          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

          <Input

            className="pl-9"

            placeholder="Search appointments..."

            value={appointmentsSearch}

            onInput={(e) => setAppointmentsSearch((e.target as HTMLInputElement).value)}

          />

        </div>

        <select

          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-auto sm:min-w-[10rem]"

          value={appointmentsStatusFilter}

          onChange={(e) => setAppointmentsStatusFilter((e.target as HTMLSelectElement).value)}

        >

          <option value="">All Statuses</option>

          <option value="booked">Booked</option>

          <option value="confirmed">Confirmed</option>

          <option value="in_progress">In Progress</option>

          <option value="completed">Completed</option>

          <option value="cancelled">Cancelled</option>

          <option value="no_show">No Show</option>

        </select>

      </div>



      {appointments.length === 0 ? (

        <Card>

          <CardContent className="py-8 text-center text-muted-foreground">

            No appointments found

          </CardContent>

        </Card>

      ) : (

        <div className="space-y-6">

          {groupedAppointments.map((group) => (

            <Card key={group.name}>

              <CardContent className="p-0">

                <div
                  className="border-b px-4 py-3"
                  style={{
                    backgroundColor: `${group.color}14`,
                    borderLeftWidth: 4,
                    borderLeftColor: group.color,
                  }}
                >

                  <div className="flex items-center gap-2.5">

                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: group.color }}
                    />

                    <h2
                      className="text-base font-semibold md:text-lg"
                      style={{ color: group.name === "Other" ? undefined : group.color }}
                    >
                      {group.name}
                    </h2>

                  </div>

                  <p className="mt-0.5 pl-5 text-xs text-muted-foreground md:pl-6">

                    {group.appointments.length} appointment{group.appointments.length === 1 ? "" : "s"}

                  </p>

                </div>



                <div className="space-y-3 p-3 md:hidden">

                  {group.appointments.map((apt) => (

                    <AppointmentMobileCard

                      key={apt.id}

                      apt={apt}

                      now={now}

                      onOpen={() => navigate(`/appointments/${apt.id}`)}

                      onDelete={() => deleteAppointment(apt.id)}

                      onCloseOut={(status) => updateAppointment(apt.id, { status })}

                    />

                  ))}

                </div>



                <div className="hidden md:block">

                  <Table>

                    <TableHeader>

                      <TableRow>

                        <TableHead className="w-24">Date</TableHead>

                        <TableHead className="w-16">Time</TableHead>

                        <TableHead>Client</TableHead>

                        <TableHead className="w-28">Staff</TableHead>

                        <TableHead className="w-24">Status</TableHead>

                        <TableHead className="min-w-[10rem]">Payment</TableHead>

                        <TableHead className="min-w-[8rem] max-w-[14rem]">Notes</TableHead>

                        <TableHead className="w-24 text-right">Price</TableHead>

                        <TableHead className="w-10" />

                      </TableRow>

                    </TableHeader>

                    <TableBody>

                      {group.appointments.map((apt) => {
                        const note = getAppointmentListNote(apt);
                        const showCloseOut = needsCloseOut(apt, now);
                        return (
                        <TableRow
                          key={apt.id}
                          className={cn(
                            "cursor-pointer",
                            showCloseOut && "bg-amber-50/50 dark:bg-amber-950/10",
                          )}
                          onClick={() => navigate(`/appointments/${apt.id}`)}
                        >

                          <TableCell className="whitespace-nowrap text-xs">{formatDateShort(apt.scheduled_date)}</TableCell>

                          <TableCell className="text-xs">{formatTimeShort(apt.start_time)}</TableCell>

                          <TableCell>
                            <div>
                              <span>{apt.client_name}</span>
                              <AppointmentExtrasChips appointment={apt} />
                            </div>
                          </TableCell>

                          <TableCell>

                            <span className="flex items-center gap-1.5">

                              {apt.staff_name && <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: apt.staff_color || "#7c3aed" }} />}

                              <span className="text-sm">{apt.staff_name || "—"}</span>

                            </span>

                          </TableCell>

                          <TableCell>
                            {showCloseOut ? (
                              <CloseOutRowActions
                                appointment={apt}
                                now={now}
                                onCloseOut={(status) => updateAppointment(apt.id, { status })}
                              />
                            ) : (
                              <StatusBadge status={apt.status} />
                            )}
                          </TableCell>

                          <TableCell><PaymentBadge appointment={apt} /></TableCell>

                          <TableCell className="max-w-[14rem]">
                            {note ? (
                              <span className="line-clamp-2 text-xs text-muted-foreground" title={note}>
                                {note}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>

                          <TableCell className="text-right">

                            <DualCurrencyAmount

                              amount={apt.total_price}

                              currency={apt.currency || "USD"}

                              align="right"

                              priceStyle

                              primaryClassName="text-sm whitespace-nowrap"

                            />

                          </TableCell>

                          <TableCell>

                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); deleteAppointment(apt.id); }}>

                              <Trash2 className="h-3.5 w-3.5" />

                            </Button>

                          </TableCell>

                        </TableRow>
                        );
                      })}

                    </TableBody>

                  </Table>

                </div>

              </CardContent>

            </Card>

          ))}

        </div>

      )}

      <Pagination pag={appointmentsPag} setPage={setAppointmentsPage} />

    </div>

  );

}


