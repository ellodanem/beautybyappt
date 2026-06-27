import { get, query, run } from "./db.js";
import { slugify } from "../shared/offerings.js";

export async function uniqueServiceSlug(name: string, excludeId?: number): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let n = 0;
  while (true) {
    const row = excludeId != null
      ? await get<{ id: number }>("SELECT id FROM services WHERE slug = ? AND id != ?", [candidate, excludeId])
      : await get<{ id: number }>("SELECT id FROM services WHERE slug = ?", [candidate]);
    if (!row) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}

export async function backfillServiceSlugs(): Promise<void> {
  const rows = await query<{ id: number; name: string }>(
    "SELECT id, name FROM services WHERE slug IS NULL OR slug = ''",
  );
  for (const row of rows) {
    const slug = await uniqueServiceSlug(row.name, row.id);
    await run("UPDATE services SET slug = ? WHERE id = ?", [slug, row.id]);
  }
}
