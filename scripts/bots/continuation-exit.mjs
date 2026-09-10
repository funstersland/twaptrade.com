import {parseUnits} from "viem";
export function exitQuote(bids, sharesMicros, rate, exponent) {
  if (!Number.isFinite(rate) || rate < 0 || !Number.isInteger(exponent) || exponent < 0 || exponent > 8) return null;
  let remaining = BigInt(sharesMicros), grossNumerator = 0n, feeNumerator = 0n, lowest = 1000000n;
  const rateUnits = parseUnits(String(rate),9), feeDenominator = 1000000000n * (1000000000000n ** BigInt(exponent));
  for (const bid of [...bids].sort((a,b) => Number(b.price)-Number(a.price))) {
    const price = parseUnits(bid.price,6), size = parseUnits(bid.size,6), quantity = size < remaining ? size : remaining;
    if (price < 990000n || price > 1000000n || quantity <= 0n) continue;
    grossNumerator += quantity*price;
    feeNumerator += quantity*rateUnits*((price*(1000000n-price))**BigInt(exponent));
    remaining -= quantity; lowest = price < lowest ? price : lowest;
    if (!remaining) break;
  }
  if (remaining || !sharesMicros) return null;
  const gross = Number(grossNumerator/1000000n), fee = Number((feeNumerator+feeDenominator-1n)/feeDenominator);
  if (!Number.isSafeInteger(gross) || !Number.isSafeInteger(fee)) return null;
  return {bidMicros: Number(lowest), sharesMicros, grossMicros:gross, feeMicros:fee, cashMicros:gross-fee};
}
export function stableExit(previous, quote, now) {
  if (!quote || quote.bidMicros < 990000) return null;
  const since = previous && now-previous.last <= 1500 && now >= previous.last ? previous.since : now;
  return {since, last: now, ready: now-since >= 5000};
}
