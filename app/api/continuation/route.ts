import { z } from "zod";
import { database, settings, auditStatement } from "@/lib/server/db";
import { requireUser } from "@/lib/server/auth";
import { body, json, failure, HttpError } from "@/lib/server/http";
import {
  continuationBot,
  sealWallet,
  openRoundSql,
} from "@/lib/server/continuation";
import { CONTINUATION } from "@/lib/bots/crypto-shares/continuation/identity";
import { nextLot } from "@/lib/bots/crypto-shares/continuation/rules";
import { continuationRisk } from "@/lib/bots/crypto-shares/continuation/performance";
import type {
  Run,
  Round,
  Feed,
} from "@/lib/bots/crypto-shares/continuation/types";
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("deploy"),
      mode: z.enum(["paper", "live"]),
      lotCents: z.number().int().min(100).max(10000000),
      force: z.boolean().default(false),
      walletAddress: z
        .string()
        .regex(/^0x[0-9a-fA-F]{40}$/)
        .optional(),
      walletKey: z
        .string()
        .regex(/^(0x)?[0-9a-fA-F]{64}$/)
        .optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("configure"),
      runId: z.string().uuid(),
      lotCents: z.number().int().min(100).max(10000000),
      walletAddress: z
        .string()
        .regex(/^0x[0-9a-fA-F]{40}$/)
        .optional(),
      walletKey: z
        .string()
        .regex(/^(0x)?[0-9a-fA-F]{64}$/)
        .optional(),
    })
    .strict(),
  z
    .object({ action: z.enum(["play", "pause"]), runId: z.string().uuid() })
    .strict(),
]);
export async function GET(request: Request) {
  try {
    const user = await requireUser(),
      db = database(),
      bot = await continuationBot();
    const params = new URL(request.url).searchParams;
    const page = Math.max(1, Math.floor(Number(params.get("page"))) || 1);
    const [runs, feed, balance] = await Promise.all([
      db
        .prepare(
          "SELECT * FROM continuation_runs WHERE user_id=? AND bot_id=? ORDER BY created_at",
        )
        .bind(user.id, bot.id)
        .all<Run>(),
      db
        .prepare(
          "SELECT heartbeat,observed_at,price_e18,round_start,open_e18,message FROM continuation_feed WHERE id=?",
        )
        .bind(CONTINUATION.key)
        .first<Feed>(),
      db
        .prepare(
          "SELECT (SELECT COALESCE(SUM(balance_delta_cents),0) FROM transactions WHERE user_id=? AND status='completed')-(SELECT COALESCE(SUM(allocation_cents),0) FROM deployments WHERE user_id=? AND status IN ('requested','queued','running')) amount",
        )
        .bind(user.id, user.id)
        .first<{ amount: number }>(),
    ]);
    const result = await Promise.all(
      runs.results.map(async (row) => {
        const { wallet_cipher, ...run } = row;
        const [history, summary, activeRound, executions, riskMetrics] = await Promise.all([
          db
            .prepare(
              "SELECT * FROM continuation_rounds WHERE run_id=? ORDER BY start_seconds DESC LIMIT 20 OFFSET ?",
            )
            .bind(run.id, (page - 1) * 20)
            .all<Round>(),
          db
            .prepare(
              "SELECT COUNT(*) \"roundCount\",COALESCE(SUM(CASE WHEN status='won' THEN 1 ELSE 0 END),0) wins,COALESCE(SUM(CASE WHEN status='lost' THEN 1 ELSE 0 END),0) losses,COALESCE(SUM(pnl_micros),0) \"pnlMicros\" FROM continuation_rounds WHERE run_id=?",
            )
            .bind(run.id)
            .first(),
          db
            .prepare(
              `SELECT * FROM continuation_rounds WHERE run_id=? AND ${openRoundSql} ORDER BY start_seconds DESC LIMIT 1`,
            )
            .bind(run.id)
            .first<Round>(),
          db.prepare("SELECT f.* FROM continuation_fills f JOIN continuation_rounds q ON q.id=f.round_id WHERE q.run_id=? AND q.id IN (SELECT id FROM continuation_rounds WHERE run_id=? ORDER BY start_seconds DESC LIMIT 20 OFFSET ?) ORDER BY f.block_number,f.log_index")
            .bind(run.id, run.id, (page - 1) * 20).all(),
          continuationRisk(db, run.id),
        ]);
        return {
          ...run,
          ...summary,
          riskMetrics,
          activeRound,
          rounds: history.results,
          fills: executions.results,
          nextLotCents: nextLot(run.base_lot_cents, run.loss_streak),
        };
      }),
    );
    return json({
      botId: bot.id,
      runs: result,
      feed,
      balanceCents: balance!.amount,
      runnerOnline: !!feed && Date.now() - feed.heartbeat < 15000,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    const input = await body(request, schema),
      user = await requireUser(),
      db = database(),
      bot = await continuationBot(),
      config = await settings(),
      now = new Date().toISOString();
    if (
      input.action !== "pause" &&
      (config.maintenanceMode ||
        !config.deploymentsOpen ||
        bot.status !== "published")
    )
      throw new HttpError(403, "Bot deployment is currently paused.");
    if (input.action === "deploy") {
      if (!!input.walletKey !== !!input.walletAddress)
        throw new HttpError(
          400,
          "Enter both the Polymarket account address and wallet key.",
        );
      const existing = await db
        .prepare(
          "SELECT id FROM continuation_runs WHERE user_id=? AND bot_id=? AND mode=?",
        )
        .bind(user.id, bot.id, input.mode)
        .first();
      if (existing)
        throw new HttpError(
          409,
          "This mode is already deployed. Open its settings.",
        );
      const balance = await db
        .prepare(
          "SELECT (SELECT COALESCE(SUM(balance_delta_cents),0) FROM transactions WHERE user_id=? AND status='completed')-(SELECT COALESCE(SUM(allocation_cents),0) FROM deployments WHERE user_id=? AND status IN ('requested','queued','running')) amount",
        )
        .bind(user.id, user.id)
        .first<{ amount: number }>();
      if (
        input.mode === "live" &&
        balance!.amount < CONTINUATION.recommendedCents &&
        !input.force
      )
        return json(
          {
            error:
              "A $1,000 account balance is recommended. Continue in paper mode or choose Force proceed.",
            code: "minimum_balance",
            balanceCents: balance!.amount,
            recommendedCents: CONTINUATION.recommendedCents,
          },
          428,
        );
      const id = crypto.randomUUID(),
        cipher =
          input.mode === "live" && input.walletKey
            ? await sealWallet(input.walletKey, user.id, bot.id)
            : null;
      await db.batch([
        db
          .prepare(
            "INSERT INTO continuation_runs (id,user_id,bot_id,mode,status,base_lot_cents,paper_cash_micros,wallet_address,wallet_cipher,connection_status,forced_minimum,created_at,updated_at) VALUES (?,?,?,?,'paused',?,?,?,?,?,?,?,?)",
          )
          .bind(
            id,
            user.id,
            bot.id,
            input.mode,
            input.lotCents,
            input.mode === "paper" ? 1_000_000_000 : 0,
            input.mode === "live" ? input.walletAddress || null : null,
            cipher,
            cipher ? "pending" : "disconnected",
            input.force ? 1 : 0,
            now,
            now,
          ),
        auditStatement(user.id, "continuation.deployed", id, {
          mode: input.mode,
          lotCents: input.lotCents,
          forcedMinimum: input.force,
        }),
      ]);
      return json({ ok: true, id }, 201);
    }
    const run = await db
      .prepare(
        "SELECT * FROM continuation_runs WHERE id=? AND user_id=? AND bot_id=?",
      )
      .bind(input.runId, user.id, bot.id)
      .first<Run>();
    if (!run) throw new HttpError(404, "Bot deployment not found.");
    if (input.action === "configure") {
      if (run.status === "running")
        throw new HttpError(409, "Pause the bot before changing its settings.");
      const open = await db
        .prepare(
          `SELECT id FROM continuation_rounds WHERE run_id=? AND ${openRoundSql}`,
        )
        .bind(run.id)
        .first();
      if (open)
        throw new HttpError(
          409,
          "Wait for the open position to settle before changing settings.",
        );
      if (!!input.walletKey !== !!input.walletAddress)
        throw new HttpError(
          400,
          "Enter both the Polymarket account address and wallet key.",
        );
      const cipher =
        run.mode === "live" && input.walletKey
          ? await sealWallet(input.walletKey, user.id, bot.id)
          : run.wallet_cipher;
      const configured = await db
        .prepare(
          `UPDATE continuation_runs SET base_lot_cents=?,wallet_address=?,wallet_cipher=?,connection_status=?,message='',updated_at=? WHERE id=? AND status!='running' AND NOT EXISTS (SELECT 1 FROM continuation_rounds WHERE run_id=continuation_runs.id AND ${openRoundSql})`,
        )
        .bind(
          input.lotCents,
          run.mode === "live"
            ? input.walletAddress || run.wallet_address
            : null,
          cipher || null,
          input.walletKey && run.mode === "live"
            ? "pending"
            : run.connection_status,
          now,
          run.id,
        )
        .run();
      if (!configured.meta.changes)
        throw new HttpError(409, "The bot state changed. Pause it and wait for its open position to settle before saving.");
    } else if (input.action === "play") {
      const feed = await db
        .prepare("SELECT heartbeat FROM continuation_feed WHERE id=?")
        .bind(CONTINUATION.key)
        .first<{ heartbeat: number }>();
      if (!feed || Date.now() - feed.heartbeat > 15000)
        throw new HttpError(
          409,
          "The bot engine is offline. Try again when it reconnects.",
        );
      if (run.mode === "live" && run.connection_status !== "connected")
        throw new HttpError(
          409,
          "Connect your Polymarket wallet in bot settings first.",
        );
      const lot = nextLot(run.base_lot_cents, run.loss_streak),
        cash =
          run.mode === "paper"
            ? run.paper_cash_micros
            : run.wallet_balance_micros;
      if (lot === null || cash === null || cash < lot * 10000)
        throw new HttpError(
          409,
          "Insufficient liquidity balance for the next lot.",
        );
      const uncertain = await db
        .prepare(
          "SELECT id FROM continuation_rounds WHERE run_id=? AND status='uncertain'",
        )
        .bind(run.id)
        .first();
      if (uncertain)
        throw new HttpError(
          409,
          "An order still needs reconciliation. The bot will wait for its confirmed status.",
        );
      await db
        .prepare(
          "UPDATE continuation_runs SET status='running',message='',updated_at=? WHERE id=?",
        )
        .bind(now, run.id)
        .run();
    } else {
      await db
        .prepare(
          "UPDATE continuation_runs SET status='paused',message='Paused. Any open position will continue to be tracked.',updated_at=? WHERE id=?",
        )
        .bind(now, run.id)
        .run();
    }
    await auditStatement(user.id, `continuation.${input.action}`, run.id).run();
    return json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
