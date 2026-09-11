// Real PostgreSQL migration/registration verification in a disposable, unique schema.
import pg from "pg";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { CHEAPSHARE } from "../../lib/bots/crypto-shares/cheapshare/identity.ts";
import { initialState } from "../../lib/bots/crypto-shares/cheapshare/state.ts";

if (!process.env.DATABASE_URL) throw Error("A test PostgreSQL DATABASE_URL is required");
const schema = `cheapshare_test_${randomUUID().replaceAll("-", "")}`;
const env = { ...process.env, TWAP_DB_SCHEMA: schema };
const client = new pg.Client({ connectionString: env.DATABASE_URL });
await client.connect();
const run = (file) => spawnSync(process.execPath, [file], { env, encoding: "utf8" });
const success = (result) => assert.equal(result.status, 0, result.stderr);
try {
  success(run("scripts/migrate-postgres.mjs"));
  await client.query(`SET search_path TO "${schema}"`);
  const at = new Date().toISOString(), botId = randomUUID(), otherId = randomUUID();
  await client.query("INSERT INTO profiles(user_id,display_name,referral_code,created_at,last_login_at) VALUES('twap_owner','Upgrade verification','upgrade-verification',$1,$1)", [at]);
  await client.query("INSERT INTO bots(id,name,family,strategy_key,pair,description,status,min_allocation_cents,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,'legacy','Original','draft',0,'twap_owner',$5,$5)", [botId,CHEAPSHARE.name,CHEAPSHARE.family,CHEAPSHARE.legacyKey,at]);
  await client.query("INSERT INTO bots(id,name,family,strategy_key,pair,description,status,min_allocation_cents,created_by,created_at,updated_at) VALUES($1,'Other bot','Crypto Shares','verification.other','BTC','Untouched','published',0,'twap_owner',$2,$2)", [otherId,at]);
  const other = (await client.query("SELECT * FROM bots WHERE id=$1", [otherId])).rows[0];
  const paperId = randomUUID(), liveId = randomUUID();
  for (const [id,mode] of [[paperId,"paper"],[liveId,"live"]]) {
    const state = { ...initialState(mode), strategyVersion: 1, armed: true,
      positions: mode === "live" ? [{ id: "unresolved-test-order" }] : [] };
    await client.query("INSERT INTO cheapshare_runs(id,user_id,bot_id,mode,strategy_version,revision,last_event,state_json,created_at,updated_at) VALUES($1,'twap_owner',$2,$3,1,12,$4,$5,$6,$6)", [id,botId,mode,randomUUID(),JSON.stringify(state),at]);
  }
  const blocked = run("scripts/register-cheapshare.mjs");
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /legacy live positions/);
  assert.equal((await client.query("SELECT strategy_key FROM bots WHERE id=$1", [botId])).rows[0].strategy_key, CHEAPSHARE.legacyKey);
  assert.equal(Number((await client.query("SELECT count(*) n FROM cheapshare_events")).rows[0].n), 0, "Failed replacement must roll back archival writes");
  await client.query("UPDATE cheapshare_runs SET state_json=$1 WHERE id=$2", [JSON.stringify({ ...initialState("live"),strategyVersion:1,armed:true }),liveId]);
  success(run("scripts/register-cheapshare.mjs"));
  const catalog = (await client.query("SELECT * FROM bots WHERE id=$1", [botId])).rows[0];
  assert.equal(catalog.strategy_key, CHEAPSHARE.key);assert.equal(catalog.status, "draft");
  const rows = (await client.query("SELECT * FROM cheapshare_runs")).rows;
  for (const row of rows) {
    const state = JSON.parse(row.state_json);
    assert.equal(state.armed,false);assert.equal(state.retired,true);assert.equal(Number(row.revision),13);
  }
  assert.equal(Number((await client.query("SELECT count(*) n FROM cheapshare_events WHERE kind='strategy-replaced'")).rows[0].n),2);
  await client.query("INSERT INTO cheapshare_runs(id,user_id,bot_id,mode,strategy_version,revision,last_event,state_json,created_at,updated_at) VALUES($1,'twap_owner',$2,'paper',2,0,$3,$4,$5,$5)", [randomUUID(),botId,randomUUID(),JSON.stringify(initialState("paper")),at]);
  success(run("scripts/register-cheapshare.mjs"));
  assert.equal(Number((await client.query("SELECT count(*) n FROM cheapshare_events")).rows[0].n),2, "Repeat registration must be idempotent");
  assert.deepEqual((await client.query("SELECT * FROM bots WHERE id=$1", [otherId])).rows[0],other);
  console.log("PostgreSQL CheapShare upgrade passed: atomic rollback, live-position guard, archive, version slots, idempotency and bot isolation.");
} finally {
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await client.end();
}
