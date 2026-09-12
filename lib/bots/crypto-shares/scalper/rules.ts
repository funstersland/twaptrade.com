import { FRAMES, type Horizon, type Direction } from "./identity.ts";
import type { Candle, Tick } from "./candles.ts";
import type { Config } from "./config.ts";
const max = (a: bigint, b: bigint) => (a > b ? a : b);
const min = (a: bigint, b: bigint) => (a < b ? a : b);
const abs = (n: bigint) => (n < 0n ? -n : n);
const bodyLow = (c: Candle) => min(BigInt(c.open), BigInt(c.close));
const bodyHigh = (c: Candle) => max(BigInt(c.open), BigInt(c.close));
export type Zone = {
  kind: "support" | "resistance";
  value: string;
  width: string;
  touches: number;
  knownAt: number;
};
export type Signal = {
  direction: Direction | null;
  reason: string;
  zones: Zone[];
  candle: Candle | null;
  atr: string | null;
};
export const nextStart = (now: number, horizon: Horizon) =>
  (Math.floor(now / (horizon * 1000)) + 1) * horizon;
export function nextEntryAt(now: number, horizon: Horizon) {
  const start = nextStart(now, horizon);
  return (now >= start * 1000 - 20000 ? start + horizon : start) * 1000 - 22000;
}
// Submit during T-22..T-20, before the twenty-second cutoff.
// Never catch up later or trade the current round; sign before this window.
export const entryWindow = (now: number, start: number, horizon: Horizon) =>
  start === nextStart(now, horizon) &&
  now >= start * 1000 - 22000 &&
  now < start * 1000 - 20000;
export function zonesFromCandles(candles: Candle[], atr: bigint): Zone[] {
  const width = max(1n, (atr * 15n) / 100n);
  const zones: Zone[] = [];
  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i],
      neighbors = [
        candles[i - 2],
        candles[i - 1],
        candles[i + 1],
        candles[i + 2],
      ];
    for (const kind of ["support", "resistance"] as const) {
      const value = kind === "support" ? bodyLow(c) : bodyHigh(c);
      if (
        !neighbors.every((n) =>
          kind === "support" ? value < bodyLow(n) : value > bodyHigh(n),
        )
      )
        continue;
      const existing = zones.find(
        (z) => z.kind === kind && abs(BigInt(z.value) - value) <= width,
      );
      if (existing) {
        existing.touches++;
        existing.knownAt = candles[i + 2].end;
      } else
        zones.push({
          kind,
          value: value.toString(),
          width: width.toString(),
          touches: 1,
          knownAt: candles[i + 2].end,
        });
    }
  }
  return zones.filter((z) => z.touches >= 2);
}
export function analyze(
  candles: Candle[],
  latest: Tick | null,
  horizon: Horizon,
  now: number,
): Signal {
  const result: Signal = {
    direction: null,
    reason: "Warming up complete TWAP candles",
    zones: [],
    candle: null,
    atr: null,
  };
  if (!latest || latest.at > now + 500 || now - latest.at > 3000)
    return { ...result, reason: "Waiting for fresh Chainlink TWAP" };
  const frame = FRAMES[horizon];
  const signals = candles
    .filter((c) => c.seconds === frame.signal && c.end <= now)
    .sort((a, b) => a.start - b.start);
  const rejection = signals.at(-1),
    previous = signals.at(-2);
  if (!rejection || !previous)
    return { ...result, reason: `Waiting for two closed ${frame.signal}s rejection candles` };
  if (!rejection.complete || !previous.complete || previous.end !== rejection.start)
    return { ...result, reason: `Feed gap in the latest ${frame.signal}s candles; waiting for two complete candles` };
  if (now - rejection.end > frame.signal * 1000 + 3000)
    return { ...result, reason: `Latest closed ${frame.signal}s candle is stale` };
  // Levels must be confirmable before the rejection begins, never retroactively.
  const history = candles
    .filter((c) => c.seconds === frame.context && c.end <= rejection.start)
    .sort((a, b) => a.start - b.start)
    .slice(-60);
  // Use the most recent valid consecutive suffix. An older invalid candle must
  // not block a fully recovered 40-candle context or be bridged as valid history.
  let first = history.length;
  while (first > 0) {
    const c = history[first - 1];
    if (!c.complete || (first < history.length && c.end !== history[first].start)) break;
    first--;
  }
  const context = history.slice(first);
  if (context.length < 40)
    return { ...result, reason: `Warming up: ${context.length}/40 consecutive ${frame.context / 60}m candles${first > 0 ? " since the last feed gap" : ""}` };
  if (rejection.start - context.at(-1)!.end >= frame.context * 1000)
    return { ...result, reason: "Structural candle history is stale" };
  const ranges = context
    .slice(-21)
    .slice(1)
    .map((c, i) => {
      const previousClose = BigInt(context.slice(-21)[i].close);
      return max(
        BigInt(c.high) - BigInt(c.low),
        max(
          abs(BigInt(c.high) - previousClose),
          abs(BigInt(c.low) - previousClose),
        ),
      );
    });
  const atr = ranges.reduce((n, v) => n + v, 0n) / BigInt(ranges.length);
  if (atr <= 0n) return { ...result, reason: "Insufficient price movement" };
  const zones = zonesFromCandles(context, atr);
  Object.assign(result, { zones, candle: rejection, atr: atr.toString() });
  const o = BigInt(rejection.open),
    c = BigInt(rejection.close),
    h = BigInt(rejection.high),
    l = BigInt(rejection.low),
    range = h - l;
  if (range <= 0n || abs(c - o) * 100n < range * 25n)
    return { ...result, reason: "Small or indecisive candle body" };
  if (range > atr * 3n)
    return { ...result, reason: "Shock candle: wait for stable structure" };
  const current = BigInt(latest.value),
    prevOpen = BigInt(previous.open),
    prevClose = BigInt(previous.close);
  const displacement =
    BigInt(context.at(-1)!.close) - BigInt(context.at(-6)!.close);
  const candidates: Direction[] = [];
  for (const z of zones) {
    const level = BigInt(z.value),
      width = BigInt(z.width);
    const touched = l <= level + width && h >= level - width;
    if (!touched) continue;
    if (
      z.kind === "support" &&
      c > o &&
      c > level + width &&
      (min(o, c) - l) * 100n >= range * 35n &&
      (c - l) * 100n >= range * 75n &&
      prevClose <= prevOpen &&
      c > (prevOpen + prevClose) / 2n &&
      current >= c - width &&
      current > level + width &&
      abs(current - c) <= atr / 2n &&
      displacement >= -atr * 2n
    )
      candidates.push("Up");
    if (
      z.kind === "resistance" &&
      c < o &&
      c < level - width &&
      (h - max(o, c)) * 100n >= range * 35n &&
      (h - c) * 100n >= range * 75n &&
      prevClose >= prevOpen &&
      c < (prevOpen + prevClose) / 2n &&
      current <= c + width &&
      current < level - width &&
      abs(current - c) <= atr / 2n &&
      displacement <= atr * 2n
    )
      candidates.push("Down");
  }
  const directions = [...new Set(candidates)];
  if (directions.length !== 1)
    return {
      ...result,
      reason: directions.length
        ? "Conflicting rejection signals"
        : "Waiting for a confirmed support/resistance rejection",
    };
  const direction = directions[0];
  const opposing = zones
    .filter((z) => z.kind === (direction === "Up" ? "resistance" : "support"))
    .map((z) =>
      direction === "Up"
        ? BigInt(z.value) - current
        : current - BigInt(z.value),
    )
    .filter((d) => d > 0n);
  if (opposing.some((d) => d < atr))
    return { ...result, reason: "Not enough room before the opposing level" };
  return {
    ...result,
    direction,
    reason:
      direction === "Up"
        ? "Support rejected: bullish body recovery"
        : "Resistance rejected: bearish body recovery",
  };
}
export function nextStake(config: Config, losses: number) {
  if (config.martingale && losses > config.martingaleSteps) return null;
  const cents = config.baseLotCents * (config.martingale ? 2 ** losses : 1);
  return Number.isSafeInteger(cents) &&
    cents <= Math.floor((config.bankrollCents * config.maxStakeBp) / 10000)
    ? cents
    : null;
}
export type Book = {
  at: number;
  tokenId: string;
  minShares: number;
  asks: { price: string; size: string }[];
  bids: { price: string; size: string }[];
};
export function quoteBuy(
  book: Book,
  cents: number,
  config: Config,
  feeRate: number,
  exponent: number,
  now: number,
) {
  if (
    !Number.isSafeInteger(book.at) ||
    !Number.isSafeInteger(cents) ||
    cents <= 0 ||
    book.at > now + 500 ||
    now - book.at > 2000 ||
    !Number.isFinite(feeRate) ||
    feeRate < 0 ||
    feeRate > 0.5 ||
    exponent !== 1 ||
    !Number.isFinite(book.minShares) ||
    book.minShares <= 0
  )
    return null;
  const asks = book.asks
    .map((a) => ({ p: Number(a.price), size: Number(a.size) }))
    .filter(
      (a) =>
        Number.isFinite(a.p) &&
        Number.isFinite(a.size) &&
        a.p > 0 &&
        a.p < 1 &&
        a.size > 0,
    )
    .sort((a, b) => a.p - b.p);
  const bids = book.bids
    .map((b) => Number(b.price))
    .filter((p) => p > 0 && p < 1);
  const best = asks[0]?.p,
    bid = bids.length ? Math.max(...bids) : null;
  if (
    !best ||
    bid === null ||
    bid > best ||
    best - bid > config.maxSpreadCents / 100 + 1e-9
  )
    return null;
  let remaining = cents / 100,
    shares = 0,
    fees = 0,
    maxPrice = 0;
  for (const a of asks) {
    if (a.p > config.maxEntryCents / 100) break;
    const perFee = feeRate * (a.p * (1 - a.p)) ** exponent;
    const q = Math.min(a.size, remaining / (a.p + perFee));
    shares += q;
    fees += q * perFee;
    remaining -= q * (a.p + perFee);
    maxPrice = a.p;
    if (remaining < 1e-6) break;
  }
  if (remaining > 1e-6 || shares < book.minShares) return null;
  return {
    costMicros: cents * 10000,
    sharesMicros: Math.floor(shares * 1e6),
    feeMicros: Math.ceil(fees * 1e6),
    maxPrice: String(maxPrice),
    breakEven: cents / 100 / shares,
  };
}

// Explain a skipped allocation without raising it or weakening execution gates.
export function quoteBuyCheck(book: Book, cents: number, config: Config, feeRate: number, exponent: number, now: number) {
  const quote = quoteBuy(book, cents, config, feeRate, exponent, now);
  if (quote) return { quote, reason: "Executable quote ready" };
  if (book.at > now + 500 || now - book.at > 2000)
    return { quote: null, reason: "Outcome order book is stale" };
  const ask = Math.min(...book.asks.filter(a => Number(a.size) > 0).map(a => Number(a.price)));
  const bid = Math.max(...book.bids.filter(b => Number(b.size) > 0).map(b => Number(b.price)));
  if (!(ask > 0 && ask < 1 && bid > 0 && bid <= ask))
    return { quote: null, reason: "Missing or crossed outcome quotes" };
  if (ask > config.maxEntryCents / 100)
    return { quote: null, reason: `Ask ${(ask * 100).toFixed(1)}¢ exceeds ${config.maxEntryCents}¢ entry limit` };
  if (ask - bid > config.maxSpreadCents / 100 + 1e-9)
    return { quote: null, reason: `Spread ${((ask - bid) * 100).toFixed(1)}¢ exceeds ${config.maxSpreadCents}¢ limit` };
  const perShare = ask + feeRate * (ask * (1 - ask)) ** exponent;
  if (cents / 100 / perShare < book.minShares)
    return { quote: null, reason: `$${(cents / 100).toFixed(2)} lot cannot buy the venue minimum of ${book.minShares} shares at this ask` };
  return { quote: null, reason: "Insufficient depth, minimum shares or unsupported fee schedule" };
}
