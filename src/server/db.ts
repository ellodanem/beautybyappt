import { get as d1Get, initDB as initClawnifyDb, query as d1Query, run as d1Run } from "@clawnify/db";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import { appendReturningId, translateSql, type DbEngine } from "./db-dialect.js";

export type RunResult = { changes: number; lastInsertRowid: number };

let engine: DbEngine = "sqlite";
let pgPool: Pool | null = null;

export function getDbEngine(): DbEngine {
  return engine;
}

function hasD1Binding(env: unknown): env is { DB: D1Database } {
  const db = (env as { DB?: D1Database })?.DB;
  return Boolean(db && typeof db.prepare === "function");
}

function getDatabaseUrl(env: unknown): string | undefined {
  const fromEnv = (env as { DATABASE_URL?: string })?.DATABASE_URL;
  const fromProcess = typeof process !== "undefined" ? process.env.DATABASE_URL : undefined;
  const url = fromEnv || fromProcess;
  return url?.trim() || undefined;
}

export function initDB(env: unknown): void {
  const databaseUrl = getDatabaseUrl(env);
  if (databaseUrl) {
    engine = "postgres";
    if (!pgPool) {
      pgPool = new Pool({ connectionString: databaseUrl });
    }
    return;
  }

  if (hasD1Binding(env)) {
    engine = "sqlite";
    initClawnifyDb(env);
    return;
  }

  if (hasD1Binding({ DB: (env as { Bindings?: { DB?: D1Database } })?.Bindings?.DB })) {
    engine = "sqlite";
    initClawnifyDb((env as { Bindings: { DB: D1Database } }).Bindings);
    return;
  }

  throw new Error(
    "Database not configured: set DATABASE_URL (Neon/Vercel) or provide a D1 binding (Wrangler local dev).",
  );
}

async function withPg<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!pgPool) throw new Error("Postgres pool not initialized — call initDB first.");
  const client = await pgPool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (engine === "sqlite") {
    return d1Query<T>(sql, params);
  }

  const pgSql = translateSql(sql, "postgres");
  return withPg(async (client) => {
    const result = await client.query(pgSql, params);
    return result.rows as T[];
  });
}

export async function get<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  if (engine === "sqlite") {
    return d1Get<T>(sql, params);
  }

  const rows = await query<T>(sql, params);
  return rows[0];
}

export async function run(sql: string, params: unknown[] = []): Promise<RunResult> {
  if (engine === "sqlite") {
    return d1Run(sql, params);
  }

  const pgSql = appendReturningId(translateSql(sql, "postgres"), "postgres");
  return withPg(async (client) => {
    const result = await client.query(pgSql, params);
    const lastInsertRowid = result.rows[0]?.id != null ? Number(result.rows[0].id) : 0;
    return {
      changes: result.rowCount ?? 0,
      lastInsertRowid,
    };
  });
}
