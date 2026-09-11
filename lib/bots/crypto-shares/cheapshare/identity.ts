export const CHEAPSHARE = {
  key: "crypto-shares.cheapshare.flip",
  legacyKey: "crypto-shares.cheapshare.ctr-m",
  name: "CheapShare",
  family: "Crypto Shares",
  pair: "6 pairs · 5m / 15m",
  version: 2,
} as const;
export const PAIRS = ["BTC", "ETH", "SOL", "XRP", "DOGE", "HYPE"] as const;
export const WINDOWS = [300, 900] as const;
export type Pair = (typeof PAIRS)[number];
export type Direction = "Up" | "Down";
