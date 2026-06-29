import { useEffect, useMemo, useState } from "preact/hooks";
import {
  CalendarDays,
  Clock,
  DollarSign,
  AlertCircle,
  Link2,
  Plus,
  Sparkles,
  ChevronRight,
  Package,
} from "lucide-preact";
import { useApp } from "../context";
import { api } from "../api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MobileNavTrigger } from "./mobile-nav-trigger";
import { StatusBadge } from "./status-badge";
import { PaymentBadge } from "./payment-badge";
import { CreateBookingLink } from "./create-booking-link";
import { CreateAppointment } from "./create-appointment";
import { DualCurrencyAmount } from "./dual-currency-amount";
import { cn, formatTimeShort } from "@/lib/utils";
import { formatMoney } from "../../shared/currency";
import { getPaymentDisplay } from "./payment-badge";
import type { Appointment } from "../types";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatTodayHeading(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function getServiceLabel(apt: Appointment): string {
  if (apt.offering_name) return apt.offering_name;
  if (apt.service_name) return apt.service_name;
  if (apt.appointment_services?.[0]?.service_name) return apt.appointment_services[0].service_name;
  return "Appointment";
}

function weekDayLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

interface AttentionItem {
  id: string;
  label: string;
  detail: string;
  onClick: () => void;
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  onClick,
}: {
  label: string;
  value: string | number;
  icon: typeof CalendarDays;
  color: string;
  onClick?: () => void;
}) {
  return (
    <Card
      className={cn(
        "min-w-[9.5rem] shrink-0 md:min-w-0",
        onClick && "cursor-pointer transition-shadow hover:shadow-md active:scale-[0.98]",
      )}
      onClick={onClick}
    >
      <CardContent className="flex items-center gap-3 p-3.5 md:p-4">
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg md:h-10 md:w-10", color)}>
          <Icon className="h-4 w-4 md:h-5 md:w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-lg font-bold leading-tight md:text-xl">{value}</div>
          <div className="truncate text-[11px] text-muted-foreground md:text-xs">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function TodayAppointmentRow({
  apt,
  onOpen,
  mobile,
}: {
  apt: Appointment;
  onOpen: () => void;
  mobile?: boolean;
}) {
  const service = getServiceLabel(apt);

  if (mobile) {
    return (
      <button
        type="button"
        className="flex w-full items-start gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/40 active:bg-accent/60"
        onClick={onOpen}
      >
        <div className="shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-primary">
          {formatTimeShort(apt.start_time)}
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-medium">{apt.client_name}</div>
              <div className="truncate text-xs text-muted-foreground">{service}</div>
            </div>
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {apt.staff_name && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: apt.staff_color || "#7c3aed" }}
                />
                {apt.staff_name}
              </span>
            )}
            <StatusBadge status={apt.status} />
            <PaymentBadge appointment={apt} />
          </div>
          <DualCurrencyAmount
            amount={apt.total_price}
            currency={apt.currency || "USD"}
            primaryClassName="text-xs font-medium"
          />
        </div>
      </button>
    );
  }

  return (
    <TableRow className="cursor-pointer" onClick={onOpen}>
      <TableCell className="font-medium tabular-nums">{formatTimeShort(apt.start_time)}</TableCell>
      <TableCell>
        <div className="font-medium">{apt.client_name}</div>
        <div className="text-xs text-muted-foreground">{service}</div>
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <span className="flex items-center gap-2">
          {apt.staff_name && (
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: apt.staff_color || "#7c3aed" }}
            />
          )}
          {apt.staff_name || "—"}
        </span>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge status={apt.status} />
          <PaymentBadge appointment={apt} />
        </div>
      </TableCell>
      <TableCell className="text-right">
        <DualCurrencyAmount
          amount={apt.total_price}
          currency={apt.currency || "USD"}
          align="right"
          primaryClassName="text-sm font-medium"
        />
      </TableCell>
    </TableRow>
  );
}

function WeekRevenueChart({
  days,
  currency,
  weekTotal,
}: {
  days: { date: string; revenue: number }[];
  currency: string;
  weekTotal: number;
}) {
  const max = Math.max(...days.map((d) => d.revenue), 1);
  const todayStr = new Date().toISOString().split("T")[0];

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2 md:hidden">
        <span className="text-sm text-muted-foreground">This week</span>
        <span className="text-lg font-bold">{formatMoney(weekTotal, currency)}</span>
      </div>
      <div className="flex h-20 items-end gap-1.5 sm:gap-2 md:h-24">
        {days.map((day) => {
          const heightPct = day.revenue > 0 ? Math.max((day.revenue / max) * 100, 8) : 0;
          const isToday = day.date === todayStr;
          return (
            <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <div className="flex h-full w-full items-end">
                <div
                  className={cn(
                    "w-full rounded-t-sm transition-all",
                    isToday ? "bg-primary" : "bg-primary/25",
                  )}
                  style={{ height: `${heightPct}%` }}
                  title={formatMoney(day.revenue, currency)}
                />
              </div>
              <span className={cn("text-[10px] sm:text-xs", isToday ? "font-medium text-foreground" : "text-muted-foreground")}>
                {weekDayLabel(day.date)}
              </span>
            </div>
          );
        })}
      </div>
      <p className="hidden text-sm text-muted-foreground md:block">
        Completed appointment revenue · {formatMoney(weekTotal, currency)} this week
      </p>
    </div>
  );
}

export function Dashboard() {
  const {
    stats,
    navigate,
    appointments,
    offerings,
    products,
    branding,
    defaultCurrency,
    setError,
  } = useApp();

  const [showBookingLink, setShowBookingLink] = useState(false);
  const [showCreateAppointment, setShowCreateAppointment] = useState(false);
  const [todayAppointments, setTodayAppointments] = useState<Appointment[]>([]);

  const todayStr = new Date().toISOString().split("T")[0];

  useEffect(() => {
    api<{ appointments: Appointment[] }>("GET", `/api/appointments?date=${todayStr}&limit=50`)
      .then((data) => {
        setTodayAppointments(
          data.appointments
            .filter((a) => a.status !== "cancelled")
            .sort((a, b) => a.start_time.localeCompare(b.start_time)),
        );
      })
      .catch((err) => setError((err as Error).message));
  }, [todayStr, setError, stats.today_appointments]);

  const attentionItems = useMemo(() => {
    const items: AttentionItem[] = [];
    const seenPayment = new Set<number>();

    for (const apt of appointments) {
      if (apt.status === "cancelled" || apt.status === "no_show") continue;
      if (apt.scheduled_date < todayStr) continue;
      const payment = getPaymentDisplay(apt);
      if (payment.kind === "none" || payment.kind === "paid") continue;
      if (seenPayment.has(apt.id)) continue;
      seenPayment.add(apt.id);
      const dueLabel =
        payment.kind === "deposit"
          ? `${formatMoney(payment.due, payment.currency)} balance due`
          : `${formatMoney(payment.due, payment.currency)} deposit due`;
      items.push({
        id: `payment-${apt.id}`,
        label: apt.client_name || "Client",
        detail: dueLabel,
        onClick: () => navigate(`/appointments/${apt.id}`),
      });
    }

    for (const offering of offerings) {
      if (offering.status !== "draft") continue;
      items.push({
        id: `offering-${offering.id}`,
        label: offering.name,
        detail: "Not live yet — finish setup",
        onClick: () => navigate(`/offers/event/${offering.id}`),
      });
    }

    for (const product of products) {
      if (product.stock > product.low_stock_alert) continue;
      items.push({
        id: `product-${product.id}`,
        label: product.name,
        detail: `Low stock (${product.stock} left)`,
        onClick: () => navigate("/products"),
      });
    }

    return items.slice(0, 8);
  }, [appointments, offerings, products, todayStr, navigate]);

  const displayName = branding.business_name?.trim() || "there";
  const currency = defaultCurrency;

  const statCards = [
    {
      label: "Today",
      value: stats.today_appointments,
      icon: CalendarDays,
      color: "text-violet-600 bg-violet-50",
      onClick: () => navigate("/calendar"),
    },
    {
      label: "Upcoming",
      value: stats.upcoming_appointments,
      icon: Clock,
      color: "text-blue-600 bg-blue-50",
      onClick: () => navigate("/appointments"),
    },
    {
      label: "Week revenue",
      value: formatMoney(stats.week_revenue, currency).replace(/\.00$/, ""),
      icon: DollarSign,
      color: "text-amber-600 bg-amber-50",
    },
    {
      label: "Pending pay",
      value: stats.pending_payments,
      icon: AlertCircle,
      color: "text-rose-600 bg-rose-50",
      onClick: () => navigate("/appointments"),
    },
  ];

  return (
    <div className="space-y-4 p-4 pb-8 md:space-y-6 md:p-6">
      <div className="flex items-start gap-2">
        <MobileNavTrigger className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">
            {getGreeting()}, {displayName}
          </h1>
          <p className="text-sm text-muted-foreground">{formatTodayHeading()}</p>
        </div>
      </div>

      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 scrollbar-none md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 lg:grid-cols-4">
        {statCards.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
            <CardTitle className="text-base md:text-lg">Today&apos;s schedule</CardTitle>
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => navigate("/calendar")}>
              Calendar
            </Button>
          </CardHeader>
          <CardContent>
            {todayAppointments.length === 0 ? (
              <div className="space-y-3 py-6 text-center">
                <p className="text-sm text-muted-foreground">No appointments scheduled for today</p>
                <Button variant="outline" size="sm" onClick={() => setShowCreateAppointment(true)}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  New appointment
                </Button>
              </div>
            ) : (
              <>
                <div className="space-y-2 md:hidden">
                  {todayAppointments.map((apt) => (
                    <TodayAppointmentRow
                      key={apt.id}
                      apt={apt}
                      mobile
                      onOpen={() => navigate(`/appointments/${apt.id}`)}
                    />
                  ))}
                </div>
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">Time</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead className="hidden sm:table-cell">Staff</TableHead>
                        <TableHead className="hidden md:table-cell">Status</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {todayAppointments.map((apt) => (
                        <TodayAppointmentRow
                          key={apt.id}
                          apt={apt}
                          onOpen={() => navigate(`/appointments/${apt.id}`)}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base md:text-lg">Quick actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant="outline"
                className="h-11 w-full justify-start gap-2 md:h-10"
                onClick={() => setShowBookingLink(true)}
              >
                <Link2 className="h-4 w-4 shrink-0" />
                Create booking link
              </Button>
              <Button
                variant="outline"
                className="h-11 w-full justify-start gap-2 md:h-10"
                onClick={() => navigate("/offers")}
              >
                <Sparkles className="h-4 w-4 shrink-0" />
                Manage services
              </Button>
              <Button
                variant="outline"
                className="h-11 w-full justify-start gap-2 md:h-10"
                onClick={() => setShowCreateAppointment(true)}
              >
                <Plus className="h-4 w-4 shrink-0" />
                New appointment
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base md:text-lg">Needs attention</CardTitle>
            </CardHeader>
            <CardContent>
              {attentionItems.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">All caught up</p>
              ) : (
                <ul className="space-y-1">
                  {attentionItems.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-accent/50 active:bg-accent"
                        onClick={item.onClick}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-600">
                          {item.id.startsWith("product-") ? (
                            <Package className="h-4 w-4" />
                          ) : (
                            <AlertCircle className="h-4 w-4" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{item.label}</span>
                          <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {stats.week_revenue_by_day.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base md:text-lg">This week</CardTitle>
          </CardHeader>
          <CardContent>
            <WeekRevenueChart
              days={stats.week_revenue_by_day}
              currency={currency}
              weekTotal={stats.week_revenue}
            />
          </CardContent>
        </Card>
      )}

      {showBookingLink && (
        <CreateBookingLink onClose={() => setShowBookingLink(false)} defaultDate={todayStr} />
      )}
      {showCreateAppointment && (
        <CreateAppointment onClose={() => setShowCreateAppointment(false)} defaultDate={todayStr} />
      )}
    </div>
  );
}
