import { z } from "zod";
import {fillSchema, exitSchemas, handleExit, fillStatement} from "@/lib/server/continuation-exits";
import { database, settings } from "@/lib/server/db";
import {
  requireRunner,
  continuationBot,
  openRoundSql,
  pendingRoundSql,
  confirmedStreakStatement,
} from "@/lib/server/continuation";
import { json, failure, HttpError } from "@/lib/server/http";
import { CONTINUATION } from "@/lib/bots/crypto-shares/continuation/identity";
import {
  candle,
  entryWindow,
  nextLot,
} from "@/lib/bots/crypto-shares/continuation/rules";
import type { Run, Round } from "@/lib/bots/crypto-shares/continuation/types";
const id = z.string().uuid(),
  integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  price = z.string().regex(/^\d{1,40}$/),
  reason = z.string().max(300);
const schema = z.discriminatedUnion("action", [
  ...exitSchemas,
  z
    .object({
      action: z.literal("heartbeat"),
      lease: id,
      observedAt: integer.nullable(),
      priceE18: price.nullable(),
      roundStart: integer,
      openE18: price.nullable(),
      message: reason,
    })
    .strict(),
  z
    .object({
      action: z.literal("connection"),
      lease: id,
      runId: id,
      status: z.enum(["connected", "error"]),
      walletCipher: z.string().max(1000),
      walletType: z.string().max(30).nullable(),
      balanceMicros: integer.nullable(),
      message: reason,
    })
    .strict(),
  z
    .object({
      action: z.literal("claim"),
      lease: id,
      runId: id,
      start: integer,
      conditionId: z.string().max(100),
      tokenId: z.string().max(100),
      direction: z.enum(["Up", "Down"]),
    })
    .strict(),
  z
    .object({
      action: z.literal("skip"),
      lease: id,
      runId: id,
      start: integer,
      reason,
    })
    .strict(),
  z
    .object({
      action: z.literal("order"),
      lease: id,
      roundId: id,
      orderId: z.string().min(1).max(200),
    })
    .strict(),
  z
    .object({
      action: z.literal("fill"),
      lease: id,
      roundId: id,
      costMicros: integer,
      sharesMicros: integer,
      feeMicros: integer,
      fills: z.array(fillSchema).max(200).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("mark"),
      lease: id,
      roundId: id,
      markMicros: integer,
      exitStableSince: integer.nullable().optional(),
      exitBidMicros: integer.nullable().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("resolve"),
      lease: id,
      roundId: id,
      winner: z.enum(["Up", "Down"]),
    })
    .strict(),
  z
    .object({
      action: z.literal("failed"),
      lease: id,
      roundId: id,
      uncertain: z.boolean(),
      reason,
    })
    .strict(),
  z
    .object({ action: z.literal("pause"), lease: id, runId: id, reason })
    .strict(),
]);
export async function GET(request: Request) {
  try {
    await requireRunner(request);
    const db = database(),
      bot = await continuationBot(),
      config = await settings();
    const runs = await db
      .prepare(
        "SELECT r.*,p.status member_status FROM continuation_runs r JOIN profiles p ON p.user_id=r.user_id WHERE r.bot_id=? ORDER BY r.created_at",
      )
      .bind(bot.id)
      .all<Run>();
    const rounds = await db
      .prepare(
        `SELECT q.* FROM continuation_rounds q JOIN continuation_runs r ON r.id=q.run_id WHERE r.bot_id=? AND q.${openRoundSql} ORDER BY q.start_seconds`,
      )
      .bind(bot.id)
      .all<Round>();
    return json({
      orders: (await db.prepare("SELECT o.* FROM continuation_orders o JOIN continuation_rounds q ON q.id=o.round_id JOIN continuation_runs r ON r.id=q.run_id WHERE r.bot_id=? AND o.status IN ('prepared','uncertain')").bind(bot.id).all()).results,
      runs: runs.results,
      rounds: rounds.results,
      entriesEnabled:
        bot.status === "published" &&
        config.deploymentsOpen &&
        !config.maintenanceMode,
      now: Date.now(),
      entryLeadSeconds: CONTINUATION.leadSeconds,
      waitsForResolution: false,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    await requireRunner(request);
    const text = await request.text();
    if (text.length > 250000) throw new HttpError(413, "Request too large.");
    let parsed;
    try {
      parsed = schema.safeParse(JSON.parse(text));
    } catch {
      throw new HttpError(400, "Invalid event.");
    }
    if (!parsed.success) throw new HttpError(400, "Invalid event.");
    const input = parsed.data,
      db = database(),
      now = Date.now(),
      iso = new Date(now).toISOString();
    if (input.action === "heartbeat") {
      if (
        input.observedAt !== null &&
        (input.observedAt > now + 2000 || input.observedAt < now - 300000)
      )
        throw new HttpError(400, "Stale feed event.");
      const result = await db
        .prepare(
          "INSERT INTO continuation_feed (id,heartbeat,observed_at,price_e18,round_start,open_e18,lease_token,lease_until,message) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET heartbeat=excluded.heartbeat,observed_at=excluded.observed_at,price_e18=excluded.price_e18,round_start=excluded.round_start,open_e18=excluded.open_e18,lease_token=excluded.lease_token,lease_until=excluded.lease_until,message=excluded.message WHERE continuation_feed.lease_until<? OR continuation_feed.lease_token=?",
        )
        .bind(
          CONTINUATION.key,
          now,
          input.observedAt,
          input.priceE18,
          input.roundStart,
          input.openE18,
          input.lease,
          now + 20000,
          input.message,
          now,
          input.lease,
        )
        .run();
      if (!result.meta.changes)
        throw new HttpError(409, "Another engine owns the lease.");
      return json({ ok: true });
    }
    const feed = await db
      .prepare(
        "SELECT * FROM continuation_feed WHERE id=? AND lease_token=? AND lease_until>?",
      )
      .bind(CONTINUATION.key, input.lease, now)
      .first<{
        round_start: number;
        open_e18: string | null;
        price_e18: string | null;
        observed_at: number | null;
      }>();
    if (!feed) throw new HttpError(409, "Engine lease expired.");
    const bot = await continuationBot();
    const run =
      "runId" in input
        ? await db
            .prepare("SELECT * FROM continuation_runs WHERE id=? AND bot_id=?")
            .bind(input.runId, bot.id)
            .first<Run>()
        : null;
    if ("runId" in input && !run)
      throw new HttpError(404, "Deployment not found.");
    if (input.action === "connection") {
      await db
        .prepare(
          "UPDATE continuation_runs SET connection_status=?,wallet_type=?,wallet_balance_micros=?,checked_at=?,message=?,updated_at=? WHERE id=? AND wallet_cipher=?",
        )
        .bind(
          input.status,
          input.walletType,
          input.balanceMicros,
          now,
          input.message,
          iso,
          input.runId,
          input.walletCipher,
        )
        .run();
      return json({ ok: true });
    }
    if (input.action === "pause") {
      await db
        .prepare(
          "UPDATE continuation_runs SET status='paused',message=?,updated_at=? WHERE id=?",
        )
        .bind(input.reason, iso, input.runId)
        .run();
      return json({ ok: true });
    }
    if (input.action === "skip") {
      if (input.start !== Math.floor(now / 300000) * 300 + 300)
        throw new HttpError(400, "Only the next round can be recorded.");
      await db
        .prepare(
          "INSERT OR IGNORE INTO continuation_rounds (id,run_id,start_seconds,market_slug,stake_cents,status,reason,created_at,updated_at) SELECT ?,?,?,?,0,'skipped',?,?,? WHERE EXISTS (SELECT 1 FROM continuation_runs WHERE id=? AND status='running')",
        )
        .bind(
          crypto.randomUUID(),
          input.runId,
          input.start,
          `btc-updown-5m-${input.start}`,
          input.reason,
          iso,
          iso,
          input.runId,
        )
        .run();
      return json({ ok: true });
    }
    if (input.action === "claim") {
      const config = await settings();
      if (
        !config.deploymentsOpen ||
        config.maintenanceMode ||
        bot.status !== "published"
      )
        throw new HttpError(409, "New entries paused.");
      if (!entryWindow(now, input.start))
        throw new HttpError(409, "Entry window closed.");
      if (
        !feed.open_e18 ||
        !feed.price_e18 ||
        !feed.observed_at ||
        now - feed.observed_at > 3000 ||
        feed.round_start !== input.start - 300 ||
        candle(feed.open_e18, feed.price_e18) !== input.direction
      )
        throw new HttpError(409, "Candle signal unavailable or changed.");
      const lot = nextLot(run!.base_lot_cents, run!.loss_streak),
        cash =
          run!.mode === "paper"
            ? run!.paper_cash_micros
            : run!.wallet_balance_micros;
      if (lot === null || cash === null || cash < lot * 10000)
        throw new HttpError(409, "Insufficient liquidity balance.");
      if (run!.mode === "live" && (run!.connection_status !== "connected" || !run!.checked_at || now-run!.checked_at > 60000))
        throw new HttpError(409, "Wallet connection is not current.");
      const rowId = crypto.randomUUID();
      const result = await db
        .prepare(
          `INSERT OR IGNORE INTO continuation_rounds (id,run_id,start_seconds,market_slug,condition_id,token_id,direction,stake_cents,status,reference_price,signal_price,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,'claiming',?,?,?,? WHERE EXISTS (SELECT 1 FROM continuation_runs r JOIN profiles p ON p.user_id=r.user_id WHERE r.id=? AND r.status='running' AND p.status='active' AND r.base_lot_cents=? AND r.loss_streak=? AND (CASE WHEN r.mode='paper' THEN r.paper_cash_micros ELSE r.wallet_balance_micros END)>=?) AND NOT EXISTS (SELECT 1 FROM continuation_rounds WHERE run_id=? AND ${pendingRoundSql}) AND NOT EXISTS (SELECT 1 FROM continuation_orders o JOIN continuation_rounds q ON q.id=o.round_id WHERE q.run_id=? AND o.status IN ('prepared','uncertain'))`,
        )
        .bind(
          rowId,
          run!.id,
          input.start,
          `btc-updown-5m-${input.start}`,
          input.conditionId,
          input.tokenId,
          input.direction,
          lot,
          feed.open_e18,
          feed.price_e18,
          iso,
          iso,
          run!.id,
          run!.base_lot_cents,
          run!.loss_streak,
          lot * 10000,
          run!.id,
          run!.id,
        )
        .run();
      if (!result.meta.changes)
        throw new HttpError(
          409,
          "An entry already exists, an order is pending, or the bot state changed.",
        );
      return json({ ok: true, roundId: rowId, stakeCents: lot });
    }
    const round = await db
      .prepare(
        "SELECT q.*,r.mode,r.user_id FROM continuation_rounds q JOIN continuation_runs r ON r.id=q.run_id WHERE q.id=? AND r.bot_id=?",
      )
      .bind(input.roundId, bot.id)
      .first<Round & { mode: string; user_id: string }>();
    if (!round) throw new HttpError(404, "Round not found.");
    if (input.action === "exit-prepare" || input.action === "exit-fill" || input.action === "exit-failed") return await handleExit(input,round);
    if (input.action === "order") {
      if (round.order_id && round.order_id !== input.orderId)
        throw new HttpError(409, "Order reference already recorded.");
      await db
        .prepare(
          "UPDATE continuation_rounds SET order_id=?,status='submitted',updated_at=? WHERE id=? AND status IN ('claiming','submitted')",
        )
        .bind(input.orderId, iso, round.id)
        .run();
      return json({ ok: true });
    }
    if (input.action === "fill") {
      if (
        input.costMicros > round.stake_cents * 10000 ||
        !input.sharesMicros ||
        !input.costMicros
      )
        throw new HttpError(400, "Fill exceeds the lot budget or is empty.");
      if (round.mode === "live" && !round.order_id)
        throw new HttpError(409, "Order reference required.");
      const fills = input.fills || [];
      if (round.mode === "live") {
        if (!fills.length || new Set(fills.map(f => f.id)).size !== fills.length || fills.some(f =>
          f.side !== "BUY" || f.orderId !== round.order_id || f.tokenId !== round.token_id || f.id !== `${f.transactionHash.toLowerCase()}:${f.logIndex}` ||
          f.cashMicros !== f.grossMicros + f.feeMicros)) throw new HttpError(400, "Invalid order-specific executions.");
        for (const [key, total] of [["cashMicros", input.costMicros], ["sharesMicros", input.sharesMicros], ["feeMicros", input.feeMicros]] as const)
          if (fills.reduce((n, f) => n+BigInt(f[key]), 0n) !== BigInt(total)) throw new HttpError(400, "Execution totals do not match.");
        if (!["claiming", "submitted", "uncertain"].includes(round.status)) {
          if (round.cost_micros !== input.costMicros || round.shares_micros !== input.sharesMicros || round.fee_micros !== input.feeMicros)
            throw new HttpError(409, "Confirmed fill cannot be changed.");
          return json({ok: true, alreadyRecorded: true});
        }
      } else if (fills.length) throw new HttpError(400, "Paper fills cannot contain live executions.");
      const gate = "id=? AND status IN ('claiming','submitted','uncertain')";
      await db.batch([
        ...fills.map(f => fillStatement(f,round.id,iso)),
        db
          .prepare(
            `UPDATE continuation_runs SET paper_cash_micros=paper_cash_micros-?,updated_at=? WHERE id=? AND mode='paper' AND EXISTS (SELECT 1 FROM continuation_rounds WHERE ${gate})`,
          )
          .bind(input.costMicros, iso, round.run_id, round.id),
        db
          .prepare(
            `UPDATE continuation_rounds SET status='open',cost_micros=?,shares_micros=?,fee_micros=?,updated_at=? WHERE ${gate}`,
          )
          .bind(
            input.costMicros,
            input.sharesMicros,
            input.feeMicros,
            iso,
            round.id,
          ),
      ]);
      return json({ ok: true });
    }
    if (input.action === "mark") {
      await db
        .prepare(
          "UPDATE continuation_rounds SET mark_micros=?,exit_stable_since=?,exit_bid_micros=?,updated_at=? WHERE id=? AND status='open'",
        )
        .bind(input.markMicros, input.exitStableSince ?? null, input.exitBidMicros ?? null, iso, round.id)
        .run();
      return json({ ok: true });
    }
    if (input.action === "resolve") {
      if (now < (round.start_seconds + 300) * 1000)
        throw new HttpError(409, "This round has not ended.");
      const pendingExit = await db.prepare("SELECT id FROM continuation_orders WHERE round_id=? AND status IN ('prepared','uncertain')").bind(round.id).first();
      if (pendingExit) throw new HttpError(409,"Wait for the exit order to confirm.");
      const payout = input.winner === round.direction ? round.shares_micros-round.sold_shares_micros : 0,
        pnl = round.sale_proceeds_micros + payout - round.cost_micros,
        won = pnl >= 0;
      await db.batch([
        db
          .prepare(
            "UPDATE continuation_runs SET paper_cash_micros=paper_cash_micros+CASE WHEN mode='paper' THEN ? ELSE 0 END,updated_at=? WHERE id=? AND EXISTS (SELECT 1 FROM continuation_rounds WHERE id=? AND status='open')",
          )
          .bind(payout, iso, round.run_id, round.id),
        db
          .prepare(
            "UPDATE continuation_rounds SET status=?,winner=?,payout_micros=?,pnl_micros=?,mark_micros=?,updated_at=? WHERE id=? AND status='open'",
          )
          .bind(
            won ? "won" : "lost",
            input.winner,
            payout,
            pnl,
            payout,
            iso,
            round.id,
          ),
        confirmedStreakStatement(round.run_id),
      ]);
      return json({ ok: true });
    }
    if (input.action === "failed") {
      await db
        .prepare(
          "UPDATE continuation_rounds SET status=?,reason=?,updated_at=? WHERE id=? AND status IN ('claiming','submitted','uncertain')",
        )
        .bind(
          input.uncertain ? "uncertain" : "unfilled",
          input.reason,
          iso,
          round.id,
        )
        .run();
      if (input.uncertain)
        await db
          .prepare(
            "UPDATE continuation_runs SET status='paused',message='Order status is uncertain. Waiting for reconciliation.',updated_at=? WHERE id=?",
          )
          .bind(iso, round.run_id)
          .run();
      return json({ ok: true });
    }
    return json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
