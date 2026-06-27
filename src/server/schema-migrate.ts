import { query, run } from "./db.js";

let ensured = false;

/** Idempotent SQLite schema fixes for DBs created before schema.sql was updated. */
export async function ensureSqliteSchema(): Promise<void> {
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
}
