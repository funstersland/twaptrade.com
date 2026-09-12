import { publicSnapshot } from "./forecast-data.mjs";
import {
  marketSlug,
  parseMarket,
} from "../../lib/bots/crypto-shares/forecast/market.ts";
export async function readJSON(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw Error(`Market data unavailable (${r.status})`);
  return r.json();
}
export async function marketAt(start, horizon) {
  return parseMarket(
    await readJSON(
      `https://gamma-api.polymarket.com/markets/slug/${marketSlug(start, horizon)}`,
    ),
    start,
    horizon,
  );
}
export async function orderBook(tokenId) {
  const snapshot = await publicSnapshot(`https://clob.polymarket.com/book?token_id=${encodeURIComponent(tokenId)}`,1500);
  const raw = snapshot.value;
  if (
    raw.asset_id !== tokenId ||
    raw.neg_risk !== false ||
    !Array.isArray(raw.bids) ||
    !Array.isArray(raw.asks)
  )
    throw Error("Order book identity changed");
  return {
    // Freshness is when this uncached REST snapshot was requested, never when an old local quote was reused.
    at: snapshot.at,
    tokenId,
    minShares: Number(raw.min_order_size),
    asks: raw.asks.map(({ price, size }) => ({ price, size })),
    bids: raw.bids.map(({ price, size }) => ({ price, size })),
  };
}
