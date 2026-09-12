import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { continuationAccounting } from "../../lib/bots/crypto-shares/continuation/performance.ts";
import { analyze, quoteBuyCheck } from "../../lib/bots/crypto-shares/scalper/rules.ts";
import { DEFAULT_CONFIG as scalperConfig } from "../../lib/bots/crypto-shares/scalper/config.ts";
import { scan } from "../../lib/bots/crypto-shares/cheapshare/rules.ts";
import { DEFAULT_CONFIG as cheapshareConfig } from "../../lib/bots/crypto-shares/cheapshare/config.ts";
import { rejectionFixture } from "../tests/scalper-fixtures.mjs";
import { reversalFixture } from "../tests/cheapshare-fixtures.mjs";

test("Continuation accounting includes full closed history, isolates runs and includes fees only once", async () => {
  const sql = new DatabaseSync(":memory:");
  try {
    sql.exec("CREATE TABLE continuation_rounds(run_id TEXT,status TEXT,pnl_micros INTEGER,fee_micros INTEGER,sale_fee_micros INTEGER,cost_micros INTEGER)");
    const put = sql.prepare("INSERT INTO continuation_rounds VALUES(?,?,?,?,?,?)");
    for (let i=0; i<25; i++) put.run("a","won",800000,30000,1000,1000000);
    put.run("a","lost",-64000000,2100000,0,64000000);
    put.run("a","breakeven",0,20000,10000,1000000);
    put.run("a","open",null,40000,0,2000000);
    put.run("a","unfilled",null,0,0,0);
    put.run("b","won",999000000,0,0,1000000);
    const db = { prepare: query => ({ bind: runId => ({ first: async () => sql.prepare(query).get(runId) }) }) };
    const a = await continuationAccounting(db,"a");
    assert.equal(a.profitableTrades,25);
    assert.equal(a.losingTrades,1);
    assert.equal(a.profitMicros,20000000);
    assert.equal(a.lossMicros,64000000);
    assert.equal(a.netMicros,-44000000);
    assert.equal(a.feeMicros,2905000);
    assert.equal(a.largestLossMicros,64000000);
    assert.equal((await continuationAccounting(db,"empty")).netMicros,0);
  } finally { sql.close(); }
});

test("Scalper recovers after 40 valid context candles without bridging a recent gap", () => {
  for (const horizon of [300,900,3600]) {
    const f = rejectionFixture(horizon);
    f.candles[10].complete = false;
    assert.equal(analyze(f.candles,f.latest,horizon,f.now).direction,"Up");
    f.candles[35].complete = false;
    const blocked = analyze(f.candles,f.latest,horizon,f.now);
    assert.equal(blocked.direction,null);
    assert.match(blocked.reason,/\/40 consecutive/);
    assert.match(blocked.reason,/feed gap/);
  }
});

test("Scalper explains the actual minimum-share rejection without increasing a $1 lot", () => {
  const f = rejectionFixture();
  const checked = quoteBuyCheck(f.book,100,scalperConfig,.07,1,f.now);
  assert.equal(checked.quote,null);
  assert.match(checked.reason,/\$1.00 lot cannot buy.*5 shares/);
  assert(quoteBuyCheck(f.book,1000,scalperConfig,.07,1,f.now).quote);
  const stale=quoteBuyCheck({...f.book,at:f.now-2001},1000,scalperConfig,.07,1,f.now);
  assert.equal(stale.quote,null);
  assert.match(stale.reason,/stale/);
});

test("CheapShare identifies the stale source while preserving its entry gate", () => {
  const f = reversalFixture();
  const i = {...f.observation, config:cheapshareConfig, preset:cheapshareConfig.presets["BTC:300"]};
  assert.equal(scan(i).eligible,true);
  i.oracle.at(-1).at=i.now-3000;
  const blocked=scan(i);
  assert.equal(blocked.eligible,false);
  assert.equal(blocked.diagnostics.agesMs.oracle,3000);
  assert.equal(blocked.diagnostics.watchingSince,i.watchingSince);
});
