import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { get, query, run } from "./db.js";
import { addMinutes, nextIdentifier } from "./helpers.js";
import { getDefaultCurrency } from "./settings.js";
import { expandDateWindows, slugify } from "../shared/offerings.js";
import { isValidCurrency } from "../shared/currency.js";
import { findRegularAppointmentConflicts } from "./event-override.js";
import { assertClientEmailForBooking, findOrCreateClient } from "./clients.js";
import { parseRequiredBookingEmail } from "../shared/email.js";
import { scheduleBookingConfirmation } from "./notifications.js";
import { runtimeEnv } from "./runtime-env.js";
import { isStripePaymentsActive } from "./stripe-payments-settings.js";
import type { StripeEnv } from "./stripe.js";
import {
  computeOfferingBookingTotal,
  countPendingOfferingCheckouts,
  createOfferingBookingCheckout,
  expireStaleOfferingCheckouts,
  finalizeOfferingBookingCheckout,
  offeringRequiresPayment,
  offeringSlotSpotsLeft,
} from "./offering-payments.js";
import {
  offeringCheckoutAmount,
  offeringClientHasPaymentChoice,
  resolveOfferingDeposit,
  type PaymentChoice,
} from "../shared/payment.js";

const ErrorSchema = z.object({ error: z.string() });
const IdParam = z.object({ id: z.string().openapi({ description: "Offering or slot ID" }) });

const DateWindowSchema = z.object({
  start_date: z.string(),
  end_date: z.string(),
});

const TimeSlotSchema = z.object({
  start_time: z.string(),
  end_time: z.string(),
});

const AddonSchema = z.object({
  id: z.number().int().optional(),
  name: z.string(),
  price: z.number(),
  extra_duration: z.number().int().optional(),
});

const OfferingBodySchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  detailed_description: z.string().optional(),
  base_price: z.number().optional(),
  duration: z.number().int().optional(),
  color: z.string().optional(),
  category: z.string().optional(),
  capacity_per_slot: z.number().int().optional(),
  staff_ids: z.array(z.number().int()).optional(),
  block_regular_bookings: z.boolean().nullable().optional(),
  date_windows: z.array(DateWindowSchema).optional(),
  time_slots: z.array(TimeSlotSchema).optional(),
  addons: z.array(AddonSchema).optional(),
  allow_addons: z.number().int().optional(),
  confirm_price_changes: z.boolean().optional(),
  currency: z.string().optional(),
});

type OfferingRow = {
  id: number;
  name: string;
  slug: string;
  description: string;
  detailed_description: string;
  base_price: number;
  duration: number;
  color: string;
  category: string;
  status: string;
  capacity_per_slot: number;
  staff_ids: string;
  block_regular_bookings: number | null;
  currency: string;
  allow_addons: number;
  created_at: string;
  updated_at: string;
};

async function resolveOfferingCurrency(bodyCurrency?: string): Promise<string> {
  if (bodyCurrency && isValidCurrency(bodyCurrency)) return bodyCurrency;
  return getDefaultCurrency();
}

function blockRegularToDb(value: boolean | null | undefined): number | null {
  if (value === true) return 1;
  if (value === false) return 0;
  return null;
}

function blockRegularFromDb(value: number | null | undefined): boolean | null {
  if (value === 1) return true;
  if (value === 0) return false;
  return null;
}

function allowAddonsFromBody(body: { allow_addons?: number; addons?: { name: string }[] }): number {
  if (body.allow_addons != null) return body.allow_addons ? 1 : 0;
  const namedAddons = (body.addons || []).filter((a) => a.name.trim());
  return namedAddons.length > 0 ? 1 : 0;
}

async function loadOfferingAddons(offeringId: number, allowAddons: number) {
  if (!allowAddons) return [];
  return query<{
    id: number;
    name: string;
    price: number;
    extra_duration: number;
    active: number;
  }>(
    "SELECT id, name, price, extra_duration, active FROM offering_addons WHERE offering_id = ? AND active = 1 ORDER BY id",
    [offeringId],
  );
}

function parseStaffIds(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === "number") : [];
  } catch {
    return [];
  }
}

function formatOffering(row: OfferingRow) {
  return {
    ...row,
    staff_ids: parseStaffIds(row.staff_ids),
    block_regular_bookings: blockRegularFromDb(row.block_regular_bookings),
  };
}

async function uniqueOfferingSlug(name: string, excludeId?: number): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let n = 0;
  while (true) {
    const row = excludeId != null
      ? await get<{ id: number }>("SELECT id FROM offerings WHERE slug = ? AND id != ?", [candidate, excludeId])
      : await get<{ id: number }>("SELECT id FROM offerings WHERE slug = ?", [candidate]);
    if (!row) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}

async function countOfferingBookings(offeringId: number): Promise<number> {
  const row = await get<{ count: number }>(
    `SELECT COUNT(*) as count FROM appointments a
     JOIN offering_slot_instances si ON si.id = a.offering_slot_instance_id
     WHERE si.offering_id = ? AND a.status NOT IN ('cancelled', 'no_show')`,
    [offeringId],
  );
  return row?.count ?? 0;
}

async function getMaxBookedPerSlot(offeringId: number): Promise<number> {
  const row = await get<{ max_booked: number }>(
    `SELECT COALESCE(MAX(booked_count), 0) as max_booked
     FROM offering_slot_instances WHERE offering_id = ?`,
    [offeringId],
  );
  return row?.max_booked ?? 0;
}

async function updateOfferingCapacity(offeringId: number, capacity: number) {
  await run(
    "UPDATE offerings SET capacity_per_slot = ?, updated_at = datetime('now') WHERE id = ?",
    [capacity, offeringId],
  );
  await run(
    "UPDATE offering_slot_instances SET capacity = ? WHERE offering_id = ?",
    [capacity, offeringId],
  );
}

type LinkedOfferingAppointment = {
  id: number;
  status: string;
  amount_paid: number;
  payment_status: string;
  offering_slot_instance_id: number | null;
};

async function getOfferingAppointments(offeringId: number): Promise<LinkedOfferingAppointment[]> {
  return query<LinkedOfferingAppointment>(
    `SELECT a.id, a.status, a.amount_paid, a.payment_status, a.offering_slot_instance_id
     FROM appointments a
     JOIN offering_slot_instances si ON si.id = a.offering_slot_instance_id
     WHERE si.offering_id = ?`,
    [offeringId],
  );
}

const ACTIVE_APPOINTMENT_STATUSES = new Set(["booked", "confirmed", "in_progress", "completed"]);

function activeOfferingAppointments(appointments: LinkedOfferingAppointment[]) {
  return appointments.filter((a) => ACTIVE_APPOINTMENT_STATUSES.has(a.status));
}

type OfferingDeleteCheck =
  | { can_delete: true; upcoming_appointment_count: number }
  | { can_delete: false; delete_blocked_reason: string };

function checkOfferingDeletable(
  offering: { status: string },
  appointments: LinkedOfferingAppointment[],
): OfferingDeleteCheck {
  const active = activeOfferingAppointments(appointments);
  const upcoming = active.filter((a) => a.status !== "completed");

  const completed = active.filter((a) => a.status === "completed");
  if (completed.length > 0) {
    return {
      can_delete: false,
      delete_blocked_reason: `${completed.length} completed appointment${completed.length === 1 ? "" : "s"} — events with completed services can't be deleted.`,
    };
  }

  const inProgress = active.filter((a) => a.status === "in_progress");
  if (inProgress.length > 0) {
    return {
      can_delete: false,
      delete_blocked_reason: "An appointment is in progress — finish or cancel it before deleting this event.",
    };
  }

  const withPayment = appointments.filter(
    (a) => (a.amount_paid ?? 0) > 0 || a.payment_status === "deposit_paid" || a.payment_status === "paid",
  );
  if (withPayment.length > 0) {
    return {
      can_delete: false,
      delete_blocked_reason: "Payment was collected on at least one booking — refund or adjust those appointments first.",
    };
  }

  if (offering.status === "draft") {
    if (active.length > 0) {
      return {
        can_delete: false,
        delete_blocked_reason: "Cancel or remove all bookings before deleting this event.",
      };
    }
    return { can_delete: true, upcoming_appointment_count: 0 };
  }

  if (offering.status === "live") {
    if (active.length > 0) {
      return {
        can_delete: false,
        delete_blocked_reason: "Archive this event before deleting — it still has upcoming bookings.",
      };
    }
    return { can_delete: true, upcoming_appointment_count: 0 };
  }

  if (offering.status === "archived" || offering.status === "completed") {
    return { can_delete: true, upcoming_appointment_count: upcoming.length };
  }

  return {
    can_delete: false,
    delete_blocked_reason: "This event can't be deleted in its current state.",
  };
}

async function deleteOfferingCascade(offeringId: number): Promise<void> {
  const appointments = await getOfferingAppointments(offeringId);
  for (const apt of appointments) {
    await run("UPDATE booking_links SET appointment_id = NULL WHERE appointment_id = ?", [apt.id]);
    if (apt.offering_slot_instance_id) {
      await run(
        "UPDATE offering_slot_instances SET booked_count = booked_count - 1 WHERE id = ? AND booked_count > 0",
        [apt.offering_slot_instance_id],
      );
    }
    await run("DELETE FROM appointments WHERE id = ?", [apt.id]);
  }
  await run("DELETE FROM offerings WHERE id = ?", [offeringId]);
}

function livePricingChanged(
  existing: OfferingRow,
  existingAddons: { id: number; price: number }[],
  body: {
    base_price?: number;
    addons?: { id?: number; name: string; price: number }[];
  },
): boolean {
  if (body.base_price != null && body.base_price !== existing.base_price) return true;
  const incoming = (body.addons || []).filter((a) => a.name.trim());
  const incomingIds = new Set(incoming.filter((a) => a.id).map((a) => a.id!));
  for (const addon of existingAddons) {
    if (!incomingIds.has(addon.id)) return true;
    const match = incoming.find((a) => a.id === addon.id);
    if (match && match.price !== addon.price) return true;
  }
  return false;
}

async function loadOfferingDetail(id: number) {
  const offering = await get<OfferingRow>("SELECT * FROM offerings WHERE id = ?", [id]);
  if (!offering) return null;

  const date_windows = await query<{ id: number; start_date: string; end_date: string }>(
    "SELECT id, start_date, end_date FROM offering_date_windows WHERE offering_id = ? ORDER BY start_date",
    [id],
  );
  const time_slots = await query<{ id: number; start_time: string; end_time: string }>(
    "SELECT id, start_time, end_time FROM offering_time_slots WHERE offering_id = ? ORDER BY start_time",
    [id],
  );
  const addons = await query<{
    id: number;
    name: string;
    price: number;
    extra_duration: number;
    active: number;
  }>(
    "SELECT id, name, price, extra_duration, active FROM offering_addons WHERE offering_id = ? AND active = 1 ORDER BY id",
    [id],
  );

  return {
    offering: formatOffering(offering),
    date_windows,
    time_slots,
    addons,
  };
}

async function syncOfferingAddons(
  offeringId: number,
  addons: { id?: number; name: string; price: number; extra_duration?: number }[],
) {
  const existing = await query<{ id: number }>(
    "SELECT id FROM offering_addons WHERE offering_id = ? AND active = 1",
    [offeringId],
  );
  const kept = addons.filter((a) => a.name.trim());
  const incomingIds = new Set(kept.filter((a) => a.id).map((a) => a.id!));

  for (const row of existing) {
    if (!incomingIds.has(row.id)) {
      await run("UPDATE offering_addons SET active = 0 WHERE id = ?", [row.id]);
    }
  }

  for (const addon of kept) {
    if (addon.id) {
      await run(
        `UPDATE offering_addons SET name = ?, price = ?, extra_duration = ?, active = 1
         WHERE id = ? AND offering_id = ?`,
        [addon.name.trim(), addon.price, addon.extra_duration ?? 0, addon.id, offeringId],
      );
    } else {
      await run(
        "INSERT INTO offering_addons (offering_id, name, price, extra_duration) VALUES (?, ?, ?, ?)",
        [offeringId, addon.name.trim(), addon.price, addon.extra_duration ?? 0],
      );
    }
  }
}

async function replaceOfferingChildren(
  offeringId: number,
  date_windows: { start_date: string; end_date: string }[],
  time_slots: { start_time: string; end_time: string }[],
  addons: { name: string; price: number; extra_duration?: number }[],
) {
  await run("DELETE FROM offering_date_windows WHERE offering_id = ?", [offeringId]);
  await run("DELETE FROM offering_time_slots WHERE offering_id = ?", [offeringId]);
  await run("DELETE FROM offering_addons WHERE offering_id = ?", [offeringId]);

  for (const window of date_windows) {
    await run(
      "INSERT INTO offering_date_windows (offering_id, start_date, end_date) VALUES (?, ?, ?)",
      [offeringId, window.start_date, window.end_date],
    );
  }
  for (const slot of time_slots) {
    await run(
      "INSERT INTO offering_time_slots (offering_id, start_time, end_time) VALUES (?, ?, ?)",
      [offeringId, slot.start_time, slot.end_time],
    );
  }
  for (const addon of addons) {
    await run(
      "INSERT INTO offering_addons (offering_id, name, price, extra_duration) VALUES (?, ?, ?, ?)",
      [offeringId, addon.name.trim(), addon.price, addon.extra_duration ?? 0],
    );
  }
}

async function materializeSlots(offeringId: number, capacity: number) {
  await run("DELETE FROM offering_slot_instances WHERE offering_id = ?", [offeringId]);

  const windows = await query<{ start_date: string; end_date: string }>(
    "SELECT start_date, end_date FROM offering_date_windows WHERE offering_id = ?",
    [offeringId],
  );
  const templates = await query<{ start_time: string; end_time: string }>(
    "SELECT start_time, end_time FROM offering_time_slots WHERE offering_id = ?",
    [offeringId],
  );

  const dates = expandDateWindows(windows);
  for (const date of dates) {
    for (const template of templates) {
      await run(
        `INSERT INTO offering_slot_instances (offering_id, slot_date, start_time, end_time, capacity, booked_count)
         VALUES (?, ?, ?, ?, ?, 0)`,
        [offeringId, date, template.start_time, template.end_time, capacity],
      );
    }
  }
}

async function bookOfferingSlotInstance(
  slotId: number,
  opts: {
    client_id: number;
    staff_id?: number | null;
    addon_ids?: number[];
    notes?: string;
    via?: "staff" | "public";
    payment?: {
      deposit_amount: number;
      amount_paid: number;
      payment_status: string;
      stripe_checkout_session_id?: string | null;
      stripe_payment_intent_id?: string | null;
    };
  },
): Promise<Record<string, unknown>> {
  const slot = await get<{
    id: number;
    offering_id: number;
    slot_date: string;
    start_time: string;
    end_time: string;
    capacity: number;
    booked_count: number;
    status: string;
    base_price: number;
    duration: number;
    staff_ids: string;
    offering_name: string;
    offering_currency: string;
    offering_allow_addons: number;
  }>(
    `SELECT si.*, o.status, o.base_price, o.duration, o.staff_ids, o.name as offering_name, o.currency as offering_currency,
            o.allow_addons as offering_allow_addons
     FROM offering_slot_instances si
     JOIN offerings o ON o.id = si.offering_id
     WHERE si.id = ?`,
    [slotId],
  );
  if (!slot) throw new Error("SLOT_NOT_FOUND");
  if (slot.status !== "live") throw new Error("OFFERING_NOT_LIVE");
  if (slot.booked_count >= slot.capacity) throw new Error("SLOT_FULL");

  const client = await get<{ id: number }>("SELECT id FROM clients WHERE id = ?", [opts.client_id]);
  if (!client) throw new Error("CLIENT_NOT_FOUND");
  await assertClientEmailForBooking(opts.client_id);

  const addonIds = opts.addon_ids || [];
  let addonPrice = 0;
  let extraDuration = 0;
  const selectedAddons: { id: number; price: number }[] = [];

  if (addonIds.length > 0) {
    if (!slot.offering_allow_addons) throw new Error("ADDONS_NOT_ALLOWED");
    const addons = await query<{ id: number; price: number; extra_duration: number }>(
      `SELECT id, price, extra_duration FROM offering_addons
       WHERE offering_id = ? AND active = 1 AND id IN (${addonIds.map(() => "?").join(",")})`,
      [slot.offering_id, ...addonIds],
    );
    for (const addon of addons) {
      addonPrice += addon.price;
      extraDuration += addon.extra_duration;
      selectedAddons.push({ id: addon.id, price: addon.price });
    }
  }

  const totalPrice = slot.base_price + addonPrice;
  const totalDuration = slot.duration + extraDuration;
  const endTime = addMinutes(slot.start_time, totalDuration);

  const staffIds = parseStaffIds(slot.staff_ids);
  let staffId = opts.staff_id ?? null;
  if (staffId === null && staffIds.length === 1) staffId = staffIds[0];

  const identifier = await nextIdentifier();
  const appointmentCurrency = slot.offering_currency || await getDefaultCurrency();
  const viaLabel = opts.via === "public" ? "Public booking" : "Offering";
  const userNotes = opts.notes?.trim() || "";
  const notes = userNotes
    ? `${userNotes}\n\n${viaLabel}: ${slot.offering_name}`
    : `${viaLabel}: ${slot.offering_name}`;

  const status = opts.via === "public" ? "confirmed" : "booked";
  const depositAmount = opts.payment?.deposit_amount ?? 0;
  const amountPaid = opts.payment?.amount_paid ?? 0;
  const paymentStatus = opts.payment?.payment_status
    ?? (totalPrice > 0 ? "unpaid" : "not_required");
  const result = await run(
    `INSERT INTO appointments (
      identifier, client_id, staff_id, scheduled_date, start_time, end_time,
      total_price, currency, deposit_amount, amount_paid, payment_status,
      stripe_checkout_session_id, stripe_payment_intent_id,
      notes, offering_slot_instance_id, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      identifier,
      opts.client_id,
      staffId,
      slot.slot_date,
      slot.start_time,
      endTime,
      totalPrice,
      appointmentCurrency,
      depositAmount,
      amountPaid,
      paymentStatus,
      opts.payment?.stripe_checkout_session_id ?? null,
      opts.payment?.stripe_payment_intent_id ?? null,
      notes,
      slotId,
      status,
    ],
  );

  const aptId = result.lastInsertRowid;
  for (const addon of selectedAddons) {
    await run(
      "INSERT INTO appointment_offering_addons (appointment_id, offering_addon_id, price) VALUES (?, ?, ?)",
      [aptId, addon.id, addon.price],
    );
  }

  await run(
    "UPDATE offering_slot_instances SET booked_count = booked_count + 1 WHERE id = ?",
    [slotId],
  );

  const appointment = await get<Record<string, unknown>>(
    `SELECT a.*, cl.name as client_name, cl.phone as client_phone,
            s.name as staff_name, s.color as staff_color, o.name as offering_name
     FROM appointments a
     LEFT JOIN clients cl ON cl.id = a.client_id
     LEFT JOIN staff s ON s.id = a.staff_id
     LEFT JOIN offering_slot_instances si ON si.id = a.offering_slot_instance_id
     LEFT JOIN offerings o ON o.id = si.offering_id
     WHERE a.id = ?`,
    [aptId],
  );

  return appointment!;
}

export { bookOfferingSlotInstance };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerOfferingRoutes(app: OpenAPIHono<any>) {
  const listOfferings = createRoute({
    method: "get",
    path: "/api/offerings",
    responses: {
      200: {
        description: "List offerings",
        content: {
          "application/json": {
            schema: z.object({ offerings: z.array(z.object({
              id: z.number().int(),
              name: z.string(),
              slug: z.string(),
              status: z.string(),
              base_price: z.number(),
              currency: z.string(),
              color: z.string(),
              category: z.string(),
              capacity_per_slot: z.number().int(),
              date_summary: z.string().optional(),
              created_at: z.string(),
            })) }),
          },
        },
      },
    },
  });

  app.openapi(listOfferings, async (c) => {
    const rows = await query<OfferingRow & { date_summary?: string }>(
      `SELECT o.*,
        (SELECT group_concat(start_date || CASE WHEN end_date != start_date THEN '–' || end_date ELSE '' END, ', ')
         FROM offering_date_windows w WHERE w.offering_id = o.id) as date_summary
       FROM offerings o
       ORDER BY o.created_at DESC`,
    );
    return c.json({
      offerings: rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        status: row.status,
        base_price: row.base_price,
        currency: row.currency || "USD",
        color: row.color,
        category: row.category,
        capacity_per_slot: row.capacity_per_slot,
        date_summary: row.date_summary || "",
        created_at: row.created_at,
      })),
    }, 200);
  });

  const calendarSlots = createRoute({
    method: "get",
    path: "/api/offerings/calendar",
    request: {
      query: z.object({ start: z.string(), end: z.string() }),
    },
    responses: {
      200: {
        description: "Offering slot instances for date range",
        content: {
          "application/json": {
            schema: z.object({
              slots: z.array(z.object({
                id: z.number().int(),
                offering_id: z.number().int(),
                offering_name: z.string(),
                offering_color: z.string(),
                slot_date: z.string(),
                start_time: z.string(),
                end_time: z.string(),
                capacity: z.number().int(),
                booked_count: z.number().int(),
                base_price: z.number(),
                currency: z.string(),
                addons: z.array(z.object({
                  id: z.number().int(),
                  name: z.string(),
                  price: z.number(),
                  extra_duration: z.number().int(),
                })),
              })),
            }),
          },
        },
      },
    },
  });

  app.openapi(calendarSlots, async (c) => {
    const { start, end } = c.req.valid("query");
    const slots = await query<{
      id: number;
      offering_id: number;
      offering_name: string;
      offering_color: string;
      slot_date: string;
      start_time: string;
      end_time: string;
      capacity: number;
      booked_count: number;
      base_price: number;
      offering_currency: string;
      offering_allow_addons: number;
    }>(
      `SELECT si.id, si.offering_id, o.name as offering_name, o.color as offering_color,
              si.slot_date, si.start_time, si.end_time, si.capacity, si.booked_count, o.base_price,
              o.currency as offering_currency, o.allow_addons as offering_allow_addons
       FROM offering_slot_instances si
       JOIN offerings o ON o.id = si.offering_id
       WHERE si.slot_date >= ? AND si.slot_date <= ? AND o.status = 'live'
       ORDER BY si.slot_date, si.start_time`,
      [start, end],
    );

    const enriched = [];
    for (const slot of slots) {
      const addons = slot.offering_allow_addons
        ? await query<{
          id: number;
          name: string;
          price: number;
          extra_duration: number;
        }>(
          "SELECT id, name, price, extra_duration FROM offering_addons WHERE offering_id = ? AND active = 1",
          [slot.offering_id],
        )
        : [];
      enriched.push({
        id: slot.id,
        offering_id: slot.offering_id,
        offering_name: slot.offering_name,
        offering_color: slot.offering_color,
        slot_date: slot.slot_date,
        start_time: slot.start_time,
        end_time: slot.end_time,
        capacity: slot.capacity,
        booked_count: slot.booked_count,
        base_price: slot.base_price,
        currency: slot.offering_currency || "USD",
        addons,
      });
    }

    return c.json({ slots: enriched }, 200);
  });

  const getOffering = createRoute({
    method: "get",
    path: "/api/offerings/{id}",
    request: { params: IdParam },
    responses: {
      200: { description: "Offering detail", content: { "application/json": { schema: z.object({
        offering: z.object({}).passthrough(),
        date_windows: z.array(z.object({ id: z.number().int(), start_date: z.string(), end_date: z.string() })),
        time_slots: z.array(z.object({ id: z.number().int(), start_time: z.string(), end_time: z.string() })),
        addons: z.array(z.object({}).passthrough()),
      }) } } },
      404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  app.openapi(getOffering, async (c) => {
    const { id } = c.req.valid("param");
    const offeringId = parseInt(id, 10);
    const detail = await loadOfferingDetail(offeringId);
    if (!detail) return c.json({ error: "Not found" }, 404);
    const booked_appointment_count = await countOfferingBookings(offeringId);
    const max_booked_per_slot = await getMaxBookedPerSlot(offeringId);
    const appointments = await getOfferingAppointments(offeringId);
    const deleteCheck = checkOfferingDeletable(detail.offering, appointments);
    return c.json({
      ...detail,
      booked_appointment_count,
      max_booked_per_slot,
      can_delete: deleteCheck.can_delete,
      delete_blocked_reason: deleteCheck.can_delete ? null : deleteCheck.delete_blocked_reason,
      upcoming_appointment_count: deleteCheck.can_delete ? deleteCheck.upcoming_appointment_count : 0,
    }, 200);
  });

  const createOffering = createRoute({
    method: "post",
    path: "/api/offerings",
    request: { body: { content: { "application/json": { schema: OfferingBodySchema } } } },
    responses: {
      201: { description: "Created", content: { "application/json": { schema: z.object({}).passthrough() } } },
      400: { description: "Invalid", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  app.openapi(createOffering, async (c) => {
    const body = c.req.valid("json");
    const name = body.name.trim();
    if (!name) return c.json({ error: "Name is required" }, 400);

    const date_windows = body.date_windows || [];
    const time_slots = body.time_slots || [];
    if (date_windows.length === 0) return c.json({ error: "At least one date window is required" }, 400);
    if (time_slots.length === 0) return c.json({ error: "At least one time slot is required" }, 400);

    const slug = await uniqueOfferingSlug(name);
    const currency = await resolveOfferingCurrency(body.currency);
    const allowAddons = allowAddonsFromBody(body);
    const result = await run(
      `INSERT INTO offerings (name, slug, description, detailed_description, base_price, duration, color, category, capacity_per_slot, block_regular_bookings, staff_ids, currency, allow_addons)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        slug,
        body.description?.trim() || "",
        body.detailed_description?.trim() || "",
        body.base_price ?? 0,
        body.duration ?? 60,
        body.color || "#ec4899",
        body.category?.trim() || "Seasonal",
        body.capacity_per_slot ?? 1,
        blockRegularToDb(body.block_regular_bookings),
        JSON.stringify(body.staff_ids || []),
        currency,
        allowAddons,
      ],
    );

    const offeringId = result.lastInsertRowid as number;
    await replaceOfferingChildren(offeringId, date_windows, time_slots, body.addons || []);
    const detail = await loadOfferingDetail(offeringId);
    return c.json(detail, 201);
  });

  const updateOffering = createRoute({
    method: "put",
    path: "/api/offerings/{id}",
    request: {
      params: IdParam,
      body: { content: { "application/json": { schema: OfferingBodySchema } } },
    },
    responses: {
      200: { description: "Updated", content: { "application/json": { schema: z.object({}).passthrough() } } },
      400: { description: "Invalid", content: { "application/json": { schema: ErrorSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  app.openapi(updateOffering, async (c) => {
    const { id } = c.req.valid("param");
    const offeringId = parseInt(id, 10);
    const existing = await get<OfferingRow>("SELECT * FROM offerings WHERE id = ?", [offeringId]);
    if (!existing) return c.json({ error: "Not found" }, 404);

    const body = c.req.valid("json");
    const name = body.name.trim();
    if (!name) return c.json({ error: "Name is required" }, 400);

    if (existing.status === "live") {
      const existingAddons = await query<{ id: number; price: number }>(
        "SELECT id, price FROM offering_addons WHERE offering_id = ? AND active = 1",
        [offeringId],
      );
      const bookedCount = await countOfferingBookings(offeringId);
      if (
        bookedCount > 0
        && livePricingChanged(existing, existingAddons, body)
        && !body.confirm_price_changes
      ) {
        return c.json({
          error: `${bookedCount} client${bookedCount === 1 ? "" : "s"} already booked at the current price. Confirm to apply new prices to future bookings only.`,
          code: "PRICE_CHANGE_REQUIRES_CONFIRM",
          booked_appointment_count: bookedCount,
        }, 400);
      }

      if (
        body.capacity_per_slot != null
        && body.capacity_per_slot !== existing.capacity_per_slot
      ) {
        const maxBooked = await getMaxBookedPerSlot(offeringId);
        if (body.capacity_per_slot < maxBooked) {
          return c.json({
            error: `Can't set capacity below ${maxBooked} — that many spots are already booked in at least one time slot.`,
            code: "CAPACITY_BELOW_BOOKED",
            max_booked_per_slot: maxBooked,
          }, 400);
        }
        await updateOfferingCapacity(offeringId, body.capacity_per_slot);
      }

      await run(
        `UPDATE offerings SET name = ?, description = ?, detailed_description = ?, base_price = ?, duration = ?, color = ?,
          block_regular_bookings = ?, allow_addons = ?, updated_at = datetime('now') WHERE id = ?`,
        [
          name,
          body.description?.trim() || "",
          body.detailed_description?.trim() || "",
          body.base_price ?? existing.base_price,
          body.duration ?? existing.duration,
          body.color || existing.color,
          blockRegularToDb(body.block_regular_bookings),
          body.allow_addons != null ? (body.allow_addons ? 1 : 0) : (existing.allow_addons ?? 1),
          offeringId,
        ],
      );
      await syncOfferingAddons(offeringId, body.addons || []);
      const detail = await loadOfferingDetail(offeringId);
      return c.json(detail, 200);
    }

    if (existing.status !== "draft") {
      return c.json({ error: "This offering can no longer be edited" }, 400);
    }

    const date_windows = body.date_windows || [];
    const time_slots = body.time_slots || [];
    if (date_windows.length === 0) return c.json({ error: "At least one date window is required" }, 400);
    if (time_slots.length === 0) return c.json({ error: "At least one time slot is required" }, 400);

    const currency = body.currency != null
      ? await resolveOfferingCurrency(body.currency)
      : (existing.currency || await getDefaultCurrency());
    const allowAddons = body.allow_addons != null ? (body.allow_addons ? 1 : 0) : (existing.allow_addons ?? 1);

    await run(
      `UPDATE offerings SET name = ?, description = ?, detailed_description = ?, base_price = ?, duration = ?, color = ?, category = ?,
        capacity_per_slot = ?, block_regular_bookings = ?, staff_ids = ?, currency = ?, allow_addons = ?, updated_at = datetime('now') WHERE id = ?`,
      [
        name,
        body.description?.trim() || "",
        body.detailed_description?.trim() || "",
        body.base_price ?? 0,
        body.duration ?? 60,
        body.color || "#ec4899",
        body.category?.trim() || "Seasonal",
        body.capacity_per_slot ?? 1,
        blockRegularToDb(body.block_regular_bookings),
        JSON.stringify(body.staff_ids || []),
        currency,
        allowAddons,
        offeringId,
      ],
    );

    await replaceOfferingChildren(offeringId, date_windows, time_slots, body.addons || []);
    const detail = await loadOfferingDetail(offeringId);
    return c.json(detail, 200);
  });

  const goLive = createRoute({
    method: "post",
    path: "/api/offerings/{id}/go-live",
    request: { params: IdParam },
    responses: {
      200: { description: "Live", content: { "application/json": { schema: z.object({}).passthrough() } } },
      400: { description: "Invalid", content: { "application/json": { schema: ErrorSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  app.openapi(goLive, async (c) => {
    const { id } = c.req.valid("param");
    const offeringId = parseInt(id, 10);
    const existing = await get<OfferingRow>("SELECT * FROM offerings WHERE id = ?", [offeringId]);
    if (!existing) return c.json({ error: "Not found" }, 404);
    if (existing.status === "live") return c.json({ error: "Offering is already live" }, 400);

    const windowCount = await get<{ count: number }>(
      "SELECT COUNT(*) as count FROM offering_date_windows WHERE offering_id = ?",
      [offeringId],
    );
    const slotCount = await get<{ count: number }>(
      "SELECT COUNT(*) as count FROM offering_time_slots WHERE offering_id = ?",
      [offeringId],
    );
    if ((windowCount?.count || 0) === 0 || (slotCount?.count || 0) === 0) {
      return c.json({ error: "Add date windows and time slots before going live" }, 400);
    }

    const windows = await query<{ start_date: string; end_date: string }>(
      "SELECT start_date, end_date FROM offering_date_windows WHERE offering_id = ?",
      [offeringId],
    );
    const conflicts = await findRegularAppointmentConflicts(windows);

    await materializeSlots(offeringId, existing.capacity_per_slot);
    await run(
      "UPDATE offerings SET status = 'live', updated_at = datetime('now') WHERE id = ?",
      [offeringId],
    );

    const detail = await loadOfferingDetail(offeringId);
    return c.json({ ...detail, conflicts }, 200);
  });

  const duplicateOfferingRoute = createRoute({
    method: "post",
    path: "/api/offerings/{id}/duplicate",
    request: { params: IdParam },
    responses: {
      201: { description: "Duplicated", content: { "application/json": { schema: z.object({}).passthrough() } } },
      404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  app.openapi(duplicateOfferingRoute, async (c) => {
    const { id } = c.req.valid("param");
    const sourceId = parseInt(id, 10);
    const source = await loadOfferingDetail(sourceId);
    if (!source) return c.json({ error: "Not found" }, 404);

    const copyName = `${source.offering.name} (copy)`;
    const slug = await uniqueOfferingSlug(copyName);
    const o = source.offering;

    const result = await run(
      `INSERT INTO offerings (name, slug, description, detailed_description, base_price, duration, color, category, capacity_per_slot, block_regular_bookings, staff_ids, currency, allow_addons)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        copyName,
        slug,
        o.description,
        o.detailed_description ?? "",
        o.base_price,
        o.duration,
        o.color,
        o.category,
        o.capacity_per_slot,
        blockRegularToDb(o.block_regular_bookings),
        JSON.stringify(o.staff_ids),
        o.currency || await getDefaultCurrency(),
        o.allow_addons ?? 1,
      ],
    );

    const newId = result.lastInsertRowid as number;
    const emptyWindows = [
      { start_date: "", end_date: "" },
      { start_date: "", end_date: "" },
    ];
    const timeSlots = source.time_slots.map((slot) => ({
      start_time: slot.start_time,
      end_time: slot.end_time,
    }));
    const addons = source.addons.map((addon) => ({
      name: addon.name,
      price: addon.price,
      extra_duration: addon.extra_duration,
    }));

    await replaceOfferingChildren(newId, emptyWindows, timeSlots, addons);
    const detail = await loadOfferingDetail(newId);
    return c.json(detail, 201);
  });

  const archiveOfferingRoute = createRoute({
    method: "post",
    path: "/api/offerings/{id}/archive",
    request: { params: IdParam },
    responses: {
      200: { description: "Archived", content: { "application/json": { schema: z.object({}).passthrough() } } },
      400: { description: "Invalid", content: { "application/json": { schema: ErrorSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  app.openapi(archiveOfferingRoute, async (c) => {
    const { id } = c.req.valid("param");
    const offeringId = parseInt(id, 10);
    const existing = await get<OfferingRow>("SELECT * FROM offerings WHERE id = ?", [offeringId]);
    if (!existing) return c.json({ error: "Not found" }, 404);
    if (existing.status === "archived") {
      return c.json({ error: "Offering is already archived" }, 400);
    }

    await run(
      "UPDATE offerings SET status = 'archived', updated_at = datetime('now') WHERE id = ?",
      [offeringId],
    );
    const detail = await loadOfferingDetail(offeringId);
    return c.json(detail, 200);
  });

  const deleteOfferingRoute = createRoute({
    method: "delete",
    path: "/api/offerings/{id}",
    request: { params: IdParam },
    responses: {
      200: { description: "Deleted", content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } } },
      404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
      409: { description: "Cannot delete", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  app.openapi(deleteOfferingRoute, async (c) => {
    const { id } = c.req.valid("param");
    const offeringId = parseInt(id, 10);
    const existing = await get<OfferingRow>("SELECT * FROM offerings WHERE id = ?", [offeringId]);
    if (!existing) return c.json({ error: "Not found" }, 404);

    const appointments = await getOfferingAppointments(offeringId);
    const deleteCheck = checkOfferingDeletable(existing, appointments);
    if (!deleteCheck.can_delete) {
      return c.json({ error: deleteCheck.delete_blocked_reason }, 409);
    }

    await deleteOfferingCascade(offeringId);
    return c.json({ ok: true as const }, 200);
  });

  const bookSlot = createRoute({
    method: "post",
    path: "/api/offerings/slots/{id}/book",
    request: {
      params: IdParam,
      body: {
        content: {
          "application/json": {
            schema: z.object({
              client_id: z.number().int(),
              staff_id: z.number().int().nullable().optional(),
              addon_ids: z.array(z.number().int()).optional(),
              notes: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: {
      201: { description: "Booked", content: { "application/json": { schema: z.object({ appointment: z.object({}).passthrough() }) } } },
      400: { description: "Invalid", content: { "application/json": { schema: ErrorSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  app.openapi(bookSlot, async (c) => {
    const { id } = c.req.valid("param");
    const slotId = parseInt(id, 10);
    const body = c.req.valid("json");

    try {
      const appointment = await bookOfferingSlotInstance(slotId, {
        client_id: body.client_id,
        staff_id: body.staff_id,
        addon_ids: body.addon_ids,
        notes: body.notes,
        via: "staff",
      });
      scheduleBookingConfirmation(c, appointment.id as number);
      return c.json({ appointment }, 201);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === "SLOT_NOT_FOUND") return c.json({ error: "Slot not found" }, 404);
      if (msg === "OFFERING_NOT_LIVE") return c.json({ error: "Offering is not live" }, 400);
      if (msg === "SLOT_FULL") return c.json({ error: "This slot is full" }, 400);
      if (msg === "CLIENT_NOT_FOUND") return c.json({ error: "Client not found" }, 400);
      if (msg === "Email is required" || msg === "Enter a valid email address") {
        return c.json({ error: msg }, 400);
      }
      throw err;
    }
  });

  const SlugParam = z.object({
    slug: z.string().openapi({ description: "Offering slug" }),
  });

  const PublicSlotSchema = z.object({
    id: z.number().int(),
    slot_date: z.string(),
    start_time: z.string(),
    end_time: z.string(),
    capacity: z.number().int(),
    booked_count: z.number().int(),
    spots_left: z.number().int(),
    is_full: z.boolean(),
  });

  const getPublicOffering = createRoute({
    method: "get",
    path: "/api/offer/public/{slug}",
    request: { params: SlugParam },
    responses: {
      200: {
        description: "Public offering page data",
        content: {
          "application/json": {
            schema: z.object({
              offering: z.object({
                name: z.string(),
                slug: z.string(),
                description: z.string(),
                detailed_description: z.string(),
                color: z.string(),
                base_price: z.number(),
                duration: z.number().int(),
                category: z.string(),
              }),
              currency: z.string(),
              dates: z.array(z.string()),
              slots: z.array(PublicSlotSchema),
              addons: z.array(z.object({
                id: z.number().int(),
                name: z.string(),
                price: z.number(),
                extra_duration: z.number().int(),
              })),
            }),
          },
        },
      },
      404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  app.openapi(getPublicOffering, async (c) => {
    const { slug } = c.req.valid("param");
    const env = runtimeEnv(c.env) as StripeEnv;
    const offering = await get<OfferingRow>("SELECT * FROM offerings WHERE slug = ? AND status = 'live'", [slug]);
    if (!offering) return c.json({ error: "This event is not available" }, 404);

    await expireStaleOfferingCheckouts();

    const today = new Date().toISOString().split("T")[0];
    const slots = await query<{
      id: number;
      slot_date: string;
      start_time: string;
      end_time: string;
      capacity: number;
      booked_count: number;
    }>(
      `SELECT id, slot_date, start_time, end_time, capacity, booked_count
       FROM offering_slot_instances
       WHERE offering_id = ? AND slot_date >= ?
       ORDER BY slot_date, start_time`,
      [offering.id, today],
    );

    const addons = offering.allow_addons
      ? await query<{
        id: number;
        name: string;
        price: number;
        extra_duration: number;
      }>(
        "SELECT id, name, price, extra_duration FROM offering_addons WHERE offering_id = ? AND active = 1 ORDER BY id",
        [offering.id],
      )
      : [];

    const dates = [...new Set(slots.map((s) => s.slot_date))].sort();
    const currency = offering.currency || await getDefaultCurrency();
    const stripeEnabled = await isStripePaymentsActive(env);
    const hasPaidOptions = offering.base_price > 0 || addons.some((a) => a.price > 0);
    const paymentRequired = offeringRequiresPayment(hasPaidOptions ? 1 : 0);
    const defaultDeposit = resolveOfferingDeposit(offering.base_price);

    const slotsWithAvailability = await Promise.all(slots.map(async (slot) => {
      const pending = await countPendingOfferingCheckouts(slot.id);
      const spotsLeft = offeringSlotSpotsLeft(slot.capacity, slot.booked_count, pending);
      return {
        ...slot,
        spots_left: spotsLeft,
        is_full: spotsLeft <= 0,
      };
    }));

    return c.json({
      offering: {
        name: offering.name,
        slug: offering.slug,
        description: offering.description,
        detailed_description: offering.detailed_description ?? "",
        color: offering.color,
        base_price: offering.base_price,
        duration: offering.duration,
        category: offering.category,
        allow_addons: offering.allow_addons ?? 1,
      },
      currency,
      dates,
      slots: slotsWithAvailability,
      addons,
      stripe_enabled: stripeEnabled,
      payment_required: paymentRequired,
      deposit_amount: defaultDeposit,
      client_payment_choice: offeringClientHasPaymentChoice(offering.base_price, defaultDeposit),
    }, 200);
  });

  const confirmPublicOffering = createRoute({
    method: "post",
    path: "/api/offer/public/{slug}/book",
    request: {
      params: SlugParam,
      body: {
        content: {
          "application/json": {
            schema: z.object({
              slot_instance_id: z.number().int(),
              name: z.string(),
              phone: z.string(),
              email: z.string().trim().min(1).email(),
              address: z.string().optional(),
              addon_ids: z.array(z.number().int()).optional(),
              notes: z.string().optional(),
              payment_choice: z.enum(["full", "deposit"]).optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Checkout required or booked",
        content: {
          "application/json": {
            schema: z.object({
              requires_payment: z.boolean().optional(),
              checkout_url: z.string().optional(),
              deposit_amount: z.number().optional(),
              checkout_total: z.number().optional(),
              payment_choice: z.enum(["full", "deposit"]).optional(),
              appointment: z.object({
                identifier: z.string(),
                scheduled_date: z.string(),
                start_time: z.string(),
                end_time: z.string(),
                total_price: z.number(),
                currency: z.string(),
                offering_name: z.string().optional(),
              }).optional(),
            }),
          },
        },
      },
      400: { description: "Invalid", content: { "application/json": { schema: ErrorSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
      410: { description: "Slot full", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  app.openapi(confirmPublicOffering, async (c) => {
    const { slug } = c.req.valid("param");
    const body = c.req.valid("json");
    const env = runtimeEnv(c.env) as StripeEnv;

    const offering = await get<OfferingRow>(
      "SELECT * FROM offerings WHERE slug = ? AND status = 'live'",
      [slug],
    );
    if (!offering) return c.json({ error: "This event is not available" }, 404);

    const slot = await get<{
      id: number;
      offering_id: number;
      slot_date: string;
      start_time: string;
    }>(
      "SELECT id, offering_id, slot_date, start_time FROM offering_slot_instances WHERE id = ?",
      [body.slot_instance_id],
    );
    if (!slot || slot.offering_id !== offering.id) {
      return c.json({ error: "Invalid time slot" }, 400);
    }

    if (!body.name.trim() || !body.phone.trim()) {
      return c.json({ error: "Name and phone are required" }, 400);
    }
    const emailCheck = parseRequiredBookingEmail(body.email);
    if (!emailCheck.ok) return c.json({ error: emailCheck.error }, 400);

    const addonIds = body.addon_ids ?? [];
    if (addonIds.length > 0 && !offering.allow_addons) {
      return c.json({ error: "Extras are not available for this event" }, 400);
    }
    const totalPrice = await computeOfferingBookingTotal(
      offering.id,
      offering.base_price,
      addonIds,
      offering.allow_addons ?? 1,
    );
    const depositAmount = resolveOfferingDeposit(totalPrice);
    const paymentChoice: PaymentChoice = body.payment_choice === "deposit" ? "deposit" : "full";
    const checkoutTotal = offeringCheckoutAmount(totalPrice, depositAmount, paymentChoice);
    const needsPayment = offeringRequiresPayment(totalPrice) && await isStripePaymentsActive(env);

    const clientId = await findOrCreateClient({
      name: body.name,
      phone: body.phone,
      email: emailCheck.email,
      address: body.address,
    });

    if (needsPayment) {
      try {
        const currency = offering.currency || await getDefaultCurrency();
        const { checkout_url } = await createOfferingBookingCheckout(env, {
          offeringId: offering.id,
          offeringSlug: offering.slug,
          offeringName: offering.name,
          slotInstanceId: slot.id,
          slotDate: slot.slot_date,
          startTime: slot.start_time,
          clientId,
          addonIds,
          notes: body.notes,
          totalPrice,
          currency,
          paymentChoice,
          requestUrl: c.req.url,
          clientEmail: emailCheck.email,
        });
        return c.json({
          requires_payment: true,
          checkout_url,
          deposit_amount: depositAmount,
          checkout_total: checkoutTotal,
          payment_choice: paymentChoice,
        }, 200);
      } catch (err) {
        const msg = (err as Error).message;
        if (msg === "SLOT_FULL") return c.json({ error: "This time slot just filled up — pick another" }, 410);
        return c.json({ error: msg }, 400);
      }
    }

    try {
      const appointment = await bookOfferingSlotInstance(body.slot_instance_id, {
        client_id: clientId,
        addon_ids: addonIds,
        notes: body.notes,
        via: "public",
      });
      scheduleBookingConfirmation(c, appointment.id as number);
      return c.json({
        requires_payment: false,
        appointment: {
          identifier: appointment.identifier as string,
          scheduled_date: appointment.scheduled_date as string,
          start_time: appointment.start_time as string,
          end_time: appointment.end_time as string,
          total_price: appointment.total_price as number,
          currency: appointment.currency as string,
          offering_name: appointment.offering_name as string | undefined,
        },
      }, 200);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === "SLOT_FULL") return c.json({ error: "This time slot just filled up — pick another" }, 410);
      if (msg === "SLOT_NOT_FOUND") return c.json({ error: "Time slot not found" }, 404);
      if (msg === "OFFERING_NOT_LIVE") return c.json({ error: "This event is not available" }, 400);
      throw err;
    }
  });

  const completePublicOffering = createRoute({
    method: "get",
    path: "/api/offer/public/{slug}/complete",
    request: {
      params: SlugParam,
      query: z.object({ session_id: z.string() }),
    },
    responses: {
      200: {
        description: "Payment completed",
        content: {
          "application/json": {
            schema: z.object({
              appointment: z.object({
                identifier: z.string(),
                scheduled_date: z.string(),
                start_time: z.string(),
                end_time: z.string(),
                total_price: z.number(),
                deposit_amount: z.number(),
                amount_paid: z.number(),
                payment_status: z.string(),
                currency: z.string(),
                offering_name: z.string().optional(),
              }),
            }),
          },
        },
      },
      400: { description: "Invalid", content: { "application/json": { schema: ErrorSchema } } },
      404: { description: "Not found", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  app.openapi(completePublicOffering, async (c) => {
    const { slug } = c.req.valid("param");
    const { session_id: sessionId } = c.req.valid("query");
    const env = runtimeEnv(c.env) as StripeEnv;

    const offering = await get<{ id: number }>(
      "SELECT id FROM offerings WHERE slug = ? AND status = 'live'",
      [slug],
    );
    if (!offering) return c.json({ error: "This event is not available" }, 404);

    try {
      const result = await finalizeOfferingBookingCheckout(env, sessionId);
      if (!result.already_done) {
        scheduleBookingConfirmation(c, result.appointment_id!, { receipt: true });
      }
      const apt = await get<{
        identifier: string;
        scheduled_date: string;
        start_time: string;
        end_time: string;
        total_price: number;
        deposit_amount: number;
        amount_paid: number;
        payment_status: string;
        currency: string;
        offering_name: string;
      }>(
        `SELECT a.identifier, a.scheduled_date, a.start_time, a.end_time, a.total_price,
                a.deposit_amount, a.amount_paid, a.payment_status, a.currency, o.name as offering_name
         FROM appointments a
         LEFT JOIN offering_slot_instances si ON si.id = a.offering_slot_instance_id
         LEFT JOIN offerings o ON o.id = si.offering_id
         WHERE a.id = ?`,
        [result.appointment_id],
      );
      if (!apt) return c.json({ error: "Appointment not found" }, 404);
      return c.json({ appointment: apt }, 200);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });
}
