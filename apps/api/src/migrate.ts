import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const connectionString = process.env.DATABASE_URL_DIRECT;
if (!connectionString) throw new Error("DATABASE_URL_DIRECT is required");
const pool = new pg.Pool({ connectionString, max: 1 });
const client = await pool.connect();
try {
  await client.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const directory = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");
  for (const name of (await readdir(directory)).filter(file => file.endsWith(".sql")).sort()) {
    const exists = await client.query("select 1 from schema_migrations where name=$1", [name]); if (exists.rowCount) continue;
    await client.query("begin");
    try { await client.query(await readFile(resolve(directory, name), "utf8")); await client.query("insert into schema_migrations(name) values($1)", [name]); await client.query("commit"); console.log(`Applied ${name}`); }
    catch (error) { await client.query("rollback"); throw error; }
  }
} finally { client.release(); await pool.end(); }
