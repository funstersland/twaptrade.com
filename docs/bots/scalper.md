# Scalper

Scalper is exclusively Crypto Shares / BTC / `crypto-shares.scalper.rejection`. Catalog registration first resolves the exact family and case-insensitive name. A conflicting strategy or duplicate identity aborts registration. Existing publication status is preserved. No other bot or family is renamed or reassigned.

The user requested a newly designed support/resistance rejection strategy, BTC 5-minute, 15-minute and hourly rounds, entries about twenty seconds before the next round, and a martingale checkbox. The research and explicit numerical hypothesis are in [Scalper research](../research/scalper-strategy-research.md). This is an unvalidated candidate strategy, not a demonstrated profitable edge or a guarantee of winning streaks.

## Data and candle rules

Use `prices.crypto.chainlink.twap`, `windowSeconds:60`, `btc/usd`, with exact E18 arithmetic. These are candles of observed TWAP values, not a recreation of Chainlink's underlying TWAP formula. Build closed 15s, 1m, 3m and 5m candles from the stream. Reject future/stale/out-of-order observations. More than three seconds between observations invalidates a candle. Finalization requires the next observation across its closing boundary. Persist completed candles in `scalper_feed`; partial candles are not restored after a restart. Missing history is never backfilled with spot prices or fabricated observations.

The 5m contract uses 1m structural candles and 15s rejection candles; 15m uses 3m structure and 1m rejection; hourly uses 5m structure and 5m rejection. Require at least 40 consecutive valid structural candles, using up to 60. Startup warmup is roughly 40 minutes, two hours and three hours twenty minutes respectively, plus the rejection/confirmation time. Gaps or missing pivots can extend that period.

Levels use body lows/highs, with two closed candles on either side confirming each pivot. Cluster same-kind pivots within 0.15 of the 20-candle ATR and require two touches. Only context candles ending before the rejection starts are eligible. This prevents a rejection from creating its own supporting historical level.

A support rejection must intersect its zone, close bullish above the zone, have a body at least 25% of its range, a lower wick at least 35% of range, and close in the top quarter. The preceding candle must be bearish or flat and the rejection close must recover more than half of that previous body. Resistance mirrors the same conditions. Reject zero ranges and shock candles larger than 3 ATR. The latest fresh TWAP must still hold the rejected side without chasing farther than 0.5 ATR from the rejection close. Reject a strong opposing five-context-candle move exceeding 2 ATR, conflicting directional signals, or a known opposing level less than 1 ATR away. These constants are research defaults, not optimized parameters or probabilities.

## Market identity and time

BTC 5m/15m must expose `cryptoMarketConfig` for the exact asset, duration, TWAP enabled, 60-second lookback and the exact Chainlink source. Hourly contracts use the year-bearing Eastern Time slug and the verified Binance BTC/USDT one-hour open/close rules. Check actual UTC start and end as well as slug, token/outcome mapping, condition and exchange. A DST ambiguity or mismatching market is skipped. Unknown fee schedules are rejected. All current examples used the 0.07 crypto fee rate and exponent 1; the runner reads each market rather than assuming those values.

Signals remain TWAP-based for hourly contracts, but hourly settlement is Binance-based. This distinction appears on the tile, in settings, and in live ARM review. Next-round opening prices are unknown before entry and are never invented. Official `closed` + `umaResolutionStatus=resolved` with exactly one winning outcome is required to settle. The runner never substitutes a prediction or observed candle direction for actual settlement.

The scheduler opens at T−22 and stops strictly before T−20, leaving at least twenty seconds before the next round. It prepares a signed live order earlier, then rechecks the signal, price, funding, ARM and server state inside the entry window. It never enters the current round or submits late to catch up. A unique run/horizon/round attempt is retained in durable state. One unresolved position blocks further entries in that same horizon; combined risk limits include all horizons. Holding to resolution therefore normally skips the immediately following round in that horizon, since its entry deadline precedes the current position’s settlement.

## Trading and money

Defaults: paper, ARM off, martingale off, $1,000 simulated/risk bankroll, $10 all-in base lot, 2% maximum per-trade stake, 5% daily loss plus open exposure, 52¢ maximum entry and 2¢ maximum spread. Actual book minimum shares must fit the lot. If they do not, skip; never silently increase the lot. Price limits and fees are included in the paper depth calculation. Orders use FOK and a maximum all-in spend. Market selection and fees are verified before signing; the server independently applies identity, fee and submission gates.

Hold purchased shares until confirmed resolution. No automatic early sell or external-wallet whole-balance exit exists. Live payoff is a resolved redeemable claim; it is not credited into the wallet cash display until the wallet provider actually reports cash. Manual redemption can be required. Performance includes only this bot's exact fills and costs. Dedicated `scalper_runs`/`scalper_events` records never modify account transactions, holdings, generic deployments or portfolio snapshots.

Live requires member ARM after reviewing the saved config, a verified funding wallet and approvals, fresh runner lease, allowed geography, active member, enabled platform and adequate balance. Signed hashes are persisted before the one provider POST. An uncertain outcome pauses new entries and is reconciled using the exact order hash, token, successful receipt and exchange log; it is never blindly resubmitted. Disarming stops new submissions, while already-sent orders and final resolutions continue to reconcile.

The martingale checkbox doubles after a realized negative result and resets on nonnegative results, separately for each horizon. The default maximum is three doubling steps, but the stake or daily limit may stop the sequence earlier. A skipped or unfilled trade does not change the streak. No limit automatically resets a loss sequence. Martingale changes stake size, not prediction accuracy, and a doubled winning order need not recover all previous costs.

The tile reports full closed-trade net P/L, win rate, maximum winning streak, maximum losing streak and maximum USD drawdown. Overall streaks use actual settlement order; martingale's internal per-horizon streaks remain separate.

## Operation and verification

Apply migrations through `0011_soft_black_widow.sql`, then run `npm run bot:register:scalper` against the intended database. `scripts/prepare-scalper-database.mjs` provides that exact two-step operation without registering other bots. Registration does not create runs or arm trading. The deployment helper `scripts/configure-scalper-railway.mjs` preserves the web service’s existing CheapShare setup and adds Scalper registration through `scripts/prepare-production-database.mjs`. Railway receives one Node executable; shell operators are not used as arguments. It creates an isolated `scalper-engine`, copies the existing encryption key without rotating it, and gives Scalper its own runner token. Run its `--connect` step only after the updated web release succeeds. No other bot’s worker is reconfigured.

Set a new independent `TWAP_SCALPER_RUNNER_TOKEN` on web and worker. Set `TWAP_SCALPER_APP_ORIGIN` on the worker. Live wallet decryption uses the existing `TWAP_BOT_ENCRYPTION_KEY` without rotating it. `npm run bot:scalper` runs the dedicated always-on engine; do not attach it to the browser lifecycle, start another bot's engine in its place, or activate live trading during development. One runner lease is active at a time.

`npm run test:bot` covers strategy boundaries, candle gaps, market identity, accounting and existing bot regressions. `scripts/tests/scalper-http.mjs` uses only the named isolated local test database and exercises persistence, member isolation, ARM gates, encryption and ledger separation. No empirical win rate is claimed from software tests. A valid performance study still requires a chronological archive of post-change TWAP observations, next-round books, fees and final outcomes, with costs and skipped opportunities recorded.

### Verification completed for this implementation

- 61 bot tests passed, including 17 Scalper checks and existing bot/risk regressions.
- 52 isolated SQLite HTTP checks passed for ownership, persistence, revisions, replay, wallet encryption, ARM denial and shared-ledger isolation.
- Dedicated Scalper lint and TypeScript checks passed; the Sites and Railway/Next production builds passed, including the public-home artifact check.
- Browser checks covered the chart, saved martingale checkbox, hourly settlement label, risk metrics and usable controls at 390px and desktop widths.
- Read-only current Gamma parsing succeeded for actual BTC 5m, 15m and hourly contracts. No live orders were submitted.

These are software checks, not a profitability backtest. Production registration is performed by the release setup; local verification never registers bots or arms trading in production.
