import { env } from "cloudflare:workers";
import type { PlatformSettings } from "../models";
export function database() {
  if (!env.DB) throw new Error("Database unavailable");
  return env.DB;
}
export const defaultSettings: PlatformSettings = {
  registrationsOpen: true,
  deploymentsOpen: true,
  referralsEnabled: true,
  maintenanceMode: false,
  announcement: "",
  supportEmail: "",
  referralTerms: "Rewards have not been configured.",
};
export async function settings(): Promise<PlatformSettings> {
  const rows = await database()
    .prepare("SELECT key, value FROM platform_settings")
    .all<{ key: string; value: string }>();
  const result = { ...defaultSettings };
  for (const row of rows.results) {
    if (Object.hasOwn(defaultSettings, row.key)) {
      try {
        const value = JSON.parse(row.value);
        if (
          typeof value ===
          typeof defaultSettings[row.key as keyof PlatformSettings]
        )
          Object.assign(result, { [row.key]: value });
      } catch {}
    }
  }
  return result;
}
export function auditStatement(
  actor: string,
  action: string,
  target: string,
  details: Record<string, unknown> = {},
) {
  return database()
    .prepare(
      "INSERT INTO audit_log (id, actor_id, action, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(
      crypto.randomUUID(),
      actor,
      action,
      target,
      JSON.stringify(details),
      new Date().toISOString(),
    );
}
