export const FORECAST = {
  name: "Forecast", family: "Crypto Shares", key: "crypto-shares.forecast.confluence",
  pair: "BTC · 5m / 15m / 1h", version: 1,
} as const;
export const HORIZONS = [300, 900, 3600] as const;
export type Horizon = (typeof HORIZONS)[number];
export type Direction = "Up" | "Down";
export const CANDLE_SECONDS = [60, 300, 900, 3600] as const;
export const FRAMES: Record<Horizon, { context: number; signal: number }> = {
  300: { context: 300, signal: 60 },
  900: { context: 900, signal: 300 },
  3600: { context: 3600, signal: 300 },
};
// Fixed before the first evaluation; these are weights, not probabilities.
export const WEIGHTS: Record<Horizon, readonly number[]> = {
  300: [0.35, 0.35, 0.20, 0.10],
  900: [0.20, 0.35, 0.30, 0.15],
  3600: [0.10, 0.20, 0.35, 0.35],
};
