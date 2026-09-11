import { closedTradeRisk } from "../../../bot-performance.ts";

export async function continuationRisk(db: D1Database, runId: string) {
  // Continuation closes the previous position before entering another round.
  // Read the complete run, independently of the paginated history on the tile.
  const rows = await db
    .prepare(
      "SELECT pnl_micros FROM continuation_rounds WHERE run_id=? AND status IN ('won','lost') ORDER BY start_seconds,id",
    )
    .bind(runId)
    .all<{ pnl_micros: number | null }>();
  return closedTradeRisk(rows.results.map((row) => row.pnl_micros));
}
