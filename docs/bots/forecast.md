# Forecast · Crypto Shares

Strategy key: `crypto-shares.forecast.confluence`, version 1. BTC only. Registration resolves exact family plus case-insensitive name, preserves an existing catalog ID/status and refuses conflicting identities. It never creates a run or arms a member's bot.

The user authorized designing this strategy. The research and fixed historical check are in [forecast-strategy-research.md](../research/forecast-strategy-research.md). The first check did not establish a winning edge. Do not describe its strength score as a probability or its spot proxy results as Polymarket returns.

## Boundaries

- All strategy/configuration/state code: `lib/bots/crypto-shares/forecast`.
- Runner/execution: `scripts/bots/forecast-*.mjs`; separate Railway `forecast-engine` and `TWAP_FORECAST_RUNNER_TOKEN`.
- Member and runner APIs: `/api/forecast` and `/api/forecast/runner`.
- Persistence: `forecast_runs`, `forecast_events`, `forecast_feed`. No generic deployments, account-ledger, holdings or portfolio snapshot writes.
- Only the member can deploy, arm, disarm, configure or switch windows. ARM defaults off; paper is selected initially. Never arm live during development/testing.

## Signals and timing

Use verified closed Binance BTCUSDT candles for 1m, 5m, 15m and 1h. Fetch up to 64 consecutive bars per frame; require at least 55 and the latest expected closed interval. Spot chart labels must not imply Chainlink TWAP. Preserve exact decimal input; normalized indicator calculations use numbers, cash and fill amounts use integer micro-units.

EMA8/21 trend, ATR14-scaled momentum and candle body strength form horizon-weighted scores. Require three agreeing frames, strength at least 25/100 and a directionally matching closed rejection, breakout, engulfing or pullback pattern. Only pivots with two completed bars to the right count. The trigger candle cannot create its own prior support/resistance. Reject strong opposing hourly trend, nearby opposing levels and excessive displacement. Rules and weights are frozen in `rules.ts`/`identity.ts`; any substantive change requires a new evaluation.

Prepare at T−40..T−25. Submit only T−25..strictly before T−20 for the next target. Check the deadline immediately before posting; never trade current rounds or catch up. Three horizons can coincide; hourly then 15m then 5m receive priority so the shortest window cannot systematically starve the others. A skipped late horizon is preferable to a late order.

5m/15m currently require exact Chainlink 60s TWAP metadata; hourly requires exact Binance BTCUSDT one-hour rules and UTC boundaries. Do not infer settlement or automatically substitute a different feed/window if market rules change.

## Risk, switches and orders

Default fixed $10 lot, $1,000 risk bankroll, 2% maximum stake, 5% daily realized loss plus exposure cap, 52¢ max ask and 2¢ max spread. Forecast has no martingale. Use executable ask depth and venue minimum size; fees are included once in all-in cost.

Window switches allow all-off, can change while armed or holding positions, and never arm an idle run. Disabled windows block both prepare and submit. Existing positions continue to reconcile. Risk configuration cannot be edited while armed or holding positions.

Up to two confirmed unresolved positions per horizon may overlap within the total cap. Any prepared/submitting/uncertain order blocks another entry until reconciled. Persist order identity/reservation before submission, one provider POST only, never retry uncertain orders. Only verified exact receipt fills enter live accounting. Hold to official resolution; do not sell wallet inventory or redeem on the member's behalf.

The book's `at` is the start of a newly requested uncached bounded REST snapshot, not a retimestamped cached local book. Positive HTTP cache age and slow responses fail. Runtime quote freshness is separate from archived candle availability. Worker lease, journal idempotency and state revision checks are mandatory.

Settled P/L, settled max drawdown and max win/loss streaks are per mode/run. Cross-window streaks follow recorded resolution order, not an invented settlement order. Do not reset records after poor results.

## Verification and release

Run `node --test scripts/bots/forecast*.test.mjs`, the full bot test suite, TypeScript, scoped ESLint and `npm run build:railway`. `scripts/tests/forecast-http.mjs` operates only on `.sites-runtime/forecast-test-state` and port 5194 with synthetic credentials; it must never target production.

`node scripts/research/forecast-evaluate.mjs` reproduces the fixed 42-day BTC spot proxy and hashes; it sends no orders. It does not model the T−25 tick, Polymarket quotes/fills or Chainlink outcomes.

Production's predeploy wrapper registers Forecast after migrations. Configure only the dedicated worker with `scripts/configure-forecast-railway.mjs`; connect it to main after the web release succeeds. Push each finished update to GitHub and verify Railway deployment/worker health. Preserve all unrelated bots and saved member settings.
