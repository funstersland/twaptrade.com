import type { Config, Preset } from "./config.ts";
import type { Direction } from "./identity.ts";
import { bucketProjection } from "./bucket.ts";
export type Point = { at: number; value: string };
export type Quote = { at: number; bid: string; ask: string };
export type Level = { price: string; size: string };
export const E18 = 10n ** 18n;
export function fixed(value: string, decimals = 18): bigint {
  if (!/^\d+(\.\d+)?$/.test(value)) throw Error("Invalid positive decimal");
  const [w, f = ""] = value.split(".");
  return (
    BigInt(w) * 10n ** BigInt(decimals) +
    BigInt(f.padEnd(decimals, "0").slice(0, decimals))
  );
}
export function decimal(value: bigint, places = 18) {
  const unit = 10n ** BigInt(places);
  return `${value / unit}.${(value % unit).toString().padStart(places, "0")}`;
}
export const directionSign = (side: Direction) => (side === "Up" ? 1n : -1n);
export function bpGap(value: string, reference: string) {
  return (
    Number(
      ((BigInt(value) - BigInt(reference)) * 1000000n) / BigInt(reference),
    ) / 100
  );
}
export function beyond(
  value: string,
  reference: string,
  side: Direction,
  bp = 0,
) {
  return (
    (BigInt(value) - BigInt(reference)) * directionSign(side) * 10000n >=
    BigInt(reference) * BigInt(bp)
  );
}
export function held(
  points: Point[],
  now: number,
  duration: number,
  predicate: (p: Point) => boolean,
  maxGap = 3000,
) {
  const start = now - duration,
    anchor = points.findLastIndex((p) => p.at <= start);
  if (anchor < 0) return false;
  const relevant = points.slice(anchor);
  if (now - relevant.at(-1)!.at > maxGap || relevant[0].at < start - maxGap)
    return false;
  return relevant.every(
    (p, i) =>
      p.at <= now &&
      predicate(p) &&
      (i === 0 ||
        (p.at >= relevant[i - 1].at && p.at - relevant[i - 1].at <= maxGap)),
  );
}
export function top(levels: Level[], side: "bid" | "ask") {
  const v = levels
    .filter((x) => Number(x.size) > 0)
    .map((x) => Number(x.price))
    .filter((x) => x > 0 && x < 1);
  return v.length ? (side === "bid" ? Math.max(...v) : Math.min(...v)) : null;
}
export type ScanInput = {
  now: number;
  start: number;
  end: number;
  watchingSince: number | null;
  windowSeconds: 30 | 60;
  strike: string | null;
  twap: Point[];
  oracle: Point[];
  spot: Quote[];
  up: { bids: Level[]; asks: Level[]; at: number };
  down: { bids: Level[]; asks: Level[]; at: number };
  preset: Preset;
  config: Config;
};
export function scan(i: ScanInput) {
  const gates: { name: string; ok: boolean }[] = [];
  const gate = (name: string, ok: boolean) => { gates.push({ name, ok }); return ok; };
  let side: Direction | null = null, setup: "flip" | null = null;
  let ask: number | null = null;
  let bucket: ReturnType<typeof bucketProjection> | null = null;
  let impulseFrom: string | null = null;
  const result = () => ({
    eligible: gates.every(g => g.ok), side, setup, ask, impulseFrom,
    projection: bucket?.available ? bucket.projected : null,
    headroom: bucket?.available ? bucket.headroom : null,
    requiredSpot: bucket?.available ? bucket.requiredSpot : null,
    conservativeSpot: bucket?.available ? bucket.conservativeSpot : null,
    modelError: bucket?.available ? bucket.modelError : null,
    windowSeconds: i.windowSeconds,
    secondsLeft: Math.max(0, (i.end - i.now) / 1000),
    gates, reason: gates.find(g => !g.ok)?.name || "Entry eligible",
  });
  gate("Pair/window enabled", i.preset.enabled);
  gate("News block off", !i.config.newsBlocked);
  gate("Watching this round from its opening", i.watchingSince !== null && i.watchingSince <= i.start + 2000 && i.now >= i.start);
  if (!gate("Price-to-Beat locked", !!i.strike && BigInt(i.strike) > 0n)) return result();
  const r = i.strike!, t = i.twap.at(-1), b = i.spot.at(-1), c = i.oracle.at(-1);
  if (!gate("Fresh Chainlink, spot and executable books", !!t && !!b && !!c &&
    i.now - t.at <= 2500 && i.now - c.at <= 2500 && i.now - b.at <= 1500 &&
    i.now - i.up.at <= 3000 && i.now - i.down.at <= 3000 &&
    t.at <= i.now && c.at <= i.now && b.at <= i.now &&
    i.up.at <= i.now + 500 && i.down.at <= i.now + 500)) return result();
  if (!gate("TWAP still has an established winning side", t!.value !== r)) return result();
  side = BigInt(t!.value) < BigInt(r) ? "Up" : "Down";
  setup = "flip";
  const leader: Direction = side === "Up" ? "Down" : "Up";
  const baselineAt = i.now - i.preset.impulseSeconds * 1000;
  const baseline = i.spot.findLast(p => p.at <= baselineAt);
  const pastTwap = i.twap.filter(p => p.at <= baselineAt);
  gate("A winner was established before the impulse", baselineAt - i.preset.leaderSeconds * 1000 >= i.start &&
    held(pastTwap, baselineAt, i.preset.leaderSeconds * 1000,
      p => (BigInt(p.value) - BigInt(r)) * directionSign(leader) > 0n, 2500));
  if (!gate("Spot baseline is available", !!baseline && baselineAt - baseline.at <= 1500)) return result();
  impulseFrom = side === "Up" ? baseline!.ask : baseline!.bid;
  const current = side === "Up" ? b!.bid : b!.ask;
  const distance = (BigInt(r) - BigInt(impulseFrom)) * directionSign(side);
  const change = (BigInt(current) - BigInt(impulseFrom)) * directionSign(side);
  gate("A sudden move reverses the previous spot direction", distance > 0n && change > 0n &&
    change * 1000n >= distance * BigInt(Math.round(i.preset.impulseMultiple * 1000)));
  gate("Spot holds beyond the strike", held(i.spot.map(p => ({ at: p.at, value: side === "Up" ? p.bid : p.ask })),
    i.now, i.preset.holdSeconds * 1000, p => (BigInt(p.value) - BigInt(r)) * directionSign(side!) > 0n, 1500));
  gate("Chainlink spot confirms the reversal", (BigInt(c!.value) - BigInt(r)) * directionSign(side) > 0n);
  gate("Time remains to execute", i.end - i.now > i.preset.timeBufferSeconds * 1000);
  bucket = bucketProjection({ now: i.now, end: i.end, windowSeconds: i.windowSeconds, reference: r,
    side, twap: t!, oracle: i.oracle, spot: current, impulseFrom,
    retreatPct: i.preset.retreatPct, clearBufferBp: i.preset.clearBufferBp,
    maxModelErrorBp: i.preset.maxModelErrorBp, latencyMs: i.preset.timeBufferSeconds * 1000 });
  gate(bucket.reason, bucket.available && bucket.clear);
  const book = side === "Up" ? i.up : i.down;
  ask = top(book.asks, "ask");
  const bid = top(book.bids, "bid");
  gate("Executable entry and exit quotes", ask !== null && bid !== null && bid <= ask);
  return result();
}

// The price limit follows actual depth; there is no fixed cheap-share price band.
export function entryPlan(config: Config, book: { asks: Level[]; bids: Level[] }, budget: number,
  feeRate: number, exponent: number) {
  const bid = top(book.bids, "bid"), ask = top(book.asks, "ask");
  if (bid === null || ask === null || bid > ask) return { ok: false as const, reason: "Invalid or crossed order book" };
  const quote = buyQuote(book.asks, budget, 0.999999, feeRate, exponent);
  if (!quote) return { ok: false as const, reason: "Insufficient ask depth for this allocation" };
  let cash = budget / 1e6, limit = 0;
  for (const l of [...book.asks].sort((a,b) => Number(a.price) - Number(b.price))) {
    const p = Number(l.price), size = Number(l.size);
    if (!(p > 0 && p < 1 && size > 0)) continue;
    cash -= Math.min(size, cash / (p + feeRate * (p * (1-p)) ** exponent)) * (p + feeRate * (p * (1-p)) ** exponent);
    limit = p;
    if (cash < 0.000001) break;
  }
  const upside = quote.sharesMicros - budget;
  if (upside * 10000 < budget * Math.max(config.minimumUpsideBp, config.profitTargetBp))
    return { ok: false as const, reason: "Insufficient profit room after entry costs" };
  const exit = sellQuote(book.bids, quote.sharesMicros, 0.000001, feeRate, exponent);
  if (!exit) return { ok: false as const, reason: "Insufficient exit liquidity" };
  if ((budget - exit.cashMicros) * 10000 > budget * config.maximumEntryLossBp)
    return { ok: false as const, reason: "Spread and fees consume too much of the allocation" };
  return { ok: true as const, quote, limit, immediateExit: exit.cashMicros, upside };
}
export function buyQuote(
  asks: Level[],
  stakeMicros: number,
  ceiling: number,
  feeRate: number,
  exponent: number,
) {
  if (
    !Number.isFinite(feeRate) ||
    feeRate < 0 ||
    !Number.isFinite(exponent) ||
    exponent < 0
  )
    return null;
  let cash = stakeMicros / 1e6,
    shares = 0,
    fee = 0,
    gross = 0;
  for (const l of [...asks].sort((a, b) => Number(a.price) - Number(b.price))) {
    const p = Number(l.price),
      size = Number(l.size);
    if (!(p > 0 && p <= ceiling && size > 0)) continue;
    const f = feeRate * (p * (1 - p)) ** exponent;
    const n = Math.min(size, cash / (p + f));
    shares += n;
    gross += n * p;
    fee += n * f;
    cash -= n * (p + f);
    if (cash < 0.000001) break;
  }
  if (cash > 0.000001 || shares < 0.000001) return null;
  const sharesMicros = Math.floor(shares * 1e6),
    feeMicros = Math.round(fee * 1e6);
  return {
    sharesMicros,
    grossMicros: stakeMicros - feeMicros,
    feeMicros,
    cashMicros: stakeMicros,
    price: (gross / shares).toFixed(18),
  };
}
export function sellQuote(
  bids: Level[],
  sharesMicros: number,
  floor: number,
  feeRate: number,
  exponent: number,
) {
  if (
    !Number.isFinite(feeRate) ||
    feeRate < 0 ||
    !Number.isFinite(exponent) ||
    exponent < 0
  )
    return null;
  let remaining = BigInt(sharesMicros),
    gross = 0n,
    fee = 0n;
  for (const l of [...bids].sort((a, b) => Number(b.price) - Number(a.price))) {
    const p = Number(l.price);
    if (!(p >= floor && p < 1 && Number(l.size) > 0)) continue;
    const n = remaining < fixed(l.size, 6) ? remaining : fixed(l.size, 6);
    gross += (n * fixed(l.price, 6)) / 1000000n;
    fee += BigInt(Math.round(Number(n) * feeRate * (p * (1 - p)) ** exponent));
    remaining -= n;
    if (remaining === 0n) break;
  }
  if (remaining > 0n || gross <= fee) return null;
  return {
    sharesMicros,
    grossMicros: Number(gross),
    feeMicros: Number(fee),
    cashMicros: Number(gross - fee),
    price: decimal((gross * E18) / BigInt(sharesMicros)),
  };
}

// Choose an observed price level: computed net-profit floors need not be valid CLOB ticks.
export function exitPlan(bids: Level[], sharesMicros: number, floor: number, feeRate: number, exponent: number) {
  const quote = sellQuote(bids, sharesMicros, floor, feeRate, exponent);
  if (!quote) return null;
  let remaining = BigInt(sharesMicros);
  for (const l of [...bids].sort((a,b) => Number(b.price) - Number(a.price))) {
    const price = Number(l.price);
    if (!(price >= floor && price < 1 && Number(l.size) > 0)) continue;
    remaining -= fixed(l.size, 6);
    if (remaining <= 0n) return { quote, limit: price };
  }
  return null;
}
export function stake(config: Config) {
  return Math.floor(Math.min(config.tradeBudgetCents, config.bankrollCents * config.riskBp / 10000)) * 10000;
}
export function utcPeriods(now: number) {
  const d = new Date(now);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const weekday = (new Date(day).getUTCDay() + 6) % 7;
  return {
    day: new Date(day).toISOString(),
    week: new Date(day - weekday * 86400000).toISOString(),
  };
}
export function riskAllowed(
  config: Config,
  amount: number,
  openRisk: number,
  cash: number,
  dayPnl: number,
  weekPnl: number,
  concurrent: number,
) {
  return (
    Number.isSafeInteger(amount) &&
    amount > 0 &&
    concurrent < 2 &&
    cash >= amount &&
    Math.max(0, -dayPnl) + openRisk + amount <=
      config.bankrollCents * config.dailyLossBp &&
    Math.max(0, -weekPnl) + openRisk + amount <=
      config.bankrollCents * config.weeklyLossBp
  );
}
