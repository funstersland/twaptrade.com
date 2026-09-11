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
  const description = "Watch each round for a sudden spot reversal with enough price-and-time strength to flip TWAP. Check profit room and exit liquidity; paper first, ARM off.";
  if (rows.length) {
    if (rows.length !== 1 || ![CHEAPSHARE.key, CHEAPSHARE.legacyKey].includes(rows[0].strategy_key))
      throw Error("CheapShare identity conflict; review the exact catalog record.");
    const id = rows[0].id;
    const retired = (await db.query("SELECT * FROM cheapshare_runs WHERE bot_id=$1 AND strategy_version<2", [id])).rows;
    for (const run of retired) {
      const previous = JSON.parse(run.state_json);
      if (previous.retired) continue;
      if (run.mode === "live" && previous.positions?.length)
        throw Error("CheapShare has legacy live positions requiring reconciliation before replacement.");
      const event = randomUUID(), now = new Date().toISOString();
      const state = { ...previous, retired: true, armed: false, confirmedVersion: null,
        message: "This strategy was retired. Deploy the replacement CheapShare to continue." };
      await db.query("UPDATE cheapshare_runs SET state_json=$1,revision=revision+1,last_event=$2,updated_at=$3 WHERE id=$4", [JSON.stringify(state), event, now, run.id]);
      await db.query("INSERT INTO cheapshare_events (id,run_id,revision,kind,data_json,created_at) VALUES ($1,$2,$3,'strategy-replaced',$4,$5)",
        [event, run.id, Number(run.revision)+1, JSON.stringify({ previousStrategy: CHEAPSHARE.legacyKey, previousState: previous }), now]);
    }
    await db.query("UPDATE bots SET strategy_key=$1,description=$2,pair=$3,updated_at=$4 WHERE id=$5",
      [CHEAPSHARE.key, description, CHEAPSHARE.pair, new Date().toISOString(), id]);
    console.log("CheapShare reversal strategy registered:", id);
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
        description,
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
