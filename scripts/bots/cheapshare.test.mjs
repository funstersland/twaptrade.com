import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_CONFIG,
  configSchema,
} from "../../lib/bots/crypto-shares/cheapshare/config.ts";
import {
  fixed,
  project,
  held,
  scan,
  buyQuote,
  sellQuote,
  stake,
  utcPeriods,
  riskAllowed,
} from "../../lib/bots/crypto-shares/cheapshare/rules.ts";
import {
  initialState,
  reduce,
  exitSignal,
  canEnter,
} from "../../lib/bots/crypto-shares/cheapshare/state.ts";
import { parseMarket, Feeds } from "./cheapshare-market.mjs";
const start = 1789089000,
  now = (start + 120) * 1000;
const f = (n) => fixed(String(n)).toString();
const m = {
  slug: `btc-updown-5m-${start}`,
  pair: "BTC",
  window: 300,
  start,
  end: start + 300,
  conditionId: "0x" + "ab".repeat(32),
  upToken: "123",
  downToken: "456",
  strike: f(100),
  strikeSource: "chainlink-open",
  feeRate: 0.07,
  feeExponent: 1,
};
function observation() {
  return {
    now,
    end: m.end * 1000,
    strike: m.strike,
    twap: Array.from({ length: 61 }, (_, n) => ({
      at: now - 60000 + n * 1000,
      value: f((99.88 + n / 3000).toFixed(8)),
    })),
    spot: Array.from({ length: 41 }, (_, n) => ({
      at: now - 20000 + n * 500,
      bid: f(100.19),
      ask: f(100.21),
    })),
    up: {
      at: now,
      bids: [{ price: ".19".replace(".", "0."), size: "10000" }],
      asks: [{ price: "0.21", size: "10000" }],
    },
    down: {
      at: now,
      bids: [{ price: "0.78", size: "10000" }],
      asks: [{ price: "0.80", size: "10000" }],
    },
  };
}
function evaluate(i = observation(), c = structuredClone(DEFAULT_CONFIG)) {
  return scan({ ...i, config: c, preset: c.presets["BTC:300"] });
}
function armed() {
  return reduce(
    initialState("paper"),
    { action: "arm", confirmVersion: null },
    now,
  ).state;
}
function entered() {
  const id = randomUUID(),
    orderId = randomUUID();
  let s = reduce(
    armed(),
    {
      action: "entry",
      positionId: id,
      orderId,
      market: m,
      observation: observation(),
    },
    now,
  ).state;
  s = reduce(s, { action: "submit", positionId: id, orderId }, now).state;
  const q = buyQuote(
    observation().up.asks,
    s.positions[0].stake,
    0.28,
    0.07,
    1,
  );
  const fill = {
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
  s = reduce(
    s,
    { action: "fill", positionId: id, orderId, fills: [fill] },
    now,
  ).state;
  return { s, id };
}
test("default configuration is paper, disarmed, no martingale or Setup B; all 12 presets", () => {
  const s = initialState("paper");
  assert.equal(s.armed, false);
  assert.equal(s.config.martingale, false);
  assert.equal(s.config.setupB, false);
  assert.equal(Object.keys(s.config.presets).length, 12);
  assert.throws(() => configSchema.parse({ ...DEFAULT_CONFIG, presets: {} }));
});
test("reference scenario satisfies every crowd, lead, hold, projector, slope, wick and book gate", () => {
  assert.equal(evaluate().eligible, true);
  assert.equal(evaluate().side, "Up");
});
test("missing strike, stale/future books and feed gaps never produce entries", () => {
  for (const mutate of [
    (i) => (i.strike = null),
    (i) => (i.up.at = now - 4000),
    (i) => (i.down.at = now + 1000),
    (i) => (i.spot.at(-1).at = now - 2000),
    (i) => i.twap.splice(30, 10),
  ]) {
    const i = observation();
    mutate(i);
    assert.equal(evaluate(i).eligible, false);
  }
});
test("no current crowd, short hold, adverse TWAP slope, wick and wide spread block entries", () => {
  for (const mutate of [
    (i) => (i.twap = i.twap.map((p) => ({ ...p, value: f(100) }))),
    (i) => (i.spot = i.spot.slice(-3)),
    (i) => (i.twap.at(-1).value = f(99.7)),
    (i) => (i.spot.at(-2).bid = f(100.01)),
    (i) => (i.up.bids[0].price = "0.10"),
  ]) {
    const i = observation();
    mutate(i);
    assert.equal(evaluate(i).eligible, false);
  }
});
test("entry timing and conservative projector boundaries", () => {
  const p = project(f(99.9), f(100.19), f(100), "Up", 60000, 3);
  assert(p.clear);
  assert(p.needMs > 26000 && p.needMs < 27000);
  assert(!project(f(99.9), f(100.19), f(100), "Up", 1000, 3).clear);
  const i = observation();
  i.end = now + 1000;
  assert(!evaluate(i).eligible);
  assert(!project(f(100.1), f(100.2), f(100), "Down", 60000, 3).clear);
});
test("opposite side is selected symmetrically", () => {
  const i = observation();
  i.twap = i.twap.map((p) => ({
    ...p,
    value: (fixed("200") - BigInt(p.value)).toString(),
  }));
  i.spot = i.spot.map((p) => ({ ...p, bid: f(99.79), ask: f(99.81) }));
  [i.up, i.down] = [i.down, i.up];
  const r = evaluate(i);
  assert(r.eligible);
  assert.equal(r.side, "Down");
});
test("Setup B is opt-in and uses lower sizing; decided markets skip", () => {
  const i = observation(),
    c = structuredClone(DEFAULT_CONFIG);
  i.up.asks[0].price = "0.10";
  i.up.bids[0].price = "0.09";
  assert(!evaluate(i, c).eligible);
  c.setupB = true;
  assert.equal(evaluate(i, c).setup, "B");
  assert(evaluate(i, c).eligible);
  assert(stake(c, "B", 0) < stake(c, "A", 0));
  i.down.bids[0].price = "0.95";
  i.twap = i.twap.map((p) => ({ ...p, value: f(99) }));
  assert(!evaluate(i, c).eligible);
});
test("hold resets on a crossing and refuses gaps", () => {
  const points = [0, 1000, 2000, 3000, 4000].map((at) => ({ at, value: "1" }));
  assert(held(points, 4000, 3000, () => true, 1500));
  points[2].value = "0";
  assert(!held(points, 4000, 3000, (p) => p.value === "1", 1500));
  assert(!held([points[0], points[4]], 4000, 3000, () => true, 1500));
});
test("paper books walk actual depth with fees and reject insufficient liquidity", () => {
  assert.equal(
    buyQuote([{ price: "0.21", size: "1" }], 10000000, 0.28, 0.07, 1),
    null,
  );
  assert.equal(
    buyQuote([{ price: "0.29", size: "1000" }], 10000000, 0.28, 0.07, 1),
    null,
  );
  const q = buyQuote(
    [
      { price: "0.20", size: "10" },
      { price: "0.25", size: "100" },
    ],
    10000000,
    0.28,
    0.07,
    1,
  );
  assert.equal(q.cashMicros, 10000000);
  assert(q.feeMicros > 0);
  assert.equal(q.cashMicros, q.grossMicros + q.feeMicros);
  const sell = sellQuote(
    [{ price: "0.55", size: "100" }],
    10000000,
    0.55,
    0.07,
    1,
  );
  assert.equal(sell.grossMicros, 5500000);
  assert.equal(sell.cashMicros, 5500000 - sell.feeMicros);
  assert.equal(
    sellQuote([{ price: "0.54", size: "100" }], 10000000, 0.55, 0.07, 1),
    null,
  );
});
test("risk reserves concurrent positions and day/week worst case; martingale is bounded", () => {
  const c = structuredClone(DEFAULT_CONFIG);
  assert(riskAllowed(c, 10000000, 10000000, 1000000000, 0, 0, 1));
  assert(!riskAllowed(c, 10000000, 0, 1000000000, 0, 0, 2));
  assert(!riskAllowed(c, 10000000, 0, 1000000000, -25000000, 0, 0));
  assert(!riskAllowed(c, 10000000, 0, 1000000000, 0, -75000000, 0));
  assert(!riskAllowed(c, 10000000, 0, 9999999, 0, 0, 0));
  c.martingale = true;
  assert.equal(stake(c, "A", 1), 20000000);
  assert.equal(stake(c, "A", 4), null);
  assert.equal(
    utcPeriods(Date.parse("2026-09-13T23:59:59Z")).week,
    "2026-09-07T00:00:00.000Z",
  );
});
test("ARM blocks entry and submit, and live requires version confirmation and a verified region/wallet", () => {
  const c = {
    action: "entry",
    positionId: randomUUID(),
    orderId: randomUUID(),
    market: m,
    observation: observation(),
  };
  assert.throws(() => reduce(initialState("paper"), c, now), /ARM/);
  let s = reduce(armed(), c, now).state;
  s = reduce(s, { action: "disarm" }, now).state;
  assert.throws(
    () =>
      reduce(
        s,
        { action: "submit", positionId: c.positionId, orderId: c.orderId },
        now,
      ),
    /ARM/,
  );
  const live = initialState("live");
  assert.throws(
    () => reduce(live, { action: "arm", confirmVersion: 1 }, now, false),
    /unavailable/,
  );
  assert.throws(
    () => reduce(live, { action: "arm", confirmVersion: 1 }, now, true),
    /Wallet/,
  );
  assert.throws(
    () => reduce(live, { action: "arm", confirmVersion: 2 }, now, true),
    /Review/,
  );
});
test("fills debit paper cash once and duplicated/wrong-wallet evidence cannot change it", () => {
  const { s, id } = entered();
  assert.equal(s.cash, 990000000);
  assert.equal(s.positions[0].fills.length, 1);
  assert.throws(
    () =>
      reduce(
        s,
        {
          action: "fill",
          positionId: id,
          orderId: s.positions[0].fills[0].orderId,
          fills: s.positions[0].fills,
        },
        now,
      ),
    /Order/,
  );
  assert.throws(
    () => reduce(s, { action: "configure", config: DEFAULT_CONFIG }, now),
    /Disarm/,
  );
  assert(
    !canEnter(
      {
        ...s,
        positions: [...s.positions, { ...s.positions[0], id: randomUUID() }],
      },
      10000000,
      now,
    ),
  );
});
test("scales sell 40%, 30%, then remainder, with exact own-position net P/L", () => {
  let { s, id } = entered();
  const initialShares = s.positions[0].shares,
    cost = s.positions[0].cost;
  let proceeds = 0;
  for (const [bid, purpose] of [
    [0.55, "scale55"],
    [0.75, "scale75"],
    [0.88, "take88"],
  ]) {
    const i = observation();
    i.up.bids = [{ price: String(bid), size: "10000" }];
    i.up.asks = [{ price: String(bid + 0.01), size: "10000" }];
    const p = s.positions[0],
      sig = exitSignal(p, i, s.config);
    assert.equal(sig.purpose, purpose);
    assert.equal(
      sig.shares,
      purpose === "scale55"
        ? Math.floor(initialShares * 0.4)
        : purpose === "scale75"
          ? Math.floor(initialShares * 0.3)
          : initialShares - p.sold,
    );
    const orderId = randomUUID();
    s = reduce(
      s,
      {
        action: "exit",
        positionId: id,
        orderId,
        purpose,
        shares: sig.shares,
        limit: bid,
        observation: i,
      },
      now,
    ).state;
    s = reduce(s, { action: "submit", positionId: id, orderId }, now).state;
    const q = sellQuote(i.up.bids, sig.shares, bid, m.feeRate, m.feeExponent);
    proceeds += q.cashMicros;
    const result = reduce(
      s,
      {
        action: "fill",
        positionId: id,
        orderId,
        fills: [
          {
            ...q,
            id: `paper:${orderId}`,
            orderId,
            side: "SELL",
            tokenId: "123",
            transactionHash: null,
            logIndex: 0,
            blockNumber: 0,
            tradeIds: [],
          },
        ],
      },
      now,
    );
    s = result.state;
    if (purpose === "take88") assert.equal(result.closed.pnl, proceeds - cost);
  }
  assert.equal(s.positions.length, 0);
  assert.equal(s.cash, 1000000000 - cost + proceeds);
  assert.equal(s.pnl, proceeds - cost);
  assert.equal(s.wins, 1);
});
test("emergency and late window exit rules override scales; disarming never sells", () => {
  const { s } = entered(),
    p = s.positions[0],
    i = observation();
  i.spot = i.spot.map((q) => ({ ...q, bid: f(99.8), ask: f(99.82) }));
  assert.equal(exitSignal(p, i, s.config).purpose, "emergency");
  const paused = reduce(s, { action: "disarm" }, now).state;
  assert.throws(
    () =>
      reduce(
        paused,
        {
          action: "exit",
          positionId: p.id,
          orderId: randomUUID(),
          purpose: "emergency",
          shares: p.shares,
          limit: 0.19,
          observation: i,
        },
        now,
      ),
    /ARM/,
  );
});
test("settlement only after expiry, uncertain orders block settlement and inventory mismatch blocks invented P/L", () => {
  let { s, id } = entered();
  assert.throws(
    () => reduce(s, { action: "resolve", positionId: id, winner: "Up" }, now),
    /settlement/,
  );
  let t = reduce(s, { action: "inventory", positionId: id }, now).state;
  assert.throws(
    () =>
      reduce(
        t,
        { action: "resolve", positionId: id, winner: "Up" },
        m.end * 1000 + 1,
      ),
    /settlement/,
  );
  const lost = reduce(
    s,
    { action: "resolve", positionId: id, winner: "Down" },
    m.end * 1000 + 1,
  );
  assert.equal(lost.state.losses, 1);
  assert.equal(lost.closed.pnl, -10000000);
  assert.equal(lost.state.lossStreak, 1);
  assert.throws(
    () =>
      reduce(
        lost.state,
        { action: "resolve", positionId: id, winner: "Down" },
        m.end * 1000 + 2,
      ),
    /not found/,
  );
});
test("TWAP opening fallback uses exact boundary, not first tick after it; out-of-order ticks ignored", () => {
  const start = Math.floor(Date.now() / 300000) * 300 - 300;
  const feeds = new Feeds();
  feeds.addTwap({
    symbol: "btc/usd",
    windowSeconds: 60,
    timestamp: start * 1000 + 1,
    value: "100",
  });
  assert.equal(feeds.opening.size, 0);
  feeds.addTwap({
    symbol: "btc/usd",
    windowSeconds: 60,
    timestamp: (start + 300) * 1000,
    value: "101",
  });
  assert.equal(feeds.opening.get(`BTC:300:${start + 300}`), f(101));
  feeds.addTwap({
    symbol: "btc/usd",
    windowSeconds: 60,
    timestamp: (start + 300) * 1000 - 1,
    value: "99",
  });
  assert.equal(feeds.twap.get("BTC").at(-1).value, f(101));
});
test("Gamma rejects changed source, wrong pair, wrong window and premature settlement", () => {
  const raw = {
    slug: m.slug,
    eventStartTime: new Date(start * 1000).toISOString(),
    endDate: new Date(m.end * 1000).toISOString(),
    negRisk: false,
    cryptoMarketConfig: {
      asset: "btc",
      duration: "5m",
      twapEnabled: true,
      twapLookbackSeconds: 60,
    },
    resolutionSource:
      "https://data.chain.link/streams/btc-usd-twap-60s-streams",
    outcomes: '["Up","Down"]',
    clobTokenIds: '["123","456"]',
    outcomePrices: '["1","0"]',
    feesEnabled: false,
    conditionId: m.conditionId,
    closed: true,
    umaResolutionStatus: "proposed",
  };
  assert.equal(parseMarket(raw, "BTC", 300, start).winner, null);
  assert.throws(() =>
    parseMarket({ ...raw, resolutionSource: "unknown" }, "BTC", 300, start),
  );
  assert.throws(() => parseMarket(raw, "ETH", 300, start));
  assert.throws(() => parseMarket(raw, "BTC", 900, start));
  assert.equal(
    parseMarket({ ...raw, umaResolutionStatus: "resolved" }, "BTC", 300, start)
      .winner,
    "Up",
  );
});
