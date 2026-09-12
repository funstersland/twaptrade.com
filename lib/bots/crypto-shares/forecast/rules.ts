import { CANDLE_SECONDS, FRAMES, WEIGHTS, type Horizon, type Direction } from "./identity.ts";
import type { Candle, Tick } from "./candles.ts";
import type { Config } from "./config.ts";
export type Zone = { kind: "support" | "resistance"; value: string; width: string; touches: number; knownAt: number };
export type FrameSignal = { seconds: number; score: number; trend: Direction | null; pattern: string | null; patternDirection: Direction | null; atr: number; close: number; end: number };
export type Signal = { direction: Direction | null; reason: string; zones: Zone[]; candle: Candle | null; atr: string | null; score: number; frames: FrameSignal[] };
export const nextStart = (now: number, horizon: Horizon) => (Math.floor(now / (horizon * 1000)) + 1) * horizon;
export const nextEntryAt = (now: number, horizon: Horizon) => {
  const start = nextStart(now, horizon);
  return (now >= start * 1000 - 20000 ? start + horizon : start) * 1000 - 25000;
};
// Allow the three windows to be processed before the hard T-20 cutoff.
export const entryWindow = (now: number, start: number, horizon: Horizon) => start === nextStart(now, horizon) && now >= start * 1000 - 25000 && now < start * 1000 - 20000;
const price = (v: string) => Number(v) / 1e18;
const clip = (v: number) => Math.max(-1, Math.min(1, v));
const e18 = (n: number) => BigInt(Math.round(n * 1e8)).toString() + "0000000000";
function ema(values: number[], period: number) {
  return values.reduce((e, v) => e + 2 / (period + 1) * (v - e), values[0]);
}
export function zonesFromCandles(candles: Candle[], atr: number): Zone[] {
  const zones: Zone[] = [], width = atr * 0.15;
  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i], near = [candles[i-2], candles[i-1], candles[i+1], candles[i+2]];
    for (const kind of ["support", "resistance"] as const) {
      const value = price(kind === "support" ? c.low : c.high);
      if (!near.every(n => kind === "support" ? value < price(n.low) : value > price(n.high))) continue;
      const old = zones.find(z => z.kind === kind && Math.abs(price(z.value) - value) <= width);
      if (old) { old.touches++; old.knownAt = candles[i+2].end; }
      else zones.push({kind, value: e18(value), width: e18(width), touches: 1, knownAt: candles[i+2].end});
    }
  }
  return zones;
}
export function frameSignal(bars: Candle[]): { frame: FrameSignal; zones: Zone[] } {
  const c = bars.at(-1)!, prev = bars.at(-2)!;
  const closes = bars.map(c => price(c.close)), o = price(c.open), h = price(c.high), l = price(c.low), close = price(c.close), range = h-l;
  const ranges = bars.slice(-15).slice(1).map((b,i) => Math.max(price(b.high)-price(b.low), Math.abs(price(b.high)-price(bars.slice(-15)[i].close)), Math.abs(price(b.low)-price(bars.slice(-15)[i].close))));
  const atr = ranges.reduce((a,b)=>a+b,0)/14;
  const fast = ema(closes,8), slow = ema(closes,21), trendValue = atr > 0 ? clip((fast-slow)/atr) : 0;
  const momentum = atr > 0 ? clip((close - closes.at(-4)!)/(2*atr)) : 0;
  const body = range > 0 ? (close-o)/range : 0;
  const score = clip(0.55*trendValue + 0.30*momentum + 0.15*body);
  // Exclude the trigger candle. Every pivot must already have two closed right bars.
  const zones = zonesFromCandles(bars.slice(0,-1), atr);
  let pattern: string | null = null, patternDirection: Direction | null = null;
  const strong = range > 0 && Math.abs(body) >= 0.30 && range <= 2.5*atr;
  if (strong) {
    const up = close > o, direction: Direction = up ? "Up" : "Down";
    const touched = zones.some(z => z.kind === (up ? "support" : "resistance") && l <= price(z.value)+price(z.width) && h >= price(z.value)-price(z.width) && (up ? close > price(z.value)+price(z.width) : close < price(z.value)-price(z.width)));
    const rejection = touched && (up ? (Math.min(o,close)-l)/range >= 0.30 && (close-l)/range >= 0.70 : (h-Math.max(o,close))/range >= 0.30 && (h-close)/range >= 0.70);
    const engulf = up ? price(prev.close)<price(prev.open) && o<=price(prev.close) && close>=price(prev.open) : price(prev.close)>price(prev.open) && o>=price(prev.close) && close<=price(prev.open);
    const prior = bars.slice(-21,-1), ceiling = Math.max(...prior.map(b=>price(b.high))), floor = Math.min(...prior.map(b=>price(b.low)));
    const breakout = Math.abs(body)>=0.55 && (up ? close>ceiling+0.05*atr && o<=ceiling : close<floor-0.05*atr && o>=floor);
    const pullback = up ? trendValue>0.15 && l<=fast && close>fast && close>price(prev.high) : trendValue< -0.15 && h>=fast && close<fast && close<price(prev.low);
    pattern = rejection ? "support/resistance rejection" : breakout ? "20-bar breakout" : engulf ? "body engulfing" : pullback ? "trend pullback recovery" : null;
    if (pattern) patternDirection=direction;
  }
  return {frame:{seconds:c.seconds,score,trend:score>0.08?"Up":score< -0.08?"Down":null,pattern,patternDirection,atr,close,end:c.end},zones};
}
export function analyze(candles: Candle[], latest: Tick | null, horizon: Horizon, now: number): Signal {
  const result: Signal = { direction:null, reason:"Waiting for closed BTC candles", zones:[], candle:null, atr:null, score:0, frames:[] };
  if (!latest || latest.at>now+500 || now-latest.at>3000) return {...result,reason:"Waiting for a fresh BTC quote"};
  const histories = new Map<number,Candle[]>();
  for (const seconds of CANDLE_SECONDS) {
    const bars = candles.filter(c=>c.seconds===seconds && c.end<=now).sort((a,b)=>a.start-b.start).slice(-64);
    if (bars.length<55) return {...result,reason:`Loading ${seconds===3600?'1h':seconds/60+'m'} history: ${bars.length}/55 closed candles`};
    if (bars.some((c,i)=>!c.complete || (i>0 && bars[i-1].end!==c.start))) return {...result,reason:`Gap in ${seconds/60}m history; fetching verified candles`};
    if (bars.at(-1)!.end !== Math.floor(now/(seconds*1000))*seconds*1000) return {...result,reason:`Waiting for the latest closed ${seconds/60}m candle`};
    histories.set(seconds,bars);
    const f=frameSignal(bars); result.frames.push(f.frame);
    if (seconds===FRAMES[horizon].context) { result.zones=f.zones; result.candle=bars.at(-1)!; result.atr=e18(f.frame.atr); }
  }
  const weighted = result.frames.reduce((n,f,i)=>n+f.score*WEIGHTS[horizon][i],0);
  result.score=Math.round(Math.abs(weighted)*100);
  const direction: Direction = weighted>=0 ? "Up":"Down", sign=direction==="Up"?1:-1;
  const aligned=result.frames.filter(f=>f.trend===direction).length;
  if (Math.abs(weighted)<0.25 || aligned<3) return {...result,reason:`Mixed trend: ${aligned}/4 frames agree; strength ${result.score}/100`};
  const execution = result.frames.find(f=>f.seconds===FRAMES[horizon].signal)!;
  if (execution.patternDirection!==direction) return {...result,reason:`${aligned}/4 trends agree; waiting for a ${execution.seconds/60}m candle pattern`};
  // Do not fade a strong higher-timeframe trend even if lower frames vote together.
  if (result.frames.at(-1)!.score*sign < -0.35) return {...result,reason:"Strong hourly trend opposes the forecast"};
  const context=result.frames.find(f=>f.seconds===FRAMES[horizon].context)!;
  const current=price(latest.value), minute=result.frames[0];
  if (Math.abs(current-minute.close)>1.5*minute.atr) return {...result,reason:"Price moved too far since the closed signal candle"};
  if (result.zones.some(z=>z.kind===(direction==="Up"?"resistance":"support") && (price(z.value)-current)*sign>0 && (price(z.value)-current)*sign<0.5*context.atr)) return {...result,reason:"Nearby opposing support/resistance limits room"};
  return {...result,direction,reason:`${direction}: ${execution.pattern}; ${aligned}/4 trends agree · strength ${result.score}/100`};
}
export function nextStake(config: Config) {
  return config.baseLotCents <= Math.floor(config.bankrollCents*config.maxStakeBp/10000) ? config.baseLotCents : null;
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
