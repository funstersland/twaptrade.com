export type Direction = "Up" | "Down";
export const roundStart = (now: number) => Math.floor(now / 300_000) * 300;
export function candle(openE18: string, latestE18: string): Direction | null {
  const open = BigInt(openE18),
    latest = BigInt(latestE18);
  return latest > open ? "Up" : latest < open ? "Down" : null;
}
export function entryWindow(now: number, targetStart: number) {
  return (
    targetStart === roundStart(now) + 300 &&
    now >= targetStart * 1000 - 10_000 &&
    now < targetStart * 1000 - 5_000
  );
}
export function nextLot(baseCents: number, consecutiveLosses: number) {
  const value = baseCents * 2 ** consecutiveLosses;
  return Number.isSafeInteger(value) && value <= 100_000_000_00 ? value : null;
}
export function paperFill(
  asks: { price: string; size: string }[],
  stakeCents: number,
  feeRate: number,
  exponent: number,
) {
  let remaining = stakeCents / 100,
    sharesFilled = 0,
    fees = 0,
    notional = 0;
  const levels = [...asks]
    .map((a) => ({ p: Number(a.price), size: Number(a.size) }))
    .filter((a) => a.p > 0 && a.p < 1 && a.size > 0)
    .sort((a, b) => a.p - b.p);
  for (const { p, size } of levels) {
    const feePerShare = feeRate * (p * (1 - p)) ** exponent;
    const shares = Math.min(size, remaining / (p + feePerShare));
    const fee = shares * feePerShare,
      cost = shares * p;
    sharesFilled += shares;
    notional += cost;
    fees += fee;
    remaining -= cost + fee;
    if (remaining < 0.000001) break;
  }
  if (remaining > 0.000001 || sharesFilled <= 0) return null;
  return {
    costMicros: stakeCents * 10_000,
    sharesMicros: Math.floor(sharesFilled * 1_000_000),
    feeMicros: Math.round(fees * 1_000_000),
    averagePrice: notional / sharesFilled,
  };
}
