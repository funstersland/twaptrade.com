import type { Direction } from "./identity.ts";

export type PricePoint = { at: number; value: string };
const abs = (n: bigint) => n < 0n ? -n : n;
const sign = (side: Direction) => side === "Up" ? 1n : -1n;
export function priceBuffer(reference: bigint, bp: number) {
  return reference * BigInt(Math.round(bp * 1000)) / 10000000n;
}

// Integrate observed prices over an exact interval. Gaps are unknown, never zero.
export function priceArea(points: PricePoint[], from: number, to: number, maxGap = 2500): bigint | null {
  if (to < from) return null;
  if (to === from) return 0n;
  const anchor = points.findLastIndex(p => p.at <= from);
  if (anchor < 0 || from - points[anchor].at > maxGap) return null;
  let area = 0n, cursor = from, previous = points[anchor];
  for (const p of points.slice(anchor + 1)) {
    if (p.at <= previous.at || p.at - previous.at > maxGap) return null;
    const end = Math.min(to, p.at);
    area += BigInt(previous.value) * BigInt(end - cursor);
    if (p.at >= to) return area;
    cursor = p.at;
    previous = p;
  }
  if (to - previous.at > maxGap) return null;
  return area + BigInt(previous.value) * BigInt(to - cursor);
}

export type BucketInput = {
  now: number;
  end: number;
  windowSeconds: 30 | 60;
  reference: string;
  side: Direction;
  twap: PricePoint;
  oracle: PricePoint[];
  spot: string;
  impulseFrom: string;
  retreatPct: number;
  clearBufferBp: number;
  maxModelErrorBp: number;
  latencyMs: number;
};

/** A stress-tested uniform-time forecast, not a reproduction of Chainlink's private weighting. */
export function bucketProjection(i: BucketInput) {
  const R = BigInt(i.reference), direction = sign(i.side), W = i.windowSeconds * 1000;
  const unavailable = (reason: string) => ({ available: false as const, clear: false, reason });
  if (R <= 0n || i.end <= i.now || i.twap.at > i.now || i.now - i.twap.at > 2500)
    return unavailable("TWAP is stale or the window has ended");
  const latest = i.oracle.at(-1);
  if (!latest || latest.at > i.now || i.now - latest.at > 2500)
    return unavailable("Chainlink spot is stale");
  const observed = priceArea(i.oracle, i.twap.at - W, i.twap.at);
  if (observed === null) return unavailable("Incomplete Chainlink lookback history");
  const observedMean = observed / BigInt(W), official = BigInt(i.twap.value);
  const modelError = abs(observedMean - official);
  if (modelError > priceBuffer(R, i.maxModelErrorBp))
    return unavailable("Observed prices do not support the official TWAP model");

  // The window keeps its observed tail; it does not retain the entire current TWAP.
  // Reserve latency at the less favorable current price, then stress the new spot.
  const from = i.end - W, knownEnd = Math.max(from, i.now);
  const known = from < i.now ? priceArea(i.oracle, from, i.now) : 0n;
  if (known === null) return unavailable("Settlement bucket contains a feed gap");
  const current = BigInt(latest.value), quoted = BigInt(i.spot);
  const conservative = i.side === "Up" ? (current < quoted ? current : quoted) : (current > quoted ? current : quoted);
  const impulse = (conservative - BigInt(i.impulseFrom)) * direction;
  const retreat = (impulse > 0n ? impulse : 0n) * BigInt(Math.round(i.retreatPct * 100)) / 10000n;
  const future = conservative - direction * retreat;
  const latencyEnd = Math.min(i.end, i.now + Math.max(0, Math.floor(i.latencyMs)));
  const latencyDuration = Math.max(0, latencyEnd - knownEnd);
  const forecastDuration = Math.max(0, i.end - Math.max(knownEnd, latencyEnd));
  const delayPrice = i.side === "Up" ? (current < future ? current : future) : (current > future ? current : future);
  const committedArea = known + delayPrice * BigInt(latencyDuration);
  const uncertainty = modelError + priceBuffer(R, i.clearBufferBp);
  const projected = (committedArea + future * BigInt(forecastDuration)) / BigInt(W) - direction * modelError;
  const headroom = (projected - R) * direction - priceBuffer(R, i.clearBufferBp);
  const targetArea = (R + direction * uncertainty) * BigInt(W) - committedArea;
  const requiredSpot = forecastDuration > 0
    ? (targetArea + (i.side === "Up" ? BigInt(forecastDuration - 1) : 0n)) / BigInt(forecastDuration)
    : null;
  return {
    available: true as const,
    clear: headroom > 0n && forecastDuration > 0 && (future - R) * direction > 0n,
    reason: headroom > 0n ? "Stressed settlement estimate clears the strike" : "Insufficient price-and-time strength to flip TWAP",
    projected: projected.toString(),
    requiredSpot: requiredSpot?.toString() ?? null,
    conservativeSpot: future.toString(),
    headroom: headroom.toString(),
    modelError: modelError.toString(),
    knownMs: Math.max(0, i.now - from),
    forecastMs: forecastDuration,
    windowSeconds: i.windowSeconds,
  };
}
