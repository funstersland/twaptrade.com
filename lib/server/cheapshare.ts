import { env } from "cloudflare:workers";
import { database } from "./db";
import { HttpError } from "./http";
import { CHEAPSHARE } from "../bots/crypto-shares/cheapshare/identity.ts";
import {
  reduce,
  type State,
  type Command,
} from "../bots/crypto-shares/cheapshare/state.ts";
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
export async function cheapshareBot() {
  const b = await database()
    .prepare(
      "SELECT id,status FROM bots WHERE strategy_key=? AND family=? AND name=?",
    )
    .bind(CHEAPSHARE.key, CHEAPSHARE.family, CHEAPSHARE.name)
    .first<{ id: string; status: string }>();
  if (!b) throw new HttpError(404, "CheapShare is not available.");
  return b;
}
export async function requireCheapshareRunner(req: Request) {
  const secret = (env as unknown as Record<string, string>)
    .TWAP_CHEAPSHARE_RUNNER_TOKEN;
  if (!secret) throw new HttpError(401, "Runner authentication required.");
  const digest = (v: string) =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  const [a, b] = await Promise.all([
    digest(req.headers.get("authorization") || ""),
    digest(`Bearer ${secret}`),
  ]);
  let diff = 0;
  new Uint8Array(a).forEach((v, i) => {
    diff |= v ^ new Uint8Array(b)[i];
  });
  if (diff) throw new HttpError(401, "Runner authentication required.");
  if (req.headers.get("x-cheapshare-version") !== "2")
    throw new HttpError(409, "CheapShare runner version has been replaced.");
}
export async function sealCheapshareWallet(
  keyText: string,
  userId: string,
  botId: string,
) {
  if (!env.TWAP_BOT_ENCRYPTION_KEY)
    throw new HttpError(503, "Secure wallet storage is not configured.");
  const key = await crypto.subtle.importKey(
    "raw",
    Buffer.from(env.TWAP_BOT_ENCRYPTION_KEY, "base64"),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(`${userId}:${botId}`),
    },
    key,
    new TextEncoder().encode(keyText),
  );
  return `${Buffer.from(iv).toString("base64")}.${Buffer.from(sealed).toString("base64")}`;
}
export async function feed() {
  const row = await database()
    .prepare("SELECT heartbeat,data_json FROM cheapshare_feed WHERE id=?")
    .bind(CHEAPSHARE.key)
    .first<{ heartbeat: number; data_json: string }>();
  return row
    ? { heartbeat: row.heartbeat, ...JSON.parse(row.data_json) }
    : null;
}
export async function mutate(
  row: RunRow,
  eventId: string,
  command: Command,
  liveAllowed: boolean,
  wallet?: { address: string; cipher: string },
) {
  const db = database();
  const old = await db
    .prepare("SELECT id FROM cheapshare_events WHERE id=? AND run_id=?")
    .bind(eventId, row.id)
    .first();
  if (old) return { duplicate: true };
  let result;
  try {
    result = reduce(
      JSON.parse(row.state_json) as State,
      command,
      Date.now(),
      liveAllowed,
    );
  } catch (e) {
    throw new HttpError(409, (e as Error).message);
  }
  if (wallet) {
    result.state.connection = {
      status: "disconnected",
      at: 0,
      balance: null,
      message: "Waiting for wallet verification.",
    };
  }
  const revision = row.revision + 1,
    now = new Date().toISOString();
  // The journal insert is conditional on this exact CAS winning in the same transaction.
  const update = wallet
    ? "UPDATE cheapshare_runs SET state_json=?,revision=?,last_event=?,updated_at=?,wallet_address=?,wallet_cipher=? WHERE id=? AND revision=?"
    : "UPDATE cheapshare_runs SET state_json=?,revision=?,last_event=?,updated_at=? WHERE id=? AND revision=?";
  const args = [
    JSON.stringify(result.state),
    revision,
    eventId,
    now,
    ...(wallet ? [wallet.address, wallet.cipher] : []),
    row.id,
    row.revision,
  ];
  const data = { command, closed: result.closed };
  const financial = !["scan", "connection"].includes(command.action);
  const rows = await db.batch([
    db.prepare(update).bind(...args),
    ...(financial
      ? [
          db
            .prepare(
              "INSERT OR IGNORE INTO cheapshare_events (id,run_id,revision,kind,data_json,created_at) SELECT ?,id,revision,?,?,? FROM cheapshare_runs WHERE id=? AND last_event=?",
            )
            .bind(
              eventId,
              result.closed ? "closed" : command.action,
              JSON.stringify(data),
              now,
              row.id,
              eventId,
            ),
        ]
      : []),
  ]);
  if (!rows[0].meta.changes)
    throw new HttpError(409, "Bot state changed. Refresh and retry.");
  return { ok: true, revision, state: result.state };
}
