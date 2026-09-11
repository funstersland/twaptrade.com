import assert from "node:assert/strict";
import { reversalFixture } from "./cheapshare-fixtures.mjs";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { DEFAULT_CONFIG } from "../../lib/bots/crypto-shares/cheapshare/config.ts";
import {
  fixed,
  buyQuote,
} from "../../lib/bots/crypto-shares/cheapshare/rules.ts";
const root =
  ".sites-runtime/cheapshare-test-state/v3/d1/miniflare-D1DatabaseObject";
const file = fs.readdirSync(root).find((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite");
if (!file) throw Error("Isolated CheapShare test DB missing");
const db = new DatabaseSync(`${root}/${file}`),
  cfg = JSON.parse(
    fs.readFileSync(".sites-runtime/cheapshare-test-wrangler.json"),
  ),
  origin = "http://localhost:5190",
  lease = randomUUID();
let count = 0;
async function api(path, payload, cookie, status = 200) {
  const r = await fetch(origin + path, {
    method: payload ? "POST" : "GET",
    headers: {
      origin,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const d = await r.json();
  assert.equal(r.status, status, JSON.stringify(d));
  count++;
  return { d, cookie: r.headers.get("set-cookie")?.split(";")[0] };
}
async function runner(payload, status = 200) {
  const r = await fetch(origin + "/api/cheapshare/runner", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.vars.TWAP_CHEAPSHARE_RUNNER_TOKEN}`,
      "x-cheapshare-version": "2",
    },
    body: JSON.stringify({ ...payload, lease }),
  });
  const d = await r.json();
  assert.equal(r.status, status, JSON.stringify(d));
  count++;
  return d;
}
async function heartbeat() {
  await runner({
    action: "heartbeat",
    geoAllowed: false,
    markets: [],
    message: "Isolated verification only",
  });
}
db.exec(
  "DELETE FROM auth_limits; DELETE FROM cheapshare_events; DELETE FROM cheapshare_runs; DELETE FROM cheapshare_markets; DELETE FROM cheapshare_feed; DELETE FROM bots;",
);
const bot = randomUUID(),
  other = randomUUID(),
  now = new Date().toISOString();
db.prepare(
  "INSERT INTO bots(id,name,pair,family,strategy_key,description,status,min_allocation_cents,created_by,created_at,updated_at) VALUES(?,?,'6 pairs','Crypto Shares',?,'','published',0,'verification',?,?)",
).run(bot, "CheapShare", "crypto-shares.cheapshare.flip", now, now);
db.prepare(
  "INSERT INTO bots(id,name,pair,family,strategy_key,description,status,min_allocation_cents,created_by,created_at,updated_at) VALUES(?,?,'BTC5m','Crypto Shares',?,'','published',100000,'verification',?,?)",
).run(
  other,
  "Continuation Strategy",
  "crypto-shares.continuation.btc5m",
  now,
  now,
);
const otherBefore = db.prepare("SELECT * FROM bots WHERE id=?").get(other);
const member = () =>
  api(
    "/api/auth",
    {
      action: "signup",
      name: "CheapShare verification",
      email: `verify-${randomUUID()}@example.test`,
      password: "Verification#2026!",
    },
    null,
    201,
  );
const a = await member(),
  b = await member();
await api("/api/cheapshare", null, null, 401);
await api("/api/cheapshare/runner", null, a.cookie, 401);
const paper = (
  await api(
    "/api/cheapshare",
    { action: "deploy", mode: "paper", config: DEFAULT_CONFIG },
    a.cookie,
    201,
  )
).d.id;
await api(
  "/api/cheapshare",
  { action: "deploy", mode: "paper", config: DEFAULT_CONFIG },
  a.cookie,
  409,
);
await api("/api/cheapshare", { action: "disarm", runId: paper }, b.cookie, 404);
await api(
  "/api/bots",
  { action: "deploy", botId: bot, allocationCents: 0 },
  a.cookie,
  409,
);
let run = (await api("/api/cheapshare", null, a.cookie)).d.runs[0];
assert.equal(run.state.armed, false);
assert.equal(run.state.pnl, 0);
assert.equal(run.state.cash, 1000000000);
count += 3;
await api(
  "/api/cheapshare",
  {
    action: "configure",
    runId: paper,
    revision: run.revision,
    config: { ...DEFAULT_CONFIG, newsBlocked: true },
  },
  a.cookie,
);
run = (await api("/api/cheapshare", null, a.cookie)).d.runs[0];
assert.equal(run.state.config.newsBlocked, true);
count++;
await api(
  "/api/cheapshare",
  {
    action: "configure",
    runId: paper,
    revision: run.revision,
    config: DEFAULT_CONFIG,
  },
  a.cookie,
);
run = (await api("/api/cheapshare", null, a.cookie)).d.runs[0];
await api(
  "/api/cheapshare",
  { action: "arm", runId: paper, revision: run.revision, confirmVersion: null },
  a.cookie,
);
await heartbeat();
run = (await api("/api/cheapshare", null, a.cookie)).d.runs[0];
await runner(
  {
    action: "command",
    runId: paper,
    revision: run.revision,
    eventId: randomUUID(),
    command: { action: "arm", confirmVersion: null },
  },
  403,
);
// Keep the HTTP entry inside a real aligned test window with time to observe a reversal.
const phase = Date.now() % 900000;
if (phase < 12000 || phase > 860000) {
  await new Promise(resolve => setTimeout(resolve, phase < 12000 ? 12000-phase : 912000-phase));
  await heartbeat();
}
const at = Date.now(), start = Math.floor(at / 900000) * 900;
const f = n => fixed(String(n)).toString(), slug = `btc-updown-15m-${start}`;
await runner({action:"reference",slug,strike:f(77000),source:"chainlink-open",observedAt:start*1000+1},400);
await runner({action:"reference",slug,strike:f(77000),source:"chainlink-open",observedAt:start*1000});
const positionId=randomUUID(), orderId=randomUUID(), market=reversalFixture(at,76998,77010,900).market;
function observation() { return reversalFixture(Date.now(),76998,77010,900).observation; }
const before = db
  .prepare(
    "SELECT (SELECT COUNT(*) FROM transactions) tx,(SELECT COUNT(*) FROM deployments) deployments,(SELECT COUNT(*) FROM holdings) holdings,(SELECT COUNT(*) FROM portfolio_snapshots) snapshots",
  )
  .get();
const cmd = {
  action: "entry",
  positionId,
  orderId,
  market,
  observation: observation(),
};
const eventId = randomUUID();
const result = await runner({
  action: "command",
  runId: paper,
  revision: run.revision,
  eventId,
  command: cmd,
});
await runner({
  action: "command",
  runId: paper,
  revision: run.revision,
  eventId,
  command: cmd,
});
assert.equal(
  db
    .prepare(
      "SELECT COUNT(*) n FROM cheapshare_events WHERE run_id=? AND kind='entry'",
    )
    .get(paper).n,
  1,
);
count++;
await runner(
  {
    action: "command",
    runId: paper,
    revision: run.revision,
    eventId: randomUUID(),
    command: cmd,
  },
  409,
);
const submit = await runner({
  action: "command",
  runId: paper,
  revision: result.revision,
  eventId: randomUUID(),
  command: { action: "submit", positionId, orderId },
});
const q = buyQuote(observation().up.asks, 10000000, 0.50, 0.07, 1),
  fill = {
    ...q,
    id: `paper:${orderId}`,
    orderId,
    side: "BUY",
    tokenId: "123",
    transactionHash: null,
    logIndex: 0,
    blockNumber: 0,
    tradeIds: [],
  };
const fillId = randomUUID();
const filled = await runner({
  action: "command",
  runId: paper,
  revision: submit.revision,
  eventId: fillId,
  command: { action: "fill", positionId, orderId, fills: [fill] },
});
await runner({
  action: "command",
  runId: paper,
  revision: submit.revision,
  eventId: fillId,
  command: { action: "fill", positionId, orderId, fills: [fill] },
});
assert.equal(filled.state.cash, 990000000);
count++;
await api("/api/cheapshare", { action: "disarm", runId: paper }, a.cookie);
run = (await api("/api/cheapshare", null, a.cookie)).d.runs[0];
await api(
  "/api/cheapshare",
  {
    action: "configure",
    runId: paper,
    revision: run.revision,
    config: DEFAULT_CONFIG,
  },
  a.cookie,
  409,
);
const fakeKey = "01".repeat(32);
const live = (
  await api(
    "/api/cheapshare",
    {
      action: "deploy",
      mode: "live",
      config: DEFAULT_CONFIG,
      walletAddress: "0x" + "11".repeat(20),
      walletKey: fakeKey,
    },
    a.cookie,
    201,
  )
).d.id;
const all = (await api("/api/cheapshare", null, a.cookie)).d;
assert(!JSON.stringify(all).includes(fakeKey));
assert(!JSON.stringify(all).includes("wallet_cipher"));
const saved = db
  .prepare("SELECT wallet_cipher FROM cheapshare_runs WHERE id=?")
  .get(live);
assert(saved.wallet_cipher && !saved.wallet_cipher.includes(fakeKey));
count += 3;
await api(
  "/api/cheapshare",
  { action: "arm", runId: live, revision: 0, confirmVersion: 1 },
  a.cookie,
  409,
);
db.prepare("UPDATE bots SET status='draft' WHERE id=?").run(bot);
const own = (await api("/api/account", { action: "init" }, a.cookie)).d;
const someone = (await api("/api/account", { action: "init" }, b.cookie)).d;
assert(own.bots.some((b) => b.id === bot));
assert(!someone.bots.some((b) => b.id === bot));
count += 2;
assert.deepEqual(
  db.prepare("SELECT * FROM bots WHERE id=?").get(other),
  otherBefore,
);
assert.deepEqual(
  db
    .prepare(
      "SELECT (SELECT COUNT(*) FROM transactions) tx,(SELECT COUNT(*) FROM deployments) deployments,(SELECT COUNT(*) FROM holdings) holdings,(SELECT COUNT(*) FROM portfolio_snapshots) snapshots",
    )
    .get(),
  before,
);
count += 2;
// A retired run remains archived, is omitted from current mode slots and rejects member commands.
const archived=randomUUID(), archivedState={...run.state,strategyVersion:1,armed:false,retired:true};
db.prepare("INSERT INTO cheapshare_runs(id,user_id,bot_id,mode,strategy_version,revision,last_event,state_json,created_at,updated_at) SELECT ?,user_id,bot_id,mode,1,0,?,?,created_at,updated_at FROM cheapshare_runs WHERE id=?")
 .run(archived,archived,JSON.stringify(archivedState),paper);
const current=(await api("/api/cheapshare",null,a.cookie)).d.runs;
assert(!current.some(r=>r.id===archived));count++;
db.prepare("UPDATE bots SET status='published' WHERE id=?").run(bot);
await api("/api/cheapshare",{action:"arm",runId:archived,revision:0,confirmVersion:null},a.cookie,404);
const retiredWorker=await fetch(origin+"/api/cheapshare/runner",{headers:{authorization:`Bearer ${cfg.vars.TWAP_CHEAPSHARE_RUNNER_TOKEN}`}});
assert.equal(retiredWorker.status,409);count++;
// Keep fixtures out of all real account stores; this entire database is throwaway.
console.log(
  `CheapShare HTTP verification: ${count} checks passed in isolated SQLite.`,
);
db.close();
