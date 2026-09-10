import { z } from "zod";
import { body, failure, HttpError, json } from "@/lib/server/http";
import { database } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
const balanceSql =
  "(SELECT COALESCE(SUM(t.balance_delta_cents),0) FROM transactions t WHERE t.user_id=p.user_id AND t.status='completed')";
const availableSql = `${balanceSql} - (SELECT COALESCE(SUM(d.allocation_cents),0) FROM deployments d WHERE d.user_id=p.user_id AND d.status IN ('requested','queued','running'))`;
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("prepare"),
      direction: z.enum(["profit", "loss"]),
      amountCents: z
        .number()
        .int()
        .min(1, "Enter an amount greater than zero.")
        .max(10000000000),
      mode: z.enum(["single", "selected", "all"]),
      userIds: z
        .array(z.string().min(1).max(100))
        .max(400, "Select up to 400 members per batch.")
        .default([]),
    })
    .strict(),
  z.object({ action: z.literal("apply"), batchId: z.string().uuid() }).strict(),
]);
type Recipient = {
  user_id: string;
  display_name: string;
  email: string | null;
  balance_cents: number;
  available_cents: number;
};
type Batch = {
  id: string;
  actor_id: string;
  direction: "profit" | "loss";
  amount_cents: number;
  recipient_ids: string;
  status: string;
  expires_at: number;
  applied_at: string | null;
};
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const db = database(),
      params = new URL(request.url).searchParams;
    const page = Math.max(
      1,
      Math.min(100000, Math.floor(Number(params.get("page"))) || 1),
    );
    const q = (params.get("q") || "").trim().slice(0, 100);
    const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const where =
      "p.role='user' AND p.status='active' AND (p.display_name||' '||COALESCE(p.email,'')) LIKE ? ESCAPE '\\'";
    const [rows, count, totals] = await Promise.all([
      db
        .prepare(
          `SELECT p.user_id,p.display_name,p.email,${balanceSql} balance_cents,${availableSql} available_cents FROM profiles p WHERE ${where} ORDER BY p.display_name,p.user_id LIMIT 25 OFFSET ?`,
        )
        .bind(pattern, (page - 1) * 25)
        .all<Recipient>(),
      db
        .prepare(`SELECT COUNT(*) total FROM profiles p WHERE ${where}`)
        .bind(pattern)
        .first<{ total: number }>(),
      db
        .prepare(
          "SELECT (SELECT COUNT(*) FROM profiles WHERE role='user' AND status='active') members,COALESCE(SUM(CASE WHEN lower(type)='profit' THEN amount_cents ELSE 0 END),0) profit_cents,COALESCE(SUM(CASE WHEN lower(type)='loss' THEN amount_cents ELSE 0 END),0) loss_cents,COUNT(*) entries FROM transactions WHERE status='completed' AND lower(type) IN ('profit','loss')",
        )
        .first(),
    ]);
    return json({
      rows: rows.results,
      total: count!.total,
      page,
      pageSize: 25,
      totals,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    const input = await body(request, schema);
    const actor = await requireAdmin(),
      db = database();
    if (input.action === "prepare") {
      const ids = [...new Set(input.userIds)];
      if (input.mode === "single" && ids.length !== 1)
        throw new HttpError(400, "Select one member.");
      if (input.mode === "selected" && !ids.length)
        throw new HttpError(400, "Select at least one member.");
      const recipients = await db
        .prepare(
          `SELECT p.user_id,p.display_name,p.email,${balanceSql} balance_cents,${availableSql} available_cents FROM profiles p WHERE p.role='user' AND p.status='active' ${input.mode === "all" ? "" : "AND p.user_id IN (SELECT value FROM json_each(?))"} ORDER BY p.user_id LIMIT 10001`,
        )
        .bind(...(input.mode === "all" ? [] : [JSON.stringify(ids)]))
        .all<Recipient>();
      const users = recipients.results;
      if (!users.length)
        throw new HttpError(400, "No active members are selected.");
      if (users.length > 10000)
        throw new HttpError(
          400,
          "Bulk posting supports up to 10,000 active members. Use selected members for smaller batches.",
        );
      if (input.mode !== "all" && users.length !== ids.length)
        throw new HttpError(
          409,
          "Some selected members are no longer active. Refresh the list.",
        );
      const insufficient = users.filter(
        (u) => u.available_cents < input.amountCents,
      );
      if (input.direction === "loss" && insufficient.length)
        throw new HttpError(
          409,
          `Insufficient liquidity balance for ${insufficient.length} selected ${insufficient.length === 1 ? "member" : "members"}. No entries were posted.`,
        );
      const id = crypto.randomUUID(),
        expiresAt = Date.now() + 300000;
      await db
        .prepare(
          "INSERT INTO profit_loss_batches (id,actor_id,direction,amount_cents,recipient_ids,status,created_at,expires_at) VALUES (?,?,?,?,?,'prepared',?,?)",
        )
        .bind(
          id,
          actor.id,
          input.direction,
          input.amountCents,
          JSON.stringify(users.map((u) => u.user_id)),
          new Date().toISOString(),
          expiresAt,
        )
        .run();
      return json(
        {
          batchId: id,
          direction: input.direction,
          amountCents: input.amountCents,
          count: users.length,
          totalCents: users.length * input.amountCents,
          recipients: users
            .slice(0, 5)
            .map((u) => ({ name: u.display_name, email: u.email })),
          expiresAt,
        },
        201,
      );
    }
    const batch = await db
      .prepare("SELECT * FROM profit_loss_batches WHERE id=? AND actor_id=?")
      .bind(input.batchId, actor.id)
      .first<Batch>();
    if (!batch) throw new HttpError(404, "This posting could not be found.");
    const count = (JSON.parse(batch.recipient_ids) as string[]).length;
    if (batch.status === "applied")
      return json({ ok: true, count, alreadyApplied: true });
    if (batch.expires_at <= Date.now())
      throw new HttpError(
        409,
        "This review has expired. Review the selection again.",
      );
    const postingToken = crypto.randomUUID(),
      now = new Date().toISOString();
    const gate =
      "b.id=? AND b.actor_id=? AND b.status='posting' AND b.posting_token=?";
    const results = await db.batch([
      db
        .prepare(
          `UPDATE profit_loss_batches SET status='posting',posting_token=? WHERE id=? AND actor_id=? AND status='prepared' AND expires_at>? AND json_array_length(recipient_ids)=(SELECT COUNT(*) FROM profiles p JOIN json_each(profit_loss_batches.recipient_ids) r ON r.value=p.user_id WHERE p.status='active' AND p.role='user' AND (profit_loss_batches.direction='profit' OR ${availableSql} >= profit_loss_batches.amount_cents))`,
        )
        .bind(postingToken, batch.id, actor.id, Date.now()),
      db
        .prepare(
          `INSERT INTO transactions (id,user_id,type,asset,quantity,amount_cents,balance_delta_cents,status,provider_ref,created_at) SELECT b.id||':'||r.value,r.value,CASE b.direction WHEN 'profit' THEN 'Profit' ELSE 'Loss' END,'USD',printf('%.2f',b.amount_cents/100.0),b.amount_cents,CASE b.direction WHEN 'profit' THEN b.amount_cents ELSE -b.amount_cents END,'completed',NULL,? FROM profit_loss_batches b JOIN json_each(b.recipient_ids) r WHERE ${gate}`,
        )
        .bind(now, batch.id, actor.id, postingToken),
      db
        .prepare(
          `INSERT INTO portfolio_snapshots (id,user_id,value_cents,recorded_at) SELECT b.id||':'||p.user_id,p.user_id,${balanceSql}+(SELECT COALESCE(SUM(h.value_cents),0) FROM holdings h WHERE h.user_id=p.user_id),? FROM profit_loss_batches b JOIN json_each(b.recipient_ids) r JOIN profiles p ON p.user_id=r.value WHERE ${gate} AND NOT EXISTS (SELECT 1 FROM holdings h WHERE h.user_id=p.user_id AND h.value_cents IS NULL)`,
        )
        .bind(now, batch.id, actor.id, postingToken),
      db
        .prepare(
          `INSERT INTO audit_log (id,actor_id,action,target_id,details,created_at) SELECT ?,?,'profit_loss.posted',b.id,?,? FROM profit_loss_batches b WHERE ${gate}`,
        )
        .bind(
          crypto.randomUUID(),
          actor.id,
          JSON.stringify({
            direction: batch.direction,
            amountCents: batch.amount_cents,
            recipients: count,
            totalCents: batch.amount_cents * count,
          }),
          now,
          batch.id,
          actor.id,
          postingToken,
        ),
      db
        .prepare(
          "UPDATE profit_loss_batches SET status='applied',applied_at=? WHERE id=? AND actor_id=? AND status='posting' AND posting_token=?",
        )
        .bind(now, batch.id, actor.id, postingToken),
    ]);
    if (!results[0].meta.changes) {
      const state = await db
        .prepare("SELECT status FROM profit_loss_batches WHERE id=?")
        .bind(batch.id)
        .first<{ status: string }>();
      if (state?.status === "applied")
        return json({ ok: true, count, alreadyApplied: true });
      throw new HttpError(
        409,
        "Member access or available liquidity changed. No entries were posted. Review the selection again.",
      );
    }
    return json({ ok: true, count });
  } catch (e) {
    return failure(e);
  }
}
