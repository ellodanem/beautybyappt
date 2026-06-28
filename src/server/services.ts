import { get, query, run } from "./db.js";
import { slugify } from "../shared/offerings.js";

export type ServiceAddonInput = {
  id?: number;
  name: string;
  price: number;
  extra_duration?: number;
};

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

export async function loadServiceAddons(serviceId: number) {
  return query<{ id: number; name: string; price: number; extra_duration: number; active: number }>(
    `SELECT id, name, price, extra_duration, active
     FROM service_addons
     WHERE service_id = ? AND active = 1
     ORDER BY id`,
    [serviceId],
  );
}

export async function syncServiceAddons(serviceId: number, addons: ServiceAddonInput[]) {
  const existing = await query<{ id: number }>(
    "SELECT id FROM service_addons WHERE service_id = ? AND active = 1",
    [serviceId],
  );
  const kept = addons.filter((a) => a.name.trim());
  const incomingIds = new Set(kept.filter((a) => a.id).map((a) => a.id!));

  for (const row of existing) {
    if (!incomingIds.has(row.id)) {
      await run("UPDATE service_addons SET active = 0 WHERE id = ?", [row.id]);
    }
  }

  for (const addon of kept) {
    if (addon.id) {
      await run(
        `UPDATE service_addons SET name = ?, price = ?, extra_duration = ?, active = 1
         WHERE id = ? AND service_id = ?`,
        [addon.name.trim(), addon.price, addon.extra_duration ?? 0, addon.id, serviceId],
      );
    } else {
      await run(
        "INSERT INTO service_addons (service_id, name, price, extra_duration) VALUES (?, ?, ?, ?)",
        [serviceId, addon.name.trim(), addon.price, addon.extra_duration ?? 0],
      );
    }
  }
}
