import test from "node:test";
import assert from "node:assert/strict";
import { encodeEventTopics, encodeAbiParameters } from "viem";
import {
  orderFilledAbi,
  receiptFills,
  summarizeFills,
  realizedSalePnl,
  signedOrderId,
} from "./cheapshare-fills.mjs";
const own = `0x${"11".repeat(32)}`,
  other = `0x${"22".repeat(32)}`;
const wallet = `0x${"aa".repeat(20)}`,
  exchange = `0x${"bb".repeat(20)}`,
  tx = `0x${"cc".repeat(32)}`;
const zero = `0x${"00".repeat(32)}`;
function log(
  orderId,
  index,
  { gross = 5000000n, shares = 10000000n, fee = 175000n, side = 0 } = {},
) {
  return {
    address: exchange,
    logIndex: index,
    topics: encodeEventTopics({
      abi: orderFilledAbi,
      eventName: "OrderFilled",
      args: { orderHash: orderId, maker: wallet, taker: exchange },
    }),
    data: encodeAbiParameters(
      [
        { type: "uint8" },
        ...Array(4).fill({ type: "uint256" }),
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        side,
        123n,
        side === 0 ? gross : shares,
        side === 0 ? shares : gross,
        fee,
        zero,
        zero,
      ],
    ),
  };
}
function parse(logs, side = "BUY", status = "success") {
  return receiptFills({
    receipt: { status, transactionHash: tx, blockNumber: 100n, logs },
    orderId: own,
    wallet,
    tokenId: "123",
    side,
    exchanges: [exchange],
    trades: [{ id: "trade-a", transactionHash: tx }],
  });
}
test("CheapShare: same wallet, token and transaction: another bot's fill is excluded", () => {
  const result = summarizeFills(
    parse([log(other, 1, { gross: 99000000n }), log(own, 2)]),
  );
  assert.equal(result.costMicros, 5175000);
  assert.equal(result.sharesMicros, 10000000);
  assert.equal(result.feeMicros, 175000);
  assert.equal(result.fills.length, 1);
  assert.equal(result.fills[0].price, "0.500000000000000000");
});
test("CheapShare: multiple actual prices aggregate exactly and replay does not double P/L", () => {
  const fills = parse([
    log(own, 1),
    log(own, 2, { gross: 6200000n, fee: 164920n }),
  ]);
  const result = summarizeFills([...fills, ...fills]);
  assert.equal(result.costMicros, 11539920);
  assert.equal(result.sharesMicros, 20000000);
  assert.equal(result.feeMicros, 339920);
  assert.deepEqual(
    result.fills.map((f) => f.price),
    ["0.500000000000000000", "0.620000000000000000"],
  );
});
test("CheapShare: sell accounting uses actual lower execution price and deducts actual fee", () => {
  const sell = summarizeFills(
    parse([log(own, 1, { side: 1, gross: 4700000n, fee: 174370n })], "SELL"),
    "SELL",
  );
  assert.equal(sell.costMicros, 4525630);
  assert.equal(
    realizedSalePnl(5175000, 10000000, 10000000, sell.costMicros).pnlMicros,
    -649370,
  );
  assert.throws(
    () => realizedSalePnl(5175000, 10000000, 11000000, 6000000),
    /exceeds/,
  );
});
test("CheapShare: unconfirmed, wrong exchange, opposite side and unrelated order events cannot count", () => {
  assert.equal(parse([log(own, 1)], "BUY", "reverted").length, 0);
  assert.equal(parse([{ ...log(own, 1), address: wallet }]).length, 0);
  assert.equal(parse([log(own, 1, { side: 1 }), log(other, 2)]).length, 0);
});
test("CheapShare: persisted order identity ignores the signature but binds the order amounts", () => {
  const signed = {
    salt: 1n,
    maker: wallet,
    signer: wallet,
    tokenId: 123n,
    makerAmount: 5000000n,
    takerAmount: 10000000n,
    side: "BUY",
    signatureType: 0,
    timestamp: 1n,
    metadata: zero,
    builder: zero,
  };
  const hash = signedOrderId(signed, exchange);
  assert.equal(
    signedOrderId({ ...signed, signature: "0x1234" }, exchange),
    hash,
  );
  assert.notEqual(
    signedOrderId({ ...signed, makerAmount: 6000000n }, exchange),
    hash,
  );
});
