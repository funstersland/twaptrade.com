# Bot families and scope

The bot families are Crypto Shares, Crypto Futures, and Forex Futures.

When the user identifies a family and a bot name, scope the work to that exact bot. Resolve its existing catalog ID before changing it. Keep its configuration and trading logic isolated from other bots, including bots with the same name in another family. Do not modify, rename, reassign, or replace unrelated bots as cleanup.

Keep bot-specific implementations in separate modules/configurations. General platform requests (authentication, administration, wallet, shared appearance) remain shared work when explicitly requested. Do not invent trading rules or populate the catalog with sample bots. Existing uncategorized bots must not be assigned a family by guesswork.

## Continuation Strategy · BTC5m

Family: Crypto Shares. Strategy key: `crypto-shares.continuation.btc5m`. Rules and types live only in `lib/bots/crypto-shares/continuation`; runner modules are `scripts/bots/continuation-*.mjs`. Read `docs/bots/continuation-btc5m.md` before changing this bot. Paper records must never write to the account ledger, holdings, snapshots, or generic deployments. At T−20, follow the running candle into the next round. Confirmed open positions may overlap; entry does not wait for resolution. Never enter the current round, infer a settlement, retry an uncertain live order, or bypass an unconfirmed order. Martingale uses confirmed results only. Live trading must be started by the user in the bot controls; do not activate live trading during development or testing.

Exit rule: 99¢ or higher executable bids continuously for five seconds. Live exits intentionally sell the wallet’s whole balance of that exact token, including other bots’ shares, per the user’s explicit change. Keep the full sale record separate from this bot’s attributed proceeds and entry-cost P/L. Never sell another outcome/round or cancel unrelated orders. Paper remains isolated.

## CheapShare · Reversal

Family: Crypto Shares. Strategy key: `crypto-shares.cheapshare.flip`, version 2. The retired CTR-M implementation is archived and cannot be re-armed. Read `docs/bots/cheapshare-ctr-m.md` before changing this bot. Strategy modules live in `lib/bots/crypto-shares/cheapshare`, runner modules in `scripts/bots/cheapshare-*.mjs`. Default paper and ARM off. Live must be explicitly armed by the member after configuration review. Do not activate live trading during development. Never apply Continuation's whole-wallet exit rule to CheapShare, invent a strike or settlement, resubmit an uncertain order, or count another bot's proceeds as this bot's profit. Its paper records never enter shared account ledgers.

## Scalper · BTC rejection

Family: Crypto Shares. Strategy key: `crypto-shares.scalper.rejection`. The user explicitly authorized designing this new support/resistance rejection strategy. Read `docs/bots/scalper.md` before changing it. Keep all strategy state/rules in `lib/bots/crypto-shares/scalper` and its runner in `scripts/bots/scalper-*.mjs`. BTC horizons are 5m, 15m and hourly. Use observed Chainlink TWAP candles for signals; verify the hourly Binance settlement rules separately. Never use an open candle to confirm rejection or enter the current round. Submit during T−22..T−20, strictly before the twenty-second cutoff, with no catch-up. Default paper, ARM off, martingale off; only members can arm live. Martingale is capped and isolated per horizon. Hold to confirmed resolution, never infer settlement, sell other bots' inventory, retry an uncertain live order, or write Scalper's paper/live performance into account ledgers.

## Forecast · BTC multi-timeframe

Family: Crypto Shares. Strategy key: `crypto-shares.forecast.confluence`. The user authorized designing this new strategy. Read `docs/bots/forecast.md` before changing it. Strategy modules live only in `lib/bots/crypto-shares/forecast`; runner modules are `scripts/bots/forecast-*.mjs`. Analyze closed Binance BTC candles in 1m, 5m, 15m and 1h; trade independently switchable BTC 5m, 15m and hourly Polymarket windows. Default paper, ARM off, fixed stake. The first historical proxy did not establish a winning edge; never claim a guaranteed streak or label signal strength as a probability. Live must be armed by the member, never during development. Submit only for the next round at T−25..strictly before T−20. Resolve market identity/settlement source explicitly, never infer outcomes, retry uncertain orders, or touch unrelated inventory/ledgers. Window-off blocks new submissions but preserves settlement reconciliation.
