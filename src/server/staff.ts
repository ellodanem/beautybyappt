import { query, run } from "./db.js";

function parseStaffIds(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === "number") : [];
  } catch {
    return [];
  }
}

/** Remove staff-scoped rows that block DELETE via foreign keys, then delete the staff row. */
export async function deleteStaffCascade(staffId: number): Promise<void> {
  await run("DELETE FROM booking_links WHERE staff_id = ?", [staffId]);

  const offerings = await query<{ id: number; staff_ids: string }>("SELECT id, staff_ids FROM offerings");
  for (const offering of offerings) {
    const ids = parseStaffIds(offering.staff_ids);
    const next = ids.filter((id) => id !== staffId);
    if (next.length !== ids.length) {
      await run("UPDATE offerings SET staff_ids = ?, updated_at = datetime('now') WHERE id = ?", [
        JSON.stringify(next),
        offering.id,
      ]);
    }
  }

  await run("DELETE FROM staff WHERE id = ?", [staffId]);
}
