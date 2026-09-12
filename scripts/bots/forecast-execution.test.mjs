import test from "node:test";
import assert from "node:assert/strict";
import { encodeEventTopics, encodeAbiParameters } from "viem";
import {
  orderFilledAbi,
  receiptFills,
  summarizeFills,
  signedOrderId,
} from "./forecast-fills.mjs";
import { submitBuy } from "./forecast-live.mjs";
const own = "0x" + "11".repeat(32),
  other = "0x" + "22".repeat(32),
  wallet = "0x" + "aa".repeat(20),
  exchange = "0x" + "bb".repeat(20),
  tx = "0x" + "cc".repeat(32),
  zero = "0x" + "00".repeat(32);
function log(
  orderId,
  index,
  { gross = 5000000n, shares = 10000000n, fee = 175000n, token = 123n } = {},
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
      [0, token, gross, shares, fee, zero, zero],
    ),
  };
}
const parse = (logs, status = "success") =>
  receiptFills({
    receipt: { status, transactionHash: tx, blockNumber: 100n, logs },
    orderId: own,
    wallet,
    tokenId: "123",
    side: "BUY",
    exchanges: [exchange],
    trades: [{ id: "trade", transactionHash: tx }],
  });
test("Forecast attributes exact confirmed receipts and deduplicates fills across replays", () => {
  const fills = parse([
    log(other, 0),
    log(own, 1),
    log(own, 2, { gross: 5200000n, fee: 174720n }),
    log(own, 3, { token: 124n }),
  ]);
  const result = summarizeFills([...fills, ...fills]);
  assert.equal(result.fills.length, 2);
  assert.equal(result.costMicros, 10549720);
  assert.equal(result.sharesMicros, 20000000);
  assert.equal(parse([log(own, 1)], "reverted").length, 0);
  assert.equal(parse([{ ...log(own, 1), address: wallet }]).length, 0);
});
test("Forecast persists a signature-independent hash bound to order amounts and exchange", () => {
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
  assert.notEqual(signedOrderId(signed, wallet), hash);
});
test("Forecast never posts after its deadline and does not retry an uncertain submission", async () => {
  let calls = 0;
  const prepared = {
    signed: {},
    client: {
      postOrder: async () => {
        calls++;
        throw Error("Uncertain transport");
      },
    },
  };
  await assert.rejects(() => submitBuy(prepared, Date.now() - 1), /window/);
  assert.equal(calls, 0);
  await assert.rejects(
    () => submitBuy(prepared, Date.now() + 10000),
    /Uncertain/,
  );
  assert.equal(calls, 1);
});
