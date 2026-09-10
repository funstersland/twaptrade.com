export async function readJSON(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error("Market data unavailable");
  return r.json();
}
export async function marketAt(start) {
  const slug = `btc-updown-5m-${start}`,
    m = await readJSON(`https://gamma-api.polymarket.com/markets/slug/${slug}`);
  if (
    m.slug !== slug ||
    Date.parse(m.eventStartTime) !== start * 1000 ||
    Date.parse(m.endDate) !== (start + 300) * 1000
  )
    throw new Error("Market timing does not match BTC5m");
  if (
    m.negRisk === true ||
    m.cryptoMarketConfig?.asset !== "btc" ||
    m.cryptoMarketConfig?.duration !== "5m" ||
    m.cryptoMarketConfig?.twapLookbackSeconds !== 60 ||
    !m.resolutionSource?.includes("btc-usd-twap-60s-streams")
  )
    throw new Error("Market rules changed");
  const outcomes = JSON.parse(m.outcomes),
    tokens = JSON.parse(m.clobTokenIds),
    prices = JSON.parse(m.outcomePrices);
  if (
    outcomes.length !== 2 ||
    !outcomes.includes("Up") ||
    !outcomes.includes("Down")
  )
    throw new Error("Unexpected outcomes");
  const winner =
    m.closed && m.umaResolutionStatus === "resolved"
      ? outcomes.find((_, i) => Number(prices[i]) === 1) || null
      : null;
  return {
    slug,
    start,
    conditionId: m.conditionId,
    upToken: tokens[outcomes.indexOf("Up")],
    downToken: tokens[outcomes.indexOf("Down")],
    accepting: !!m.acceptingOrders && !m.closed,
    winner,
    feeRate: m.feesEnabled ? Number(m.feeSchedule?.rate) : 0,
    feeExponent: m.feesEnabled ? Number(m.feeSchedule?.exponent) : 1,
  };
}
export async function orderBook(tokenId) {
  const b = await readJSON(
    `https://clob.polymarket.com/book?token_id=${encodeURIComponent(tokenId)}`,
  );
  if (
    b.asset_id !== tokenId ||
    !Array.isArray(b.asks) ||
    !Array.isArray(b.bids)
  )
    throw new Error("Order book unavailable");
  if (Math.abs(Date.now() - Number(b.timestamp)) > 10000)
    throw new Error("Order book is stale");
  return b;
}
export function markValue(bids, sharesMicros) {
  let shares = sharesMicros / 1e6,
    value = 0;
  for (const b of [...bids].sort((a, b) => Number(b.price) - Number(a.price))) {
    const size = Math.min(shares, Number(b.size));
    if (!(Number(b.price) > 0 && Number(b.price) < 1 && size > 0)) continue;
    value += size * Number(b.price);
    shares -= size;
    if (shares < 1e-6) break;
  }
  return shares < 1e-6 ? Math.floor(value * 1e6) : null;
}
