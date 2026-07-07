import { get, run } from "./db.js";

export async function getMetaValue(key: string): Promise<string> {
  const row = await get<{ value: string }>("SELECT value FROM _meta WHERE key = ?", [key]);
  return row?.value ?? "";
}

export async function setMetaValue(key: string, value: string): Promise<void> {
  await run("INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)", [key, value]);
}

export async function metaFlag(key: string, defaultValue = false): Promise<boolean> {
  const row = await get<{ value: string }>("SELECT value FROM _meta WHERE key = ?", [key]);
  if (!row) return defaultValue;
  return row.value === "1" || row.value === "true";
}
