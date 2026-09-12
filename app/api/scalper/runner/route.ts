import { z } from "zod";
import { database, settings } from "@/lib/server/db";
import { json, failure, HttpError } from "@/lib/server/http";
import {
  scalperBot,
  scalperFeed,
  requireScalperRunner,
  mutateScalper,
  type RunRow,
} from "@/lib/server/scalper";
import { SCALPER } from "@/lib/bots/crypto-shares/scalper/identity";
import {
  commandSchema,
  type State,
} from "@/lib/bots/crypto-shares/scalper/state";
import { analyze, quoteBuy } from "@/lib/bots/crypto-shares/scalper/rules";
const integer = z.number().int().nonnegative(),
  price = z.string().regex(/^\d{1,40}$/);
const candle = z
  .object({
    start: integer,
    end: integer,
    seconds: z.union([
      z.literal(15),
      z.literal(60),
      z.literal(180),
      z.literal(300),
    ]),
    open: price,
    high: price,
    low: price,
    close: price,
    firstAt: integer,
    lastAt: integer,
    complete: z.boolean(),
  })
  .strict()
  .refine(
    (c) =>
      c.end - c.start === c.seconds * 1000 &&
      c.start % (c.seconds * 1000) === 0 &&
      c.firstAt >= c.start &&
      c.firstAt <= c.lastAt &&
      c.lastAt < c.end &&
      BigInt(c.low) > 0n &&
      BigInt(c.low) <= BigInt(c.open) &&
      BigInt(c.low) <= BigInt(c.close) &&
      BigInt(c.high) >= BigInt(c.open) &&
      BigInt(c.high) >= BigInt(c.close),
    "Invalid candle",
  );
const level = z
  .object({ price: z.string().max(40), size: z.string().max(40) })
  .strict();
const book = z
  .object({
    at: integer,
    tokenId: z.string().regex(/^\d{1,100}$/),
    minShares: z.number().positive(),
    asks: z.array(level).max(1000),
    bids: z.array(level).max(1000),
  })
  .strict();
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("heartbeat"),
      lease: z.string().uuid(),
      geoAllowed: z.boolean(),
      latest: z.object({ at: integer, value: price }).nullable(),
      candles: z.array(candle).max(640),
      message: z.string().max(300),
      checks: z.array(z.object({ runId: z.string().uuid(), horizon: z.union([z.literal(300), z.literal(900), z.literal(3600)]), target: integer, at: integer, reason: z.string().max(300) }).strict()).max(300).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("command"),
      lease: z.string().uuid(),
      runId: z.string().uuid(),
      revision: integer,
      eventId: z.string().uuid(),
      command: commandSchema,
      book: book.optional(),
    })
    .strict(),
]);
export async function GET(req: Request) {
  try {
    await requireScalperRunner(req);
    const b = await scalperBot(),
      db = database(),
      p = await settings();
    const [rows, feed] = await Promise.all([
      db
        .prepare(
          "SELECT r.*,p.status member_status FROM scalper_runs r JOIN profiles p ON p.user_id=r.user_id WHERE r.bot_id=?",
        )
        .bind(b.id)
        .all<RunRow & { member_status: string }>(),
      scalperFeed(),
    ]);
    return json({
      runs: rows.results.map((r) => ({
        ...r,
        state: JSON.parse(r.state_json),
        state_json: undefined,
      })),
      feed,
      entriesEnabled:
        b.status === "published" && p.deploymentsOpen && !p.maintenanceMode,
      now: Date.now(),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    await requireScalperRunner(req);
    const raw = await req.text();
    if (raw.length > 500000) throw new HttpError(413, "Request too large");
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success)
      throw new HttpError(400, parsed.error.issues[0].message);
    const c = parsed.data,
      db = database(),
      now = Date.now();
    if (c.action === "heartbeat") {
      if (c.candles.some((v) => v.end > now))
        throw new HttpError(
          400,
          "An open candle cannot be published as closed",
        );
      await db
        .prepare(
          "INSERT OR IGNORE INTO scalper_feed(id,lease,lease_until,heartbeat,data_json) VALUES(?,?,0,0,?)",
        )
        .bind(SCALPER.key, c.lease, "{}")
        .run();
      const result = await db
        .prepare(
          "UPDATE scalper_feed SET lease=?,lease_until=?,heartbeat=?,data_json=? WHERE id=? AND (lease=? OR lease_until<?)",
        )
        .bind(
          c.lease,
          now + 15000,
          now,
          JSON.stringify({
            latest: c.latest,
            candles: c.candles,
            geoAllowed: c.geoAllowed,
            message: c.message,
            checks: c.checks || [],
          }),
          SCALPER.key,
          c.lease,
          now,
        )
        .run();
      if (!result.meta.changes)
        throw new HttpError(409, "Another Scalper runner owns the lease");
      return json({ ok: true });
    }
    if (
      !(await db
        .prepare(
          "SELECT id FROM scalper_feed WHERE id=? AND lease=? AND lease_until>?",
        )
        .bind(SCALPER.key, c.lease, now)
        .first())
    )
      throw new HttpError(409, "Runner lease expired");
    if (["arm", "disarm", "configure"].includes(c.command.action))
      throw new HttpError(403, "Only the member can change ARM and settings");
    const b = await scalperBot(),
      r = await db
        .prepare("SELECT * FROM scalper_runs WHERE id=? AND bot_id=?")
        .bind(c.runId, b.id)
        .first<RunRow>();
    if (!r) throw new HttpError(404, "Scalper deployment not found");
    if (
      await db
        .prepare("SELECT id FROM scalper_events WHERE id=? AND run_id=?")
        .bind(c.eventId, r.id)
        .first()
    )
      return json({ duplicate: true });
    if (c.revision !== r.revision)
      throw new HttpError(409, "Bot state changed");
    const [feed, platform, member] = await Promise.all([
      scalperFeed(),
      settings(),
      db
        .prepare("SELECT status FROM profiles WHERE user_id=?")
        .bind(r.user_id)
        .first<{ status: string }>(),
    ]);
    if (
      ["prepare", "submit"].includes(c.command.action) &&
      (member?.status !== "active" ||
        b.status !== "published" ||
        !platform.deploymentsOpen ||
        platform.maintenanceMode)
    )
      throw new HttpError(403, "New entries are paused");
    const s = JSON.parse(r.state_json) as State;
    const liveAllowed =
      !!feed &&
      now - feed.heartbeat < 10000 &&
      feed.geoAllowed &&
      !!r.wallet_cipher;
    let signal;
    if (c.command.action === "prepare") {
      signal = analyze(
        feed?.candles || [],
        feed?.latest || null,
        c.command.market.horizon,
        now,
      );
      const token =
        c.command.direction === "Up"
          ? c.command.market.upToken
          : c.command.market.downToken;
      if (
        !c.book ||
        c.book.tokenId !== token ||
        !quoteBuy(
          c.book,
          c.command.stakeCents,
          s.config,
          c.command.market.feeRate,
          c.command.market.feeExponent,
          now,
        )
      )
        throw new HttpError(409, "Entry price, fee or liquidity gate failed");
    }
    if (c.command.action === "fill" && r.mode === "paper") {
      const p = s.positions.find(
        (p) => p.id === (c.command as { positionId: string }).positionId,
      );
      const quote =
        p &&
        c.book &&
        c.book.tokenId ===
          (p.direction === "Up" ? p.market.upToken : p.market.downToken)
          ? quoteBuy(
              c.book,
              p.stakeCents,
              s.config,
              p.market.feeRate,
              p.market.feeExponent,
              now,
            )
          : null;
      if (
        !quote ||
        quote.costMicros !== c.command.costMicros ||
        quote.sharesMicros !== c.command.sharesMicros ||
        quote.feeMicros !== c.command.feeMicros
      )
        throw new HttpError(
          409,
          "Paper execution does not match the observed book",
        );
    }
    return json(
      await mutateScalper(r, c.eventId, c.command, {
        liveAllowed,
        signal,
        positionId: c.eventId,
      }),
    );
  } catch (e) {
    return failure(e);
  }
}
