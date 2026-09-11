import { botFamilies } from "@/lib/bot-families";
import { z } from "zod";
import { body, failure, HttpError, json } from "@/lib/server/http";
import {
  database,
  settings,
  auditStatement,
  defaultSettings,
} from "@/lib/server/db";
import {
  requireAdmin,
  publicProfile,
  issuePasswordReset,
  profileInsert,
  type ProfileRow,
} from "@/lib/server/auth";
const userFields = {
  name: z.string().trim().min(1).max(80),
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  role: z.enum(["user", "admin", "owner"]),
  status: z.enum(["active", "suspended", "archived"]),
  notes: z.string().max(2000),
};
const config = z
  .object({
    registrationsOpen: z.boolean(),
    deploymentsOpen: z.boolean(),
    referralsEnabled: z.boolean(),
    maintenanceMode: z.boolean(),
    announcement: z.string().trim().max(500),
    supportEmail: z.union([z.literal(""), z.string().email().max(254)]),
    referralTerms: z.string().max(2000),
  })
  .strict();
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("save-user"),
      id: z.string().min(1).max(100),
      ...userFields,
    })
    .strict(),
  z
    .object({
      action: z.literal("create-user"),
      name: userFields.name,
      email: userFields.email,
      role: z.enum(["user", "admin"]),
    })
    .strict(),
  z
    .object({
      action: z.literal("reset-password"),
      id: z.string().min(1).max(100),
    })
    .strict(),
  z
    .object({
      action: z.literal("revoke-sessions"),
      id: z.string().min(1).max(100),
    })
    .strict(),
  z
    .object({
      action: z.literal("save-bot"),
      family: z.enum(botFamilies),
      id: z.string().uuid().optional(),
      name: z.string().trim().min(2).max(80),
      pair: z.string().trim().min(3).max(30),
      description: z.string().trim().max(2000),
      status: z.enum(["draft", "published", "archived"]),
      minAllocationCents: z.number().int().min(0).max(10000000000),
    })
    .strict(),
  z
    .object({
      action: z.literal("review-deployment"),
      id: z.string().uuid(),
      status: z.enum(["queued", "rejected", "stopped"]),
      note: z.string().trim().max(1000),
    })
    .strict(),
  z.object({ action: z.literal("save-settings"), settings: config }).strict(),
]);
export async function GET(request: Request) {
  try {
    const actor = await requireAdmin();
    const db = database(),
      q = new URL(request.url).searchParams;
    const view = q.get("view") || "overview";
    const page = Math.max(
      1,
      Math.min(100000, Math.floor(Number(q.get("page"))) || 1),
    );
    const pageSize = 25;
    const search = (q.get("q") || "").trim().slice(0, 100);
    const like = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    const status = q.get("status") || "all";
    const family = q.get("family") || "all";
    const userId = q.get("user") || "";
    let rows: Record<string, unknown>[] = [],
      total = 0;
    const defs: Record<
      string,
      {
        from: string;
        fields: string;
        search: string;
        sort: string;
        status?: string;
        user?: string;
      }
    > = {
      users: {
        from: "profiles p",
        fields:
          "p.*, (SELECT COUNT(*) FROM profiles r WHERE r.referred_by=p.user_id) referrals, (SELECT COUNT(*) FROM deployments d WHERE d.user_id=p.user_id) deployments",
        search: "(COALESCE(p.email,'')||' '||p.display_name||' '||p.user_id)",
        sort: "p.created_at DESC",
        status: "p.status",
      },
      bots: {
        from: "bots b",
        fields: "b.*",
        search: "(b.name||' '||b.pair)",
        sort: "b.created_at DESC",
        status: "b.status",
      },
      deployments: {
        from: "deployments d JOIN bots b ON b.id=d.bot_id JOIN profiles p ON p.user_id=d.user_id",
        fields: "d.*, b.name,b.pair,b.family,p.email",
        search: "(COALESCE(p.email,'')||' '||b.name||' '||d.id)",
        sort: "d.created_at DESC",
        status: "d.status",
        user: "d.user_id",
      },
      transactions: {
        from: "transactions t JOIN profiles p ON p.user_id=t.user_id",
        fields: "t.*,p.email",
        search:
          "(COALESCE(p.email,'')||' '||t.asset||' '||t.id||' '||COALESCE(t.provider_ref,''))",
        sort: "t.created_at DESC",
        status: "t.status",
        user: "t.user_id",
      },
      holdings: {
        from: "holdings h JOIN profiles p ON p.user_id=h.user_id",
        fields: "h.*,p.email",
        search: "(COALESCE(p.email,'')||' '||h.symbol)",
        sort: "h.updated_at DESC",
        user: "h.user_id",
      },
      referrals: {
        from: "profiles p JOIN profiles r ON r.user_id=p.referred_by",
        fields:
          "p.user_id,p.display_name,p.email,p.created_at,r.email referrer_email,r.referral_code",
        search:
          "(COALESCE(p.email,'')||' '||COALESCE(r.email,'')||' '||r.referral_code)",
        sort: "p.created_at DESC",
      },
      audit: {
        from: "audit_log a LEFT JOIN profiles p ON p.user_id=a.actor_id",
        fields: "a.*,p.email",
        search: "(a.action||' '||a.target_id||' '||COALESCE(p.email,''))",
        sort: "a.created_at DESC",
      },
    };
    if (Object.hasOwn(defs, view)) {
      const d = defs[view],
        clauses: string[] = [],
        bindings: (string | number)[] = [];
      if (view === "bots" && family !== "all") {
        if (!botFamilies.includes(family as (typeof botFamilies)[number]))
          throw new HttpError(400, "Unknown bot family.");
        clauses.push("b.family=?");
        bindings.push(family);
      }
      if (search) {
        clauses.push(`${d.search} LIKE ? ESCAPE '\\'`);
        bindings.push(like);
      }
      if (status !== "all" && d.status) {
        clauses.push(`${d.status}=?`);
        bindings.push(status);
      }
      if (userId && d.user) {
        clauses.push(`${d.user}=?`);
        bindings.push(userId);
      }
      const where = clauses.length ? " WHERE " + clauses.join(" AND ") : "";
      const [result, count] = await Promise.all([
        db
          .prepare(
            `SELECT ${d.fields} FROM ${d.from}${where} ORDER BY ${d.sort} LIMIT ? OFFSET ?`,
          )
          .bind(...bindings, pageSize, (page - 1) * pageSize)
          .all(),
        db
          .prepare(`SELECT COUNT(*) total FROM ${d.from}${where}`)
          .bind(...bindings)
          .first<{ total: number }>(),
      ]);
      rows = result.results;
      total = count!.total;
    } else if (
      !["overview", "settings", "security", "profit-loss"].includes(view)
    )
      throw new HttpError(404, "This view does not exist.");
    const summary = await db
      .prepare(
        "SELECT (SELECT COUNT(*) FROM profiles WHERE role='user' AND status!='archived') users,(SELECT COUNT(*) FROM profiles WHERE role IN ('admin','owner') AND status!='archived') admins,(SELECT COUNT(*) FROM profiles WHERE status='suspended') suspended,(SELECT COUNT(*) FROM bots WHERE status='published') published_bots,(SELECT COUNT(*) FROM deployments WHERE status='requested') pending_deployments,(SELECT COUNT(*) FROM deployments WHERE status='queued') queued_deployments,(SELECT COUNT(*) FROM transactions) transactions,(SELECT COALESCE(SUM(balance_delta_cents),0) FROM transactions WHERE status='completed') cash_balance,(SELECT COUNT(*) FROM profiles WHERE referred_by IS NOT NULL) referrals,(SELECT COUNT(*) FROM sessions WHERE expires_at>?) sessions,(SELECT COUNT(*) FROM audit_log) audit_events",
      )
      .bind(Date.now())
      .first();
    if (view === "overview") {
      rows = (
        await db
          .prepare(
            "SELECT a.*,p.email FROM audit_log a LEFT JOIN profiles p ON p.user_id=a.actor_id ORDER BY a.created_at DESC LIMIT 8",
          )
          .all()
      ).results;
    }
    return json({
      view,
      rows,
      total,
      page,
      pageSize,
      summary,
      settings: await settings(),
      actor: publicProfile(actor.profile!),
      sessionAccent: actor.sessionAccent,
      integrations: { wallet: false, execution: false, email: false },
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
    const now = new Date().toISOString();
    if (input.action === "save-settings") {
      const entries = Object.entries(input.settings).filter(([key]) =>
        Object.hasOwn(defaultSettings, key),
      );
      await db.batch([
        ...entries.map(([key, value]) =>
          db
            .prepare(
              "INSERT INTO platform_settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
            )
            .bind(key, JSON.stringify(value), now),
        ),
        auditStatement(actor.id, "platform.settings_updated", "platform", {
          fields: entries.map(([key]) => key),
        }),
      ]);
      return json({ ok: true });
    }
    if (input.action === "save-bot") {
      if (input.id) {
        const scoped = await db.prepare("SELECT strategy_key FROM bots WHERE id=?").bind(input.id).first<{strategy_key:string|null}>();
        if (scoped?.strategy_key === "crypto-shares.scalper.rejection" && (input.name !== "Scalper" || input.family !== "Crypto Shares"))
          throw new HttpError(409, "Scalper’s name and family identify its trading engine and cannot be reassigned.");
        if (scoped?.strategy_key === "crypto-shares.cheapshare.flip" && (input.name !== "CheapShare" || input.family !== "Crypto Shares"))
          throw new HttpError(409, "CheapShare's name and family identify its trading engine and cannot be reassigned.");
      }
      const id = input.id || crypto.randomUUID();
      const duplicate = await db
        .prepare(
          "SELECT id FROM bots WHERE family=? AND lower(name)=lower(?) AND id<>?",
        )
        .bind(input.family, input.name, id)
        .first();
      if (duplicate)
        throw new HttpError(
          409,
          "A bot with this name already exists in this family.",
        );
      if (input.id) {
        const result = await db
          .prepare(
            "UPDATE bots SET name=?,pair=?,family=?,description=?,status=?,min_allocation_cents=?,updated_at=? WHERE id=?",
          )
          .bind(
            input.name,
            input.pair.toUpperCase(),
            input.family,
            input.description,
            input.status,
            input.minAllocationCents,
            now,
            id,
          )
          .run();
        if (!result.meta.changes) throw new HttpError(404, "Bot not found.");
      } else {
        await db
          .prepare(
            "INSERT INTO bots (id,name,pair,family,description,status,min_allocation_cents,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            id,
            input.name,
            input.pair.toUpperCase(),
            input.family,
            input.description,
            input.status,
            input.minAllocationCents,
            actor.id,
            now,
            now,
          )
          .run();
      }
      await auditStatement(
        actor.id,
        input.id ? "bot.updated" : "bot.created",
        id,
        { name: input.name, family: input.family, status: input.status },
      ).run();
      return json({ ok: true, id });
    }
    if (input.action === "review-deployment") {
      const result = await db
        .prepare(
          "UPDATE deployments SET status=?,note=?,updated_at=? WHERE id=? AND status IN ('requested','queued')",
        )
        .bind(input.status, input.note, now, input.id)
        .run();
      if (!result.meta.changes)
        throw new HttpError(409, "This request is no longer awaiting review.");
      await auditStatement(actor.id, "deployment.reviewed", input.id, {
        status: input.status,
        note: input.note,
      }).run();
      return json({ ok: true });
    }
    if (input.action === "create-user") {
      if (input.role === "admin" && actor.role !== "owner")
        throw new HttpError(403, "Only the owner can appoint administrators.");
      if (
        await db
          .prepare("SELECT user_id FROM profiles WHERE email=?")
          .bind(input.email)
          .first()
      )
        throw new HttpError(409, "An account already uses this email.");
      const id = crypto.randomUUID();
      await db.batch([
        profileInsert(id, input.name, input.email, input.role, "password"),
        db
          .prepare("UPDATE profiles SET last_login_at = '' WHERE user_id=?")
          .bind(id),
        auditStatement(actor.id, "user.created", id, { role: input.role }),
      ]);
      const reset = await issuePasswordReset(id, actor.id);
      return json(
        {
          ok: true,
          resetPath: `/reset-password?token=${reset}`,
          message:
            "Account created. Share the secure setup link directly with this user. It expires in 30 minutes.",
        },
        201,
      );
    }
    const target = await db
      .prepare("SELECT * FROM profiles WHERE user_id=?")
      .bind(input.id)
      .first<ProfileRow>();
    if (!target) throw new HttpError(404, "User not found.");
    if (actor.role !== "owner" && target.role !== "user")
      throw new HttpError(403, "Only the owner can manage administrators.");
    if (input.action === "save-user") {
      if (
        target.role === "owner" &&
        (input.role !== "owner" ||
          input.status !== "active" ||
          input.email !== target.email)
      )
        throw new HttpError(
          400,
          "The owner’s email, role, and access cannot be changed here.",
        );
      if (input.role === "owner" && target.role !== "owner")
        throw new HttpError(
          403,
          "Ownership cannot be reassigned from this panel.",
        );
      if (input.role !== target.role && actor.role !== "owner")
        throw new HttpError(403, "Only the owner can change roles.");
      if (
        target.user_id === actor.id &&
        (input.role !== target.role || input.status !== "active")
      )
        throw new HttpError(
          400,
          "You cannot remove your own administrative access.",
        );
      const existing = await db
        .prepare("SELECT user_id FROM profiles WHERE email=? AND user_id<>?")
        .bind(input.email, input.id)
        .first();
      if (existing)
        throw new HttpError(409, "An account already uses this email.");
      const statements = [
        db
          .prepare(
            "UPDATE profiles SET display_name=?,email=?,role=?,status=?,notes=? WHERE user_id=?",
          )
          .bind(
            input.name,
            input.email,
            input.role,
            input.status,
            input.notes,
            input.id,
          ),
      ];
      if (
        input.status !== "active" ||
        input.role !== target.role ||
        input.email !== target.email
      ) {
        statements.push(
          db.prepare("DELETE FROM sessions WHERE user_id=?").bind(input.id),
        );
        statements.push(
          db
            .prepare(
              "UPDATE password_resets SET used_at=? WHERE user_id=? AND used_at IS NULL",
            )
            .bind(now, input.id),
        );
      }
      await db.batch([
        ...statements,
        auditStatement(actor.id, "user.updated", input.id, {
          role: input.role,
          status: input.status,
          emailChanged: input.email !== target.email,
        }),
      ]);
      return json({ ok: true });
    }
    if (input.action === "revoke-sessions") {
      await db.batch([
        db.prepare("DELETE FROM sessions WHERE user_id=?").bind(input.id),
        auditStatement(actor.id, "user.sessions_revoked", input.id),
      ]);
      return json({ ok: true });
    }
    if (target.status !== "active")
      throw new HttpError(
        400,
        "Reactivate this account before issuing a reset link.",
      );
    const reset = await issuePasswordReset(input.id, actor.id);
    return json({
      ok: true,
      resetPath: `/reset-password?token=${reset}`,
      message:
        "This single-use link expires in 30 minutes. Share it directly with the account holder.",
    });
  } catch (e) {
    return failure(e);
  }
}
