import { getDbEngine, query, run } from "./db.js";

let ensured = false;

/** Idempotent SQLite schema fixes for DBs created before schema.sql was updated. */
export async function ensureSqliteSchema(): Promise<void> {
  if (getDbEngine() !== "sqlite") return;
  if (ensured) return;
  ensured = true;

  const offeringCols = await query<{ name: string }>("PRAGMA table_info(offerings)");
  if (offeringCols.length > 0) {
    if (!offeringCols.some((c) => c.name === "currency")) {
      await run("ALTER TABLE offerings ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD'");
    }
    if (!offeringCols.some((c) => c.name === "detailed_description")) {
      await run("ALTER TABLE offerings ADD COLUMN detailed_description TEXT NOT NULL DEFAULT ''");
    }
    if (!offeringCols.some((c) => c.name === "allow_addons")) {
      await run("ALTER TABLE offerings ADD COLUMN allow_addons INTEGER NOT NULL DEFAULT 1");
    }
  }

  const staffCols = await query<{ name: string }>("PRAGMA table_info(staff)");
  if (staffCols.length > 0) {
    if (!staffCols.some((c) => c.name === "is_admin")) {
      await run("ALTER TABLE staff ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
      const adminCount = await query<{ count: number }>("SELECT COUNT(*) as count FROM staff WHERE is_admin = 1");
      if ((adminCount[0]?.count || 0) === 0) {
        const first = await query<{ id: number }>("SELECT id FROM staff ORDER BY id ASC LIMIT 1");
        if (first[0]) {
          await run("UPDATE staff SET is_admin = 1 WHERE id = ?", [first[0].id]);
        }
      }
    }
  }

  const paymentCols = await query<{ name: string }>("PRAGMA table_info(payments)");
  if (paymentCols.length > 0 && !paymentCols.some((c) => c.name === "link_token")) {
    await run("ALTER TABLE payments ADD COLUMN link_token TEXT");
    await run("CREATE INDEX IF NOT EXISTS idx_payments_link_token ON payments(link_token)");
  }

  const serviceCols = await query<{ name: string }>("PRAGMA table_info(services)");
  if (serviceCols.length > 0 && !serviceCols.some((c) => c.name === "allow_addons")) {
    await run("ALTER TABLE services ADD COLUMN allow_addons INTEGER NOT NULL DEFAULT 0");
  }

  await run(`CREATE TABLE IF NOT EXISTS service_addons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    price REAL NOT NULL DEFAULT 0,
    extra_duration INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  )`);
  await run(`CREATE TABLE IF NOT EXISTS appointment_service_addons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    service_addon_id INTEGER NOT NULL REFERENCES service_addons(id),
    price REAL NOT NULL DEFAULT 0
  )`);
  await run("CREATE INDEX IF NOT EXISTS idx_service_addons_service ON service_addons(service_id)");
  await run("CREATE INDEX IF NOT EXISTS idx_appointment_service_addons_appointment ON appointment_service_addons(appointment_id)");

  await run(`CREATE TABLE IF NOT EXISTS email_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    is_builtin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  await run(
    `INSERT OR IGNORE INTO email_templates (slug, name, subject, body, is_builtin)
     VALUES (?, ?, ?, ?, 1)`,
    [
      "payment_reminder",
      "Payment reminder",
      "Payment reminder — {reference}",
      `Hi {client_name},

This is a friendly reminder that you have a balance of {balance_due} due for your appointment with {business_name}.

Reference: {reference}
Date: {date}
Time: {time}
Total: {total}
Amount paid: {amount_paid}
Balance due: {balance_due}

{payment_link}

Please let us know if you have any questions.

— {business_name}`,
    ],
  );

  await run(
    `INSERT OR IGNORE INTO email_templates (slug, name, subject, body, is_builtin)
     VALUES (?, ?, ?, ?, 1)`,
    [
      "appointment_reminder",
      "Appointment reminder",
      "Reminder: your appointment — {date}",
      `Hi {client_name},

Reminder: your appointment with {business_name} is coming up.

Reference: {reference}
Date: {date}
Time: {time}
{event_name}
{services}
{location}

{balance_due}

{business_tagline}

— {business_name}`,
    ],
  );

  await run(`CREATE TABLE IF NOT EXISTS notification_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    offering_id INTEGER REFERENCES offerings(id) ON DELETE CASCADE,
    email_template_id INTEGER NOT NULL REFERENCES email_templates(id),
    hours_before INTEGER NOT NULL,
    channel TEXT NOT NULL DEFAULT 'email',
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  await run(`CREATE TABLE IF NOT EXISTS appointment_notification_sent (
    appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    rule_id INTEGER NOT NULL REFERENCES notification_rules(id) ON DELETE CASCADE,
    sent_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (appointment_id, rule_id)
  )`);

  await run("CREATE INDEX IF NOT EXISTS idx_notification_rules_offering ON notification_rules(offering_id)");
  await run("CREATE INDEX IF NOT EXISTS idx_appointment_notification_sent_appointment ON appointment_notification_sent(appointment_id)");
}
