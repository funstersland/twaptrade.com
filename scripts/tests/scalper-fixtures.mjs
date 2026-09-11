// Synthetic test-only candles, never used by the runner or catalog.
import { FRAMES } from "../../lib/bots/crypto-shares/scalper/identity.ts";
import { toE18 } from "../../lib/bots/crypto-shares/scalper/candles.ts";
import { marketSlug } from "../../lib/bots/crypto-shares/scalper/market.ts";
export const e18 = (n) => toE18(String(n));
export function rejectionFixture(
  horizon = 300,
  target = 1789135200,
  side = "Up",
) {
  const now = target * 1000 - 21000,
    { signal, context } = FRAMES[horizon];
  const bar = (start, seconds, o, h, l, c) => ({
    start,
    end: start + seconds * 1000,
    seconds,
    open: e18(o),
    high: e18(h),
    low: e18(l),
    close: e18(c),
    firstAt: start,
    lastAt: start + seconds * 1000 - 1000,
    complete: true,
  });
  const rejectionStart =
    Math.floor(now / (signal * 1000)) * signal * 1000 - signal * 1000;
  const contextEnd =
    Math.floor(rejectionStart / (context * 1000)) * context * 1000;
  const candles = Array.from({ length: 60 }, (_, i) =>
    bar(
      contextEnd - (60 - i) * context * 1000,
      context,
      ...([15, 35].includes(i) ? [100, 104, 98, 101] : [105, 108, 102, 106]),
    ),
  );
  const previous = bar(
      rejectionStart - signal * 1000,
      signal,
      105,
      106,
      101,
      102,
    ),
    rejection = bar(rejectionStart, signal, 102, 105.5, 99.5, 105);
  if (signal === context) candles[candles.length - 1] = previous;
  else candles.push(previous);
  candles.push(rejection);
  if (side === "Down")
    for (const c of candles) {
      const old = { ...c };
      c.open = (BigInt(e18(200)) - BigInt(old.open)).toString();
      c.close = (BigInt(e18(200)) - BigInt(old.close)).toString();
      c.high = (BigInt(e18(200)) - BigInt(old.low)).toString();
      c.low = (BigInt(e18(200)) - BigInt(old.high)).toString();
    }
  const market = {
    slug: marketSlug(target, horizon),
    start: target,
    end: target + horizon,
    horizon,
    conditionId: "0x" + "1".repeat(64),
    upToken: "111",
    downToken: "222",
    source: horizon === 3600 ? "binance-hourly" : "chainlink-twap-60",
    feeRate: 0.07,
    feeExponent: 1,
    accepting: true,
    winner: null,
  };
  const latest = { at: now, value: e18(side === "Up" ? 105 : 95) },
    book = {
      at: now,
      tokenId: side === "Up" ? "111" : "222",
      minShares: 5,
      asks: [{ price: "0.50", size: "1000" }],
      bids: [{ price: "0.49", size: "1000" }],
    };
  return { now, target, candles, latest, market, book };
}
export function gammaFixture(m) {
  return {
    slug: m.slug,
    eventStartTime: new Date(m.start * 1000).toISOString(),
    endDate: new Date(m.end * 1000).toISOString(),
    negRisk: false,
    conditionId: m.conditionId,
    resolutionSource:
      m.horizon === 3600
        ? "https://www.binance.com/en/trade/BTC_USDT"
        : "https://data.chain.link/streams/btc-usd-twap-60s-streams",
    description:
      "BTC/USDT 1 hour candle close price greater than or equal to the open price",
    cryptoMarketConfig: {
      asset: "btc",
      duration: `${m.horizon / 60}m`,
      twapEnabled: true,
      twapLookbackSeconds: 60,
    },
    outcomes: '["Down","Up"]',
    clobTokenIds: `["${m.downToken}","${m.upToken}"]`,
    outcomePrices: '["0.5","0.5"]',
    closed: false,
    umaResolutionStatus: "proposed",
    feesEnabled: true,
    feeSchedule: { rate: 0.07, exponent: 1 },
    acceptingOrders: true,
  };
}
