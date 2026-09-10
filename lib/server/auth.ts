import { cookies } from "next/headers";
import { env } from "cloudflare:workers";

import { database, auditStatement } from "./db";
import { HttpError } from "./http";
import { digest, token, verifyPassword } from "./password";
import type { Profile, Role } from "../models";
import { defaultPreferences, validPreferences } from "../appearance";
export type ProfileRow = {
  user_id: string;
  display_name: string;
  email: string | null;
  role: Role;
  status: string;
  referral_code: string;
  created_at: string;
  last_login_at: string;
  preferences: string;
  auth_method: string;
  welcome_seen: number;
};
export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: string;
  authMethod: string;
  sessionHash?: string;
  sessionAccent: string;
  profile: ProfileRow | null;
};
export function publicProfile(p: ProfileRow): Profile {
  return {
    userId: p.user_id,
    name: p.display_name,
    email: p.email || "",
    role: p.role,
    status: p.status,
    referralCode: p.referral_code,
    createdAt: p.created_at,
    lastLoginAt: p.last_login_at,
    preferences: {
      ...defaultPreferences,
      ...validPreferences(JSON.parse(p.preferences)),
    },
    authMethod: p.auth_method,
  };
}
export async function getUser(): Promise<AuthUser | null> {
  const jar = await cookies();
  const raw =
    jar.get("__Host-twap_session")?.value || jar.get("twap_session")?.value;
  if (raw) {
    const sessionHash = digest(raw);
    const profile = await database()
      .prepare(
        "SELECT p.*, s.accent AS session_accent FROM sessions s JOIN profiles p ON p.user_id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?",
      )
      .bind(sessionHash, Date.now())
      .first<ProfileRow & { session_accent: string }>();
    if (!profile) return null;
    return {
      id: profile.user_id,
      email: profile.email || "",
      name: profile.display_name,
      role: profile.role,
      status: profile.status,
      authMethod: profile.auth_method,
      sessionHash,
      sessionAccent: profile.session_accent,
      profile,
    };
  }
  return null;
}

export async function requireUser() {
  const user = await getUser();
  if (!user) throw new HttpError(401, "Please log in to continue.");
  if (user.status !== "active")
    throw new HttpError(
      403,
      "Your account access is restricted. Contact the administrator.",
    );
  return user;
}
export async function requireAdmin() {
  const user = await requireUser();
  if (!["owner", "admin"].includes(user.role))
    throw new HttpError(403, "Administrator access is required.");
  return user;
}
function secureRequest(request: Request) {
  return !!process.env.RAILWAY_ENVIRONMENT_ID || new URL(request.url).protocol === "https:";
}
export function cookieName(request: Request) {
  return secureRequest(request)
    ? "__Host-twap_session"
    : "twap_session";
}
export function sessionCookie(request: Request, value: string, maxAge = 28800) {
  return `${cookieName(request)}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secureRequest(request) ? "; Secure" : ""}`;
}
export async function newSession(
  request: Request,
  userId: string,
  preserveAccent?: string,
) {
  const raw = token();
  const now = new Date().toISOString();
  await database().batch([
    database()
      .prepare(
        "INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent, accent) SELECT ?, user_id, ?, ?, ?, COALESCE(?, CASE last_session_accent WHEN 'mint' THEN 'sky' WHEN 'sky' THEN 'amber' WHEN 'amber' THEN 'rose' ELSE 'mint' END) FROM profiles WHERE user_id = ?",
      )
      .bind(
        digest(raw),
        now,
        Date.now() + 28800000,
        (request.headers.get("user-agent") || "").slice(0, 250),
        preserveAccent || null,
        userId,
      ),
    database()
      .prepare(
        "UPDATE profiles SET last_login_at = ?, last_session_accent = CASE WHEN CAST(? AS text) IS NULL THEN (SELECT accent FROM sessions WHERE token_hash = ?) ELSE last_session_accent END WHERE user_id = ?",
      )
      .bind(now, preserveAccent || null, digest(raw), userId),
    auditStatement(userId, "auth.login", userId),
  ]);
  return sessionCookie(request, raw);
}
export function profileInsert(
  id: string,
  name: string,
  email: string,
  role: Role,
  method: string,
  referrer: string | null = null,
) {
  const now = new Date().toISOString();
  return database()
    .prepare(
      "INSERT INTO profiles (user_id,display_name,email,role,status,referral_code,referred_by,created_at,last_login_at,preferences,auth_method) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      id,
      name,
      email,
      role,
      "TW-" +
        crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase(),
      referrer,
      now,
      now,
      JSON.stringify(defaultPreferences),
      method,
    );
}
export async function bootstrapOwner(email: string, password: string) {
  if (
    !env.TWAP_ADMIN_EMAIL ||
    !env.TWAP_ADMIN_PASSWORD_HASH ||
    email !== env.TWAP_ADMIN_EMAIL.toLowerCase()
  )
    return null;
  const existing = await database()
    .prepare("SELECT user_id FROM profiles WHERE role = 'owner'")
    .first();
  if (existing) return null;
  if (!verifyPassword(password, env.TWAP_ADMIN_PASSWORD_HASH)) return null;
  const id = "twap_owner";
  await database().batch([
    profileInsert(id, "Administrator", email, "owner", "password"),
    database()
      .prepare(
        "INSERT INTO credentials (user_id,password_hash,updated_at) VALUES (?, ?, ?)",
      )
      .bind(id, env.TWAP_ADMIN_PASSWORD_HASH, new Date().toISOString()),
    auditStatement(id, "admin.initialized", id),
  ]);
  return id;
}
export async function rateLimit(request: Request, action: string) {
  const address = process.env.RAILWAY_ENVIRONMENT_ID ? (request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown") : (request.headers.get("cf-connecting-ip") || "local");
  const key = digest(`${action}:${address}`);
  const now = Date.now();
  const record = await database()
    .prepare(
      "INSERT INTO auth_limits (key,attempts,reset_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts = CASE WHEN auth_limits.reset_at <= ? THEN 1 ELSE auth_limits.attempts + 1 END, reset_at = CASE WHEN auth_limits.reset_at <= ? THEN excluded.reset_at ELSE auth_limits.reset_at END RETURNING attempts",
    )
    .bind(key, now + 900000, now, now)
    .first<{ attempts: number }>();
  if ((record?.attempts || 0) > 10)
    throw new HttpError(
      429,
      "Too many attempts. Please wait 15 minutes before trying again.",
    );
  return key;
}
export async function clearRate(key: string) {
  await database()
    .prepare("DELETE FROM auth_limits WHERE key = ?")
    .bind(key)
    .run();
}
export async function issuePasswordReset(userId: string, actorId: string) {
  const raw = token(),
    now = new Date().toISOString();
  await database().batch([
    database()
      .prepare(
        "UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL",
      )
      .bind(now, userId),
    database()
      .prepare(
        "INSERT INTO password_resets (token_hash,user_id,expires_at,created_at) VALUES (?, ?, ?, ?)",
      )
      .bind(digest(raw), userId, Date.now() + 1800000, now),
    auditStatement(actorId, "user.password_reset_issued", userId),
  ]);
  return raw;
}
