import pg from "pg";
import { randomUUID } from "node:crypto";
import { SCALPER } from "../lib/bots/crypto-shares/scalper/identity.ts";
if (!process.env.DATABASE_URL) throw Error("DATABASE_URL is required");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(847291104)");
  const schema = process.env.TWAP_DB_SCHEMA || "public";
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw Error("Invalid schema");
  await db.query(`SET LOCAL search_path TO "${schema}", public`);
  // Resolve the exact family/name first. Never rename or reassign another bot.
  const rows = (
    await db.query(
      "SELECT id,strategy_key FROM bots WHERE family=$1 AND lower(name)=lower($2)",
      [SCALPER.family, SCALPER.name],
    )
  ).rows;
  if (
    rows.length > 1 ||
    rows.some((r) => r.strategy_key && r.strategy_key !== SCALPER.key)
  )
    throw Error("Scalper catalog identity conflict; no changes applied");
  const now = new Date().toISOString(),
    description =
      "BTC TWAP support/resistance rejection on closed candles. Enter the upcoming 5m, 15m or hourly round before T−20; optional capped martingale. Paper first, ARM off.";
  const id = rows[0]?.id || randomUUID();
  if (rows.length) {
    await db.query(
      "UPDATE bots SET strategy_key=$1,pair=$2,description=$3,updated_at=$4 WHERE id=$5",
      [SCALPER.key, SCALPER.pair, description, now, id],
    );
  } else {
    await db.query(
      "INSERT INTO bots(id,name,pair,family,strategy_key,description,status,min_allocation_cents,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'published',0,COALESCE((SELECT user_id FROM profiles WHERE role='owner' LIMIT 1),'system'),$7,$7)",
      [
        id,
        SCALPER.name,
        SCALPER.pair,
        SCALPER.family,
        SCALPER.key,
        description,
        now,
      ],
    );
  }
  await db.query("COMMIT");
  console.log("Scalper registered:", id);
} catch (e) {
  await db.query("ROLLBACK");
  throw e;
} finally {
  await db.end();
}
