import { z } from "zod";
import { body, failure, json } from "@/lib/server/http";
import { database, settings, auditStatement } from "@/lib/server/db";
import { requireUser, publicProfile, type ProfileRow } from "@/lib/server/auth";
const prefs = z
  .object({
    theme: z.enum(["dark", "light", "system"]).optional(),
    accent: z.enum(["auto", "mint", "sky", "amber", "rose"]).optional(),
    density: z.enum(["comfortable", "compact"]).optional(),
    motion: z.enum(["full", "reduced"]).optional(),
  })
  .strict();
const schema = z
  .object({
    action: z.enum(["init", "save"]).default("init"),
    name: z.string().trim().min(1).max(80).optional(),
    preferences: prefs.optional(),
  })
  .strict();
export async function POST(request: Request) {
  try {
    const input = await body(request, schema);
    const user = await requireUser();
    const db = database();
    if (input.action === "save") {
      const updates = [];
      if (input.name)
        updates.push(
          db
            .prepare("UPDATE profiles SET display_name=? WHERE user_id=?")
            .bind(input.name, user.id),
        );
      if (input.preferences)
        updates.push(
          db.prepare("UPDATE profiles SET preferences=? WHERE user_id=?").bind(
            JSON.stringify({
              ...publicProfile(user.profile!).preferences,
              ...input.preferences,
            }),
            user.id,
          ),
        );
      if (updates.length)
        await db.batch([
          ...updates,
          auditStatement(user.id, "account.updated", user.id, {
            fields: Object.keys(input).filter((k) => k !== "action"),
          }),
        ]);
    }
    const profile = await db
      .prepare("SELECT * FROM profiles WHERE user_id=?")
      .bind(user.id)
      .first<ProfileRow>();
    if (!profile) throw new Error("Profile unavailable");
    const savedPreferences = JSON.stringify(publicProfile(profile).preferences);
    if (profile.preferences !== savedPreferences) {
      await db
        .prepare(
          "UPDATE profiles SET preferences=? WHERE user_id=? AND preferences=?",
        )
        .bind(savedPreferences, user.id, profile.preferences)
        .run();
      profile.preferences = savedPreferences;
    }
    const isNew = profile.welcome_seen === 0;
    if (input.action === "init" && isNew)
      await db
        .prepare("UPDATE profiles SET welcome_seen=1 WHERE user_id=?")
        .bind(user.id)
        .run();
    const [
      holdings,
      transactions,
      counts,
      deployments,
      bots,
      snapshots,
      referrals,
      config,
    ] = await Promise.all([
      db
        .prepare(
          "SELECT id,symbol,name,quantity,value_cents,updated_at FROM holdings WHERE user_id=? ORDER BY value_cents DESC",
        )
        .bind(user.id)
        .all(),
      db
        .prepare(
          "SELECT * FROM transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
        )
        .bind(user.id)
        .all(),
      db
        .prepare(
          "SELECT (SELECT COUNT(*) FROM transactions WHERE user_id=?) transaction_count,(SELECT COALESCE(SUM(balance_delta_cents),0) FROM transactions WHERE user_id=? AND status='completed') balance,(SELECT COUNT(*) FROM profiles WHERE referred_by=?) referral_count",
        )
        .bind(user.id, user.id, user.id)
        .first<{
          transaction_count: number;
          balance: number;
          referral_count: number;
        }>(),
      db
        .prepare(
          "SELECT d.*,b.name,b.pair,b.family FROM deployments d JOIN bots b ON b.id=d.bot_id WHERE d.user_id=? ORDER BY d.created_at DESC",
        )
        .bind(user.id)
        .all(),
      db
        .prepare(
          "SELECT id,name,pair,family,strategy_key,description,status,min_allocation_cents,created_at,updated_at FROM bots WHERE status='published' OR EXISTS (SELECT 1 FROM continuation_runs r WHERE r.bot_id=bots.id AND r.user_id=?) OR EXISTS (SELECT 1 FROM cheapshare_runs c WHERE c.bot_id=bots.id AND c.user_id=?) OR EXISTS (SELECT 1 FROM scalper_runs s WHERE s.bot_id=bots.id AND s.user_id=?) ORDER BY created_at DESC",
        )
        .bind(user.id, user.id, user.id)
        .all(),
      db
        .prepare(
          "SELECT value_cents,recorded_at FROM (SELECT value_cents,recorded_at FROM portfolio_snapshots WHERE user_id=? ORDER BY recorded_at DESC LIMIT 365) ORDER BY recorded_at",
        )
        .bind(user.id)
        .all(),
      db
        .prepare(
          "SELECT created_at FROM profiles WHERE referred_by=? ORDER BY created_at DESC LIMIT 100",
        )
        .bind(user.id)
        .all(),
      settings(),
    ]);
    return json({
      profile: publicProfile(profile),
      sessionAccent: user.sessionAccent,
      isNew,
      holdings: holdings.results,
      transactions: transactions.results,
      transactionCount: counts!.transaction_count,
      balanceCents: counts!.balance,
      deployments: deployments.results,
      bots: bots.results,
      snapshots: snapshots.results,
      referrals: referrals.results,
      referralCount: counts!.referral_count,
      settings: config,
    });
  } catch (error) {
    return failure(error);
  }
}
