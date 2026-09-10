import { createPublicClient } from "@polymarket/client";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import {
  candle,
  nextLot,
  roundStart,
  paperFill,
  entryWindow,
} from "../../lib/bots/crypto-shares/continuation/rules.ts";
import {exitQuote, stableExit} from "./continuation-exit.mjs";
import { marketAt, orderBook, markValue } from "./continuation-market.mjs";
import {
  connectionState,
  prepareBuy,
  prepareSell,
  walletShares,
  submitBuy,
  confirmedFill,
  geographyAllowed,
} from "./continuation-live.mjs";
try {
  process.loadEnvFile(".dev.vars");
} catch {}
const origin = process.env.TWAP_BOT_APP_ORIGIN || "http://localhost:5173",
  base = new URL(origin);
if (
  base.protocol !== "https:" &&
  !["localhost", "127.0.0.1"].includes(base.hostname)
)
  throw new Error("Runner requires HTTPS outside localhost");
if (!process.env.TWAP_BOT_RUNNER_TOKEN || !process.env.TWAP_BOT_ENCRYPTION_KEY)
  throw new Error("Bot runner secrets are not configured");
const endpoint = origin + "/api/continuation/runner",
  lease = randomUUID();
let stopped = false,
  leaseReady = false,
  latest = null,
  opening = null,
  current = roundStart(Date.now()),
  state = { runs: [], rounds: [], orders: [], entriesEnabled: false },
  lastJobs = 0, lastReconcile = 0, reconciling = false, connecting = false;
const publicClient = createPublicClient(),
  attempted = new Set(),
  checked = new Map(),
  marketCache = new Map(),
  exitStability = new Map();
async function bridge(payload) {
  const r = await fetch(endpoint, {
    method: payload ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${process.env.TWAP_BOT_RUNNER_TOKEN}`,
      "content-type": "application/json",
      connection: "close",
    },
    ...(payload ? { body: JSON.stringify({ ...payload, lease }) } : {}),
    signal: AbortSignal.timeout(6000),
  });
  const d = await r.json();
  if (!r.ok) {
    const e = new Error(d.message || "Engine request failed");
    e.status = r.status;
    throw e;
  }
  return d;
}
async function report(payload) {
  for (let i = 0; i < 3; i++) {
    try {
      return await bridge(payload);
    } catch (e) {
      if ((e.status && e.status < 500) || i === 2) throw e;
      await sleep(150);
    }
  }
}
function toE18(value) {
  const [whole, fraction = ""] = value.split(".");
  return (
    BigInt(whole) * 10n ** 18n +
    BigInt(fraction.padEnd(18, "0").slice(0, 18))
  ).toString();
}
async function streamPrices() {
  while (!stopped) {
    try {
      const stream = await publicClient.subscribe([
        {
          topic: "prices.crypto.chainlink.twap",
          windowSeconds: 60,
          symbols: ["btc/usd"],
        },
      ]);
      for await (const event of stream) {
        const p = event.payload;
        if (p.symbol !== "btc/usd" || p.windowSeconds !== 60) continue;
        const observedAt = Number(p.timestamp),
          value = toE18(p.value);
        if (!latest || observedAt > latest.at)
          latest = { at: observedAt, value };
        if (observedAt === roundStart(observedAt) * 1000) {
          opening = { start: roundStart(observedAt), value };
        }
        if (stopped) break;
      }
    } catch {}
    if (!stopped) await sleep(2000);
  }
}
async function heartbeat() {
  current = roundStart(Date.now());
  const fresh = latest && Date.now() - latest.at < 300000;
  try {
    await bridge({
      action: "heartbeat",
      observedAt: fresh ? latest.at : null,
      priceE18: fresh ? latest.value : null,
      roundStart: current,
      openE18: opening?.start === current ? opening.value : null,
      message: !fresh
        ? "Waiting for Chainlink prices"
        : opening?.start !== current
          ? "Waiting for the next complete candle"
          : "",
    });
    leaseReady = true;
  } catch {
    leaseReady = false;
  }
}
async function market(start) {
  const cached = marketCache.get(start);
  if (cached && Date.now() - cached.at < 1000) return cached.value;
  const value = await marketAt(start);
  marketCache.set(start, { value, at: Date.now() });
  for (const key of marketCache.keys())
    if (key < current - 7200) marketCache.delete(key);
  return value;
}
async function fail(roundId, reason, uncertain = false) {
  await report({ action: "failed", roundId, reason, uncertain });
}
async function refreshConnections() {
  for (const run of state.runs) {
    if (
      run.mode !== "live" ||
      !run.wallet_cipher ||
      Date.now() - (checked.get(run.id) || 0) < 30000
    )
      continue;
    checked.set(run.id, Date.now());
    try {
      const c = await connectionState(run);
      await report({
        action: "connection",
        runId: run.id,
        walletCipher: run.wallet_cipher,
        status: c.approved ? "connected" : "error",
        walletType: c.walletType,
        balanceMicros: c.balanceMicros,
        message: c.approved
          ? ""
          : "Spending approvals are missing. Complete them on Polymarket; gasless setup may require relayer authorization.",
      });
    } catch {
      await report({
        action: "connection",
        runId: run.id,
        walletCipher: run.wallet_cipher,
        status: "error",
        walletType: null,
        balanceMicros: null,
        message:
          "Connection failed. Check the Polymarket account address and signing key.",
      });
    }
  }
}
async function reconcile() {
  await Promise.allSettled(state.rounds.map(async (q) => {
    const run = state.runs.find((r) => r.id === q.run_id);
    if (!run) return;
    try {
      if (
        q.status === "claiming" &&
        Date.now() - Date.parse(q.created_at) > 15000
      ) {
        await fail(
          q.id,
          "Entry interrupted before its result was recorded.",
          run.mode === "live",
        );
        return;
      }
      if (["submitted", "uncertain"].includes(q.status) && q.order_id) {
        const f = await confirmedFill(run, q);
        if (f?.unfilled) {
          await fail(q.id, "Order was not filled.");
          return;
        }
        if (f) {
          await report({ action: "fill", roundId: q.id, ...f });
          return;
        }
      }
      if (q.status !== "open") return;
      const exitOrder = state.orders?.find(o => o.round_id === q.id);
      if (exitOrder) {
        if (run.mode === "paper") {
          await report({action:"exit-failed",roundId:q.id,orderId:exitOrder.id,uncertain:false});
        } else {
          const f = await confirmedFill(run,q,"SELL",exitOrder.id);
          if (f?.unfilled) await report({action:"exit-failed",roundId:q.id,orderId:exitOrder.id,uncertain:false});
          else if (f) await report({action:"exit-fill",roundId:q.id,orderId:exitOrder.id,
            sharesMicros:f.sharesMicros,grossMicros:f.costMicros+f.feeMicros,feeMicros:f.feeMicros,cashMicros:f.costMicros,fills:f.fills});
        }
        return;
      }
      const m = await market(q.start_seconds);
      if (m.winner) {
        await report({ action: "resolve", roundId: q.id, winner: m.winner });
        return;
      }
      const remaining = q.shares_micros-q.sold_shares_micros;
      const book = await orderBook(q.token_id), value = markValue(book.bids, remaining);
      const available = run.mode === "live" ? await walletShares(run,q.token_id) : remaining;
      if (available < remaining) {exitStability.delete(q.id); return;}
      const quote = exitQuote(book.bids,available,m.feeRate,m.feeExponent);
      const stable = stableExit(exitStability.get(q.id),quote,Date.now());
      if (stable) exitStability.set(q.id,stable); else exitStability.delete(q.id);
      if (value !== null) await report({action:"mark",roundId:q.id,markMicros:value,exitStableSince:stable?.since || null,exitBidMicros:quote?.bidMicros || null});
      if (stable?.ready && Date.now() < (q.start_seconds+300)*1000) {
        exitStability.delete(q.id);
        await sellAtTarget(run,q,quote,stable);
      }
    } catch {
      exitStability.delete(q.id);
      /* Keep the last confirmed state; never infer a fill or outcome. */
    }
  }));
}

async function sellAtTarget(run,q,quote,stable) {
  let orderId, posted = false, claimed = false;
  try {
    let prepared;
    if (run.mode === "live") {
      if (!(await geographyAllowed())) return;
      prepared = await prepareSell(run,q.token_id,quote.sharesMicros);
      orderId = prepared.orderId;
    } else orderId = `paper-${randomUUID()}`;
    await report({action:"exit-prepare",roundId:q.id,orderId,
      sharesMicros:prepared?.requestedSharesMicros || quote.sharesMicros,
      walletSharesMicros:quote.sharesMicros,stableSince:stable.since,observedAt:stable.last,bidMicros:quote.bidMicros});
    claimed = true;
    if (run.mode === "paper") {
      const {bidMicros,...fill} = quote;
      await report({action:"exit-fill",roundId:q.id,orderId,...fill});
      return;
    }
    if (Date.now() >= (q.start_seconds+300)*1000) throw Error("Exit window ended");
    posted = true;
    const response = await submitBuy(prepared,(q.start_seconds+300)*1000);
    if (!response.ok) await report({action:"exit-failed",roundId:q.id,orderId,uncertain:false});
    else if (response.orderId.toLowerCase() !== orderId.toLowerCase() || response.status !== "matched")
      await report({action:"exit-failed",roundId:q.id,orderId,uncertain:true});
  } catch {
    if (claimed) try {await report({action:"exit-failed",roundId:q.id,orderId,uncertain:posted});} catch {}
  }
}
async function enter(run, target) {
  const marker = `${run.id}:${target}`;
  if (attempted.has(marker)) return;
  attempted.add(marker);
  for (const key of attempted)
    if (Number(key.split(":").at(-1)) < current - 600) attempted.delete(key);
  const skip = (reason) =>
    report({ action: "skip", runId: run.id, start: target, reason });
  let claim = null,
    submitted = false;
  try {
    if (state.rounds.some((r) => r.run_id === run.id))
      return await skip("Waiting for the open trade to settle.");
    if (!latest || Date.now() - latest.at > 3000 || opening?.start !== current)
      return await skip("Fresh candle data unavailable.");
    const direction = candle(opening.value, latest.value);
    if (!direction) return await skip("Flat candle.");
    const m = await market(target);
    if (!m.accepting)
      return await skip("Upcoming market is not accepting orders.");
    const lot = nextLot(run.base_lot_cents, run.loss_streak);
    if (lot === null)
      return await report({
        action: "pause",
        runId: run.id,
        reason: "The doubled lot exceeds the supported balance.",
      });
    const cash =
      run.mode === "paper" ? run.paper_cash_micros : run.wallet_balance_micros;
    if (cash === null || cash < lot * 10000)
      return await report({
        action: "pause",
        runId: run.id,
        reason: "Insufficient liquidity balance for the next lot.",
      });
    const tokenId = direction === "Up" ? m.upToken : m.downToken;
    let prepared, fill;
    if (run.mode === "live") {
      if (run.connection_status !== "connected")
        return await skip("Wallet connection is not ready.");
      if (!(await geographyAllowed()))
        return await report({
          action: "pause",
          runId: run.id,
          reason:
            "Live orders are unavailable from the engine’s current location.",
        });
      prepared = await prepareBuy(run, tokenId, lot);
    } else {
      const book = await orderBook(tokenId);
      if (!Number.isFinite(m.feeRate) || !Number.isFinite(m.feeExponent))
        return await skip("Market fee information unavailable.");
      fill = paperFill(book.asks, lot, m.feeRate, m.feeExponent);
      if (!fill)
        return await skip("Not enough shares available to fill the lot.");
    }
    if (!leaseReady || !entryWindow(Date.now(), target))
      return await skip("Entry window missed.");
    claim = await bridge({
      action: "claim",
      runId: run.id,
      start: target,
      conditionId: m.conditionId,
      tokenId,
      direction,
    });
    if (run.mode === "paper") {
      const { averagePrice, ...execution } = fill;
      await report({ action: "fill", roundId: claim.roundId, ...execution });
      return;
    }
    if (Date.now() >= target * 1000 - 5000)
      return await fail(claim.roundId, "Entry window missed.");
    // Persist the exact EIP-712 order ID before the one and only external POST.
    await report({action: "order", roundId: claim.roundId, orderId: prepared.orderId});
    submitted = true;
    const result = await submitBuy(prepared, target * 1000 - 5000);
    if (!result.ok)
      return await fail(
        claim.roundId,
        "Polymarket rejected the order. Check balance, approvals, and market availability.",
      );
    if (result.orderId.toLowerCase() !== prepared.orderId.toLowerCase())
      return await fail(claim.roundId, "Exchange order reference differs from the signed order. Reconciliation required.", true);
    await report({
      action: "order",
      roundId: claim.roundId,
      orderId: result.orderId,
    });
    if (result.status !== "matched")
      await fail(claim.roundId, "Order did not match immediately.", true);
  } catch (e) {
    if (claim) {
      try {
        await fail(
          claim.roundId,
          submitted
            ? "Order response uncertain; new entries are paused."
            : "Entry could not complete before the next round.",
          submitted,
        );
      } catch {}
    } else {
      try {
        await skip(
          e.status === 409
            ? e.message
            : "Market or connection unavailable at entry time.",
        );
      } catch {}
    }
  }
}
process.once("SIGINT", () => {
  stopped = true;
});
process.once("SIGTERM", () => {
  stopped = true;
});
void streamPrices();
await heartbeat();
let beating = false;
const beat = setInterval(async () => {if (beating) return; beating = true; try {await heartbeat();} finally {beating = false;}}, 1000);
console.log(
  "Continuation Strategy engine started. Deployments remain paused until a user presses play.",
);
while (!stopped) {
  try {
    if (!leaseReady) {
      await sleep(1000);
      continue;
    }
    const now = Date.now(),
      target = roundStart(now) + 300,
      until = target * 1000 - now;
    if (now - lastJobs >= 1000) {
      state = await bridge();
      lastJobs = now;
    }
    if (until <= 10000 && until > 5000 && state.entriesEnabled) {
      await heartbeat();
      await Promise.allSettled(
        state.runs
          .filter((r) => r.status === "running" && r.member_status === "active")
          .map((run) => enter(run, target)),
      );
    }
    if (!connecting && until > 15000) {
      connecting = true;
      void refreshConnections().catch(() => {}).finally(() => {connecting = false;});
    }
    if (!reconciling && Date.now() - lastReconcile >= 1000) {
      lastReconcile = Date.now(); reconciling = true;
      void reconcile().finally(() => {reconciling = false;});
    }
  } catch {
    console.error(
      "Continuation engine is waiting for its connection to recover.",
    );
  }
  await sleep(100);
}
clearInterval(beat);
await publicClient.closeSubscriptions();
console.log("Continuation Strategy engine stopped.");
