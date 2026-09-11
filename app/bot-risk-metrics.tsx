import type { BotRiskMetrics as Metrics } from "@/lib/bot-performance";

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function BotRiskMetrics({
  metrics,
  emptyLabel = "No closed trades yet",
}: {
  metrics?: Metrics | null;
  emptyLabel?: string;
}) {
  return (
    <div className="bot-risk-summary">
      <dl className="bot-risk-metrics">
        <div>
          <dt title="Largest peak-to-trough drop in cumulative net P/L from closed trades, including the starting point.">
            Max drawdown
          </dt>
          <dd>
            {metrics
              ? metrics.maxDrawdownMicros > 0 && metrics.maxDrawdownMicros < 10000
                ? "< $0.01"
                : dollars.format(metrics.maxDrawdownMicros / 1e6)
              : "—"}
          </dd>
        </div>
        <div>
          <dt title="Most consecutive closed trades with negative net P/L. A winning or break-even trade ends the streak.">
            Max losing streak
          </dt>
          <dd>{metrics ? metrics.maxLosingStreak : "—"}</dd>
        </div>
      </dl>
      <p className="bot-risk-caption">
        {metrics ? "All-time · Closed trades · USD" : emptyLabel}
      </p>
    </div>
  );
}
