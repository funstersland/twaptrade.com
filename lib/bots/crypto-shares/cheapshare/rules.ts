import type { Config, Preset } from "./config.ts";
import type { Direction } from "./identity.ts";
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
export function project(
  t: string,
  spot: string,
  r: string,
  side: Direction,
  tauMs: number,
  bufferBp: number,
  windowMs = 60000,
) {
  const T = BigInt(t),
    S = BigInt(spot),
    R = BigInt(r),
    sign = directionSign(side),
    weight = BigInt(Math.max(0, Math.min(windowMs, Math.floor(tauMs))));
  const projected = T + ((S - T) * weight) / BigInt(windowMs),
    clear = (projected - R) * sign * 10000n >= R * BigInt(bufferBp);
  const distance = R * BigInt(bufferBp) - (T - R) * sign * 10000n,
    velocity = (S - T) * sign * 10000n;
  const need =
    distance <= 0n
      ? 0
      : velocity <= 0n
        ? Infinity
        : Number((distance * BigInt(windowMs) + velocity - 1n) / velocity);
  return { projected: projected.toString(), clear, needMs: need };
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
  end: number;
  strike: string | null;
  twap: Point[];
  spot: Quote[];
  up: { bids: Level[]; asks: Level[]; at: number };
  down: { bids: Level[]; asks: Level[]; at: number };
  preset: Preset;
  config: Config;
};
export function scan(i: ScanInput) {
  const gates: { name: string; ok: boolean }[] = [];
  const gate = (name: string, ok: boolean) => {
    gates.push({ name, ok });
    return ok;
  };
  let side: Direction | null = null,
    setup: "A" | "B" | null = null,
    ask: number | null = null,
    projection: string | null = null,
    needMs: number | null = null;
  const result = () => ({
    eligible: gates.every((g) => g.ok),
    side,
    setup,
    ask,
    projection,
    needMs,
    gates,
    reason: gates.find((g) => !g.ok)?.name || "Entry eligible",
  });
  gate("Pair/window enabled", i.preset.enabled);
  gate("News block off", !i.config.newsBlocked);
  if (!gate("Price-to-Beat locked", !!i.strike && BigInt(i.strike) > 0n))
    return result();
  const r = i.strike!,
    t = i.twap.at(-1),
    b = i.spot.at(-1),
    tau = i.end - i.now;
  if (
    !gate(
      "Fresh TWAP, Binance and CLOB",
      !!t &&
        !!b &&
        i.now - t.at <= 3000 &&
        i.now - b.at <= 1500 &&
        i.now - i.up.at <= 3000 &&
        i.now - i.down.at <= 3000 &&
        t.at <= i.now &&
        b.at <= i.now &&
        i.up.at <= i.now + 500 &&
        i.down.at <= i.now + 500,
    )
  )
    return result();
  const gap = bpGap(t!.value, r);
  side = gap > 0 ? "Down" : "Up";
  const crowd: Direction = side === "Up" ? "Down" : "Up";
  gate(
    "Mature TWAP crowd",
    held(i.twap, i.now, i.preset.crowdSeconds * 1000, (p) =>
      beyond(p.value, r, crowd, i.preset.crowdBp),
    ),
  );
  const book = side === "Up" ? i.up : i.down,
    opposite = side === "Up" ? i.down : i.up;
  ask = top(book.asks, "ask");
  const bid = top(book.bids, "bid"),
    expensive = top(opposite.bids, "bid");
  if (ask !== null && ask >= 0.15 && ask <= 0.28) setup = "A";
  else if (i.config.setupB && ask !== null && ask >= 0.01 && ask <= 0.12)
    setup = "B";
  gate("Cheap ask band", !!setup);
  gate(
    "One-sided CLOB",
    expensive !== null &&
      expensive >= 0.7 &&
      (setup !== "A" || expensive <= 0.88),
  );
  gate(
    "Not already decided",
    !(
      expensive !== null &&
      expensive >= 0.92 &&
      Math.abs(gap) >= i.config.decidedGapBp
    ),
  );
  const mid = (BigInt(b!.bid) + BigInt(b!.ask)) / 2n,
    S = side === "Up" ? b!.bid : b!.ask;
  gate("Binance lead", beyond(mid.toString(), r, side, i.preset.leadBp));
  const spots = i.spot.map((p) => ({
    at: p.at,
    value: side === "Up" ? p.bid : p.ask,
  }));
  gate(
    "Spot held beyond strike",
    held(
      spots,
      i.now,
      i.preset.holdSeconds * 1000,
      (p) => beyond(p.value, r, side!, i.preset.holdBufferBp),
      1500,
    ),
  );
  const p = project(t!.value, S, r, side, tau, i.preset.clearBufferBp);
  projection = p.projected;
  needMs = Number.isFinite(p.needMs) ? p.needMs : null;
  gate("CLEAR projector", p.clear);
  gate("Time for clearance", tau >= p.needMs + 8000 && tau > 0);
  const old = i.twap.findLast((x) => x.at <= i.now - 5000);
  gate(
    "TWAP slope agrees",
    !!old &&
      i.now - old.at <= 8000 &&
      (BigInt(t!.value) - BigInt(old.value)) * directionSign(side) > 0n,
  );
  const recent = i.spot.filter((x) => x.at >= i.now - 2000),
    wickPoints = recent.map((x) => (BigInt(x.bid) + BigInt(x.ask)) / 2n);
  const anchor = i.spot.findLast((x) => x.at <= i.now - 2000);
  if (anchor)
    wickPoints.unshift((BigInt(anchor.bid) + BigInt(anchor.ask)) / 2n);
  const range = wickPoints.length
    ? wickPoints.reduce((a, v) => (v > a ? v : a)) -
      wickPoints.reduce((a, v) => (v < a ? v : a))
    : 0n;
  const lead = mid > BigInt(r) ? mid - BigInt(r) : BigInt(r) - mid;
  gate(
    "Two-second move is not a wick",
    !!anchor &&
      i.now - anchor.at <= 3500 &&
      range * 10000n <= lead * BigInt(Math.round(i.config.wickRatio * 10000)),
  );
  gate(
    "Spread at most 4 cents",
    ask !== null && bid !== null && ask >= bid && ask - bid <= 0.040000001,
  );
  return result();
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
export function stake(config: Config, setup: "A" | "B", lossStreak: number) {
  if (config.martingale && lossStreak > config.martingaleSteps) return null;
  const bp = setup === "B" ? config.setupBRiskBp : config.riskBp;
  return (
    Math.floor((config.bankrollCents * bp) / 10000) *
    10000 *
    (config.martingale ? 2 ** lossStreak : 1)
  );
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
