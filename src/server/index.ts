import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { initDB, query, get, run } from "./db.js";
import { ensureSqliteSchema } from "./schema-migrate.js";
import { addMinutes, nextIdentifier } from "./helpers.js";
import { registerBookingLinkRoutes } from "./booking-links.js";
import { registerSettingsRoutes } from "./settings.js";
import { registerBrandingRoutes } from "./branding.js";
import { registerOfferingRoutes } from "./offerings.js";
import { registerAnytimeBookingRoutes } from "./anytime-booking.js";
import { registerPaymentRoutes } from "./payments.js";
import { registerAppointmentPaymentRoutes } from "./appointment-payments.js";
import { registerNotificationRoutes, scheduleBookingConfirmation, processAppointmentReminders, type NotificationEnv } from "./notifications.js";
import { registerEmailDomainRoutes } from "./email-domain.js";
import { backfillServiceSlugs, uniqueServiceSlug, syncServiceAddons, loadServiceAddons } from "./services.js";
import { assertRegularBookingAllowed, getEventDayInfo } from "./event-override.js";
import { derivePaymentStatus } from "../shared/payment.js";
import { loadPendingPaymentSummary } from "./appointment-payments.js";
import { blockingClientAppointmentsWhere, blockingClientBookingLinksWhere, countClientActiveBookings, detachClientBookingLinks, todayIsoDate } from "./clients.js";
import { deleteStaffCascade } from "./staff.js";
import { registerAuthRoutes, createAuthMiddleware } from "./auth.js";

type Env = {
  Bindings: {
    DB?: D1Database;
    DATABASE_URL?: string;
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    APP_URL?: string;
    RESEND_API_KEY?: string;
    EMAIL_FROM?: string;
    CRON_SECRET?: string;
    ADMIN_PASSWORD?: string;
    SESSION_SECRET?: string;
  };
};

import { runtimeEnv } from "./runtime-env.js";

export const app = new OpenAPIHono<Env>();

app.use("*", async (c, next) => {
  initDB(runtimeEnv(c.env));
  await ensureSqliteSchema();
  await next();
});

registerAuthRoutes(app);
app.use("/api/*", createAuthMiddleware());

// ── Shared Schemas ─────────────────────────────────────────────────

const ErrorSchema = z.object({ error: z.string() }).openapi("Error");
const OkSchema = z.object({ ok: z.boolean() }).openapi("Ok");

const ClientSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  address: z.string().optional(),
  notes: z.string(),
  appointment_count: z.number().int().optional(),
  active_booking_count: z.number().int().optional(),
  created_at: z.string(),
  updated_at: z.string(),
}).openapi("Client");

const StaffSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  title: z.string(),
  color: z.string(),
  active: z.number().int(),
  is_admin: z.number().int(),
  appointment_count: z.number().int().optional(),
  created_at: z.string(),
}).openapi("Staff");

const ServiceSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  duration: z.number().int(),
  price: z.number(),
  color: z.string(),
  category: z.string(),
  active: z.number().int(),
  allow_addons: z.number().int().optional(),
  created_at: z.string(),
}).openapi("Service");

const ServiceAddonSchema = z.object({
  id: z.number().int().optional(),
  name: z.string(),
  price: z.number(),
  extra_duration: z.number().int().optional(),
  active: z.number().int().optional(),
}).openapi("ServiceAddon");

const AppointmentServiceAddonSchema = z.object({
  id: z.number().int(),
  appointment_id: z.number().int(),
  service_addon_id: z.number().int(),
  price: z.number(),
  name: z.string().optional(),
  extra_duration: z.number().int().optional(),
}).openapi("AppointmentServiceAddon");

const AppointmentNoteSchema = z.object({
  id: z.number().int(),
  appointment_id: z.number().int(),
  content: z.string(),
  created_at: z.string(),
}).openapi("AppointmentNote");

const AppointmentServiceSchema = z.object({
  id: z.number().int(),
  appointment_id: z.number().int(),
  service_id: z.number().int(),
  service_name: z.string().optional(),
  price: z.number(),
  duration: z.number().int(),
}).openapi("AppointmentService");

const AppointmentOfferingAddonSchema = z.object({
  id: z.number().int(),
  appointment_id: z.number().int(),
  offering_addon_id: z.number().int(),
  price: z.number(),
  name: z.string().optional(),
  extra_duration: z.number().int().optional(),
}).openapi("AppointmentOfferingAddon");

const OfferingAddonSchema = z.object({
  id: z.number().int().optional(),
  name: z.string(),
  price: z.number(),
  extra_duration: z.number().int().optional(),
  active: z.number().int().optional(),
}).openapi("OfferingAddon");

const AppointmentSchema = z.object({
  id: z.number().int(),
  identifier: z.string(),
  client_id: z.number().int(),
  staff_id: z.number().int().nullable(),
  status: z.string(),
  scheduled_date: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  total_price: z.number(),
  currency: z.string().optional(),
  deposit_amount: z.number().optional(),
  amount_paid: z.number().optional(),
  payment_status: z.string().optional(),
  travel_fee: z.number().optional(),
  service_address: z.string().optional(),
  notes: z.string(),
  is_recurring: z.number().int(),
  recurrence_interval: z.string(),
  client_name: z.string().optional(),
  client_phone: z.string().optional(),
  staff_name: z.string().nullable().optional(),
  staff_color: z.string().nullable().optional(),
  offering_name: z.string().nullable().optional(),
  service_name: z.string().nullable().optional(),
  offering_color: z.string().nullable().optional(),
  service_color: z.string().nullable().optional(),
  latest_note: z.string().nullable().optional(),
  offering_id: z.number().int().nullable().optional(),
  offering_base_price: z.number().nullable().optional(),
  offering_addons: z.array(OfferingAddonSchema).optional(),
  appointment_offering_addons: z.array(AppointmentOfferingAddonSchema).optional(),
  service_addons: z.array(ServiceAddonSchema).optional(),
  appointment_service_addons: z.array(AppointmentServiceAddonSchema).optional(),
  appointment_services: z.array(AppointmentServiceSchema).optional(),
  appointment_notes: z.array(AppointmentNoteSchema).optional(),
  pending_payment: z.object({
    amount: z.number(),
    currency: z.string(),
    created_at: z.string(),
    page_url: z.string().nullable().optional(),
    checkout_url: z.string().nullable().optional(),
  }).nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
}).openapi("Appointment");

const BlockedSlotSchema = z.object({
  id: z.number().int(),
  staff_id: z.number().int(),
  staff_name: z.string().optional(),
  blocked_date: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  reason: z.string(),
  created_at: z.string(),
}).openapi("BlockedSlot");

const ProductSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  brand: z.string(),
  category: z.string(),
  sku: z.string(),
  price: z.number(),
  cost: z.number(),
  stock: z.number().int(),
  low_stock_alert: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
}).openapi("Product");

const IdParam = z.object({ id: z.string().openapi({ description: "Resource ID" }) });

registerBookingLinkRoutes(app);
registerPaymentRoutes(app);
registerAppointmentPaymentRoutes(app);
registerSettingsRoutes(app);
registerBrandingRoutes(app);
registerNotificationRoutes(app);
registerEmailDomainRoutes(app);
registerOfferingRoutes(app);
registerAnytimeBookingRoutes(app);

// ── Stats ──────────────────────────────────────────────────────────

const getStats = createRoute({
  method: "get",
  path: "/api/stats",
  responses: {
    200: {
      description: "Dashboard stats",
      content: { "application/json": { schema: z.object({
        appointments: z.number().int(),
        clients: z.number().int(),
        staff: z.number().int(),
        services: z.number().int(),
        products: z.number().int(),
        today_appointments: z.number().int(),
        upcoming_appointments: z.number().int(),
        completed_appointments: z.number().int(),
        revenue: z.number(),
        low_stock_products: z.number().int(),
      }) } },
    },
  },
});

app.openapi(getStats, async (c) => {
  const today = new Date().toISOString().split("T")[0];
  const appointments = await get<{ count: number }>("SELECT COUNT(*) as count FROM appointments");
  const clients = await get<{ count: number }>("SELECT COUNT(*) as count FROM clients");
  const staff = await get<{ count: number }>("SELECT COUNT(*) as count FROM staff WHERE active = 1");
  const services = await get<{ count: number }>("SELECT COUNT(*) as count FROM services WHERE active = 1");
  const products = await get<{ count: number }>("SELECT COUNT(*) as count FROM products");
  const todayAppointments = await get<{ count: number }>("SELECT COUNT(*) as count FROM appointments WHERE scheduled_date = ?", [today]);
  const upcomingAppointments = await get<{ count: number }>("SELECT COUNT(*) as count FROM appointments WHERE status IN ('booked', 'confirmed') AND scheduled_date >= ?", [today]);
  const completedAppointments = await get<{ count: number }>("SELECT COUNT(*) as count FROM appointments WHERE status = 'completed'");
  const revenue = await get<{ total: number }>("SELECT COALESCE(SUM(total_price), 0) as total FROM appointments WHERE status = 'completed'");
  const lowStock = await get<{ count: number }>("SELECT COUNT(*) as count FROM products WHERE stock <= low_stock_alert");
  return c.json({
    appointments: appointments?.count || 0,
    clients: clients?.count || 0,
    staff: staff?.count || 0,
    services: services?.count || 0,
    products: products?.count || 0,
    today_appointments: todayAppointments?.count || 0,
    upcoming_appointments: upcomingAppointments?.count || 0,
    completed_appointments: completedAppointments?.count || 0,
    revenue: revenue?.total || 0,
    low_stock_products: lowStock?.count || 0,
  }, 200);
});

// ── Appointments ───────────────────────────────────────────────────

const listAppointments = createRoute({
  method: "get",
  path: "/api/appointments",
  request: {
    query: z.object({
      page: z.string().optional(),
      limit: z.string().optional(),
      search: z.string().optional(),
      status: z.string().optional(),
      date: z.string().optional(),
      staff_id: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Paginated appointment list",
      content: { "application/json": { schema: z.object({ appointments: z.array(AppointmentSchema), total: z.number().int() }) } },
    },
  },
});

app.openapi(listAppointments, async (c) => {
  const q = c.req.valid("query");
  const page = parseInt(q.page || "1", 10);
  const limit = parseInt(q.limit || "50", 10);
  const offset = (page - 1) * limit;

  let where = "WHERE 1=1";
  const params: unknown[] = [];

  if (q.search) {
    where += " AND (a.identifier LIKE ? OR cl.name LIKE ?)";
    const s = `%${q.search}%`;
    params.push(s, s);
  }
  if (q.status) { where += " AND a.status = ?"; params.push(q.status); }
  if (q.date) { where += " AND a.scheduled_date = ?"; params.push(q.date); }
  if (q.staff_id) { where += " AND a.staff_id = ?"; params.push(q.staff_id); }

  const total = await get<{ count: number }>(
    `SELECT COUNT(*) as count FROM appointments a LEFT JOIN clients cl ON cl.id = a.client_id ${where}`,
    params,
  );

  const appointments = await query<Record<string, unknown>>(
    `SELECT a.*, cl.name as client_name, cl.phone as client_phone,
            s.name as staff_name, s.color as staff_color,
            o.name as offering_name, o.color as offering_color,
            (SELECT sv.name FROM appointment_services aps
             LEFT JOIN services sv ON sv.id = aps.service_id
             WHERE aps.appointment_id = a.id
             ORDER BY aps.id LIMIT 1) as service_name,
            (SELECT sv.color FROM appointment_services aps
             LEFT JOIN services sv ON sv.id = aps.service_id
             WHERE aps.appointment_id = a.id
             ORDER BY aps.id LIMIT 1) as service_color,
            (SELECT content FROM appointment_notes an
             WHERE an.appointment_id = a.id
             ORDER BY an.created_at DESC LIMIT 1) as latest_note
     FROM appointments a
     LEFT JOIN clients cl ON cl.id = a.client_id
     LEFT JOIN staff s ON s.id = a.staff_id
     LEFT JOIN offering_slot_instances si ON si.id = a.offering_slot_instance_id
     LEFT JOIN offerings o ON o.id = si.offering_id
     ${where}
     ORDER BY a.scheduled_date DESC, a.start_time ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  if (appointments.length > 0) {
    const aptIds = appointments.map((a) => a.id as number);
    const placeholders = aptIds.map(() => "?").join(",");
    const assignedOfferingAddons = await query<Record<string, unknown>>(
      `SELECT aoa.*, oa.name, oa.extra_duration
       FROM appointment_offering_addons aoa
       JOIN offering_addons oa ON oa.id = aoa.offering_addon_id
       WHERE aoa.appointment_id IN (${placeholders})
       ORDER BY oa.name`,
      aptIds,
    );
    const offeringAddonsByAppointment = new Map<number, Record<string, unknown>[]>();
    for (const addon of assignedOfferingAddons) {
      const aptId = addon.appointment_id as number;
      const list = offeringAddonsByAppointment.get(aptId);
      if (list) list.push(addon);
      else offeringAddonsByAppointment.set(aptId, [addon]);
    }

    const assignedServiceAddons = await query<Record<string, unknown>>(
      `SELECT asa.*, sa.name, sa.extra_duration
       FROM appointment_service_addons asa
       JOIN service_addons sa ON sa.id = asa.service_addon_id
       WHERE asa.appointment_id IN (${placeholders})
       ORDER BY sa.name`,
      aptIds,
    );
    const serviceAddonsByAppointment = new Map<number, Record<string, unknown>[]>();
    for (const addon of assignedServiceAddons) {
      const aptId = addon.appointment_id as number;
      const list = serviceAddonsByAppointment.get(aptId);
      if (list) list.push(addon);
      else serviceAddonsByAppointment.set(aptId, [addon]);
    }

    for (const apt of appointments) {
      apt.appointment_offering_addons = offeringAddonsByAppointment.get(apt.id as number) ?? [];
      apt.appointment_service_addons = serviceAddonsByAppointment.get(apt.id as number) ?? [];
    }
  }

  return c.json({ appointments, total: total?.count || 0 }, 200);
});

// Calendar view - appointments for a date range
const getCalendar = createRoute({
  method: "get",
  path: "/api/calendar",
  request: {
    query: z.object({ start: z.string(), end: z.string() }),
  },
  responses: {
    200: {
      description: "Calendar appointments and blocked slots",
      content: { "application/json": { schema: z.object({
        appointments: z.array(AppointmentSchema),
        blocked_slots: z.array(BlockedSlotSchema),
        event_day: z.object({
          is_event_day: z.boolean(),
          block_regular_bookings: z.boolean(),
          event_names: z.array(z.string()),
        }),
      }) } },
    },
  },
});

app.openapi(getCalendar, async (c) => {
  const { start, end } = c.req.valid("query");
  const appointments = await query<Record<string, unknown>>(
    `SELECT a.*, cl.name as client_name, cl.phone as client_phone,
            s.name as staff_name, s.color as staff_color, o.name as offering_name
     FROM appointments a
     LEFT JOIN clients cl ON cl.id = a.client_id
     LEFT JOIN staff s ON s.id = a.staff_id
     LEFT JOIN offering_slot_instances si ON si.id = a.offering_slot_instance_id
     LEFT JOIN offerings o ON o.id = si.offering_id
     WHERE a.scheduled_date >= ? AND a.scheduled_date <= ? AND a.status != 'cancelled'
     ORDER BY a.start_time ASC`,
    [start, end],
  );

  // Attach services to each appointment
  for (const apt of appointments) {
    const svcs = await query<Record<string, unknown>>(
      `SELECT aps.*, sv.name as service_name FROM appointment_services aps
       LEFT JOIN services sv ON sv.id = aps.service_id
       WHERE aps.appointment_id = ?`,
      [apt.id],
    );
    (apt as Record<string, unknown>).appointment_services = svcs;
  }

  const blocked = await query<Record<string, unknown>>(
    `SELECT b.*, s.name as staff_name FROM blocked_slots b
     LEFT JOIN staff s ON s.id = b.staff_id
     WHERE b.blocked_date >= ? AND b.blocked_date <= ?
     ORDER BY b.start_time ASC`,
    [start, end],
  );

  return c.json({ appointments, blocked_slots: blocked, event_day: await getEventDayInfo(start) }, 200);
});

// Get single appointment
const getAppointment = createRoute({
  method: "get",
  path: "/api/appointments/{id}",
  request: { params: IdParam },
  responses: {
    200: {
      description: "Appointment detail",
      content: { "application/json": { schema: z.object({ appointment: AppointmentSchema }) } },
    },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(getAppointment, async (c) => {
  const { id } = c.req.valid("param");
  const apt = await get<Record<string, unknown>>(
    `SELECT a.*, cl.name as client_name, cl.phone as client_phone,
            s.name as staff_name, s.color as staff_color,
            o.id as offering_id, o.name as offering_name, o.base_price as offering_base_price
     FROM appointments a
     LEFT JOIN clients cl ON cl.id = a.client_id
     LEFT JOIN staff s ON s.id = a.staff_id
     LEFT JOIN offering_slot_instances si ON si.id = a.offering_slot_instance_id
     LEFT JOIN offerings o ON o.id = si.offering_id
     WHERE a.id = ?`,
    [id],
  );
  if (!apt) return c.json({ error: "Not found" }, 404);

  const svcs = await query<Record<string, unknown>>(
    `SELECT aps.*, sv.name as service_name FROM appointment_services aps
     LEFT JOIN services sv ON sv.id = aps.service_id
     WHERE aps.appointment_id = ?`,
    [id],
  );
  apt.appointment_services = svcs;

  const notes = await query<Record<string, unknown>>(
    "SELECT * FROM appointment_notes WHERE appointment_id = ? ORDER BY created_at DESC",
    [id],
  );
  apt.appointment_notes = notes;

  const assignedOfferingAddons = await query<Record<string, unknown>>(
    `SELECT aoa.*, oa.name, oa.extra_duration
     FROM appointment_offering_addons aoa
     JOIN offering_addons oa ON oa.id = aoa.offering_addon_id
     WHERE aoa.appointment_id = ?
     ORDER BY oa.name`,
    [id],
  );
  apt.appointment_offering_addons = assignedOfferingAddons;

  const assignedServiceAddons = await query<Record<string, unknown>>(
    `SELECT asa.*, sa.name, sa.extra_duration
     FROM appointment_service_addons asa
     JOIN service_addons sa ON sa.id = asa.service_addon_id
     WHERE asa.appointment_id = ?
     ORDER BY sa.name`,
    [id],
  );
  apt.appointment_service_addons = assignedServiceAddons;

  if (apt.offering_id) {
    apt.offering_addons = await query<Record<string, unknown>>(
      `SELECT id, name, price, extra_duration, active
       FROM offering_addons
       WHERE offering_id = ? AND active = 1
       ORDER BY id`,
      [apt.offering_id],
    );
  }

  const primaryService = svcs[0] as { service_id: number } | undefined;
  if (primaryService?.service_id) {
    const service = await get<{ allow_addons: number }>(
      "SELECT allow_addons FROM services WHERE id = ?",
      [primaryService.service_id],
    );
    if (service?.allow_addons) {
      apt.service_addons = await loadServiceAddons(primaryService.service_id);
    }
  }

  const pendingPayment = await loadPendingPaymentSummary(
    parseInt(String(id), 10),
    runtimeEnv(c.env) as { STRIPE_SECRET_KEY?: string },
    c.req.url,
  );
  apt.pending_payment = pendingPayment ?? null;

  return c.json({ appointment: apt }, 200);
});

const updateAppointmentAddons = createRoute({
  method: "put",
  path: "/api/appointments/{id}/addons",
  request: {
    params: IdParam,
    body: {
      content: {
        "application/json": {
          schema: z.object({ addon_ids: z.array(z.number().int()) }),
        },
      },
    },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: OkSchema } } },
    400: { description: "Invalid", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(updateAppointmentAddons, async (c) => {
  const { id } = c.req.valid("param");
  const { addon_ids } = c.req.valid("json");

  const apt = await get<{
    offering_slot_instance_id: number | null;
    start_time: string;
    travel_fee: number;
  }>(
    "SELECT offering_slot_instance_id, start_time, travel_fee FROM appointments WHERE id = ?",
    [id],
  );
  if (!apt) return c.json({ error: "Not found" }, 404);

  const uniqueIds = [...new Set(addon_ids)];

  if (apt.offering_slot_instance_id) {
    const slot = await get<{
      offering_id: number;
      base_price: number;
      duration: number;
    }>(
      `SELECT si.offering_id, o.base_price, o.duration
       FROM offering_slot_instances si
       JOIN offerings o ON o.id = si.offering_id
       WHERE si.id = ?`,
      [apt.offering_slot_instance_id],
    );
    if (!slot) return c.json({ error: "Offering slot not found" }, 404);

    let addonPrice = 0;
    let extraDuration = 0;
    const selected: { id: number; price: number }[] = [];

    if (uniqueIds.length > 0) {
      const addons = await query<{ id: number; price: number; extra_duration: number }>(
        `SELECT id, price, extra_duration FROM offering_addons
         WHERE offering_id = ? AND active = 1 AND id IN (${uniqueIds.map(() => "?").join(",")})`,
        [slot.offering_id, ...uniqueIds],
      );
      if (addons.length !== uniqueIds.length) {
        return c.json({ error: "One or more add-ons are invalid for this offering" }, 400);
      }
      for (const addon of addons) {
        addonPrice += addon.price;
        extraDuration += addon.extra_duration;
        selected.push({ id: addon.id, price: addon.price });
      }
    }

    await run("DELETE FROM appointment_offering_addons WHERE appointment_id = ?", [id]);
    for (const addon of selected) {
      await run(
        "INSERT INTO appointment_offering_addons (appointment_id, offering_addon_id, price) VALUES (?, ?, ?)",
        [id, addon.id, addon.price],
      );
    }

    const travelFee = apt.travel_fee ?? 0;
    const totalPrice = slot.base_price + addonPrice + travelFee;
    const endTime = addMinutes(apt.start_time, slot.duration + extraDuration);

    await run(
      "UPDATE appointments SET total_price = ?, end_time = ?, updated_at = datetime('now') WHERE id = ?",
      [totalPrice, endTime, id],
    );

    return c.json({ ok: true }, 200);
  }

  const apptService = await get<{ service_id: number; price: number; duration: number }>(
    `SELECT service_id, price, duration FROM appointment_services
     WHERE appointment_id = ?
     ORDER BY id LIMIT 1`,
    [id],
  );
  if (!apptService) {
    return c.json({ error: "This appointment is not linked to a bookable service" }, 400);
  }

  const service = await get<{ allow_addons: number }>(
    "SELECT allow_addons FROM services WHERE id = ?",
    [apptService.service_id],
  );
  if (!service?.allow_addons) {
    return c.json({ error: "Extras are not enabled for this service" }, 400);
  }

  let addonPrice = 0;
  let extraDuration = 0;
  const selected: { id: number; price: number }[] = [];

  if (uniqueIds.length > 0) {
    const addons = await query<{ id: number; price: number; extra_duration: number }>(
      `SELECT id, price, extra_duration FROM service_addons
       WHERE service_id = ? AND active = 1 AND id IN (${uniqueIds.map(() => "?").join(",")})`,
      [apptService.service_id, ...uniqueIds],
    );
    if (addons.length !== uniqueIds.length) {
      return c.json({ error: "One or more extras are invalid for this service" }, 400);
    }
    for (const addon of addons) {
      addonPrice += addon.price;
      extraDuration += addon.extra_duration;
      selected.push({ id: addon.id, price: addon.price });
    }
  }

  await run("DELETE FROM appointment_service_addons WHERE appointment_id = ?", [id]);
  for (const addon of selected) {
    await run(
      "INSERT INTO appointment_service_addons (appointment_id, service_addon_id, price) VALUES (?, ?, ?)",
      [id, addon.id, addon.price],
    );
  }

  const travelFee = apt.travel_fee ?? 0;
  const totalPrice = apptService.price + addonPrice + travelFee;
  const endTime = addMinutes(apt.start_time, apptService.duration + extraDuration);

  await run(
    "UPDATE appointments SET total_price = ?, end_time = ?, updated_at = datetime('now') WHERE id = ?",
    [totalPrice, endTime, id],
  );

  return c.json({ ok: true }, 200);
});

// Create appointment
const createAppointment = createRoute({
  method: "post",
  path: "/api/appointments",
  request: {
    body: { content: { "application/json": { schema: z.object({
      client_id: z.number().int(),
      staff_id: z.number().int().nullable().optional(),
      scheduled_date: z.string(),
      start_time: z.string().optional(),
      notes: z.string().optional(),
      is_recurring: z.number().int().optional(),
      recurrence_interval: z.string().optional(),
      service_ids: z.array(z.number().int()).optional(),
      travel_fee: z.number().optional(),
      service_address: z.string().optional(),
    }) } } },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: z.object({ appointment: AppointmentSchema }) } } },
    400: { description: "Blocked or invalid", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(createAppointment, async (c) => {
  const body = c.req.valid("json");
  try {
    await assertRegularBookingAllowed(body.scheduled_date);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
  const identifier = await nextIdentifier();
  const startTime = body.start_time || "09:00";

  // Calculate total duration and price from services
  let totalDuration = 60;
  let totalPrice = 0;
  const serviceIds = body.service_ids || [];
  const travelFee = Math.max(0, body.travel_fee ?? 0);

  if (serviceIds.length > 0) {
    const svcs = await query<{ duration: number; price: number }>(
      `SELECT duration, price FROM services WHERE id IN (${serviceIds.map(() => "?").join(",")})`,
      serviceIds,
    );
    totalDuration = svcs.reduce((sum, s) => sum + s.duration, 0);
    totalPrice = svcs.reduce((sum, s) => sum + s.price, 0);
  }

  totalPrice += travelFee;

  const endTime = addMinutes(startTime, totalDuration);

  const result = await run(
    `INSERT INTO appointments (identifier, client_id, staff_id, scheduled_date, start_time, end_time, total_price, travel_fee, service_address, notes, is_recurring, recurrence_interval)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [identifier, body.client_id, body.staff_id ?? null, body.scheduled_date,
    startTime, endTime, totalPrice, travelFee, body.service_address?.trim() || "",
    body.notes || "", body.is_recurring || 0, body.recurrence_interval || ""],
  );

  const aptId = result.lastInsertRowid;

  // Insert appointment services
  for (const svcId of serviceIds) {
    const svc = await get<{ duration: number; price: number }>("SELECT duration, price FROM services WHERE id = ?", [svcId]);
    if (svc) {
      await run(
        "INSERT INTO appointment_services (appointment_id, service_id, price, duration) VALUES (?, ?, ?, ?)",
        [aptId, svcId, svc.price, svc.duration],
      );
    }
  }

  const apt = await get<Record<string, unknown>>(
    `SELECT a.*, cl.name as client_name, cl.phone as client_phone,
            s.name as staff_name, s.color as staff_color
     FROM appointments a
     LEFT JOIN clients cl ON cl.id = a.client_id
     LEFT JOIN staff s ON s.id = a.staff_id
     WHERE a.id = ?`,
    [aptId],
  );

  scheduleBookingConfirmation(c, aptId as number);

  return c.json({ appointment: apt }, 201);
});

// Update appointment
const updateAppointment = createRoute({
  method: "put",
  path: "/api/appointments/{id}",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({
      client_id: z.number().int().optional(),
      staff_id: z.number().int().nullable().optional(),
      status: z.string().optional(),
      scheduled_date: z.string().optional(),
      start_time: z.string().optional(),
      end_time: z.string().optional(),
      total_price: z.number().optional(),
      deposit_amount: z.number().optional(),
      amount_paid: z.number().optional(),
      travel_fee: z.number().optional(),
      service_address: z.string().optional(),
      notes: z.string().optional(),
    }) } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: OkSchema } } },
  },
});

app.openapi(updateAppointment, async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const paymentTouched =
    body.total_price !== undefined
    || body.deposit_amount !== undefined
    || body.amount_paid !== undefined;

  const updates: Record<string, unknown> = { ...body };

  if (paymentTouched) {
    const current = await get<{ total_price: number; deposit_amount: number; amount_paid: number }>(
      "SELECT total_price, deposit_amount, amount_paid FROM appointments WHERE id = ?",
      [id],
    );
    const total = (body.total_price ?? current?.total_price ?? 0) as number;
    const deposit = (body.deposit_amount ?? current?.deposit_amount ?? 0) as number;
    const paid = (body.amount_paid ?? current?.amount_paid ?? 0) as number;
    updates.payment_status = derivePaymentStatus(total, deposit, paid);
  }

  if (body.scheduled_date) {
    const existing = await get<{ offering_slot_instance_id: number | null }>(
      "SELECT offering_slot_instance_id FROM appointments WHERE id = ?",
      [id],
    );
    if (!existing?.offering_slot_instance_id) {
      try {
        await assertRegularBookingAllowed(body.scheduled_date);
      } catch (err) {
        return c.json({ error: (err as Error).message }, 400);
      }
    }
  }

  const sets: string[] = [];
  const params: unknown[] = [];

  for (const [key, val] of Object.entries(updates)) {
    if (val !== undefined) { sets.push(`${key} = ?`); params.push(val); }
  }
  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')");
    await run(`UPDATE appointments SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
  }
  return c.json({ ok: true }, 200);
});

// Delete appointment
const deleteAppointment = createRoute({
  method: "delete",
  path: "/api/appointments/{id}",
  request: { params: IdParam },
  responses: { 200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } } },
});

app.openapi(deleteAppointment, async (c) => {
  const { id } = c.req.valid("param");
  const apt = await get<{ offering_slot_instance_id: number | null }>(
    "SELECT offering_slot_instance_id FROM appointments WHERE id = ?",
    [id],
  );
  if (!apt) return c.json({ error: "Not found" }, 404);

  try {
    await run("UPDATE booking_links SET appointment_id = NULL WHERE appointment_id = ?", [id]);
    if (apt.offering_slot_instance_id) {
      await run(
        "UPDATE offering_slot_instances SET booked_count = booked_count - 1 WHERE id = ? AND booked_count > 0",
        [apt.offering_slot_instance_id],
      );
    }
    await run("DELETE FROM appointments WHERE id = ?", [id]);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
  return c.json({ ok: true }, 200);
});

// Appointment notes
const addAppointmentNote = createRoute({
  method: "post",
  path: "/api/appointments/{id}/notes",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({ content: z.string() }) } } },
  },
  responses: { 201: { description: "Note added", content: { "application/json": { schema: OkSchema } } } },
});

app.openapi(addAppointmentNote, async (c) => {
  const { id } = c.req.valid("param");
  const { content } = c.req.valid("json");
  await run("INSERT INTO appointment_notes (appointment_id, content) VALUES (?, ?)", [id, content]);
  return c.json({ ok: true }, 201);
});

const deleteNote = createRoute({
  method: "delete",
  path: "/api/notes/{id}",
  request: { params: IdParam },
  responses: { 200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } } },
});

app.openapi(deleteNote, async (c) => {
  const { id } = c.req.valid("param");
  await run("DELETE FROM appointment_notes WHERE id = ?", [id]);
  return c.json({ ok: true }, 200);
});

// ── Clients ───────────────────────────────────────────────────────

const listClients = createRoute({
  method: "get",
  path: "/api/clients",
  request: {
    query: z.object({
      page: z.string().optional(),
      limit: z.string().optional(),
      search: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Paginated client list",
      content: { "application/json": { schema: z.object({ clients: z.array(ClientSchema), total: z.number().int() }) } },
    },
  },
});

app.openapi(listClients, async (c) => {
  const q = c.req.valid("query");
  const page = parseInt(q.page || "1", 10);
  const limit = parseInt(q.limit || "50", 10);
  const offset = (page - 1) * limit;

  let where = "WHERE 1=1";
  const params: unknown[] = [];
  if (q.search) {
    where += " AND (c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)";
    const s = `%${q.search}%`;
    params.push(s, s, s);
  }

  const total = await get<{ count: number }>(`SELECT COUNT(*) as count FROM clients c ${where}`, params);
  const today = todayIsoDate();
  const clients = await query<Record<string, unknown>>(
    `SELECT c.*,
      (SELECT COUNT(*) FROM appointments WHERE client_id = c.id) as appointment_count,
      (
        (SELECT COUNT(*) FROM appointments a WHERE a.client_id = c.id AND ${blockingClientAppointmentsWhere("a")})
        + (SELECT COUNT(*) FROM booking_links bl WHERE bl.client_id = c.id AND ${blockingClientBookingLinksWhere("bl")})
      ) as active_booking_count
     FROM clients c ${where} ORDER BY c.name ASC LIMIT ? OFFSET ?`,
    [...params, today, today, limit, offset],
  );

  return c.json({ clients, total: total?.count || 0 }, 200);
});

const getAllClients = createRoute({
  method: "get",
  path: "/api/clients/all",
  responses: {
    200: {
      description: "All clients for lookup",
      content: { "application/json": { schema: z.object({ clients: z.array(z.object({ id: z.number().int(), name: z.string() })) }) } },
    },
  },
});

app.openapi(getAllClients, async (c) => {
  const clients = await query<{ id: number; name: string }>("SELECT id, name FROM clients ORDER BY name ASC");
  return c.json({ clients }, 200);
});

const getClient = createRoute({
  method: "get",
  path: "/api/clients/{id}",
  request: { params: IdParam },
  responses: {
    200: {
      description: "Client detail with appointments",
      content: { "application/json": { schema: z.object({ client: ClientSchema, appointments: z.array(AppointmentSchema) }) } },
    },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(getClient, async (c) => {
  const { id } = c.req.valid("param");
  const client = await get<Record<string, unknown>>("SELECT * FROM clients WHERE id = ?", [id]);
  if (!client) return c.json({ error: "Not found" }, 404);
  const today = todayIsoDate();
  const active_booking_count = await countClientActiveBookings(id, today);
  const appointments = await query<Record<string, unknown>>(
    `SELECT a.*, s.name as staff_name, s.color as staff_color
     FROM appointments a LEFT JOIN staff s ON s.id = a.staff_id
     WHERE a.client_id = ? ORDER BY a.scheduled_date DESC LIMIT 50`,
    [id],
  );
  return c.json({ client: { ...client, active_booking_count }, appointments }, 200);
});

const createClient = createRoute({
  method: "post",
  path: "/api/clients",
  request: {
    body: { content: { "application/json": { schema: z.object({
      name: z.string(),
      email: z.string().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      notes: z.string().optional(),
    }) } } },
  },
  responses: { 201: { description: "Created", content: { "application/json": { schema: z.object({ client: ClientSchema }) } } } },
});

app.openapi(createClient, async (c) => {
  const body = c.req.valid("json");
  const result = await run(
    "INSERT INTO clients (name, email, phone, address, notes) VALUES (?, ?, ?, ?, ?)",
    [body.name, body.email || "", body.phone || "", body.address || "", body.notes || ""],
  );
  const client = await get<Record<string, unknown>>("SELECT * FROM clients WHERE id = ?", [result.lastInsertRowid]);
  return c.json({ client }, 201);
});

const updateClient = createRoute({
  method: "put",
  path: "/api/clients/{id}",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({
      name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
      notes: z.string().optional(),
    }) } } },
  },
  responses: { 200: { description: "Updated", content: { "application/json": { schema: OkSchema } } } },
});

app.openapi(updateClient, async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, val] of Object.entries(body)) {
    if (val !== undefined) { sets.push(`${key} = ?`); params.push(val); }
  }
  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')");
    await run(`UPDATE clients SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
  }
  return c.json({ ok: true }, 200);
});

const deleteClient = createRoute({
  method: "delete",
  path: "/api/clients/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } },
    409: { description: "Client has active or upcoming bookings", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deleteClient, async (c) => {
  const { id } = c.req.valid("param");
  const client = await get<{ id: number; name: string }>("SELECT id, name FROM clients WHERE id = ?", [id]);
  if (!client) return c.json({ error: "Not found" }, 404);

  const blockingCount = await countClientActiveBookings(id);
  if (blockingCount > 0) {
    return c.json(
      { error: `${client.name} has active or upcoming bookings. Delete or cancel those appointments first.` },
      409,
    );
  }

  try {
    await detachClientBookingLinks(id);
    await run("DELETE FROM clients WHERE id = ?", [id]);
  } catch {
    return c.json(
      { error: `${client.name} could not be deleted because related booking records still exist.` },
      409,
    );
  }
  return c.json({ ok: true }, 200);
});

// ── Staff ─────────────────────────────────────────────────────────

const listStaff = createRoute({
  method: "get",
  path: "/api/staff",
  responses: {
    200: {
      description: "All staff members",
      content: { "application/json": { schema: z.object({ staff: z.array(StaffSchema) }) } },
    },
  },
});

app.openapi(listStaff, async (c) => {
  const staff = await query<Record<string, unknown>>(
    `SELECT s.*, (SELECT COUNT(*) FROM appointments WHERE staff_id = s.id) as appointment_count
     FROM staff s ORDER BY s.name ASC`,
  );
  return c.json({ staff }, 200);
});

const getAllStaff = createRoute({
  method: "get",
  path: "/api/staff/all",
  responses: {
    200: {
      description: "All staff for lookup",
      content: { "application/json": { schema: z.object({ staff: z.array(z.object({ id: z.number().int(), name: z.string(), color: z.string() })) }) } },
    },
  },
});

app.openapi(getAllStaff, async (c) => {
  const staff = await query<{ id: number; name: string; color: string }>("SELECT id, name, color FROM staff WHERE active = 1 ORDER BY name ASC");
  return c.json({ staff }, 200);
});

const createStaff = createRoute({
  method: "post",
  path: "/api/staff",
  request: {
    body: { content: { "application/json": { schema: z.object({
      name: z.string(),
      email: z.string().optional(),
      phone: z.string().optional(),
      title: z.string().optional(),
      color: z.string().optional(),
      is_admin: z.number().int().optional(),
    }) } } },
  },
  responses: { 201: { description: "Created", content: { "application/json": { schema: z.object({ staff: StaffSchema }) } } } },
});

app.openapi(createStaff, async (c) => {
  const body = c.req.valid("json");
  const adminCount = await get<{ count: number }>("SELECT COUNT(*) as count FROM staff WHERE is_admin = 1");
  const isAdmin = (adminCount?.count || 0) === 0 ? 1 : (body.is_admin ? 1 : 0);
  const result = await run(
    "INSERT INTO staff (name, email, phone, title, color, is_admin) VALUES (?, ?, ?, ?, ?, ?)",
    [body.name, body.email || "", body.phone || "", body.title || "", body.color || "#7c3aed", isAdmin],
  );
  const staff = await get<Record<string, unknown>>("SELECT * FROM staff WHERE id = ?", [result.lastInsertRowid]);
  return c.json({ staff }, 201);
});

const updateStaff = createRoute({
  method: "put",
  path: "/api/staff/{id}",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({
      name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      title: z.string().optional(),
      color: z.string().optional(),
      active: z.number().int().optional(),
      is_admin: z.number().int().optional(),
    }) } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: OkSchema } } },
    409: { description: "Cannot remove sole admin", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(updateStaff, async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const existing = await get<{ id: number; name: string; is_admin: number }>(
    "SELECT id, name, is_admin FROM staff WHERE id = ?",
    [id],
  );
  if (!existing) return c.json({ error: "Not found" }, 404);

  if (body.is_admin === 0 && existing.is_admin) {
    const otherAdmins = await get<{ count: number }>(
      "SELECT COUNT(*) as count FROM staff WHERE is_admin = 1 AND id != ?",
      [id],
    );
    if ((otherAdmins?.count || 0) === 0) {
      return c.json(
        { error: `${existing.name} is the only admin. Assign another admin before removing admin access.` },
        409,
      );
    }
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, val] of Object.entries(body)) {
    if (val !== undefined) { sets.push(`${key} = ?`); params.push(val); }
  }
  if (sets.length > 0) {
    await run(`UPDATE staff SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
  }
  return c.json({ ok: true }, 200);
});

const deleteStaff = createRoute({
  method: "delete",
  path: "/api/staff/{id}",
  request: { params: IdParam },
  responses: {
    200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } },
    409: { description: "Cannot delete sole admin", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(deleteStaff, async (c) => {
  const { id } = c.req.valid("param");
  const staff = await get<{ id: number; name: string; is_admin: number }>(
    "SELECT id, name, is_admin FROM staff WHERE id = ?",
    [id],
  );
  if (!staff) return c.json({ error: "Not found" }, 404);

  if (staff.is_admin) {
    const otherAdmins = await get<{ count: number }>(
      "SELECT COUNT(*) as count FROM staff WHERE is_admin = 1 AND id != ?",
      [id],
    );
    if ((otherAdmins?.count || 0) === 0) {
      return c.json(
        { error: `${staff.name} is the only admin. Assign another admin before deleting them.` },
        409,
      );
    }
  }

  try {
    await deleteStaffCascade(id);
  } catch {
    return c.json(
      { error: `${staff.name} could not be deleted because related booking records still exist.` },
      409,
    );
  }
  return c.json({ ok: true }, 200);
});

// ── Services ──────────────────────────────────────────────────────

const listServices = createRoute({
  method: "get",
  path: "/api/services",
  responses: {
    200: {
      description: "All services",
      content: { "application/json": { schema: z.object({ services: z.array(ServiceSchema) }) } },
    },
  },
});

app.openapi(listServices, async (c) => {
  await backfillServiceSlugs();
  const services = await query<Record<string, unknown>>("SELECT * FROM services ORDER BY category ASC, name ASC");
  return c.json({ services }, 200);
});

const ServiceAddonInputSchema = z.object({
  id: z.number().int().optional(),
  name: z.string(),
  price: z.number(),
  extra_duration: z.number().int().optional(),
});

const createService = createRoute({
  method: "post",
  path: "/api/services",
  request: {
    body: { content: { "application/json": { schema: z.object({
      name: z.string(),
      description: z.string().optional(),
      duration: z.number().int().optional(),
      price: z.number().optional(),
      color: z.string().optional(),
      category: z.string().optional(),
      allow_addons: z.number().int().optional(),
      addons: z.array(ServiceAddonInputSchema).optional(),
    }) } } },
  },
  responses: { 201: { description: "Created", content: { "application/json": { schema: z.object({ service: ServiceSchema }) } } } },
});

app.openapi(createService, async (c) => {
  const body = c.req.valid("json");
  const { addons, ...fields } = body;
  const slug = await uniqueServiceSlug(fields.name);
  const result = await run(
    "INSERT INTO services (name, slug, description, duration, price, color, category, allow_addons) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      fields.name,
      slug,
      fields.description || "",
      fields.duration || 60,
      fields.price || 0,
      fields.color || "#6b7280",
      fields.category || "",
      fields.allow_addons ? 1 : 0,
    ],
  );
  const serviceId = result.lastInsertRowid as number;
  if (fields.allow_addons && addons?.length) {
    await syncServiceAddons(serviceId, addons);
  }
  const service = await get<Record<string, unknown>>("SELECT * FROM services WHERE id = ?", [serviceId]);
  return c.json({ service }, 201);
});

const getService = createRoute({
  method: "get",
  path: "/api/services/{id}",
  request: { params: IdParam },
  responses: {
    200: {
      description: "Service detail",
      content: {
        "application/json": {
          schema: z.object({
            service: ServiceSchema,
            addons: z.array(ServiceAddonSchema),
          }),
        },
      },
    },
    404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

app.openapi(getService, async (c) => {
  const { id } = c.req.valid("param");
  await backfillServiceSlugs();
  const service = await get<Record<string, unknown>>("SELECT * FROM services WHERE id = ?", [id]);
  if (!service) return c.json({ error: "Not found" }, 404);
  const addons = service.allow_addons
    ? await loadServiceAddons(parseInt(String(id), 10))
    : [];
  return c.json({ service, addons }, 200);
});

const updateService = createRoute({
  method: "put",
  path: "/api/services/{id}",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({
      name: z.string().optional(),
      description: z.string().optional(),
      duration: z.number().int().optional(),
      price: z.number().optional(),
      color: z.string().optional(),
      category: z.string().optional(),
      active: z.number().int().optional(),
      allow_addons: z.number().int().optional(),
      addons: z.array(ServiceAddonInputSchema).optional(),
    }) } } },
  },
  responses: { 200: { description: "Updated", content: { "application/json": { schema: OkSchema } } } },
});

app.openapi(updateService, async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const { addons, ...fields } = body;
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, val] of Object.entries(fields)) {
    if (val !== undefined) { sets.push(`${key} = ?`); params.push(val); }
  }
  if (sets.length > 0) {
    await run(`UPDATE services SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
  }
  if (addons !== undefined) {
    const service = await get<{ allow_addons: number }>("SELECT allow_addons FROM services WHERE id = ?", [id]);
    if (service?.allow_addons) {
      await syncServiceAddons(parseInt(String(id), 10), addons);
    } else if (addons.length > 0) {
      await run("UPDATE services SET allow_addons = 1 WHERE id = ?", [id]);
      await syncServiceAddons(parseInt(String(id), 10), addons);
    }
  } else if (fields.allow_addons === 0) {
    const existing = await query<{ id: number }>(
      "SELECT id FROM service_addons WHERE service_id = ? AND active = 1",
      [id],
    );
    for (const row of existing) {
      await run("UPDATE service_addons SET active = 0 WHERE id = ?", [row.id]);
    }
  }
  return c.json({ ok: true }, 200);
});

const deleteService = createRoute({
  method: "delete",
  path: "/api/services/{id}",
  request: { params: IdParam },
  responses: { 200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } } },
});

app.openapi(deleteService, async (c) => {
  const { id } = c.req.valid("param");
  await run("DELETE FROM services WHERE id = ?", [id]);
  return c.json({ ok: true }, 200);
});

// ── Blocked Slots ─────────────────────────────────────────────────

const createBlockedSlot = createRoute({
  method: "post",
  path: "/api/blocked-slots",
  request: {
    body: { content: { "application/json": { schema: z.object({
      staff_id: z.number().int(),
      blocked_date: z.string(),
      start_time: z.string(),
      end_time: z.string(),
      reason: z.string().optional(),
    }) } } },
  },
  responses: { 201: { description: "Created", content: { "application/json": { schema: OkSchema } } } },
});

app.openapi(createBlockedSlot, async (c) => {
  const body = c.req.valid("json");
  await run(
    "INSERT INTO blocked_slots (staff_id, blocked_date, start_time, end_time, reason) VALUES (?, ?, ?, ?, ?)",
    [body.staff_id, body.blocked_date, body.start_time, body.end_time, body.reason || ""],
  );
  return c.json({ ok: true }, 201);
});

const deleteBlockedSlot = createRoute({
  method: "delete",
  path: "/api/blocked-slots/{id}",
  request: { params: IdParam },
  responses: { 200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } } },
});

app.openapi(deleteBlockedSlot, async (c) => {
  const { id } = c.req.valid("param");
  await run("DELETE FROM blocked_slots WHERE id = ?", [id]);
  return c.json({ ok: true }, 200);
});

// ── Products ──────────────────────────────────────────────────────

const listProducts = createRoute({
  method: "get",
  path: "/api/products",
  request: {
    query: z.object({
      page: z.string().optional(),
      limit: z.string().optional(),
      search: z.string().optional(),
      category: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Paginated product list",
      content: { "application/json": { schema: z.object({ products: z.array(ProductSchema), total: z.number().int() }) } },
    },
  },
});

app.openapi(listProducts, async (c) => {
  const q = c.req.valid("query");
  const page = parseInt(q.page || "1", 10);
  const limit = parseInt(q.limit || "50", 10);
  const offset = (page - 1) * limit;

  let where = "WHERE 1=1";
  const params: unknown[] = [];
  if (q.search) {
    where += " AND (p.name LIKE ? OR p.brand LIKE ? OR p.sku LIKE ?)";
    const s = `%${q.search}%`;
    params.push(s, s, s);
  }
  if (q.category) { where += " AND p.category = ?"; params.push(q.category); }

  const total = await get<{ count: number }>(`SELECT COUNT(*) as count FROM products p ${where}`, params);
  const products = await query<Record<string, unknown>>(
    `SELECT * FROM products p ${where} ORDER BY p.name ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return c.json({ products, total: total?.count || 0 }, 200);
});

const createProduct = createRoute({
  method: "post",
  path: "/api/products",
  request: {
    body: { content: { "application/json": { schema: z.object({
      name: z.string(),
      brand: z.string().optional(),
      category: z.string().optional(),
      sku: z.string().optional(),
      price: z.number().optional(),
      cost: z.number().optional(),
      stock: z.number().int().optional(),
      low_stock_alert: z.number().int().optional(),
    }) } } },
  },
  responses: { 201: { description: "Created", content: { "application/json": { schema: z.object({ product: ProductSchema }) } } } },
});

app.openapi(createProduct, async (c) => {
  const body = c.req.valid("json");
  const result = await run(
    "INSERT INTO products (name, brand, category, sku, price, cost, stock, low_stock_alert) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [body.name, body.brand || "", body.category || "", body.sku || "",
    body.price || 0, body.cost || 0, body.stock || 0, body.low_stock_alert || 5],
  );
  const product = await get<Record<string, unknown>>("SELECT * FROM products WHERE id = ?", [result.lastInsertRowid]);
  return c.json({ product }, 201);
});

const updateProduct = createRoute({
  method: "put",
  path: "/api/products/{id}",
  request: {
    params: IdParam,
    body: { content: { "application/json": { schema: z.object({
      name: z.string().optional(),
      brand: z.string().optional(),
      category: z.string().optional(),
      sku: z.string().optional(),
      price: z.number().optional(),
      cost: z.number().optional(),
      stock: z.number().int().optional(),
      low_stock_alert: z.number().int().optional(),
    }) } } },
  },
  responses: { 200: { description: "Updated", content: { "application/json": { schema: OkSchema } } } },
});

app.openapi(updateProduct, async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, val] of Object.entries(body)) {
    if (val !== undefined) { sets.push(`${key} = ?`); params.push(val); }
  }
  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')");
    await run(`UPDATE products SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
  }
  return c.json({ ok: true }, 200);
});

const deleteProduct = createRoute({
  method: "delete",
  path: "/api/products/{id}",
  request: { params: IdParam },
  responses: { 200: { description: "Deleted", content: { "application/json": { schema: OkSchema } } } },
});

app.openapi(deleteProduct, async (c) => {
  const { id } = c.req.valid("param");
  await run("DELETE FROM products WHERE id = ?", [id]);
  return c.json({ ok: true }, 200);
});

