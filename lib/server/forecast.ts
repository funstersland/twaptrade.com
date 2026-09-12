import { env } from "cloudflare:workers";
import { database } from "./db";
import { HttpError } from "./http";
import { FORECAST } from "../bots/crypto-shares/forecast/identity.ts";
import { reduce, type Command } from "../bots/crypto-shares/forecast/state.ts";
import type { Candle, Tick } from "../bots/crypto-shares/forecast/candles.ts";
import type { Signal } from "../bots/crypto-shares/forecast/rules.ts";
export type RunRow = {
  id: string;
  user_id: string;
  bot_id: string;
  mode: "paper" | "live";
  revision: number;
  last_event: string;
  state_json: string;
  wallet_address: string | null;
  wallet_cipher: string | null;
  created_at: string;
  updated_at: string;
};
export type Feed = {
  heartbeat: number;
  geoAllowed: boolean;
  latest: Tick | null;
  candles: Candle[];
  message: string;
  checks?: { runId: string; horizon: 300 | 900 | 3600; target: number; at: number; reason: string }[];
};
export async function forecastBot() {
  const rows = await database()
    .prepare(
      "SELECT id,status FROM bots WHERE family=? AND lower(name)=lower(?) AND strategy_key=?",
    )
    .bind(FORECAST.family, FORECAST.name, FORECAST.key)
    .all<{ id: string; status: string }>();
  if (rows.results.length !== 1)
    throw new HttpError(
      404,
      "Forecast is not registered or its catalog identity needs review",
    );
  return rows.results[0];
}
export async function sealForecastWallet(
  keyText: string,
  userId: string,
  botId: string,
) {
  if (!env.TWAP_BOT_ENCRYPTION_KEY)
    throw new HttpError(503, "Secure wallet storage is not configured");
  const key = await crypto.subtle.importKey(
    "raw",
    Buffer.from(env.TWAP_BOT_ENCRYPTION_KEY, "base64"),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(`${userId}:${botId}`),
    },
    key,
    new TextEncoder().encode(keyText),
  );
  return `${Buffer.from(iv).toString("base64")}.${Buffer.from(cipher).toString("base64")}`;
}
export async function requireForecastRunner(req: Request) {
  const secret = env.TWAP_FORECAST_RUNNER_TOKEN;
  if (!secret) throw new HttpError(401, "Runner authentication required");
  const digest = (s: string) =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  const [a, b] = await Promise.all([
    digest(req.headers.get("authorization") || ""),
    digest(`Bearer ${secret}`),
  ]);
  let diff = 0;
  new Uint8Array(a).forEach((v, i) => {
    diff |= v ^ new Uint8Array(b)[i];
  });
  if (diff) throw new HttpError(401, "Runner authentication required");
}
export async function forecastFeed() {
  const row = await database()
    .prepare("SELECT heartbeat,data_json FROM forecast_feed WHERE id=?")
    .bind(FORECAST.key)
    .first<{ heartbeat: number; data_json: string }>();
  return row
    ? ({ ...JSON.parse(row.data_json), heartbeat: row.heartbeat } as Feed)
    : null;
}
export async function mutateForecast(
  row: RunRow,
  eventId: string,
  command: Command,
  context: { liveAllowed?: boolean; signal?: Signal; positionId?: string } = {},
  wallet?: { address: string; cipher: string },
) {
  const db = database();
  const duplicate = await db
    .prepare("SELECT id FROM forecast_events WHERE id=? AND run_id=?")
    .bind(eventId, row.id)
    .first();
  if (duplicate) return { duplicate: true };
  let result;
  try {
    result = reduce(JSON.parse(row.state_json), command, Date.now(), context);
  } catch (e) {
    throw new HttpError(409, (e as Error).message);
  }
  if (wallet)
    result.state.connection = {
      at: 0,
      approved: false,
      balanceMicros: null,
      message: "Waiting for wallet verification",
    };
  const revision = row.revision + 1,
    now = new Date().toISOString();
  const update = wallet
    ? "UPDATE forecast_runs SET state_json=?,revision=?,last_event=?,updated_at=?,wallet_address=?,wallet_cipher=? WHERE id=? AND revision=?"
    : "UPDATE forecast_runs SET state_json=?,revision=?,last_event=?,updated_at=? WHERE id=? AND revision=?";
  const rows = await db.batch([
    db
      .prepare(update)
      .bind(
        JSON.stringify(result.state),
        revision,
        eventId,
        now,
        ...(wallet ? [wallet.address, wallet.cipher] : []),
        row.id,
        row.revision,
      ),
    db
      .prepare(
        "INSERT OR IGNORE INTO forecast_events(id,run_id,revision,kind,data_json,created_at) SELECT ?,id,revision,?,?,? FROM forecast_runs WHERE id=? AND last_event=?",
      )
      .bind(
        eventId,
        result.closed ? "closed" : command.action,
        JSON.stringify({ command, closed: result.closed }),
        now,
        row.id,
        eventId,
      ),
  ]);
  if (!rows[0].meta.changes)
    throw new HttpError(409, "Bot state changed; refresh and retry");
  return { ok: true, revision, state: result.state };
}
