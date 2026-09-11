export const SCALPER = {
  name: "Scalper",
  family: "Crypto Shares",
  key: "crypto-shares.scalper.rejection",
  pair: "BTC · 5m / 15m / 1h",
  version: 1,
} as const;
export const HORIZONS = [300, 900, 3600] as const;
export type Horizon = (typeof HORIZONS)[number];
export type Direction = "Up" | "Down";
export const FRAMES: Record<Horizon, { context: number; signal: number }> = {
  300: { context: 60, signal: 15 },
  900: { context: 180, signal: 60 },
  3600: { context: 300, signal: 300 },
};
export const CANDLE_SECONDS = [15, 60, 180, 300] as const;
