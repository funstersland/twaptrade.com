import { z } from "zod";
import { database, settings } from "@/lib/server/db";
import { json, failure, HttpError } from "@/lib/server/http";
import {
  cheapshareBot,
  requireCheapshareRunner,
  mutate,
  feed,
  type RunRow,
} from "@/lib/server/cheapshare";
import { CHEAPSHARE } from "@/lib/bots/crypto-shares/cheapshare/identity.ts";
import {
  commandSchema,
  type State,
} from "@/lib/bots/crypto-shares/cheapshare/state.ts";
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("heartbeat"),
      lease: z.string().uuid(),
      geoAllowed: z.boolean(),
      markets: z.array(z.unknown()).max(12),
      message: z.string().max(300),
    })
    .strict(),
  z
    .object({
      action: z.literal("reference"),
      lease: z.string().uuid(),
      slug: z
        .string()
        .regex(/^(btc|eth|sol|xrp|doge|hype)-updown-(5|15)m-\d+$/),
      strike: z.string().regex(/^\d{1,40}$/),
      source: z.enum(["gamma", "chainlink-open"]),
      observedAt: z.number().int(),
    })
    .strict(),
  z
    .object({
      action: z.literal("command"),
      lease: z.string().uuid(),
      runId: z.string().uuid(),
      revision: z.number().int(),
      eventId: z.string().uuid(),
      command: commandSchema,
    })
    .strict(),
]);
export async function GET(req: Request) {
  try {
    await requireCheapshareRunner(req);
    const db = database(),
      b = await cheapshareBot(),
      p = await settings();
    const [runs, refs] = await Promise.all([
      db
        .prepare(
          "SELECT r.*,p.status member_status FROM cheapshare_runs r JOIN profiles p ON p.user_id=r.user_id WHERE r.bot_id=? AND r.strategy_version=2",
        )
        .bind(b.id)
        .all<RunRow & { member_status: string }>(),
      db
        .prepare("SELECT * FROM cheapshare_markets WHERE locked_at>?")
        .bind(Date.now() - 86400000)
        .all(),
    ]);
    return json({
      runs: runs.results.map((r) => ({
        ...r,
        state: JSON.parse(r.state_json),
        state_json: undefined,
      })),
      references: refs.results,
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
    await requireCheapshareRunner(req);
    const raw = await req.text();
    if (raw.length > 3000000) throw new HttpError(413, "Request too large.");
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success)
      throw new HttpError(400, parsed.error.issues[0].message);
    const c = parsed.data,
      db = database(),
      now = Date.now();
    if (c.action === "heartbeat") {
      await db
        .prepare(
          "INSERT OR IGNORE INTO cheapshare_feed (id,lease,lease_until,heartbeat,data_json) VALUES (?,?,0,0,?)",
        )
        .bind(CHEAPSHARE.key, c.lease, "{}")
        .run();
      const updated = await db
        .prepare(
          "UPDATE cheapshare_feed SET lease=?,lease_until=?,heartbeat=?,data_json=? WHERE id=? AND (lease=? OR lease_until<?)",
        )
        .bind(
          c.lease,
          now + 15000,
          now,
          JSON.stringify({
            geoAllowed: c.geoAllowed,
            markets: c.markets,
            message: c.message,
          }),
          CHEAPSHARE.key,
          c.lease,
          now,
        )
        .run();
      if (!updated.meta.changes)
        throw new HttpError(409, "Another CheapShare runner owns the lease.");
      return json({ ok: true });
    }
    const lease = await db
      .prepare(
        "SELECT lease FROM cheapshare_feed WHERE id=? AND lease=? AND lease_until>?",
      )
      .bind(CHEAPSHARE.key, c.lease, now)
      .first();
    if (!lease) throw new HttpError(409, "Runner lease expired.");
    if (c.action === "reference") {
      const start = Number(c.slug.split("-").at(-1)) * 1000;
      if (
        BigInt(c.strike) <= 0n ||
        (c.source === "chainlink-open" && c.observedAt !== start)
      )
        throw new HttpError(
          400,
          "The fallback requires the exact opening TWAP observation.",
        );
      await db
        .prepare(
          "INSERT OR IGNORE INTO cheapshare_markets (slug,strike,source,locked_at) VALUES (?,?,?,?)",
        )
        .bind(c.slug, c.strike, c.source, start)
        .run();
      const reference = await db
        .prepare("SELECT * FROM cheapshare_markets WHERE slug=?")
        .bind(c.slug)
        .first();
      return json({ ok: true, reference });
    }
    if (["arm", "disarm", "configure"].includes(c.command.action))
      throw new HttpError(
        403,
        "Only the member may change ARM or configuration.",
      );
    const b = await cheapshareBot(),
      r = await db
        .prepare("SELECT * FROM cheapshare_runs WHERE id=? AND bot_id=? AND strategy_version=2")
        .bind(c.runId, b.id)
        .first<RunRow>();
    if (!r) throw new HttpError(404, "Run not found.");
    const old = await db
      .prepare("SELECT id FROM cheapshare_events WHERE id=? AND run_id=?")
      .bind(c.eventId, c.runId)
      .first();
    if (old) return json({ duplicate: true });
    if (r.revision !== c.revision)
      throw new HttpError(409, "Bot state changed.");
    const f = await feed(),
      p = await settings(),
      member = await db
        .prepare("SELECT status FROM profiles WHERE user_id=?")
        .bind(r.user_id)
        .first<{ status: string }>();
    const s = JSON.parse(r.state_json) as State;
    if (
      ["entry", "exit", "submit"].includes(c.command.action) &&
      member?.status !== "active"
    )
      throw new HttpError(403, "Member is not active.");
    const cmd = c.command;
    const isBuy =
      cmd.action === "entry" ||
      (cmd.action === "submit" &&
        s.positions.find((q) => q.id === cmd.positionId)?.order?.side ===
          "BUY");
    if (
      isBuy &&
      (b.status !== "published" || !p.deploymentsOpen || p.maintenanceMode)
    )
      throw new HttpError(403, "Entries are paused.");
    if (c.command.action === "entry") {
      const ref = await db
        .prepare("SELECT strike FROM cheapshare_markets WHERE slug=?")
        .bind(c.command.market.slug)
        .first<{ strike: string }>();
      if (ref?.strike !== c.command.market.strike)
        throw new HttpError(409, "Opening reference is not verified.");
    }
    return json(
      await mutate(
        r,
        c.eventId,
        c.command,
        !!f && now - f.heartbeat < 10000 && f.geoAllowed === true,
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
