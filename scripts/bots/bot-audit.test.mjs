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
import { CandleBook, toE18 } from "../../lib/bots/crypto-shares/scalper/candles.ts";
import { Feeds } from "./cheapshare-market.mjs";

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

test("Scalper retains delayed observed candles but never treats a delayed live tick as fresh", () => {
  const b = new CandleBook();
  for (let at=300000; at<=315000; at+=1000)
    assert(b.push({at,value:toE18("100")},at+4000));
  assert.equal(b.snapshot().find(c => c.seconds===15).complete,true);
  const f = rejectionFixture();
  assert.match(analyze(f.candles,{...f.latest,at:f.now-4000},300,f.now).reason,/fresh/);
  assert(!b.push({at:316000,value:toE18("100")},376001));
});

test("CheapShare verifies a quiet quote with a new read and never refreshes failed/cached/mismatched data", async () => {
  const f = new Feeds();
  f.available.add("BTC");
  f.available.add("HYPE");
  const at=Date.now()-800;
  f.addSpot({at,s:"BTCUSDT",b:"100",a:"101",u:7});
  const ok = async (url,options) => {
    assert.match(url,/symbol=BTCUSDT$/);
    assert.equal(options.cache,"no-store");
    return Response.json({symbol:"BTCUSDT",bidPrice:"100",askPrice:"101"});
  };
  await f.refreshSpotSnapshots(ok);
  assert(f.spot.get("BTC").at(-1).at>at);
  assert.equal(f.continuity.get("spot:BTC").since,at);
  assert.equal(f.spot.get("BTC").at(-1).sequence,7);
  assert.equal(f.spot.has("HYPE"),false);
  for (const get of [async()=>{throw Error("offline");},async()=>Response.json({symbol:"ETHUSDT",bidPrice:"100",askPrice:"101"}),async()=>Response.json({symbol:"BTCUSDT",bidPrice:"100",askPrice:"101"},{headers:{age:"1"}})]) {
    f.spot.get("BTC").at(-1).at=Date.now()-800;
    const previous=structuredClone(f.spot.get("BTC"));
    await f.refreshSpotSnapshots(get);
    assert.deepEqual(f.spot.get("BTC"),previous);
  }
});

test("CheapShare REST requests cannot overwrite a newer WebSocket quote", async () => {
  const f=new Feeds(); f.available.add("BTC");
  f.addSpot({at:Date.now()-800,s:"BTCUSDT",b:"100",a:"101",u:7});
  await f.refreshSpotSnapshots(async()=> {
    f.addSpot({at:Date.now(),s:"BTCUSDT",b:"102",a:"103",u:8});
    return Response.json({symbol:"BTCUSDT",bidPrice:"100",askPrice:"101"});
  });
  assert.equal(f.spot.get("BTC").at(-1).bid,toE18("102"));
  assert.equal(f.spot.get("BTC").at(-1).sequence,8);
});
