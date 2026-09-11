import { env } from "cloudflare:workers";
import { database } from "./db";
import { HttpError } from "./http";
import { CONTINUATION } from "../bots/crypto-shares/continuation/identity";
export async function continuationBot() {
  const row = await database()
    .prepare("SELECT id,status FROM bots WHERE strategy_key=? AND family=?")
    .bind(CONTINUATION.key, CONTINUATION.family)
    .first<{ id: string; status: string }>();
  if (!row) throw new HttpError(404, "This bot is not available.");
  return row;
}
export async function sealWallet(
  privateKey: string,
  userId: string,
  botId: string,
) {
  const secret = env.TWAP_BOT_ENCRYPTION_KEY;
  if (!secret)
    throw new HttpError(503, "Secure wallet storage is not configured.");
  const key = await crypto.subtle.importKey(
    "raw",
    Buffer.from(secret, "base64"),
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
    new TextEncoder().encode(privateKey),
  );
  return `${Buffer.from(iv).toString("base64")}.${Buffer.from(cipher).toString("base64")}`;
}
export async function requireRunner(request: Request) {
  const expected = env.TWAP_BOT_RUNNER_TOKEN,
    sent = request.headers.get("authorization");
  if (!expected || !sent)
    throw new HttpError(401, "Runner authentication required.");
  const encode = (v: string) =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));
  const [a, b] = await Promise.all([
    encode(sent),
    encode(`Bearer ${expected}`),
  ]);
  let diff = 0;
  const aa = new Uint8Array(a),
    bb = new Uint8Array(b);
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  if (diff) throw new HttpError(401, "Runner authentication required.");
}
export const openRoundSql =
  "status IN ('claiming','submitted','open','uncertain')";
export const pendingRoundSql = "status IN ('claiming','submitted','uncertain')";

// With overlapping rounds, older settlements may arrive after newer results.
// Size from confirmed rounds in market order, independently of receipt order.
export function confirmedStreakStatement(runId: string) {
  return database().prepare(`UPDATE continuation_runs SET loss_streak=(
    SELECT COUNT(*) FROM continuation_rounds q WHERE q.run_id=continuation_runs.id AND q.status='lost'
    AND q.start_seconds>COALESCE((SELECT MAX(w.start_seconds) FROM continuation_rounds w
      WHERE w.run_id=continuation_runs.id AND w.status IN ('won','breakeven')),0)
  ) WHERE id=?`).bind(runId);
}
