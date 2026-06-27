import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "..", "migrations", "postgres");

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("Set DATABASE_URL to your Neon connection string.");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });

const files = (await readdir(migrationsDir))
  .filter((name) => name.endsWith(".sql"))
  .sort();

console.log(`Running ${files.length} migration(s) against Neon…`);

for (const file of files) {
  const sql = await readFile(path.join(migrationsDir, file), "utf8");
  console.log(`→ ${file}`);
  await pool.query(sql);
}

await pool.end();
console.log("Done.");
