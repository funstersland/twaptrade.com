import pg from "pg";
import { CONTINUATION } from "../lib/bots/crypto-shares/continuation/identity.ts";
if (!process.env.DATABASE_URL) throw Error("DATABASE_URL is required");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(847291104)");
  const schema = process.env.TWAP_DB_SCHEMA || "public";
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw Error("Invalid schema");
  await db.query(`SET LOCAL search_path TO "${schema}", public`);
  const rows = (await db.query("SELECT id,strategy_key FROM bots WHERE family=$1 AND lower(name)=lower($2)", [CONTINUATION.family, CONTINUATION.name])).rows;
  if (rows.length) {
    if (rows.length !== 1 || rows[0].id !== "047f0cd1-f335-43f0-b775-cb478c82ea08" || rows[0].strategy_key !== CONTINUATION.key)
      throw Error("Continuation catalog identity differs from the verified bot.");
    const description = "Follow the running candle at T−20 into the next round without waiting for resolution. Size from confirmed results; double after losses and reset after a win.";
    await db.query("UPDATE bots SET description=$1,updated_at=$2 WHERE id=$3 AND description<>$1", [description,new Date().toISOString(),rows[0].id]);
    console.log("Continuation T−20 rules registered:", rows[0].id);
  }
  await db.query("COMMIT");
} catch (e) { await db.query("ROLLBACK"); throw e; }
finally { await db.end(); }
