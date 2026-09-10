import { database } from "@/lib/server/db";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await database().prepare("SELECT user_id FROM profiles LIMIT 1").all();
    return Response.json({status: "ok"}, {headers: {"Cache-Control": "no-store"}});
  } catch {
    return Response.json({status: "unavailable"}, {status: 503});
  }
}
