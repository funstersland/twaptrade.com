export const botFamilies = [
  "Crypto Shares",
  "Crypto Futures",
  "Forex Futures",
] as const;
export type BotFamily = (typeof botFamilies)[number];
