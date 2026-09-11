import { fixed } from "../../lib/bots/crypto-shares/cheapshare/rules.ts";
export const f = n => fixed(String(n)).toString();
export function reversalFixture(now = (1789089000 + 270) * 1000, before = 76998, after = 77010, window = 300) {
  const start = Math.floor(now / (window * 1000)) * window;
  const market = {
    slug: `btc-updown-${window / 60}m-${start}`, pair: "BTC", window, windowSeconds: 60,
    start, end: start + window, conditionId: "0x" + "ab".repeat(32), upToken: "123", downToken: "456",
    strike: f(77000), strikeSource: "chainlink-open", feeRate: 0.07, feeExponent: 1,
  };
  const oracle = Array.from({length:126}, (_,n) => ({at: now - 125000 + n*1000, value: f(n < 123 ? before : after)}));
  const twap = Array.from({length:66}, (_,n) => ({at:now - 65000 + n*1000,
    value: f((before + (after-before) * Math.max(0, n-63) / 60).toFixed(12))}));
  const spot = Array.from({length:41}, (_,n) => ({at:now - 20000 + n*500,
    bid:f(n < 36 ? before : after), ask:f(n < 36 ? before : after)}));
  const observation = {now, start:start*1000, end:market.end*1000, watchingSince:start*1000-1000,
    windowSeconds:60, strike:market.strike, twap, oracle, spot,
    up:{at:now,bids:[{price:"0.49",size:"10000"}],asks:[{price:"0.50",size:"10000"}]},
    down:{at:now,bids:[{price:"0.49",size:"10000"}],asks:[{price:"0.50",size:"10000"}]}};
  return {now,market,observation};
}
