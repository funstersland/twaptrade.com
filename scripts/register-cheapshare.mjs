import pg from "pg";
import { randomUUID } from "node:crypto";
import { CHEAPSHARE } from "../lib/bots/crypto-shares/cheapshare/identity.ts";
// Explicit catalog registration, separate from schema migrations; all other bots are untouched.
if (!process.env.DATABASE_URL) throw Error("DATABASE_URL is required");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(847291104)");
  const schema = process.env.TWAP_DB_SCHEMA || "public";
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw Error("Invalid schema");
  await db.query(`SET LOCAL search_path TO "${schema}", public`);
  const rows = (
    await db.query(
      "SELECT id,strategy_key FROM bots WHERE family=$1 AND lower(name)=lower($2)",
      [CHEAPSHARE.family, CHEAPSHARE.name],
    )
  ).rows;
  if (rows.length) {
    if (rows.length !== 1 || rows[0].strategy_key !== CHEAPSHARE.key)
      throw Error(
        "CheapShare identity conflict; review the exact catalog record.",
      );
    console.log("CheapShare already registered:", rows[0].id);
  } else {
    const id = randomUUID(),
      now = new Date().toISOString();
    await db.query(
      "INSERT INTO bots(id,name,pair,family,strategy_key,description,status,min_allocation_cents,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'published',0,'twap_owner',$7,$7)",
      [
        id,
        CHEAPSHARE.name,
        CHEAPSHARE.pair,
        CHEAPSHARE.family,
        CHEAPSHARE.key,
        "Fade a mature crowd with spot hold and projected TWAP clearance. Paper first; live requires ARM and confirmation.",
        now,
      ],
    );
    console.log("Registered CheapShare:", id);
  }
  await db.query("COMMIT");
} catch (e) {
  await db.query("ROLLBACK");
  throw e;
} finally {
  await db.end();
}
