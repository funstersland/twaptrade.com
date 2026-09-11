import { z } from "zod";
import { body, failure, json, HttpError } from "@/lib/server/http";
import { database, settings, auditStatement } from "@/lib/server/db";
import { requireUser } from "@/lib/server/auth";
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("deploy"),
      botId: z.string().uuid(),
      allocationCents: z.number().int().min(0).max(10000000000),
    })
    .strict(),
  z.object({ action: z.literal("stop"), id: z.string().uuid() }).strict(),
]);
export async function POST(request: Request) {
  try {
    const input = await body(request, schema);
    const user = await requireUser();
    const db = database();
    const config = await settings();
    if (config.maintenanceMode)
      throw new HttpError(
        503,
        "Deployment changes are paused during maintenance.",
      );
    if (input.action === "stop") {
      const result = await db
        .prepare(
          "UPDATE deployments SET status='stopped',updated_at=? WHERE id=? AND user_id=? AND status IN ('requested','queued')",
        )
        .bind(new Date().toISOString(), input.id, user.id)
        .run();
      if (!result.meta.changes)
        throw new HttpError(
          409,
          "This deployment cannot be stopped or is no longer available.",
        );
      await auditStatement(user.id, "deployment.stopped", input.id).run();
      return json({ ok: true });
    }
    if (!config.deploymentsOpen)
      throw new HttpError(403, "Deployments are currently closed.");
    const strategy = await db
      .prepare("SELECT strategy_key FROM bots WHERE id=?")
      .bind(input.botId)
      .first<{ strategy_key: string | null }>();
    if (strategy?.strategy_key === "crypto-shares.continuation.btc5m" || strategy?.strategy_key === "crypto-shares.cheapshare.flip")
      throw new HttpError(
        409,
        "Deploy this bot using its own settings and controls.",
      );
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    const result = await db
      .prepare(
        "INSERT INTO deployments (id,user_id,bot_id,allocation_cents,status,note,created_at,updated_at) SELECT ?,?,b.id,?,'queued','',?,? FROM bots b WHERE b.id=? AND b.status='published' AND b.min_allocation_cents<=? AND ? <= (SELECT COALESCE(SUM(balance_delta_cents),0) FROM transactions WHERE user_id=? AND status='completed') - (SELECT COALESCE(SUM(allocation_cents),0) FROM deployments WHERE user_id=? AND status IN ('requested','queued','running')) AND NOT EXISTS (SELECT 1 FROM deployments WHERE user_id=? AND bot_id=b.id AND status IN ('requested','queued','running'))",
      )
      .bind(
        id,
        user.id,
        input.allocationCents,
        now,
        now,
        input.botId,
        input.allocationCents,
        input.allocationCents,
        user.id,
        user.id,
        user.id,
      )
      .run();
    if (!result.meta.changes) {
      const bot = await db
        .prepare(
          "SELECT min_allocation_cents FROM bots WHERE id=? AND status='published'",
        )
        .bind(input.botId)
        .first<{ min_allocation_cents: number }>();
      if (!bot)
        throw new HttpError(
          409,
          "This bot is no longer available for deployment.",
        );
      const existing = await db
        .prepare(
          "SELECT id FROM deployments WHERE user_id=? AND bot_id=? AND status IN ('requested','queued','running')",
        )
        .bind(user.id, input.botId)
        .first();
      if (existing) throw new HttpError(409, "This bot is already deployed.");
      const balance = await db
        .prepare(
          "SELECT (SELECT COALESCE(SUM(balance_delta_cents),0) FROM transactions WHERE user_id=? AND status='completed') - (SELECT COALESCE(SUM(allocation_cents),0) FROM deployments WHERE user_id=? AND status IN ('requested','queued','running')) available",
        )
        .bind(user.id, user.id)
        .first<{ available: number }>();
      const required = Math.max(
        bot.min_allocation_cents,
        input.allocationCents,
      );
      const money = (cents: number) =>
        new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
        }).format(cents / 100);
      if (balance!.available < required)
        throw new HttpError(
          409,
          `Insufficient liquidity balance. Required: ${money(required)}. Available: ${money(balance!.available)}.`,
        );
      if (input.allocationCents < bot.min_allocation_cents)
        throw new HttpError(
          400,
          `The minimum allocation for this bot is ${money(bot.min_allocation_cents)}.`,
        );
      throw new HttpError(
        409,
        "Your account changed while deploying. Refresh your balance and try again.",
      );
    }
    await auditStatement(user.id, "deployment.deployed", id, {
      botId: input.botId,
      allocationCents: input.allocationCents,
    }).run();
    return json(
      {
        ok: true,
        message:
          "Bot deployed. Trading will begin when execution is connected.",
      },
      201,
    );
  } catch (error) {
    return failure(error);
  }
}
