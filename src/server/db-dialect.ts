/** Translate SQLite-style SQL (used throughout the app) to PostgreSQL. */

export type DbEngine = "sqlite" | "postgres";

export function translateSql(sql: string, engine: DbEngine): string {
  if (engine === "sqlite") return sql;

  let out = sql;

  out = out.replace(/datetime\s*\(\s*'now'\s*\)/gi, "NOW()::text");
  out = out.replace(
    /date\s*\(\s*'now'\s*,\s*'-1 day'\s*\)/gi,
    "(CURRENT_DATE - INTERVAL '1 day')::text",
  );
  out = out.replace(/date\s*\(\s*'now'\s*\)/gi, "CURRENT_DATE::text");

  out = out.replace(
    /INSERT\s+OR\s+REPLACE\s+INTO\s+_meta\s*\(\s*key\s*,\s*value\s*\)/gi,
    "INSERT INTO _meta (key, value)",
  );
  if (/INSERT\s+INTO\s+_meta\s*\(\s*key\s*,\s*value\s*\)/i.test(out) && !/\bON\s+CONFLICT\b/i.test(out)) {
    out += " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value";
  }

  out = out.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, "INSERT INTO");
  if (/^\s*INSERT\s+INTO\s+_meta\b/i.test(out.trim()) && !/\bON\s+CONFLICT\b/i.test(out)) {
    out += " ON CONFLICT (key) DO NOTHING";
  }

  let index = 0;
  out = out.replace(/\?/g, () => `$${++index}`);

  return out;
}

export function appendReturningId(sql: string, engine: DbEngine): string {
  if (engine !== "postgres") return sql;
  const trimmed = sql.trim();
  if (!/^INSERT\s+/i.test(trimmed)) return sql;
  if (/\bRETURNING\b/i.test(trimmed)) return sql;
  return `${trimmed} RETURNING id`;
}
