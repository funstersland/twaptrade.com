import { z } from "zod";
import { database, settings, auditStatement } from "@/lib/server/db";
import { body, json, failure, HttpError } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import {
  scalperBot,
  scalperFeed,
  sealScalperWallet,
  mutateScalper,
  type RunRow,
} from "@/lib/server/scalper";
import {
  configSchema,
  DEFAULT_CONFIG,
} from "@/lib/bots/crypto-shares/scalper/config";
import {
  initialState,
  type State,
} from "@/lib/bots/crypto-shares/scalper/state";
import { HORIZONS } from "@/lib/bots/crypto-shares/scalper/identity";
import { analyze } from "@/lib/bots/crypto-shares/scalper/rules";
const wallet = {
  walletAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
  walletKey: z
    .string()
    .regex(/^(0x)?[0-9a-fA-F]{64}$/)
    .optional(),
};
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("deploy"),
      mode: z.enum(["paper", "live"]).default("paper"),
      config: configSchema,
      ...wallet,
    })
    .strict(),
  z
    .object({
      action: z.literal("configure"),
      runId: z.string().uuid(),
      revision: z.number().int(),
      config: configSchema,
      ...wallet,
    })
    .strict(),
  z
    .object({
      action: z.literal("arm"),
      runId: z.string().uuid(),
      revision: z.number().int(),
      confirmVersion: z.number().int(),
    })
    .strict(),
  z.object({ action: z.literal("disarm"), runId: z.string().uuid() }).strict(),
]);
export async function GET(req: Request) {
  try {
    const u = await requireUser(),
      b = await scalperBot(),
      db = database(),
      page = Math.max(
        1,
        Math.min(
          100000,
          Math.floor(Number(new URL(req.url).searchParams.get("page"))) || 1,
        ),
      );
    const [rows, feed] = await Promise.all([
      db
        .prepare(
          "SELECT * FROM scalper_runs WHERE user_id=? AND bot_id=? ORDER BY created_at",
        )
        .bind(u.id, b.id)
        .all<RunRow>(),
      scalperFeed(),
    ]);
    const runs = await Promise.all(
      rows.results.map(async (r) => {
        const history = await db
          .prepare(
            "SELECT id,kind,data_json,created_at FROM scalper_events WHERE run_id=? AND kind IN ('closed','fill','unfilled','uncertain') ORDER BY revision DESC LIMIT 30 OFFSET ?",
          )
          .bind(r.id, (page - 1) * 30)
          .all<{
            id: string;
            kind: string;
            data_json: string;
            created_at: string;
          }>();
        return {
          id: r.id,
          mode: r.mode,
          revision: r.revision,
          walletAddress: r.wallet_address,
          hasWallet: !!r.wallet_cipher,
          state: JSON.parse(r.state_json) as State,
          history: history.results.map((e) => ({
            id: e.id,
            kind: e.kind,
            createdAt: e.created_at,
            ...JSON.parse(e.data_json),
          })),
        };
      }),
    );
    return json({
      botId: b.id,
      runs,
      feed: feed ? { ...feed, checks: feed.checks?.filter(c => rows.results.some(r => r.id === c.runId)) } : null,
      online: !!feed && Date.now() - feed.heartbeat < 10000,
      defaults: DEFAULT_CONFIG,
      page,
      signals: HORIZONS.map((horizon) => ({
        horizon,
        ...analyze(
          feed?.candles || [],
          feed?.latest || null,
          horizon,
          Date.now(),
        ),
      })),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    const c = await body(req, schema),
      u = await requireUser(),
      b = await scalperBot(),
      db = database(),
      platform = await settings();
    if (
      c.action !== "disarm" &&
      (!platform.deploymentsOpen ||
        platform.maintenanceMode ||
        b.status !== "published")
    )
      throw new HttpError(403, "Scalper deployments are paused");
    let credentials: { address: string; cipher: string } | undefined;
    if ("walletKey" in c || "walletAddress" in c) {
      if (!!c.walletKey !== !!c.walletAddress)
        throw new HttpError(400, "Enter both wallet address and signing key");
      if (c.walletKey && c.walletAddress)
        credentials = {
          address: c.walletAddress,
          cipher: await sealScalperWallet(c.walletKey, u.id, b.id),
        };
    }
    if (c.action === "deploy") {
      if (c.mode === "paper" && credentials)
        throw new HttpError(400, "Paper mode does not use a wallet");
      const existing = await db
        .prepare(
          "SELECT id FROM scalper_runs WHERE user_id=? AND bot_id=? AND mode=?",
        )
        .bind(u.id, b.id, c.mode)
        .first();
      if (existing) throw new HttpError(409, "This mode is already deployed");
      const id = crypto.randomUUID(),
        now = new Date().toISOString();
      await db.batch([
        db
          .prepare(
            "INSERT INTO scalper_runs(id,user_id,bot_id,mode,revision,last_event,state_json,wallet_address,wallet_cipher,created_at,updated_at) VALUES(?,?,?,?,0,?,?,?,?,?,?)",
          )
          .bind(
            id,
            u.id,
            b.id,
            c.mode,
            id,
            JSON.stringify(initialState(c.mode, c.config)),
            credentials?.address || null,
            credentials?.cipher || null,
            now,
            now,
          ),
        auditStatement(u.id, "scalper.deployed", id, { mode: c.mode }),
      ]);
      return json({ ok: true, id }, 201);
    }
    let row = await db
      .prepare(
        "SELECT * FROM scalper_runs WHERE id=? AND user_id=? AND bot_id=?",
      )
      .bind(c.runId, u.id, b.id)
      .first<RunRow>();
    if (!row) throw new HttpError(404, "Scalper deployment not found");
    if (row.mode === "paper" && credentials)
      throw new HttpError(400, "Paper mode does not use wallet keys");
    if (c.action === "disarm") {
      for (let i = 0; i < 4; i++)
        try {
          return json(
            await mutateScalper(row, crypto.randomUUID(), { action: "disarm" }),
          );
        } catch (e) {
          if (!(e instanceof HttpError) || e.status !== 409 || i === 3) throw e;
          row = (await db
            .prepare(
              "SELECT * FROM scalper_runs WHERE id=? AND user_id=? AND bot_id=?",
            )
            .bind(c.runId, u.id, b.id)
            .first<RunRow>())!;
        }
    }
    if (c.action === "disarm")
      throw new HttpError(409, "Refresh the bot state");
    if (c.revision !== row.revision)
      throw new HttpError(409, "Bot state changed; refresh and retry");
    const feed = await scalperFeed();
    return json(
      await mutateScalper(
        row,
        crypto.randomUUID(),
        c.action === "configure"
          ? { action: "configure", config: c.config }
          : { action: "arm", confirmVersion: c.confirmVersion },
        {
          liveAllowed:
            !!feed &&
            Date.now() - feed.heartbeat < 10000 &&
            feed.geoAllowed &&
            !!row.wallet_cipher,
        },
        credentials,
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
