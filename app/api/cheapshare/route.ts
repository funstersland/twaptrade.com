import { z } from "zod";
import { database, settings, auditStatement } from "@/lib/server/db";
import { requireUser } from "@/lib/server/auth";
import { body, json, failure, HttpError } from "@/lib/server/http";
import {
  cheapshareBot,
  feed,
  mutate,
  sealCheapshareWallet,
  type RunRow,
} from "@/lib/server/cheapshare";
import {
  initialState,
  type State,
} from "@/lib/bots/crypto-shares/cheapshare/state.ts";
import {
  configSchema,
  DEFAULT_CONFIG,
} from "@/lib/bots/crypto-shares/cheapshare/config.ts";
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
      confirmVersion: z.number().int().nullable(),
    })
    .strict(),
  z.object({ action: z.literal("disarm"), runId: z.string().uuid() }).strict(),
]);
export async function GET(req: Request) {
  try {
    const u = await requireUser(),
      b = await cheapshareBot(),
      db = database(),
      page = Math.max(
        1,
        Math.min(
          100000,
          Math.floor(Number(new URL(req.url).searchParams.get("page")) || 1),
        ),
      );
    const [rows, f] = await Promise.all([
      db
        .prepare(
          "SELECT * FROM cheapshare_runs WHERE user_id=? AND bot_id=? ORDER BY created_at",
        )
        .bind(u.id, b.id)
        .all<RunRow>(),
      feed(),
    ]);
    const runs = await Promise.all(
      rows.results.map(async (r) => ({
        id: r.id,
        mode: r.mode,
        revision: r.revision,
        walletAddress: r.wallet_address,
        hasWallet: !!r.wallet_cipher,
        state: JSON.parse(r.state_json) as State,
        history: (
          await db
            .prepare(
              "SELECT id,kind,data_json,created_at FROM cheapshare_events WHERE run_id=? AND kind IN ('closed','fill','unfilled','uncertain') ORDER BY revision DESC LIMIT 30 OFFSET ?",
            )
            .bind(r.id, (page - 1) * 30)
            .all<{
              id: string;
              kind: string;
              data_json: string;
              created_at: string;
            }>()
        ).results.map((e) => ({
          ...e,
          data: JSON.parse(e.data_json),
          data_json: undefined,
        })),
      })),
    );
    return json({
      botId: b.id,
      runs,
      feed: f,
      online: !!f && Date.now() - f.heartbeat < 10000,
      defaults: DEFAULT_CONFIG,
      page,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    const c = await body(req, schema),
      u = await requireUser(),
      b = await cheapshareBot(),
      platform = await settings(),
      db = database();
    if (
      c.action !== "disarm" &&
      (platform.maintenanceMode ||
        !platform.deploymentsOpen ||
        b.status !== "published")
    )
      throw new HttpError(403, "Bot deployment is currently paused.");
    let credentials: { address: string; cipher: string } | undefined;
    if ("walletKey" in c) {
      if (!!c.walletKey !== !!c.walletAddress)
        throw new HttpError(
          400,
          "Enter both the Polymarket account address and wallet key.",
        );
      if (c.walletKey && c.walletAddress)
        credentials = {
          address: c.walletAddress,
          cipher: await sealCheapshareWallet(c.walletKey, u.id, b.id),
        };
    }
    if (c.action === "deploy") {
      if (c.mode === "paper" && credentials)
        throw new HttpError(400, "Paper mode does not use wallet keys.");
      const id = crypto.randomUUID(),
        now = new Date().toISOString();
      const existing = await db
        .prepare(
          "SELECT id FROM cheapshare_runs WHERE user_id=? AND bot_id=? AND mode=?",
        )
        .bind(u.id, b.id, c.mode)
        .first();
      if (existing)
        throw new HttpError(
          409,
          "This mode is already deployed. Open its settings.",
        );
      await db.batch([
        db
          .prepare(
            "INSERT INTO cheapshare_runs (id,user_id,bot_id,mode,revision,last_event,state_json,wallet_address,wallet_cipher,created_at,updated_at) VALUES (?,?,?,?,0,?,?,?,?,?,?)",
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
        auditStatement(u.id, "cheapshare.deployed", id, { mode: c.mode }),
      ]);
      return json({ ok: true, id }, 201);
    }
    let r = await db
      .prepare(
        "SELECT * FROM cheapshare_runs WHERE id=? AND user_id=? AND bot_id=?",
      )
      .bind(c.runId, u.id, b.id)
      .first<RunRow>();
    if (!r) throw new HttpError(404, "Bot deployment not found.");
    if (c.action !== "disarm" && r.revision !== c.revision)
      throw new HttpError(409, "Bot state changed. Refresh and retry.");
    if (r.mode === "paper" && credentials)
      throw new HttpError(400, "Paper mode does not use wallet keys.");
    if (c.action === "disarm") {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          return json(
            await mutate(r, crypto.randomUUID(), { action: "disarm" }, false),
          );
        } catch (e) {
          if (!(e instanceof HttpError) || e.status !== 409 || attempt === 3)
            throw e;
          const latest = await db
            .prepare(
              "SELECT * FROM cheapshare_runs WHERE id=? AND user_id=? AND bot_id=?",
            )
            .bind(c.runId, u.id, b.id)
            .first<RunRow>();
          if (!latest) throw new HttpError(404, "Bot deployment not found.");
          r = latest;
        }
      }
    }
    const f = await feed(),
      liveAllowed =
        !!f && Date.now() - f.heartbeat < 10000 && f.geoAllowed === true;
    return json(
      await mutate(
        r,
        crypto.randomUUID(),
        c.action === "configure"
          ? { action: "configure", config: c.config }
          : c.action === "arm"
            ? { action: "arm", confirmVersion: c.confirmVersion }
            : { action: "disarm" },
        liveAllowed,
        credentials,
      ),
    );
  } catch (e) {
    return failure(e);
  }
}
