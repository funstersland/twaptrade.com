# Bot families and scope

The bot families are Crypto Shares, Crypto Futures, and Forex Futures.

When the user identifies a family and a bot name, scope the work to that exact bot. Resolve its existing catalog ID before changing it. Keep its configuration and trading logic isolated from other bots, including bots with the same name in another family. Do not modify, rename, reassign, or replace unrelated bots as cleanup.

Keep bot-specific implementations in separate modules/configurations. General platform requests (authentication, administration, wallet, shared appearance) remain shared work when explicitly requested. Do not invent trading rules or populate the catalog with sample bots. Existing uncategorized bots must not be assigned a family by guesswork.

## Continuation Strategy · BTC5m

Family: Crypto Shares. Strategy key: `crypto-shares.continuation.btc5m`. Rules and types live only in `lib/bots/crypto-shares/continuation`; runner modules are `scripts/bots/continuation-*.mjs`. Read `docs/bots/continuation-btc5m.md` before changing this bot. Paper records must never write to the account ledger, holdings, snapshots, or generic deployments. Never enter the current round, infer a settlement, retry an uncertain live order, or bypass an unresolved position. Live trading must be started by the user in the bot controls; do not activate live trading during development or testing.

Exit rule: 99¢ or higher executable bids continuously for five seconds. Live exits intentionally sell the wallet’s whole balance of that exact token, including other bots’ shares, per the user’s explicit change. Keep the full sale record separate from this bot’s attributed proceeds and entry-cost P/L. Never sell another outcome/round or cancel unrelated orders. Paper remains isolated.

## CheapShare · Reversal

Family: Crypto Shares. Strategy key: `crypto-shares.cheapshare.flip`, version 2. The retired CTR-M implementation is archived and cannot be re-armed. Read `docs/bots/cheapshare-ctr-m.md` before changing this bot. Strategy modules live in `lib/bots/crypto-shares/cheapshare`, runner modules in `scripts/bots/cheapshare-*.mjs`. Default paper and ARM off. Live must be explicitly armed by the member after configuration review. Do not activate live trading during development. Never apply Continuation's whole-wallet exit rule to CheapShare, invent a strike or settlement, resubmit an uncertain order, or count another bot's proceeds as this bot's profit. Its paper records never enter shared account ledgers.
