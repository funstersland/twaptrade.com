import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  CandleBook,
  toE18,
} from "../../lib/bots/crypto-shares/scalper/candles.ts";
import {
  DEFAULT_CONFIG,
  configSchema,
} from "../../lib/bots/crypto-shares/scalper/config.ts";
import {
  analyze,
  entryWindow,
  nextStart,
  nextEntryAt,
  nextStake,
  quoteBuy,
  zonesFromCandles,
} from "../../lib/bots/crypto-shares/scalper/rules.ts";
import {
  initialState,
  reduce,
  entryGate,
} from "../../lib/bots/crypto-shares/scalper/state.ts";
import {
  marketSlug,
  parseMarket,
} from "../../lib/bots/crypto-shares/scalper/market.ts";
import {
  rejectionFixture,
  gammaFixture,
  e18,
} from "../tests/scalper-fixtures.mjs";
const fixture = rejectionFixture(),
  { now, market: m, book } = fixture;
const step = (s, c, t = now, ctx = {}) => reduce(s, c, t, ctx).state;
function entered(mode = "paper", base = initialState(mode), f = fixture) {
  let s = base,
    id = randomUUID(),
    signal = analyze(f.candles, f.latest, f.market.horizon, f.now);
  if (mode === "live")
    s = step(
      s,
      {
        action: "connection",
        approved: true,
        balanceMicros: 1e9,
        message: "Test fixture",
      },
      f.now,
    );
  s = step(s, { action: "arm", confirmVersion: s.configVersion }, f.now, {
    liveAllowed: true,
  });
  const stake = nextStake(s.config, s.lossStreaks[f.market.horizon]);
  s = step(
    s,
    {
      action: "prepare",
      market: f.market,
      direction: signal.direction,
      stakeCents: stake,
      orderId: mode === "live" ? "0x" + "a".repeat(64) : null,
    },
    f.now,
    { liveAllowed: true, signal, positionId: id },
  );
  s = step(s, { action: "submit", positionId: id }, f.now, {
    liveAllowed: true,
  });
  const { costMicros, sharesMicros, feeMicros } = quoteBuy(
    f.book,
    stake,
    s.config,
    0.07,
    1,
    f.now,
  );
  return { s, id, q: { costMicros, sharesMicros, feeMicros } };
}
test("Scalper defaults to ARM off, martingale off and the three requested BTC horizons", () => {
  const s = initialState("paper");
  assert.equal(s.armed, false);
  assert.equal(s.config.martingale, false);
  assert.deepEqual(s.config.horizons, [300, 900, 3600]);
  assert.throws(() =>
    configSchema.parse({ ...DEFAULT_CONFIG, horizons: [300, 300] }),
  );
  assert.throws(() =>
    configSchema.parse({ ...DEFAULT_CONFIG, horizons: [60] }),
  );
});
test("entry is strictly before T-20, never current-round or late catch-up, for every horizon", () => {
  for (const h of [300, 900, 3600]) {
    const t = m.start;
    for (const ms of [-22000, -21000, -20001])
      assert(entryWindow(t * 1000 + ms, t, h));
    for (const ms of [-22001, -20000, -18000, 0, 1000])
      assert(!entryWindow(t * 1000 + ms, t, h));
    assert.equal(nextStart(t * 1000, h), t + h);
  }
});
test("TWAP uses exact decimals and only closes at the next bucket; gaps remain invalid", () => {
  assert.equal(toE18("123.000000000000000001"), "123000000000000000001");
  assert.throws(() => toE18("1e3"));
  const b = new CandleBook();
  for (let t = 0; t < 15000; t += 1000)
    b.push({ at: t + 300000, value: e18(100) }, t + 300000);
  assert.equal(b.snapshot().length, 0);
  b.push({ at: 315000, value: e18(102) }, 315000);
  const c = b.snapshot().find((c) => c.seconds === 15);
  assert(c.complete);
  assert.equal(c.close, e18(100));
  assert.equal(c.high, e18(100));
  assert(!b.push({ at: 315000, value: e18(999) }, 315000));
  assert(!b.push({ at: 319000, value: e18(999) }, 315000));
  for (let t = 320000; t <= 330000; t += 1000)
    b.push({ at: t, value: e18(102) }, t);
  assert.equal(
    b.snapshot().find((c) => c.start === 315000 && c.seconds === 15).complete,
    false,
  );
  const restored = new CandleBook(b.snapshot());
  assert(restored.snapshot().every((c) => c.complete));
  assert(!restored.push({ at: 340000, value: e18(100) }, 344000));
});
test("closed support/body recovery and mirrored resistance qualify across all horizons", () => {
  for (const h of [300, 900, 3600])
    for (const side of ["Up", "Down"]) {
      const f = rejectionFixture(h, m.start, side),
        r = analyze(f.candles, f.latest, h, f.now);
      assert.equal(r.direction, side, r.reason);
      assert(
        r.zones.every((z) => z.touches >= 2 && z.knownAt <= r.candle.start),
      );
    }
});
test("stale, missing, gapped, unclosed, weak and chased signals do not trade", () => {
  for (const change of [
    (f) => (f.latest.at -= 4000),
    (f) => f.candles.pop(),
    (f) => (f.candles[40].complete = false),
    (f) => f.candles.splice(40, 1),
    (f) => (f.candles.at(-1).complete = false),
    (f) => (f.candles.at(-1).close = e18(102)),
    (f) => (f.latest.value = e18(120)),
  ]) {
    const f = structuredClone(fixture);
    change(f);
    assert.equal(analyze(f.candles, f.latest, 300, f.now).direction, null);
  }
});
test("future candles cannot retroactively create or change the decision", () => {
  const f = structuredClone(fixture),
    a = analyze(f.candles, f.latest, 300, now);
  const last = f.candles.at(-1);
  f.candles.push({
    ...last,
    start: now + 60000,
    end: now + 75000,
    low: e18(1),
    close: e18(500),
  });
  assert.deepEqual(analyze(f.candles, f.latest, 300, now), a);
  const lone = f.candles.filter((c) => c.seconds === 60).slice(0, 20);
  assert.equal(zonesFromCandles(lone, BigInt(e18(6))).length, 0);
});
test("paper quote includes crypto fees, depth, minimum size and strict price/spread freshness", () => {
  const q = quoteBuy(book, 1000, DEFAULT_CONFIG, 0.07, 1, now);
  assert(q);
  assert(Math.abs(q.breakEven - 0.5175) < 1e-10);
  assert.equal(q.costMicros, 10000000);
  assert(q.sharesMicros < 20000000);
  for (const edit of [
    (b) => (b.at -= 3000),
    (b) => (b.at += 1000),
    (b) => (b.minShares = 100),
    (b) => (b.asks[0].size = "1"),
    (b) => (b.asks[0].size = "Infinity"),
    (b) => (b.bids[0].price = ".4"),
    (b) => (b.asks[0].price = ".53"),
  ]) {
    const b = structuredClone(book);
    edit(b);
    assert.equal(quoteBuy(b, 1000, DEFAULT_CONFIG, 0.07, 1, now), null);
  }
  assert.equal(quoteBuy(book, 1000, DEFAULT_CONFIG, 0.07, 2, now), null);
});
test("market parsing checks exact round, source, duration, outcomes and final resolution", () => {
  for (const h of [300, 900, 3600]) {
    const f = rejectionFixture(h),
      raw = gammaFixture(f.market),
      parsed = parseMarket(raw, m.start, h);
    assert.equal(parsed.upToken, "111");
    assert.equal(parsed.winner, null);
    raw.outcomePrices = '["0","1"]';
    assert.equal(parseMarket(raw, m.start, h).winner, null);
    raw.closed = true;
    raw.umaResolutionStatus = "resolved";
    assert.equal(parseMarket(raw, m.start, h).winner, "Up");
    raw.outcomePrices = '["1","1"]';
    assert.equal(parseMarket(raw, m.start, h).winner, null);
    assert.throws(() =>
      parseMarket(
        { ...raw, endDate: new Date((m.start + h + 1) * 1000).toISOString() },
        m.start,
        h,
      ),
    );
    assert.throws(() =>
      parseMarket({ ...raw, resolutionSource: "spot" }, m.start, h),
    );
  }
  const raw = gammaFixture(m);
  raw.cryptoMarketConfig.twapLookbackSeconds = 30;
  assert.throws(() => parseMarket(raw, m.start, 300));
  assert.equal(
    marketSlug(m.start, 3600),
    "bitcoin-up-or-down-september-11-2026-10am-et",
  );
});
test("martingale remains per-timeframe, finite, and subordinate to stake caps", () => {
  const c = { ...DEFAULT_CONFIG, martingale: true, maxStakeBp: 1000 };
  assert.equal(nextStake(c, 0), 1000);
  assert.equal(nextStake(c, 3), 8000);
  assert.equal(nextStake(c, 4), null);
  assert.equal(nextStake({ ...c, maxStakeBp: 200 }, 2), null);
  assert.equal(nextStake(DEFAULT_CONFIG, 20), 1000);
});
test("paper losses/wins record net drawdown and losing streak without resetting cash", () => {
  let s = initialState("paper");
  for (const [i, winner] of ["Down", "Down", "Up"].entries()) {
    const f = rejectionFixture(300, m.start + i * 600),
      entry = entered("paper", s, f);
    s = step(
      entry.s,
      { action: "fill", positionId: entry.id, ...entry.q, fills: [] },
      f.now,
    );
    assert.throws(
      () => step(s, { action: "resolve", positionId: entry.id, winner }, f.now),
      /confirmed resolution/,
    );
    const result = reduce(
      s,
      { action: "resolve", positionId: entry.id, winner },
      f.market.end * 1000,
    );
    s = result.state;
    assert.equal(
      result.closed.pnlMicros,
      (winner === "Up" ? entry.q.sharesMicros : 0) - entry.q.costMicros,
    );
  }
  assert.equal(s.trades, 3);
  assert.equal(s.maxLosingStreak, 2);
  assert.equal(s.maxDrawdownMicros, 20000000);
  assert.equal(s.maxWinningStreak, 1);
  assert.equal(s.lossStreaks[300], 0);
  assert.equal(s.lossStreaks[900], 0);
  assert.equal(s.cashMicros, 1e9 + s.pnlMicros);
  s = step(s, { action: "disarm" });
  assert.throws(
    () =>
      step(s, {
        action: "configure",
        config: { ...s.config, bankrollCents: 200000 },
      }),
    /cannot be reset/,
  );
});
test("durable attempt prevents duplicates; unresolved orders and risk caps prevent overlap", () => {
  const { s, id } = entered();
  assert.throws(() => entryGate(s, m, now, true), /already has/);
  const next = rejectionFixture(300, m.start + 300);
  assert.throws(
    () => entryGate(s, next.market, next.now, true),
    /previous position/,
  );
  assert.throws(
    () => step(s, { action: "configure", config: s.config }),
    /Disarm/,
  );
  const paused = step(s, {
    action: "uncertain",
    positionId: id,
    reason: "Interrupted",
  });
  assert.equal(paused.armed, false);
  assert.throws(
    () => step(paused, { action: "arm", confirmVersion: paused.configVersion }),
    /uncertain/,
  );
  const unfilled = step(s, {
    action: "unfilled",
    positionId: id,
    reason: "No fill",
  });
  assert.equal(unfilled.lossStreaks[300], 0);
  assert.throws(() => entryGate(unfilled, m, now, true), /already has/);
  const capped = {
    ...initialState("paper"),
    armed: true,
    daily: {
      day: new Date(now).toISOString().slice(0, 10),
      pnlMicros: -45000000,
    },
  };
  assert.throws(() => entryGate(capped, m, now, true), /Daily/);
});
test("live ARM requires reviewed version and fresh approved wallet, never from deployment", () => {
  const s = initialState("live");
  assert.throws(
    () => step(s, { action: "arm", confirmVersion: 1 }),
    /incomplete/,
  );
  let a = step(s, {
    action: "connection",
    approved: true,
    balanceMicros: 1e9,
    message: "fixture",
  });
  assert.throws(
    () =>
      step(a, { action: "arm", confirmVersion: 2 }, now, { liveAllowed: true }),
    /latest/,
  );
  assert.throws(
    () =>
      step(a, { action: "arm", confirmVersion: 1 }, now + 46000, {
        liveAllowed: true,
      }),
    /incomplete/,
  );
});
test("live fills need exact order/token/receipt totals; paper deadline and modes are enforced", () => {
  let { s, id, q } = entered("live");
  const p = s.positions[0],
    transactionHash = "0x" + "b".repeat(64);
  const fill = {
    id: `${transactionHash}:0`,
    orderId: p.orderId,
    side: "BUY",
    tokenId: "111",
    transactionHash,
    logIndex: 0,
    blockNumber: 1,
    grossMicros: q.costMicros - q.feeMicros,
    sharesMicros: q.sharesMicros,
    feeMicros: q.feeMicros,
    cashMicros: q.costMicros,
    price: ".5",
    tradeIds: ["test"],
  };
  assert.throws(
    () => step(s, { action: "fill", positionId: id, ...q, fills: [] }),
    /executions/,
  );
  assert.throws(
    () =>
      step(s, {
        action: "fill",
        positionId: id,
        ...q,
        fills: [{ ...fill, tokenId: "222" }],
      }),
    /identity/,
  );
  s = step(s, { action: "fill", positionId: id, ...q, fills: [fill] });
  assert.equal(s.cashMicros, 0);
  assert.equal(s.connection.at, 0);
  assert.equal(s.positions[0].status, "open");
  assert.throws(
    () => step(s, { action: "unfilled", positionId: id, reason: "No" }),
    /Filled/,
  );
  const paper = entered();
  assert.throws(
    () =>
      step(paper.s, {
        action: "fill",
        positionId: paper.id,
        ...paper.q,
        fills: [fill],
      }),
    /Paper/,
  );
  assert.throws(
    () =>
      step(
        paper.s,
        { action: "fill", positionId: paper.id, ...paper.q, fills: [] },
        m.start * 1000 - 20000,
      ),
    /deadline/,
  );
});

test("entry countdown advances when the twenty-second deadline has passed", () => {
  for (const h of [300, 900, 3600]) {
    assert.equal(
      nextEntryAt(m.start * 1000 - 20001, h),
      m.start * 1000 - 22000,
    );
    assert.equal(
      nextEntryAt(m.start * 1000 - 20000, h),
      (m.start + h) * 1000 - 22000,
    );
  }
});
