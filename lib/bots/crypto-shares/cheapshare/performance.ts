import { closedTradeRisk } from "../../../bot-performance.ts";

export async function cheapshareRisk(
  db: D1Database,
  runId: string,
  revision: number,
) {
  // Only final position P/L counts, including all scale exits and fees. Use the
  // journal's close order and the same revision as the state returned to the UI.
  const rows = await db
    .prepare(
      "SELECT data_json FROM cheapshare_events WHERE run_id=? AND kind='closed' AND revision<=? ORDER BY revision,id",
    )
    .bind(runId, revision)
    .all<{ data_json: string }>();
  return closedTradeRisk(
    rows.results.map((row) => {
      const data = JSON.parse(row.data_json);
      return data.closed?.pnl ?? null;
    }),
  );
}
