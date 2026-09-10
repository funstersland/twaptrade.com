import { decodeEventLog, parseAbi, hashTypedData } from "viem";

export function signedOrderId(signed, exchange) {
  const fields = [
    ["salt", "uint256"], ["maker", "address"], ["signer", "address"], ["tokenId", "uint256"],
    ["makerAmount", "uint256"], ["takerAmount", "uint256"], ["side", "uint8"], ["signatureType", "uint8"],
    ["timestamp", "uint256"], ["metadata", "bytes32"], ["builder", "bytes32"],
  ].map(([name, type]) => ({name, type}));
  return hashTypedData({domain: {name: "Polymarket CTF Exchange", version: "2", chainId: 137, verifyingContract: exchange},
    types: {Order: fields}, primaryType: "Order", message: {...signed, side: signed.side === "BUY" ? 0 : 1}});
}

// Official CTF Exchange V2 ITrading.OrderFilled. Amounts and fees are base units.
export const orderFilledAbi = parseAbi([
  "event OrderFilled(bytes32 indexed orderHash,address indexed maker,address indexed taker,uint8 side,uint256 tokenId,uint256 makerAmountFilled,uint256 takerAmountFilled,uint256 fee,bytes32 builder,bytes32 metadata)",
]);
const safe = (value) => {
  const result = Number(value);
  if (value < 0n || !Number.isSafeInteger(result)) throw new Error("Unsupported fill amount");
  return result;
};
export function receiptFills({ receipt, orderId, wallet, tokenId, side, exchanges, trades }) {
  if (receipt.status !== "success") return [];
  const allowed = new Set(exchanges.map((a) => a.toLowerCase()));
  const fills = [];
  for (const log of receipt.logs) {
    if (!allowed.has(log.address.toLowerCase())) continue;
    let event;
    try { event = decodeEventLog({ abi: orderFilledAbi, data: log.data, topics: log.topics }); }
    catch { continue; }
    const a = event.args;
    if (a.orderHash.toLowerCase() !== orderId.toLowerCase() ||
      a.maker.toLowerCase() !== wallet.toLowerCase() || a.tokenId !== BigInt(tokenId) ||
      Number(a.side) !== (side === "BUY" ? 0 : 1)) continue;
    const gross = side === "BUY" ? a.makerAmountFilled : a.takerAmountFilled;
    const shares = side === "BUY" ? a.takerAmountFilled : a.makerAmountFilled;
    const cash = side === "BUY" ? gross + a.fee : gross - a.fee;
    if (!shares || !gross) throw new Error("Empty execution event");
    const tradeIds = [...new Set(trades.filter((t) => t.transactionHash?.toLowerCase() === receipt.transactionHash.toLowerCase()).map((t) => t.id))].sort();
    fills.push({ id: `${receipt.transactionHash.toLowerCase()}:${log.logIndex}`, orderId, side, tokenId,
      transactionHash: receipt.transactionHash, logIndex: log.logIndex, blockNumber: safe(receipt.blockNumber),
      grossMicros: safe(gross), sharesMicros: safe(shares), feeMicros: safe(a.fee), cashMicros: safe(cash),
      price: `${gross / shares}.${((gross % shares) * 10n ** 18n / shares).toString().padStart(18, "0")}`,
      tradeIds,
    });
  }
  return fills;
}
export function summarizeFills(fills, side = "BUY") {
  const unique = new Map();
  for (const fill of fills) {
    if (fill.side !== side) throw new Error("Mixed execution sides");
    const old = unique.get(fill.id);
    if (old && JSON.stringify(old) !== JSON.stringify(fill)) throw new Error("Conflicting execution event");
    unique.set(fill.id, fill);
  }
  const sum = (key) => safe([...unique.values()].reduce((n, f) => n + BigInt(f[key]), 0n));
  return { costMicros: sum("cashMicros"), sharesMicros: sum("sharesMicros"), feeMicros: sum("feeMicros"), fills: [...unique.values()] };
}
export function realizedSalePnl(entryCostMicros, ownedSharesMicros, soldSharesMicros, actualNetProceedsMicros) {
  if (soldSharesMicros > ownedSharesMicros || soldSharesMicros <= 0 || ownedSharesMicros <= 0) throw new Error("Sale exceeds this bot's shares");
  const allocatedCost = BigInt(entryCostMicros) * BigInt(soldSharesMicros) / BigInt(ownedSharesMicros);
  return { allocatedCostMicros: safe(allocatedCost), pnlMicros: actualNetProceedsMicros - safe(allocatedCost) };
}
