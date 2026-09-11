import { z } from "zod";
import type { Horizon } from "./identity.ts";
export const marketSchema = z
  .object({
    slug: z.string().max(160),
    start: z.number().int().positive(),
    end: z.number().int().positive(),
    horizon: z.union([z.literal(300), z.literal(900), z.literal(3600)]),
    conditionId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    upToken: z.string().regex(/^\d{1,100}$/),
    downToken: z.string().regex(/^\d{1,100}$/),
    source: z.enum(["chainlink-twap-60", "binance-hourly"]),
    feeRate: z.number().min(0).max(0.5),
    feeExponent: z.literal(1),
    accepting: z.boolean(),
    winner: z.enum(["Up", "Down"]).nullable(),
  })
  .strict()
  .refine(
    (m) =>
      m.end === m.start + m.horizon &&
      m.start % m.horizon === 0 &&
      m.upToken !== m.downToken &&
      m.slug === marketSlug(m.start, m.horizon) &&
      m.source ===
        (m.horizon === 3600 ? "binance-hourly" : "chainlink-twap-60"),
    "Market identity mismatch",
  );
export type Market = z.infer<typeof marketSchema>;
export function marketSlug(start: number, horizon: Horizon) {
  if (horizon !== 3600) return `btc-updown-${horizon / 60}m-${start}`;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    hour12: true,
  }).formatToParts(new Date(start * 1000));
  const get = (kind: string) =>
    parts.find((p) => p.type === kind)!.value.toLowerCase();
  return `bitcoin-up-or-down-${get("month")}-${get("day")}-${get("year")}-${get("hour")}${get("dayPeriod")}-et`;
}
const gammaSchema = z.object({
  slug: z.string(),
  eventStartTime: z.string(),
  endDate: z.string(),
  negRisk: z.boolean(),
  conditionId: z.string(),
  resolutionSource: z.string(),
  description: z.string().nullish(),
  cryptoMarketConfig: z
    .object({
      asset: z.string(),
      duration: z.string(),
      twapEnabled: z.boolean(),
      twapLookbackSeconds: z.number(),
    })
    .nullish(),
  outcomes: z.string(),
  clobTokenIds: z.string(),
  outcomePrices: z.string(),
  closed: z.boolean(),
  umaResolutionStatus: z.string().nullish(),
  feesEnabled: z.boolean(),
  feeSchedule: z.object({ rate: z.number(), exponent: z.number() }).nullish(),
  acceptingOrders: z.boolean(),
});
export function parseMarket(
  raw: Record<string, unknown>,
  start: number,
  horizon: Horizon,
): Market {
  const m = gammaSchema.parse(raw);
  if (
    m.slug !== marketSlug(start, horizon) ||
    Date.parse(m.eventStartTime) !== start * 1000 ||
    Date.parse(m.endDate) !== (start + horizon) * 1000 ||
    m.negRisk !== false
  )
    throw Error("Market timing or exchange rules changed");
  if (horizon === 3600) {
    if (
      m.resolutionSource !== "https://www.binance.com/en/trade/BTC_USDT" ||
      !m.description?.includes("BTC/USDT 1 hour candle") ||
      !m.description?.includes("greater than or equal to the open price")
    )
      throw Error("Hourly settlement rules changed");
  } else if (
    m.cryptoMarketConfig?.asset !== "btc" ||
    m.cryptoMarketConfig?.duration !== `${horizon / 60}m` ||
    m.cryptoMarketConfig?.twapEnabled !== true ||
    m.cryptoMarketConfig?.twapLookbackSeconds !== 60 ||
    m.resolutionSource !==
      "https://data.chain.link/streams/btc-usd-twap-60s-streams"
  )
    throw Error("TWAP settlement rules changed");
  const outcomes = z
      .array(z.enum(["Up", "Down"]))
      .length(2)
      .parse(JSON.parse(m.outcomes)),
    tokens = z.array(z.string()).length(2).parse(JSON.parse(m.clobTokenIds)),
    prices = z
      .array(z.string().regex(/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/))
      .length(2)
      .parse(JSON.parse(m.outcomePrices));
  if (
    outcomes.length !== 2 ||
    tokens.length !== 2 ||
    !outcomes.includes("Up") ||
    !outcomes.includes("Down")
  )
    throw Error("Unexpected outcomes");
  const resolved = m.closed === true && m.umaResolutionStatus === "resolved";
  const won =
    resolved && prices.every((p) => Number(p) === 0 || Number(p) === 1)
      ? outcomes.filter((_: string, i: number) => Number(prices[i]) === 1)
      : [];
  return marketSchema.parse({
    slug: m.slug,
    start,
    end: start + horizon,
    horizon,
    conditionId: m.conditionId,
    upToken: tokens[outcomes.indexOf("Up")],
    downToken: tokens[outcomes.indexOf("Down")],
    source: horizon === 3600 ? "binance-hourly" : "chainlink-twap-60",
    feeRate: m.feesEnabled === false ? 0 : m.feeSchedule?.rate,
    feeExponent: m.feesEnabled === false ? 1 : m.feeSchedule?.exponent,
    accepting: m.acceptingOrders === true && !m.closed,
    winner: won.length === 1 ? won[0] : null,
  });
}
