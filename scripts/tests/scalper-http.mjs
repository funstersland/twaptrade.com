// Only the explicitly named throwaway local database; never the account database.
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { randomUUID, createDecipheriv } from "node:crypto";
import { DEFAULT_CONFIG } from "../../lib/bots/crypto-shares/scalper/config.ts";
import {
  initialState,
  reduce,
} from "../../lib/bots/crypto-shares/scalper/state.ts";
import {
  analyze,
  quoteBuy,
} from "../../lib/bots/crypto-shares/scalper/rules.ts";
import { rejectionFixture } from "./scalper-fixtures.mjs";
const root =
    ".sites-runtime/scalper-test-state/v3/d1/miniflare-D1DatabaseObject",
  file = fs
    .readdirSync(root)
    .find((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite");
if (!file) throw Error("Isolated Scalper test database missing");
const db = new DatabaseSync(`${root}/${file}`),
  cfg = JSON.parse(
    fs.readFileSync(".sites-runtime/scalper-test-wrangler.json"),
  ),
  origin = "http://127.0.0.1:5193",
  lease = randomUUID();
let checks = 0;
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
  checks++;
  return { d, cookie: r.headers.get("set-cookie")?.split(";")[0] };
}
async function runner(payload, status = 200) {
  const r = await fetch(origin + "/api/scalper/runner", {
    method: payload ? "POST" : "GET",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.vars.TWAP_SCALPER_RUNNER_TOKEN}`,
    },
    ...(payload ? { body: JSON.stringify({ lease, ...payload }) } : {}),
  });
  const d = await r.json();
  assert.equal(r.status, status, JSON.stringify(d));
  checks++;
  return d;
}
const heartbeat = () =>
  runner({
    action: "heartbeat",
    geoAllowed: false,
    latest: null,
    candles: [],
    message: "Isolated software verification",
  });
// This test may be rerun; clear only this named fixture store.
db.exec(
  "DELETE FROM auth_limits; DELETE FROM scalper_events; DELETE FROM scalper_runs; DELETE FROM scalper_feed; DELETE FROM bots;",
);
const bot = randomUUID(),
  other = randomUUID(),
  now = new Date().toISOString();
const insert = db.prepare(
  "INSERT INTO bots(id,name,pair,family,strategy_key,description,status,min_allocation_cents,created_by,created_at,updated_at) VALUES(?,?,'BTC',?,?,'Test fixture','published',0,'verification',?,?)",
);
insert.run(
  bot,
  "Scalper",
  "Crypto Shares",
  "crypto-shares.scalper.rejection",
  now,
  now,
);
insert.run(other, "Scalper", "Crypto Futures", null, now, now);
const otherBefore = db.prepare("SELECT * FROM bots WHERE id=?").get(other);
const credentials = {
  email: `scalper-${randomUUID()}@example.test`,
  password: "ScalperFixture#2026!",
};
const a = await api(
    "/api/auth",
    { action: "signup", name: "Scalper verification", ...credentials },
    null,
    201,
  ),
  b = await api(
    "/api/auth",
    {
      action: "signup",
      name: "Other verification",
      email: `scalper-${randomUUID()}@example.test`,
      password: credentials.password,
    },
    null,
    201,
  );
await api("/api/scalper", null, null, 401);
await api("/api/scalper/runner", null, a.cookie, 401);
const paper = (
  await api(
    "/api/scalper",
    { action: "deploy", mode: "paper", config: DEFAULT_CONFIG },
    a.cookie,
    201,
  )
).d.id;
await api(
  "/api/scalper",
  { action: "deploy", mode: "paper", config: DEFAULT_CONFIG },
  a.cookie,
  409,
);
await api("/api/scalper", { action: "disarm", runId: paper }, b.cookie, 404);
await api(
  "/api/bots",
  { action: "deploy", botId: bot, allocationCents: 0 },
  a.cookie,
  409,
);
let run = (await api("/api/scalper", null, a.cookie)).d.runs[0];
assert.equal(run.state.armed, false);
assert.equal(run.state.config.martingale, false);
checks += 2;
await api(
  "/api/scalper",
  {
    action: "configure",
    runId: paper,
    revision: run.revision,
    config: { ...DEFAULT_CONFIG, martingale: true },
  },
  a.cookie,
);
run = (await api("/api/scalper", null, a.cookie)).d.runs[0];
assert(run.state.config.martingale);
checks++;
await api(
  "/api/scalper",
  { action: "configure", runId: paper, revision: 0, config: DEFAULT_CONFIG },
  a.cookie,
  409,
);
await api(
  "/api/scalper",
  {
    action: "arm",
    runId: paper,
    revision: run.revision,
    confirmVersion: run.state.configVersion,
  },
  a.cookie,
);
await api("/api/scalper", { action: "disarm", runId: paper }, a.cookie);
await heartbeat();
run = (await api("/api/scalper", null, a.cookie)).d.runs[0];
await runner(
  {
    action: "command",
    runId: paper,
    revision: run.revision,
    eventId: randomUUID(),
    command: { action: "arm", confirmVersion: run.state.configVersion },
  },
  403,
);
await runner(
  {
    action: "heartbeat",
    lease: randomUUID(),
    geoAllowed: false,
    latest: null,
    candles: [],
    message: "Competing runner",
  },
  409,
);
const future = rejectionFixture(
  300,
  (Math.floor(Date.now() / 300000) + 3) * 300,
);
await runner(
  {
    action: "heartbeat",
    geoAllowed: false,
    latest: future.latest,
    candles: future.candles,
    message: "Invalid future candle",
  },
  400,
);
const ledger = () =>
    db
      .prepare(
        "SELECT (SELECT COUNT(*) FROM transactions) tx,(SELECT COUNT(*) FROM deployments) deployments,(SELECT COUNT(*) FROM holdings) holdings,(SELECT COUNT(*) FROM portfolio_snapshots) snapshots",
      )
      .get(),
  before = ledger();
// Hydrate a historical paper position from the same pure reducer, then test durable
// resolution, revision conflicts and replay via HTTP. No wall-clock bypass exists.
const f = rejectionFixture(300, (Math.floor(Date.now() / 300000) - 2) * 300),
  id = randomUUID(),
  signal = analyze(f.candles, f.latest, 300, f.now),
  { costMicros, sharesMicros, feeMicros } = quoteBuy(
    f.book,
    1000,
    DEFAULT_CONFIG,
    0.07,
    1,
    f.now,
  );
let s = initialState("paper");
for (const [command, context] of [
  [{ action: "arm", confirmVersion: 1 }, {}],
  [
    {
      action: "prepare",
      market: f.market,
      direction: "Up",
      stakeCents: 1000,
      orderId: null,
    },
    { signal, positionId: id },
  ],
  [{ action: "submit", positionId: id }, {}],
  [
    {
      action: "fill",
      positionId: id,
      costMicros,
      sharesMicros,
      feeMicros,
      fills: [],
    },
    {},
  ],
])
  s = reduce(s, command, f.now, context).state;
s = reduce(s, { action: "disarm" }, f.now).state;
db.prepare("UPDATE scalper_runs SET state_json=? WHERE id=?").run(
  JSON.stringify(s),
  paper,
);
run = (await api("/api/scalper", null, a.cookie)).d.runs[0];
await api(
  "/api/scalper",
  {
    action: "configure",
    runId: paper,
    revision: run.revision,
    config: DEFAULT_CONFIG,
  },
  a.cookie,
  409,
);
const eventId = randomUUID(),
  resolve = {
    action: "command",
    runId: paper,
    revision: run.revision,
    eventId,
    command: { action: "resolve", positionId: id, winner: "Down" },
  };
const closed = await runner(resolve);
await runner(resolve);
assert.equal(closed.state.pnlMicros, -10000000);
assert.equal(closed.state.maxDrawdownMicros, 10000000);
assert.equal(closed.state.maxLosingStreak, 1);
assert.equal(closed.state.lossStreaks[900], 0);
assert.equal(
  db
    .prepare(
      "SELECT COUNT(*) n FROM scalper_events WHERE run_id=? AND kind='closed'",
    )
    .get(paper).n,
  1,
);
checks += 5;
await runner({ ...resolve, eventId: randomUUID() }, 409);
run = (await api("/api/scalper", null, a.cookie)).d.runs[0];
assert.equal(run.history.filter((h) => h.kind === "closed").length, 1);
checks++;
// Even with an authenticated runner, arbitrary future/current rounds cannot enter.
await api(
  "/api/scalper",
  {
    action: "arm",
    runId: paper,
    revision: run.revision,
    confirmVersion: run.state.configVersion,
  },
  a.cookie,
);
run = (await api("/api/scalper", null, a.cookie)).d.runs[0];
await runner(
  {
    action: "command",
    runId: paper,
    revision: run.revision,
    eventId: randomUUID(),
    command: {
      action: "prepare",
      market: f.market,
      direction: "Up",
      stakeCents: 1000,
      orderId: null,
    },
    book: { ...f.book, at: Date.now() },
  },
  409,
);
await api("/api/scalper", { action: "disarm", runId: paper }, a.cookie);
const fakeKey = "01".repeat(32),
  walletAddress = "0x" + "11".repeat(20);
const live = (
  await api(
    "/api/scalper",
    {
      action: "deploy",
      mode: "live",
      config: DEFAULT_CONFIG,
      walletAddress,
      walletKey: fakeKey,
    },
    a.cookie,
    201,
  )
).d.id;
const all = (await api("/api/scalper", null, a.cookie)).d;
assert(!JSON.stringify(all).includes(fakeKey));
assert(!JSON.stringify(all).includes("wallet_cipher"));
assert(all.runs.every((r) => r.state.armed === false));
checks += 3;
const row = db.prepare("SELECT * FROM scalper_runs WHERE id=?").get(live),
  [iv, encoded] = row.wallet_cipher.split("."),
  bytes = Buffer.from(encoded, "base64"),
  d = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(cfg.vars.TWAP_BOT_ENCRYPTION_KEY, "base64"),
    Buffer.from(iv, "base64"),
  );
d.setAAD(Buffer.from(`${row.user_id}:${row.bot_id}`));
d.setAuthTag(bytes.subarray(-16));
assert.equal(
  Buffer.concat([d.update(bytes.subarray(0, -16)), d.final()]).toString(),
  fakeKey,
);
checks++;
// Denial test only: no live run is ever armed and no provider request is made.
await api(
  "/api/scalper",
  { action: "arm", runId: live, revision: 0, confirmVersion: 1 },
  a.cookie,
  409,
);
db.prepare("UPDATE bots SET status='draft' WHERE id=?").run(bot);
assert(
  (await api("/api/account", { action: "init" }, a.cookie)).d.bots.some(
    (b) => b.id === bot,
  ),
);
assert(
  !(await api("/api/account", { action: "init" }, b.cookie)).d.bots.some(
    (b) => b.id === bot,
  ),
);
checks += 2;
assert.deepEqual(
  db.prepare("SELECT * FROM bots WHERE id=?").get(other),
  otherBefore,
);
assert.deepEqual(ledger(), before);
checks += 2;
db.prepare("UPDATE bots SET status='published' WHERE id=?").run(bot);
// Keep a named local UI fixture available for browser QA, clearly synthetic.
const recent = rejectionFixture(300, Math.floor(Date.now() / 300000) * 300);
await runner({
  action: "heartbeat",
  geoAllowed: false,
  latest: null,
  candles: recent.candles,
  message: "Synthetic chart fixture — local verification only",
});
fs.writeFileSync(
  ".sites-runtime/scalper-preview-user.json",
  JSON.stringify({ ...credentials, origin }),
);
console.log(
  `Scalper HTTP verification: ${checks} checks passed in isolated SQLite. Live ARM off; no provider orders.`,
);
