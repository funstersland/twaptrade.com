import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(847291104)");
  const schema = process.env.TWAP_DB_SCHEMA || "public";
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error("Invalid schema");
  if (schema !== "public") await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await client.query(`SET LOCAL search_path TO "${schema}", public`);
  await client.query("CREATE TABLE IF NOT EXISTS twap_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
  const files = (await fs.readdir(new URL("../drizzle/", import.meta.url))).filter(f => /^\d+.*\.sql$/.test(f)).sort();
  const constraints = [];
  for (const file of files) {
    const source = await fs.readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
    const checksum = createHash("sha256").update(source).digest("hex");
    const existing = (await client.query("SELECT checksum FROM twap_migrations WHERE name=$1", [file])).rows[0];
    if (existing) {
      if (existing.checksum !== checksum) throw new Error(`Applied migration changed: ${file}`);
      continue;
    }
    for (let sql of source.split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean)) {
      sql = sql.replaceAll("`", '"').replace(/\binteger\b/gi, "bigint");
      const table = sql.match(/^CREATE TABLE "([^"]+)"/i)?.[1];
      if (table) {
        sql = sql.replace(/,\s*(FOREIGN KEY \([^\n]+?ON DELETE no action)/gi, (_, constraint) => {
          constraints.push(`ALTER TABLE "${table}" ADD ${constraint} DEFERRABLE INITIALLY DEFERRED`);
          return "";
        });
      }
      await client.query(sql);
    }
    await client.query("INSERT INTO twap_migrations (name,checksum) VALUES ($1,$2)", [file,checksum]);
    console.log(`Applied ${file}`);
  }
  for (const constraint of constraints) await client.query(constraint);
  await client.query(`CREATE OR REPLACE FUNCTION twap_json_each(input text) RETURNS TABLE(value text)
    LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT jsonb_array_elements_text(input::jsonb) $$`);
  await client.query(`CREATE OR REPLACE FUNCTION twap_json_array_length(input text) RETURNS integer
    LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT jsonb_array_length(input::jsonb) $$`);
  await client.query("COMMIT");
  console.log("PostgreSQL migrations complete.");
} catch (error) {
  await client.query("ROLLBACK");
  console.error("Migration failed:", error.message);
  process.exitCode = 1;
} finally { await client.end(); }
