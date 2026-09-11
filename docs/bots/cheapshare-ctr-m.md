# CheapShare · Crypto Shares · CTR-M

Catalog identity is the exact name `CheapShare`, family `Crypto Shares`, strategy key `crypto-shares.cheapshare.ctr-m`. Registration resolves this identity before inserting. It never changes another bot. Continuation's whole-wallet 99¢ exit does not apply here.

CheapShare fades a mature one-sided crowd. If TWAP is below the locked opening strike and Down is expensive, it considers buying cheap Up after Binance holds above the strike; Down entries mirror that rule. It uses no technical indicators or learned model.

## Inputs and market verification

- Six configured assets: BTC, ETH, SOL, XRP, DOGE, HYPE; 5m and 15m.
- Official Polymarket Gamma market identity, exact opening/closing times, Up/Down token IDs, 60-second Chainlink TWAP resolution source, and fee schedule must match. Changed rules disable that window.
- Chainlink TWAP comes directly from the public Polymarket `prices.crypto.chainlink.twap` subscription with `windowSeconds: 60`. Observation timestamps and exact decimal strings are retained. An explicit Gamma Price-to-Beat field is preferred; otherwise, only the observation exactly at the opening boundary can lock the fallback. This reference is persisted and never silently replaced. A restart halfway through a window without a saved reference skips that window.
- Binance spot bid/ask streams supply the lead, conservative projector price, hold and wick checks. These are USDT quotes used as a USD proxy, disclosed in settings/live confirmation. HYPEUSDT was not listed by Binance's spot exchange-info API at verification on 2026-09-11; HYPE therefore remains unavailable until the required spot market exists. No futures substitution is made.
- CLOB books provide executable prices and depth, not midpoint approximations. Polling targets one second without overlapping engine ticks. Network delays can cause skipped decisions; stale inputs do not create orders. Chainlink history gaps over 3 seconds and Binance gaps over 1.5 seconds invalidate holds. CLOB timestamps allow at most 500ms of clock lead.

## Editable starting configuration

These are paper defaults chosen within the supplied approximate ranges, not a proven parameter set. Live ARM requires reviewing and confirming the saved version.

| Pair | Lead, both windows | Spot hold 5m / 15m |
|---|---:|---:|
| BTC | 12bp | 7s / 9s |
| ETH | 14bp | 8s / 10s |
| SOL | 16bp | 9s / 11s |
| XRP | 18bp | 10s / 12s |
| DOGE | 20bp | 11s / 12s |
| HYPE | 22bp | 12s / 12s |

All presets initially use a 10bp TWAP crowd gap held 45s for 5m / 60s for 15m, a 2bp conservative spot hold buffer, a 3bp CLEAR buffer, and late flatten thresholds of 15s / 25s. Every preset can be disabled or edited separately while disarmed with no open positions.

Setup A requires ask 15–28¢, opposing executable bid 70–88¢, and spread at most 4¢. Optional Setup B allows 1–12¢ at lower risk. A crowded bid at least 92¢ with absolute TWAP gap at least 60bp is considered decided and skipped. The two-second spot range must be at most 60% of the current lead by default. TWAP must slope in the proposed purchase direction over five seconds.

The user-specified projector is `T + (S − T) × min(τ, 60s) / 60s`, with S equal to the Binance bid for Up and ask for Down. It must clear the strike by the configured buffer. Time remaining must also exceed the calculated clearance time by eight seconds. This is a conservative constant-spot estimate; it does not reproduce Chainlink's future weighting or guarantee resolution.

Paper starts with a configurable simulated $1,000 bankroll, 1% Setup A risk, optional 0.35% Setup B, 3% daily and 8% weekly loss limits, and at most two concurrent positions per mode. Risk limits include still-exposed entry costs and pending orders. Periods reset at UTC midnight and Monday midnight. Martingale is off by default; when enabled, negative realized round P/L doubles the next allocation up to the configured steps, positive P/L resets it, and risk limits still apply. Bankroll cannot be reset after trading. The news block is a manual control; no automatic news provider is claimed.

## Execution and exits

ARM defaults off in paper and live. Off is a hard stop on new buy **and** sell submissions. It does not reverse an already submitted order; receipts and final settlements continue to be reconciled. Administrator entry pauses stop new buys, while an armed active member may still reduce an existing position.

Live requires saved wallet address/key, derived CLOB credentials, verified spending approvals and balance, current configuration confirmation, fresh runner lease, active member, and allowed geography. Missing approvals are reported for completion on Polymarket. The runtime enforces Polymarket's geographic restriction; no location bypass is attempted.

Buy orders are FOK with a maximum price of 28¢ (A) or 12¢ (B) and an all-in cash cap. A signed order hash and reserved risk are persisted before submission. A second server gate checks ARM and current state immediately before posting. There is at most one entry attempt per run and market window, including an unfilled attempt. Unknown outcomes are queried by that exact hash and are never blindly resubmitted. Paper uses public order-book depth and estimated fees; it is labeled simulated throughout.

Exit order priority:

1. Emergency when the CLEAR projector fails, or Binance stays strictly back beyond the strike for about three seconds.
2. Late flatten when the configured time threshold is reached and TWAP remains on the crowd's side.
3. Sell approximately 40% of initial shares at executable bids ≥55¢.
4. Sell approximately 30% of initial shares at bids ≥75¢.
5. Sell the remaining shares at bids ≥88¢ while CLEAR holds.

Scale orders retain their trigger price as the minimum acceptable execution rate. Emergency/time exits use the lowest currently observed bid needed for the owned quantity. FOK refuses insufficient depth. SDK quantity rounding may leave dust, which remains recorded until official resolution.

CheapShare never sells more than its recorded remaining shares. Actual CLOB trade IDs and successful Polygon OrderFilled logs are matched against signed order hash, wallet, token, side and exchange. Gross, fees, cash, shares and individual accepted rates are retained. P/L uses actual net proceeds plus confirmed remaining settlement value minus this position's full entry cost. Settlement value is a redeemable claim, not a claim that redemption has happened; wallet cash remains the provider balance. Wins and losses use the final realized P/L sign, including exits before resolution.

A shared-wallet inventory shortfall is flagged and blocks new entries and further fabricated attribution. If another bot sold CheapShare's shares, this engine does not guess that external order's rate or profit. Manual review is required. All records, including live records, remain in CheapShare's dedicated journal; paper never touches account transactions, holdings, analytics snapshots or generic deployments.

## Operation

- `npm run bot:cheapshare` runs the isolated worker.
- Set `TWAP_CHEAPSHARE_RUNNER_TOKEN` on the web service and this worker, `TWAP_CHEAPSHARE_APP_ORIGIN` on the worker, and the existing `TWAP_BOT_ENCRYPTION_KEY` on both. Never put them in browser code.
- The web pre-deploy sequence runs PostgreSQL migrations and `node scripts/register-cheapshare.mjs`. Schema migration 0009 is additive. Catalog registration is separately idempotent and respects an existing draft/unpublished record.
- GitHub `funstersland/twaptrade.com`, branch `main`, is the source for both web and CheapShare worker. There is one active worker lease. Continuation's service and strategy modules stay separate.
- `npm run test:bot` covers strategy, exits, fills and existing Continuation regressions. `scripts/tests/cheapshare-http.mjs` only uses the isolated local test database and verifies ownership, durable configuration, CAS/idempotency, paper ledger isolation, encrypted key storage and live gates.

Sources: [Polymarket Chainlink TWAP](https://docs.polymarket.com/market-data/chainlink-twap), [official trading client](https://docs.polymarket.com/trading/quickstart), [Binance spot WebSocket streams](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams).
