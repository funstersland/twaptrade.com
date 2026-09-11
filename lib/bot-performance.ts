export type BotRiskMetrics = {
  maxDrawdownMicros: number;
  maxLosingStreak: number;
};

// Reporting only: each input is one fully closed trade's net, attributed P/L,
// in chronological order. Open positions and wallet cash are not equity points.
export function closedTradeRisk(
  profits: Iterable<number | null>,
): BotRiskMetrics | null {
  let count = 0,
    cumulative = 0,
    peak = 0,
    maxDrawdownMicros = 0,
    losingStreak = 0,
    maxLosingStreak = 0;
  for (const profit of profits) {
    // Incomplete history cannot establish an accurate maximum or sequence.
    if (profit === null || !Number.isSafeInteger(profit)) return null;
    count++;
    cumulative += profit;
    if (!Number.isSafeInteger(cumulative)) return null;
    peak = Math.max(peak, cumulative);
    const drawdown = peak - cumulative;
    if (!Number.isSafeInteger(drawdown)) return null;
    maxDrawdownMicros = Math.max(maxDrawdownMicros, drawdown);
    // A break-even closed trade ends a consecutive losing sequence.
    losingStreak = profit < 0 ? losingStreak + 1 : 0;
    maxLosingStreak = Math.max(maxLosingStreak, losingStreak);
  }
  return count ? { maxDrawdownMicros, maxLosingStreak } : null;
}
