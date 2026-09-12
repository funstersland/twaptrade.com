import { closedTradeRisk } from "../../../bot-performance.ts";

export async function continuationRisk(db: D1Database, runId: string) {
  // Read the complete run, independently of the paginated history on the tile.
  const rows = await db
    .prepare(
      "SELECT pnl_micros FROM continuation_rounds WHERE run_id=? AND status IN ('won','lost') ORDER BY start_seconds,id",
    )
    .bind(runId)
    .all<{ pnl_micros: number | null }>();
  return closedTradeRisk(rows.results.map((row) => row.pnl_micros));
}

export async function continuationAccounting(db: D1Database, runId: string) {
  return db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN pnl_micros>0 THEN pnl_micros ELSE 0 END),0) "profitMicros",
    COALESCE(SUM(CASE WHEN pnl_micros<0 THEN -pnl_micros ELSE 0 END),0) "lossMicros",
    COALESCE(SUM(pnl_micros),0) "netMicros",
    COALESCE(SUM(fee_micros+sale_fee_micros),0) "feeMicros",
    COALESCE(SUM(CASE WHEN pnl_micros>0 THEN 1 ELSE 0 END),0) "profitableTrades",
    COALESCE(SUM(CASE WHEN pnl_micros<0 THEN 1 ELSE 0 END),0) "losingTrades",
    COALESCE(MAX(CASE WHEN pnl_micros<0 THEN -pnl_micros ELSE 0 END),0) "largestLossMicros",
    COALESCE(MAX(cost_micros),0) "largestCostMicros"
    FROM continuation_rounds WHERE run_id=? AND status IN ('won','lost','breakeven')`)
    .bind(runId).first<ContinuationAccounting>();
}
export type ContinuationAccounting = {
  profitMicros: number;
  lossMicros: number;
  netMicros: number;
  feeMicros: number;
  profitableTrades: number;
  losingTrades: number;
  largestLossMicros: number;
  largestCostMicros: number;
};
