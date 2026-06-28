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
}
