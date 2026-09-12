import { createPublicClient } from "@polymarket/client";
import { fixed } from "../../lib/bots/crypto-shares/cheapshare/rules.ts";
import { PAIRS } from "../../lib/bots/crypto-shares/cheapshare/identity.ts";
export async function readJSON(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw Error(`Public feed unavailable (${r.status})`);
  return r.json();
}
export function parseMarket(m, pair, window, start) {
  const slug = `${pair.toLowerCase()}-updown-${window / 60}m-${start}`;
  if (
    m.slug !== slug ||
    Date.parse(m.eventStartTime) !== start * 1000 ||
    Date.parse(m.endDate) !== (start + window) * 1000 ||
    m.negRisk === true ||
    m.cryptoMarketConfig?.asset !== pair.toLowerCase() ||
    m.cryptoMarketConfig?.duration !== `${window / 60}m` ||
    m.cryptoMarketConfig?.twapEnabled !== true ||
    m.cryptoMarketConfig?.twapLookbackSeconds !== 60 ||
    m.resolutionSource !==
      `https://data.chain.link/streams/${pair.toLowerCase()}-usd-twap-60s-streams`
  )
    throw Error("Unsupported or changed market resolution rules");
  const outcomes = JSON.parse(m.outcomes),
    tokens = JSON.parse(m.clobTokenIds),
    prices = JSON.parse(m.outcomePrices);
  if (
    outcomes.length !== 2 ||
    !outcomes.includes("Up") ||
    !outcomes.includes("Down") ||
    tokens.length !== 2 ||
    tokens.some((t) => !/^\d+$/.test(t))
  )
    throw Error("Invalid outcome tokens");
  const feeRate = m.feesEnabled ? Number(m.feeSchedule?.rate) : 0,
    feeExponent = m.feesEnabled ? Number(m.feeSchedule?.exponent) : 1;
  if (!Number.isFinite(feeRate) || !Number.isFinite(feeExponent))
    throw Error("Fee schedule missing");
  // Only an explicit PTB field is accepted; never infer the strike from a spot quote.
  const official = m.priceToBeat ?? m.eventMetadata?.priceToBeat;
  let strike = null;
  if (
    official !== undefined &&
    official !== null &&
    /^\d+(\.\d+)?$/.test(String(official)) &&
    Number(official) > 0
  )
    strike = fixed(String(official)).toString();
  const winning = outcomes.filter((_, i) => Number(prices[i]) === 1);
  return {
    slug,
    pair,
    window,
    windowSeconds: 60,
    start,
    end: start + window,
    conditionId: m.conditionId,
    upToken: tokens[outcomes.indexOf("Up")],
    downToken: tokens[outcomes.indexOf("Down")],
    feeRate,
    feeExponent,
    officialStrike: strike,
    accepting: !!m.acceptingOrders && !m.closed,
    winner:
      m.closed && m.umaResolutionStatus === "resolved" && winning.length === 1
        ? winning[0]
        : null,
  };
}
export async function marketAt(pair, window, start) {
  return parseMarket(
    await readJSON(
      `https://gamma-api.polymarket.com/markets/slug/${pair.toLowerCase()}-updown-${window / 60}m-${start}`,
    ),
    pair,
    window,
    start,
  );
}
export async function orderBook(token) {
  const b = await readJSON(
    `https://clob.polymarket.com/book?token_id=${token}`,
  );
  if (b.asset_id !== token || !Array.isArray(b.asks) || !Array.isArray(b.bids))
    throw Error("Order book mismatch");
  return { at: Number(b.timestamp), bids: b.bids, asks: b.asks };
}
export class Feeds {
  constructor() {
    this.twap = new Map();
    this.oracle = new Map();
    this.continuity = new Map();
    this.spot = new Map();
    this.available = new Set();
    this.opening = new Map();
    this.stopped = false;
    this.socket = null;
    this.hypeAvailable = false;
    this.stream = null;
  }
  observe(key, at, maxGap) {
    const old = this.continuity.get(key);
    if (!old || at - old.last > maxGap) this.continuity.set(key, { since: at, last: at });
    else if (at > old.last) old.last = at;
  }
  addOracle(p) {
    const pair = p.symbol?.split("/")[0]?.toUpperCase();
    if (!PAIRS.includes(pair)) return;
    const at = Number(p.timestamp), value = fixed(String(p.value)).toString();
    const points = this.oracle.get(pair) || [];
    if (!Number.isSafeInteger(at) || at > Date.now() + 1000 || BigInt(value) <= 0n || points.at(-1)?.at >= at) return;
    this.observe(`oracle:${pair}`, at, 2500);
    points.push({ at, value });
    this.oracle.set(pair, points.filter(q => q.at >= at - 125000).slice(-1000));
  }
  addTwap(p) {
    const pair = p.symbol?.split("/")[0]?.toUpperCase();
    if (!PAIRS.includes(pair) || p.windowSeconds !== 60) return;
    const at = Number(p.timestamp),
      value = fixed(p.value).toString(),
      points = this.twap.get(pair) || [];
    if (
      at > Date.now() + 1000 ||
      BigInt(value) <= 0n ||
      points.at(-1)?.at >= at
    )
      return;
    this.observe(`twap:${pair}`, at, 2500);
    points.push({ at, value });
    this.twap.set(pair, points.filter((p) => p.at >= at - 125000).slice(-500));
    for (const w of [300, 900])
      if (at % (w * 1000) === 0)
        this.opening.set(`${pair}:${w}:${at / 1000}`, value);
    for (const k of this.opening.keys())
      if (Number(k.split(":")[2]) < Date.now() / 1000 - 1800)
        this.opening.delete(k);
  }
  addSpot(q, pair = q.s?.replace(/USDT$/, "")) {
    if (!this.available.has(pair) && !(pair === "HYPE" && this.hypeAvailable)) return;
    const at = q.at ?? Date.now(),
      bid = fixed(q.b).toString(),
      ask = fixed(q.a).toString();
    if (!Number.isSafeInteger(at) || at > Date.now() + 500 || Date.now() - at > 1500 || BigInt(bid) <= 0n || BigInt(ask) < BigInt(bid)) return;
    const points = this.spot.get(pair) || [];
    const previous = points.at(-1);
    if (previous?.at > at || (previous?.at === at && q.u === undefined) || (q.u !== undefined && previous?.sequence >= q.u)) return;
    if (previous?.at === at) points.pop();
    this.observe(`spot:${pair}`, at, 1500);
    points.push({ at, bid, ask, sequence: q.u ?? previous?.sequence });
    this.spot.set(pair, points.filter((p) => p.at >= at - 20000).slice(-10000));
  }
  async refreshSpotSnapshots(fetcher = fetch) {
    // bookTicker streams report changes, not periodic heartbeats. Independently
    // verify quiet quotes through a fresh REST read; never refresh a cached quote.
    await Promise.allSettled([...this.available].filter(pair => pair !== "HYPE").map(async pair => {
      const at = Date.now();
      if (at - (this.spot.get(pair)?.at(-1)?.at || 0) < 500) return;
      const response = await fetcher(`https://api.binance.com/api/v3/ticker/bookTicker?symbol=${pair}USDT`, {
        cache: "no-store", signal: AbortSignal.timeout(1000),
      });
      if (!response.ok || Number(response.headers.get("age") || 0) > 0) return;
      const q = await response.json();
      if (q.symbol !== `${pair}USDT` || Date.now() - at > 1000) return;
      // A WebSocket tick received during this request wins over its older read.
      this.addSpot({ at, b: q.bidPrice, a: q.askPrice }, pair);
    }));
  }
  async spotSnapshots() {
    while (!this.stopped) {
      const at = Date.now();
      await this.refreshSpotSnapshots();
      if (!this.stopped) await new Promise(resolve => setTimeout(resolve, Math.max(50, 500 - (Date.now() - at))));
    }
  }
  async chainlink() {
    const client = createPublicClient();
    while (!this.stopped) {
      try {
        this.stream = await client.subscribe([
          { topic: "prices.crypto.chainlink", symbols: PAIRS.map(p => `${p.toLowerCase()}/usd`) },
          {
            topic: "prices.crypto.chainlink.twap",
            windowSeconds: 60,
            symbols: PAIRS.map((p) => `${p.toLowerCase()}/usd`),
          },
        ]);
        for await (const e of this.stream) {
          try {
            if (e.topic === "prices.crypto.chainlink.twap") this.addTwap(e.payload);
            else if (e.topic === "prices.crypto.chainlink") this.addOracle(e.payload);
          } catch {}
          if (this.stopped) break;
        }
      } catch {}
      if (!this.stopped) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  async binance() {
    while (!this.stopped) {
      try {
        const checked = await Promise.allSettled(
          PAIRS.map(async (p) => {
            const d = await readJSON(
              `https://api.binance.com/api/v3/exchangeInfo?symbol=${p}USDT`,
            );
            return d.symbols?.some(
              (s) =>
                s.symbol === `${p}USDT` &&
                s.status === "TRADING" &&
                s.isSpotTradingAllowed,
            )
              ? p
              : null;
          }),
        );
        this.available = new Set(
          checked
            .filter((r) => r.status === "fulfilled" && r.value)
            .map((r) => r.value),
        );
        if (!this.available.size) throw Error("No Binance spot markets");
        this.spot.clear();
        await new Promise((resolve) => {
          const ws = new WebSocket(
            `wss://stream.binance.com:9443/stream?streams=${[...this.available].map((p) => `${p.toLowerCase()}usdt@bookTicker`).join("/")}`,
          );
          this.socket = ws;
          let last = Date.now();
          const watchdog = setInterval(() => {
            if (this.stopped || Date.now() - last > 10000) ws.close();
          }, 2000);
          ws.onmessage = (e) => {
            last = Date.now();
            try {
              this.addSpot(JSON.parse(e.data).data);
            } catch {}
          };
          ws.onerror = () => ws.close();
          ws.onclose = () => {
            clearInterval(watchdog);
            resolve();
          };
        });
      } catch {}
      if (!this.stopped) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  async hyperliquid() {
    while (!this.stopped) {
      try {
        const response = await fetch("https://api.hyperliquid.xyz/info", { method: "POST",
          headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "spotMeta" }), signal: AbortSignal.timeout(4000) });
        if (!response.ok) throw Error("HYPE spot metadata unavailable");
        const meta = await response.json();
        const hypes = meta.tokens.filter(t => t.name === "HYPE"), dollars = meta.tokens.filter(t => t.name === "USDC");
        if (hypes.length !== 1 || dollars.length !== 1) throw Error("Ambiguous HYPE spot identity");
        const pairs = meta.universe.filter(p => p.tokens[0] === hypes[0].index && p.tokens[1] === dollars[0].index);
        if (pairs.length !== 1) throw Error("HYPE/USDC spot market unavailable");
        const coin = pairs[0].name;
        while (!this.stopped) {
          const begun = Date.now();
          const response = await fetch("https://api.hyperliquid.xyz/info", { method: "POST",
            headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "l2Book", coin }), signal: AbortSignal.timeout(2500) });
          if (!response.ok) throw Error("HYPE spot snapshot unavailable");
          const q = await response.json();
          if (q.coin !== coin || !q.levels?.[0]?.[0] || !q.levels?.[1]?.[0]) throw Error("Invalid HYPE spot snapshot");
          this.hypeAvailable = true;
          this.addSpot({ b: q.levels[0][0].px, a: q.levels[1][0].px, u: q.time, at: q.time }, "HYPE");
          await new Promise(resolve => setTimeout(resolve, Math.max(10, 1000-(Date.now()-begun))));
        }
      } catch { this.hypeAvailable = false; }
      if (!this.stopped) await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  start() {
    void this.chainlink();
    void this.binance();
    void this.spotSnapshots();
    void this.hyperliquid();
  }
  stop() {
    this.stopped = true;
    this.socket?.close();
    void this.stream?.close?.();
  }
  observation(m, books, now = Date.now()) {
    return {
      now,
      start: m.start * 1000,
      windowSeconds: m.windowSeconds,
      watchingSince: ["twap", "spot", "oracle"].every(k => this.continuity.has(`${k}:${m.pair}`))
        ? Math.max(...["twap", "spot", "oracle"].map(k => this.continuity.get(`${k}:${m.pair}`).since)) : null,
      oracle: this.oracle.get(m.pair) || [],
      end: m.end * 1000,
      strike: m.strike,
      twap: this.twap.get(m.pair) || [],
      spot: (this.spot.get(m.pair) || []).map(({ at, bid, ask }) => ({
        at,
        bid,
        ask,
      })),
      up: books.up,
      down: books.down,
    };
  }
}
