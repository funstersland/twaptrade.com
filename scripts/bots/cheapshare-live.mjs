import { createSecureClient, OrderSide, OrderType } from "@polymarket/client";
import { privateKey } from "@polymarket/client/viem";
import { fetchBalanceAllowance } from "@polymarket/client/actions";
import { AssetType } from "@polymarket/bindings/clob";
import { createPublicClient as rpcClient, http } from "viem";
import { polygon } from "viem/chains";
import { createDecipheriv } from "node:crypto";
const clients = new Map();
import {
  receiptFills,
  summarizeFills,
  signedOrderId,
} from "./cheapshare-fills.mjs";
function decrypt(run) {
  const [iv, encoded] = run.wallet_cipher.split(".");
  const bytes = Buffer.from(encoded, "base64"),
    tag = bytes.subarray(-16),
    body = bytes.subarray(0, -16);
  const d = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(process.env.TWAP_BOT_ENCRYPTION_KEY, "base64"),
    Buffer.from(iv, "base64"),
  );
  d.setAAD(Buffer.from(`${run.user_id}:${run.bot_id}`));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString("utf8");
}
export async function connect(run) {
  const old = clients.get(run.id);
  if (old?.cipher === run.wallet_cipher) return old.client;
  if (!run.wallet_cipher || !run.wallet_address)
    throw new Error("Wallet not connected");
  let key = decrypt(run);
  if (!key.startsWith("0x")) key = "0x" + key;
  const client = await createSecureClient({
    wallet: run.wallet_address,
    signer: privateKey(key),
  });
  key = "";
  clients.set(run.id, { client, cipher: run.wallet_cipher });
  return client;
}
export async function connectionState(run) {
  const client = await connect(run),
    [balance, approvals] = await Promise.all([
      fetchBalanceAllowance(client, { assetType: AssetType.COLLATERAL }),
      client.fetchTradingApprovalsState({ user: run.wallet_address }),
    ]);
  const amount = Number(balance.balance);
  if (!Number.isSafeInteger(amount))
    throw new Error("Balance exceeds supported precision");
  return {
    client,
    balanceMicros: amount,
    walletType: String(client.account.walletType),
    approved: approvals.isFullyApproved,
  };
}
export async function prepareBuy(run, tokenId, stakeMicros, maxPrice) {
  const client = await connect(run),
    amount = (stakeMicros / 1e6).toFixed(6);
  const signed = await client.createMarketOrder({
    tokenId,
    side: OrderSide.BUY,
    amount,
    maxSpend: amount,
    maxPrice,
    orderType: OrderType.FOK,
  });
  return {
    client,
    signed,
    orderId: signedOrderId(
      signed,
      client.environment.contracts.standardExchange,
    ),
  };
}
export async function submitBuy(prepared, deadline) {
  if (Date.now() >= deadline) throw new Error("Entry window closed");
  // Posting a previously signed FOK order avoids delayed approval-and-retry workflows.
  return prepared.client.postOrder(prepared.signed);
}
export async function walletShares(run, tokenId) {
  const client = await connect(run);
  const result = await fetchBalanceAllowance(client, {
    assetType: AssetType.CONDITIONAL,
    tokenId,
  });
  const shares = Number(result.balance);
  if (!Number.isSafeInteger(shares) || shares < 0)
    throw new Error("Unsupported wallet share balance");
  return shares;
}
export async function prepareSell(run, tokenId, sharesMicros, minPrice) {
  const client = await connect(run);
  const signed = await client.createMarketOrder({
    tokenId,
    side: OrderSide.SELL,
    shares: (sharesMicros / 1e6).toFixed(6),
    minPrice: String(minPrice),
    orderType: OrderType.FOK,
  });
  const requestedSharesMicros = Number(signed.makerAmount);
  if (
    !Number.isSafeInteger(requestedSharesMicros) ||
    requestedSharesMicros <= 0 ||
    requestedSharesMicros > sharesMicros
  )
    throw new Error("Sell quantity exceeds the observed wallet balance");
  return {
    client,
    signed,
    requestedSharesMicros,
    orderId: signedOrderId(
      signed,
      client.environment.contracts.standardExchange,
    ),
  };
}
export async function confirmedFill(
  run,
  round,
  side = "BUY",
  orderId = round.order_id,
) {
  const client = await connect(run);
  const order = await client.fetchOrder({ orderId });
  if (order.id.toLowerCase() !== orderId.toLowerCase()) return null;
  const trades = [];
  for await (const page of client.listAccountTrades({
    market: round.condition_id,
    after: String(round.start_seconds - 30),
  })) {
    trades.push(
      ...page.items.filter(
        (t) =>
          t.takerOrderId.toLowerCase() === orderId.toLowerCase() &&
          (t.tokenId || t.assetId) === round.token_id,
      ),
    );
  }
  const associated = new Set(order.associateTrades || []);
  if ([...associated].some((id) => !trades.some((t) => t.id === id)))
    return null;
  if (!trades.length) {
    if (
      ["CANCELED", "CANCELLED", "UNMATCHED"].includes(
        order.status.toUpperCase(),
      ) &&
      Number(order.sizeMatched) === 0
    )
      return { unfilled: true };
    return null;
  }
  if (trades.every((t) => ["FAILED", "TRADE_STATUS_FAILED"].includes(t.status)))
    return { unfilled: true };
  if (
    trades.some(
      (t) =>
        !["CONFIRMED", "TRADE_STATUS_CONFIRMED"].includes(t.status) ||
        !t.transactionHash,
    )
  )
    return null;
  const rpc = rpcClient({
    chain: polygon,
    transport: http(process.env.POLYGON_RPC_URL || client.environment.rpc, {
      retryCount: 1,
      timeout: 5000,
    }),
  });
  const fills = [];
  for (const hash of new Set(trades.map((t) => t.transactionHash))) {
    const receipt = await rpc.getTransactionReceipt({ hash });
    const found = receiptFills({
      receipt,
      orderId,
      wallet: run.wallet_address,
      tokenId: round.token_id,
      side,
      exchanges: [
        client.environment.contracts.standardExchange,
        client.environment.contracts.negRiskExchange,
      ],
      trades,
    });
    if (!found.length) return null;
    fills.push(...found);
  }
  const result = summarizeFills(fills, side);
  if (
    !result.costMicros ||
    !result.sharesMicros ||
    (side === "BUY" && result.costMicros > round.stake_micros)
  )
    return null;
  // Do not finish reconciliation while the exchange still reports unmatched size.
  if (
    !["MATCHED", "FILLED", "CANCELED", "CANCELLED"].includes(
      order.status.toUpperCase(),
    )
  )
    return null;
  return result;
}
export async function geographyAllowed() {
  const r = await fetch("https://polymarket.com/api/geoblock", {
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) return false;
  const d = await r.json();
  return d.blocked === false;
}
