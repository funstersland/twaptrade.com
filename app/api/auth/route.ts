import { z } from "zod";
import { env } from "cloudflare:workers";
import { body, failure, HttpError, json } from "@/lib/server/http";
import { database, settings, auditStatement } from "@/lib/server/db";
import {
  bootstrapOwner,
  clearRate,
  getUser,
  newSession,
  profileInsert,
  rateLimit,
  requireUser,
  sessionCookie,
} from "@/lib/server/auth";
import { digest, passwordHash, verifyPassword } from "@/lib/server/password";
const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
const password = z.string().min(12, "Use at least 12 characters.").max(128);
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("login"),
      email,
      password: z.string().min(1).max(128),
    })
    .strict(),
  z
    .object({
      action: z.literal("signup"),
      email,
      password,
      name: z.string().trim().min(1).max(80),
      referral: z.string().max(30).optional(),
    })
    .strict(),
  z.object({ action: z.literal("logout") }).strict(),
  z
    .object({
      action: z.literal("change-password"),
      currentPassword: z.string().min(1).max(128),
      password,
    })
    .strict(),
  z
    .object({
      action: z.literal("reset-password"),
      token: z.string().min(40).max(100),
      password,
    })
    .strict(),
  z.object({ action: z.literal("forgot-password"), email }).strict(),
  z.object({ action: z.literal("revoke-other-sessions") }).strict(),
]);
export async function POST(request: Request) {
  try {
    const input = await body(request, schema);
    const db = database();
    if (input.action === "logout") {
      const user = await getUser();
      if (user?.sessionHash)
        await db.batch([
          db
            .prepare("DELETE FROM sessions WHERE token_hash = ?")
            .bind(user.sessionHash),
          auditStatement(user.id, "auth.logout", user.id),
        ]);
      return json({ ok: true }, 200, {
        "Set-Cookie": sessionCookie(request, "", 0),
      });
    }
    if (input.action === "forgot-password") {
      await rateLimit(request, "recovery");
      const p = await db
        .prepare(
          "SELECT user_id FROM profiles WHERE email = ? AND status = 'active'",
        )
        .bind(input.email)
        .first<{ user_id: string }>();
      if (p)
        await auditStatement(
          p.user_id,
          "user.recovery_requested",
          p.user_id,
        ).run();
      return json({
        message:
          "Your request has been recorded. Contact the administrator to receive a secure reset link. Email delivery is not available yet.",
      });
    }
    if (input.action === "signup") {
      const config = await settings();
      if (!config.registrationsOpen || config.maintenanceMode)
        throw new HttpError(403, "Registration is currently closed.");
      await rateLimit(request, "signup");
      if (input.email === env.TWAP_ADMIN_EMAIL?.toLowerCase())
        throw new HttpError(409, "This email cannot be registered.");
      const existing = await db
        .prepare("SELECT user_id FROM profiles WHERE email = ?")
        .bind(input.email)
        .first();
      if (existing)
        throw new HttpError(
          409,
          "An account already uses this email. Please log in.",
        );
      let referrer: string | null = null;
      if (input.referral) {
        if (!config.referralsEnabled)
          throw new HttpError(400, "Referrals are currently unavailable.");
        const row = await db
          .prepare(
            "SELECT user_id FROM profiles WHERE referral_code = ? AND status = 'active'",
          )
          .bind(input.referral.toUpperCase())
          .first<{ user_id: string }>();
        if (!row) throw new HttpError(400, "This referral code is not valid.");
        referrer = row.user_id;
      }
      const id = crypto.randomUUID();
      await db.batch([
        profileInsert(
          id,
          input.name,
          input.email,
          "user",
          "password",
          referrer,
        ),
        db
          .prepare(
            "INSERT INTO credentials (user_id,password_hash,updated_at) VALUES (?, ?, ?)",
          )
          .bind(id, passwordHash(input.password), new Date().toISOString()),
        auditStatement(id, "user.registered", id, { referred: !!referrer }),
      ]);
      return json({ ok: true, redirect: "/app/dashboard?entry=1" }, 201, {
        "Set-Cookie": await newSession(request, id),
      });
    }
    if (input.action === "login") {
      const limit = await rateLimit(request, "login");
      const record = await db
        .prepare(
          "SELECT p.user_id,p.status,p.role,c.password_hash FROM profiles p JOIN credentials c ON c.user_id=p.user_id WHERE p.email=?",
        )
        .bind(input.email)
        .first<{
          user_id: string;
          status: string;
          role: string;
          password_hash: string;
        }>();
      let id: string | null = null;
      if (record) {
        if (!verifyPassword(input.password, record.password_hash))
          throw new HttpError(401, "Email or password is incorrect.");
        if (record.status !== "active")
          throw new HttpError(
            403,
            "Your account access is restricted. Contact the administrator.",
          );
        id = record.user_id;
      } else {
        id = await bootstrapOwner(input.email, input.password);
      }
      if (!id) throw new HttpError(401, "Email or password is incorrect.");
      const admin = record ? ["owner", "admin"].includes(record.role) : true;
      const config = await settings();
      if (config.maintenanceMode && !admin)
        throw new HttpError(
          503,
          "TwapTrade is currently under maintenance. Please try again later.",
        );
      await clearRate(limit);
      return json(
        {
          ok: true,
          redirect: admin
            ? "/admin/overview?entry=1"
            : "/app/dashboard?entry=1",
        },
        200,
        { "Set-Cookie": await newSession(request, id) },
      );
    }
    if (input.action === "reset-password") {
      await rateLimit(request, "reset");
      const now = new Date().toISOString();
      const hash = digest(input.token);
      const reset = await db
        .prepare(
          "SELECT r.user_id FROM password_resets r JOIN profiles p ON p.user_id=r.user_id WHERE r.token_hash=? AND r.used_at IS NULL AND r.expires_at>? AND p.status='active'",
        )
        .bind(hash, Date.now())
        .first<{ user_id: string }>();
      if (!reset)
        throw new HttpError(
          400,
          "This reset link has expired or has already been used.",
        );
      const claim = crypto.randomUUID();
      const results = await db.batch([
        db
          .prepare(
            "UPDATE password_resets SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?",
          )
          .bind(claim, hash, Date.now()),
        db
          .prepare(
            "INSERT INTO credentials (user_id,password_hash,updated_at) SELECT user_id,?,? FROM password_resets WHERE token_hash=? AND used_at=? ON CONFLICT(user_id) DO UPDATE SET password_hash=excluded.password_hash,updated_at=excluded.updated_at",
          )
          .bind(passwordHash(input.password), now, hash, claim),
        db
          .prepare(
            "UPDATE profiles SET auth_method='password' WHERE user_id IN (SELECT user_id FROM password_resets WHERE token_hash=? AND used_at=?)",
          )
          .bind(hash, claim),
        db
          .prepare(
            "DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM password_resets WHERE token_hash=? AND used_at=?)",
          )
          .bind(hash, claim),
      ]);
      if (!results[0].meta.changes)
        throw new HttpError(400, "This reset link has already been used.");
      await auditStatement(
        reset.user_id,
        "auth.password_reset",
        reset.user_id,
      ).run();
      return json(
        {
          ok: true,
          message: "Your password has been changed. You can now log in.",
        },
        200,
        { "Set-Cookie": sessionCookie(request, "", 0) },
      );
    }
    const user = await requireUser();
    if (input.action === "revoke-other-sessions") {
      await db.batch([
        db
          .prepare("DELETE FROM sessions WHERE user_id=? AND token_hash<>?")
          .bind(user.id, user.sessionHash || ""),
        auditStatement(user.id, "auth.other_sessions_revoked", user.id),
      ]);
      return json({ ok: true });
    }
    await rateLimit(request, "password-change");
    const record = await db
      .prepare("SELECT password_hash FROM credentials WHERE user_id=?")
      .bind(user.id)
      .first<{ password_hash: string }>();
    if (!record || !verifyPassword(input.currentPassword, record.password_hash))
      throw new HttpError(400, "Your current password is incorrect.");
    await db.batch([
      db
        .prepare(
          "UPDATE credentials SET password_hash=?,updated_at=? WHERE user_id=?",
        )
        .bind(passwordHash(input.password), new Date().toISOString(), user.id),
      db.prepare("DELETE FROM sessions WHERE user_id=?").bind(user.id),
      db
        .prepare(
          "UPDATE password_resets SET used_at=? WHERE user_id=? AND used_at IS NULL",
        )
        .bind(new Date().toISOString(), user.id),
      auditStatement(user.id, "auth.password_changed", user.id),
    ]);
    return json(
      {
        ok: true,
        message: "Password updated. Other sessions have been signed out.",
      },
      200,
      { "Set-Cookie": await newSession(request, user.id, user.sessionAccent) },
    );
  } catch (error) {
    return failure(error);
  }
}
