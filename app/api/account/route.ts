import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { z } from "zod";
export const dynamic = "force-dynamic";
const preferenceSchema = z
  .object({
    theme: z.enum(["dark", "light", "system"]).optional(),
    accent: z.enum(["auto", "mint", "sky", "amber", "rose"]).optional(),
    density: z.enum(["comfortable", "compact"]).optional(),
    motion: z.enum(["full", "reduced"]).optional(),
  })
  .strict();
const bodySchema = z
  .object({
    action: z.enum(["initialize", "save"]),
    referral: z.string().max(30).optional(),
    name: z.string().trim().min(1).max(80).optional(),
    preferences: preferenceSchema.optional(),
    login: z.boolean().optional(),
  })
  .strict();
const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin)
      return Response.json(
        { error: "This request could not be verified." },
        { status: 403, headers },
      );
    const user = await getChatGPTUser();
    if (!user)
      return Response.json(
        { error: "Please sign in to continue." },
        { status: 401, headers },
      );
    if (!env.DB) throw new Error("Database unavailable");
    if (Number(request.headers.get("content-length") || 0) > 8000)
      return Response.json(
        { error: "Request too large." },
        { status: 413, headers },
      );
    const raw = await request.text();
    if (raw.length > 8000)
      return Response.json(
        { error: "Request too large." },
        { status: 413, headers },
      );
    let parsed;
    try {
      parsed = bodySchema.safeParse(JSON.parse(raw));
    } catch {
      return Response.json(
        { error: "Invalid request." },
        { status: 400, headers },
      );
    }
    if (!parsed.success)
      return Response.json(
        { error: "Please check your settings and try again." },
        { status: 400, headers },
      );
    const body = parsed.data;
    const now = new Date().toISOString();
    let isNew = false;
    let referralNotice = "";
    if (body.action === "initialize") {
      let referrer: string | null = null;
      if (body.referral) {
        const ref = await env.DB.prepare(
          "SELECT user_id FROM profiles WHERE referral_code = ?",
        )
          .bind(body.referral)
          .first<{ user_id: string }>();
        if (ref && ref.user_id !== user.userId) referrer = ref.user_id;
        else referralNotice = "This referral code could not be applied.";
      }
      const code =
        "TW-" +
        crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
      const result = await env.DB.prepare(
        "INSERT OR IGNORE INTO profiles (user_id, display_name, referral_code, referred_by, created_at, last_login_at, preferences) VALUES (?, ?, ?, ?, ?, ?, '{}')",
      )
        .bind(
          user.userId,
          user.fullName || user.email.split("@")[0],
          code,
          referrer,
          now,
          now,
        )
        .run();
      isNew = result.meta.changes > 0;
      if (body.login && !isNew)
        await env.DB.prepare(
          "UPDATE profiles SET last_login_at = ? WHERE user_id = ?",
        )
          .bind(now, user.userId)
          .run();
    }
    if (body.action === "save") {
      const statements = [];
      if (body.name)
        statements.push(
          env.DB.prepare(
            "UPDATE profiles SET display_name = ? WHERE user_id = ?",
          ).bind(body.name, user.userId),
        );
      if (body.preferences) {
        const existing = await env.DB.prepare(
          "SELECT preferences FROM profiles WHERE user_id = ?",
        )
          .bind(user.userId)
          .first<{ preferences: string }>();
        if (!existing)
          return Response.json(
            { error: "Please reload your account before saving." },
            { status: 409, headers },
          );
        statements.push(
          env.DB.prepare(
            "UPDATE profiles SET preferences = ? WHERE user_id = ?",
          ).bind(
            JSON.stringify({
              ...JSON.parse(existing.preferences),
              ...body.preferences,
            }),
            user.userId,
          ),
        );
      }
      if (statements.length) await env.DB.batch(statements);
    }
    const profile = await env.DB.prepare(
      "SELECT display_name, referral_code, created_at, last_login_at, preferences FROM profiles WHERE user_id = ?",
    )
      .bind(user.userId)
      .first<{
        display_name: string;
        referral_code: string;
        created_at: string;
        last_login_at: string;
        preferences: string;
      }>();
    if (!profile)
      return Response.json(
        { error: "Your profile is not available yet. Please reload." },
        { status: 404, headers },
      );
    const referred = await env.DB.prepare(
      "SELECT created_at FROM profiles WHERE referred_by = ? ORDER BY created_at DESC LIMIT 100",
    )
      .bind(user.userId)
      .all();
    const count = await env.DB.prepare(
      "SELECT count(*) AS total FROM profiles WHERE referred_by = ?",
    )
      .bind(user.userId)
      .first<{ total: number }>();
    return Response.json(
      {
        profile: {
          name: profile.display_name,
          email: user.email,
          referralCode: profile.referral_code,
          createdAt: profile.created_at,
          lastLoginAt: profile.last_login_at,
          preferences: JSON.parse(profile.preferences),
        },
        referrals: referred.results,
        referralCount: count?.total || 0,
        isNew,
        referralNotice,
      },
      { headers },
    );
  } catch (error) {
    console.error(
      "Account operation failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return Response.json(
      {
        error:
          "Your account couldn’t be loaded. Please try again; your input has been kept.",
      },
      { status: 503, headers },
    );
  }
}
