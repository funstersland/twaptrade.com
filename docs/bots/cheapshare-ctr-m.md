# CheapShare · Crypto Shares · Reversal

This replaces the retired CTR-M strategy. The exact catalog identity remains CheapShare in Crypto Shares; its strategy key is now `crypto-shares.cheapshare.flip`, version 2. Production catalog ID at replacement: `97cdb51c-7a1d-4dca-bea7-ba1502b707c7`. Continuation and all other bots remain separate.

## Entry theory

Watch the round from its opening. First establish which side TWAP favors. A playable entry requires a sudden spot move from that side through Price-to-Beat in the opposite direction. Buy the former losing outcome only when a stressed forecast has enough price-and-time strength to move the settlement TWAP past the strike with a buffer. A spot crossing alone is insufficient.

The current markets are BTC, ETH, SOL, XRP, DOGE and HYPE, on 5m and 15m windows. Gamma must verify the exact asset, slug, opening/closing boundary, outcome tokens and Chainlink 60-second TWAP resolution source. The current 60-second metadata was checked against the live API on September 11, 2026. A different averaging window or changed source blocks trading until explicitly supported; the round duration is never used as the TWAP lookback.

An explicit Gamma Price-to-Beat is preferred. The fallback is only the official TWAP observation exactly on the opening boundary, persisted for that market. No first-tick-after-open or spot-price fallback is allowed. A worker that starts or loses required feed continuity midway through a round waits for another round.

The public Chainlink spot and TWAP streams supply timestamped exact decimal observations. Binance spot supplies executable underlying bid/ask references for BTC, ETH, SOL, XRP and DOGE. HYPE uses Hyperliquid's actual HYPE/USDC spot book, resolved from the unique HYPE and USDC tokens in public spot metadata, with one snapshot per second. No HYPE futures substitution is made. USDT and USDC are USD proxies; the forecast additionally uses the less favorable of the external spot quote and the official Chainlink spot observation.

Binance book-ticker WebSocket updates are change-driven. A separate 500ms check obtains an uncached REST book-ticker snapshot for a supported Binance pair when no observation arrived in the last 500ms. The read uses its request-start time, must finish within one second, checks the exact symbol and cached-response age, and cannot overwrite a newer WebSocket quote. It preserves the 1.5s spot freshness/continuity gate without treating every quiet quote as a disconnect. Failed snapshots do not refresh an old price. HYPE remains on its separate Hyperliquid feed.

## Price-and-time model

`bucket.ts` integrates observed Chainlink spot prices over the known portion of the final lookback. Historical samples that will have expired at settlement do not remain in the bucket. Future contributions use a conservative spot reference with a configurable fraction of the impulse retraced. Execution time and model disagreement are included in the checks.

The current reconstructed lookback is compared with the published official TWAP. Missing history, gaps over 2.5 seconds, stale feeds, or disagreement beyond the configured tolerance block entries. The accepted difference is also charged against the projected margin. The UI shows the estimated settlement TWAP, required sustained spot, stressed spot and remaining time.

This is a uniform-time forecast under a stressed future-price assumption, not an exact reproduction of Chainlink's undisclosed weighting, sampling, rounding or missing-input rules. Its checks cannot guarantee a future outcome or eliminate losses. Official resolution is always taken from the verified market, never from this model.

Examples covered by tests:

- Strike 77,000, previous level 76,900, sudden spot 77,004 with five seconds left: rejected; the remaining contribution cannot overcome the cold portion.
- Previous level 76,998, sudden spot 77,010: can qualify with sufficient remaining time, confirmation and liquidity; rejected with only five seconds left.
- A valid reversal at a 50-cent ask is allowed. There is no hard-coded cheap-share ask band.

## Allocation and execution

The paper defaults are a simulated $1,000 bankroll, a $10 allocation cap, at most 1% of that bankroll per trade, two concurrent positions, 3% daily and 8% weekly loss limits. These are editable starting settings, not optimized parameters. Allocation uses the lower of the dollar cap and percentage. There is no martingale or secondary setup.

The actual ask ladder determines the FOK order limit and share quantity. Before reserving the allocation, the engine checks available entry depth, net profit room against the requested target, and sufficient exit depth. The spread and fees may consume at most 10% of the allocation by default. Buying an outcome close to its maximum payout can therefore fail the profit-room check even though there is no fixed entry-price ceiling. A signed price limit still protects each individual order from worse execution.

Paper fills walk public books and include estimated fees. Live fills retain actual order hashes, trade IDs, Polygon OrderFilled evidence, accepted prices, shares, costs, fees and proceeds. An uncertain order is reconciled by its exact hash and is never blindly resubmitted. This bot sells only the shares attributed to its own position; another bot's holdings and proceeds are excluded.

## Exits

The default configurable net profit target is 20% of entry cost. A profit exit uses an observed executable book tick at or above the minimum rate sufficient to cover that target after modeled fees. A calculated target is never passed as an unsupported fractional tick. Every accepted fill is still recorded at its actual price and fee.

An earlier protective exit is triggered if the forecast no longer clears, the remaining stressed margin falls to 50% of its entry margin, or the required spot/oracle model becomes unavailable while an executable outcome book remains available. Near expiry, it also exits if the official TWAP has not crossed. Protective exits may realize a loss. Insufficient executable depth can prevent an exit; the engine does not fabricate a sale.

All exits use FOK and keep exact order attribution. Closed P/L equals actual net sale proceeds plus confirmed remaining settlement value minus entry cost. Settlement represents a redeemable claim, not an assertion that wallet redemption already occurred. A shared-wallet inventory shortfall is flagged for reconciliation and never assigned an invented rate.

## Controls and replacement

Paper is the default and ARM starts off. Live requires saved wallet credentials, current configuration confirmation, verified approvals/balance, a fresh runner lease, an active member and allowed geography. Saving never starts live trading. ARM off stops new buy and sell submissions; already submitted orders and official outcomes continue to reconcile. No live trading is activated during development or verification.

Migration 0010 separates run versions. Registration retires version-1 runs, records an archival event, and publishes the new logic under the same exact catalog record while preserving its publication status. Old records do not consume version-2 deployment slots or enter its current P/L. A legacy live position blocks replacement until it is reconciled. Runner protocol version 2 rejects retired workers; archived member controls cannot re-arm old runs. The member deploys the replacement afresh with ARM off.

All paper balances, positions and statistics stay inside this bot, outside account ledgers, holdings and shared portfolio analytics. Settings are persisted in the database. No sample catalog entries or invented live data are created.

## Reporting and operation

Tiles show all-time max drawdown in USD and max losing streak separately for each member's paper and live run. Drawdown is the largest peak-to-trough decline in cumulative final position P/L, including zero. A winning or break-even position ends the losing streak. The full close journal supplies metrics independently of pagination; partial exits and open/uncertain orders do not count as completed trades. No completed history displays unavailable. This is reporting only.

Each entry checklist records its observation time, round opening, uninterrupted-feed start and separate TWAP, Chainlink spot, exchange spot and outcome-book ages. The run status surfaces the most common blocking condition across markets. The authenticated runner `?diagnostics=<runId>` read exposes the exact run's latest checklist and current public feed for troubleshooting. This reporting does not relax continuity/freshness, change configured profit targets or enable trading.

`npm run bot:cheapshare` runs the isolated worker. The web service and worker share `TWAP_CHEAPSHARE_RUNNER_TOKEN` and the existing encryption key; the worker uses `TWAP_CHEAPSHARE_APP_ORIGIN`. Source is GitHub `funstersland/twaptrade.com`, branch `main`, with Railway's managed PostgreSQL database and a separate CheapShare worker. No region changes or geographic restriction bypasses are permitted.

Validation includes reversal counterexamples, symmetry, history gaps, model mismatch, entry economics, valid exit ticks, net-profit/protective exits, actual fill attribution, ARM/live gates, version isolation, and isolated HTTP/database checks. `scripts/tests/cheapshare-upgrade-postgres.mjs` verifies replacement, atomic rollback, the live-position guard and repeat registration in a disposable PostgreSQL schema. Tests place no real orders.

Sources: [Polymarket TWAP feeds and calculation limits](https://docs.polymarket.com/market-data/chainlink-twap), [Hyperliquid spot metadata](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot), [Binance spot streams](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams).
