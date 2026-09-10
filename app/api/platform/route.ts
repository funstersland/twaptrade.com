import { database, settings } from "@/lib/server/db";
import { json, failure } from "@/lib/server/http";
export async function GET() {
  try {
    const [count, config] = await Promise.all([
      database()
        .prepare("SELECT count(*) total FROM bots WHERE status='published'")
        .first<{ total: number }>(),
      settings(),
    ]);
    return json({
      publishedBots: count!.total,
      announcement: config.announcement,
      registrationsOpen: config.registrationsOpen && !config.maintenanceMode,
    });
  } catch (e) {
    return failure(e);
  }
}
