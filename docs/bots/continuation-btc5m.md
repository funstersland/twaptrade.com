# Crypto Shares / Continuation Strategy / BTC5m

Only this catalog bot uses `crypto-shares.continuation.btc5m`. Its verified production catalog ID is `047f0cd1-f335-43f0-b775-cb478c82ea08`. Catalog registration resolves the exact family and name and never changes another bot. The $1,000 catalog minimum is a recommendation for this bot only; generic bots retain their strict allocation requirement.

## Approved strategy

- Market: Polymarket BTC Up/Down, five-minute rounds.
- At twenty seconds before the current round ends, compare the running Chainlink BTC/USD 60-second TWAP observation with the observation at the current round's opening boundary. Do not wait for the candle to close or for any round to resolve.
- Green buys Up in the **next** round. Red buys Down in the **next** round. An unchanged price skips the entry.
- No current-round purchases. A unique deployment/target-round record prevents repeat entries. Submission starts at T−20 and must finish before T−15; there is no late catch-up at the old T−10 timing.
- Confirmed open positions do not block the next entry. Each open round continues to be marked, exited and reconciled independently. Pending or uncertain order executions still block new submissions until their quantities and cash effects are known.
- Lot means all-in dollars per round. Only confirmed results affect the lot. Order confirmed rounds by their market start: a confirmed win resets to the configured base lot; subsequent confirmed losses double the next lot. A delayed older result cannot override a newer confirmed win. Open, unfilled, skipped, or uncertain rounds do not count as losses. Available cash must cover every new allocation; pending buys cannot spend the same cash twice.
- The next lot must fit available funds. Doubling can exhaust the balance; binary share prices and fees mean a double does not guarantee recovery.
- Exit when the executable bid stays at **99¢ or higher for five continuous seconds**, checked on the one-second cycle. A price dip, stale response, insufficient full-quantity depth, or observation gap over 1.5 seconds resets the timer.
- Live exits sell the connected wallet’s **entire available balance of that exact outcome token**, including shares bought by other bots, as explicitly requested. Other rounds and the opposite outcome are not sold. A FOK sell has a 99¢ minimum; actual fills can improve on that price.
- Persist the signed sell order hash and observed wallet quantity before submitting. Never cancel unrelated orders to make shares available. An ambiguous sell stays pending and is not resubmitted.
- Record the full wallet sale, then allocate its actual gross proceeds and fees by the quantity attributed to this bot. Unknown external entry costs are never counted as this bot’s P/L. Rounding residuals remain in the external portion. Paper mode sells only its own simulated position.
- Unsold shares remain tracked until a later eligible exit or confirmed market resolution. Resolution and cash redemption are distinct. The tile reports closed-position P/L; wallet cash comes from the provider’s balance.
- Pause blocks future entries. Existing positions continue to follow their exit rule, reconcile, and settle.

## Paper and live records

Tiles show all-time max drawdown in USD and max losing streak for each member's exact run, with paper and live kept separate. Drawdown is the largest peak-to-trough decline in cumulative closed-round net P/L, starting from zero. The streak counts consecutive negative-P/L closed rounds; a winning or break-even round ends it. Open, uncertain, skipped and unfilled rounds do not count. Metrics use the full history, not the displayed page, and show unavailable when no completed history exists. These reporting metrics do not change staking or exits.

The P&L breakdown sums positive and negative closed-round net P/L separately, shows their difference, average profit/loss and largest loss, and reports closed-trade fees already included in those amounts. Trade counts do not imply equal dollar outcomes. The runner's authenticated `?accounting=<runId>` read returns this same breakdown for an existing exact-bot run without wallet credentials. It performs no mutation.

`continuation_runs` and `continuation_rounds` hold bot-specific settings, positions, marks, and history. Live and paper modes are separate deployments with separate balances and streaks. Paper starts with explicitly simulated $1,000 cash, follows actual upcoming markets and observed order books, includes the market's reported fee curve, and waits for Polymarket's resolved outcome. Paper fills are estimates, not exchange executions.

Neither paper nor live bot performance is used to fabricate a TwapTrade cash balance. Paper never writes to `transactions`, `holdings`, `portfolio_snapshots`, or `deployments` and does not enter account analytics. Live position/cash figures on the tile come from the connected external wallet; they are not added to the internal account ledger. Future wallet reconciliation must preserve this separation and avoid counting the same money twice.

The $1,000 deployment prompt offers Force proceed or the recommendation to use paper mode. Force overrides that recommendation only; it cannot manufacture funds, bypass wallet approval, or override order liquidity.

## Polymarket connection research (2026-09-11)

The current official unified TypeScript SDK is `@polymarket/client` (pinned 0.10.0 here), with its Viem signer adapter. The current quickstart takes two inputs: account wallet address and signer private key. `createSecureClient` resolves the wallet type and creates/derives CLOB L2 credentials. Those credentials authenticate requests; the signing key still signs orders. Earlier indexed documentation refers to the older `clob-client-v2`; this implementation follows the current unified SDK.

The account address must be the funding wallet shown in the Polymarket profile, which can differ from the signing key's EOA address. Current accounts generally use Deposit Wallets; older Proxy and Safe wallets are supported by the SDK.

Two fields suffice for CLOB authentication and trading on an already funded, approved account. They cannot derive a separate Relayer API key or Builder authorization. Gasless wallet deployment, missing spending approvals, and redemption can require that separate authorization. The connection check reads spending approval state and reports missing approvals rather than pretending they were granted. Users can complete approvals/redemption on Polymarket. No private key is requested in conversation.

Orders use `createMarketOrder` with all-in `maxSpend`, followed by a single `postOrder` with Fill-or-Kill. This avoids the SDK's high-level approval-and-retry workflow inside the narrow entry window. Provider rejections remain unfilled. An ambiguous submission pauses the bot, which does not retry it. The exact EIP-712 order hash is persisted before posting, allowing subsequent reconciliation even if the response is interrupted. The local hash was checked against the deployed exchange’s read-only hashOrder method. An order that cannot be conclusively reconciled remains paused.

Live fills require confirmed CLOB trades and successful Polygon receipts. The Exchange V2 `OrderFilled` event must match the persisted order hash, expected funding wallet, side, and token ID from a known exchange address. Each transaction/log index, block, order reference, related CLOB trade IDs, exact collateral amount, shares, fee, and effective price is persisted. Wallet-wide transfer deltas and the venue’s averaged positions are never used to reconstruct the bot’s entry cost. Buys and sells use integer base units; fees are added to buy cost and deducted from sale proceeds. Duplicate execution events cannot post twice.

`continuation_fills` records each confirmed execution; `continuation_orders` records every exit attempt and the full-wallet versus bot-attributed quantities. Rounds retain accumulated own proceeds, remaining shares, final P/L, win/loss, and the 99¢ stability indicator. This includes zero outcomes; unfilled or uncertain orders never become fabricated losses.

Sources:

- [Current first-order guide](https://docs.polymarket.com/trading/quickstart)
- [Wallets and authentication](https://docs.polymarket.com/trading/wallets-auth)
- [Order placement](https://docs.polymarket.com/trading/place-orders)
- [Chainlink TWAP feed](https://docs.polymarket.com/market-data/chainlink-twap)
- [Trading fees](https://docs.polymarket.com/trading/fees)
- [BTC five-minute market rules](https://polymarket.com/event/btc-updown-5m-1789086300)
- [Order management](https://docs.polymarket.com/trading/manage-orders)
- [Order lifecycle](https://docs.polymarket.com/concepts/order-lifecycle)
- [Exchange V2 event definitions](https://github.com/Polymarket/ctf-exchange-v2/blob/main/src/exchange/interfaces/ITrading.sol)
- [Exchange settlement and fee accounting](https://github.com/Polymarket/ctf-exchange-v2/blob/main/src/exchange/mixins/Trading.sol)
- [Official TypeScript SDK](https://github.com/Polymarket/ts-sdk)

## Runtime and operations

On Railway, the `twaptrade.com` web service and `continuation-engine` run as separate services with one shared PostgreSQL database. Locally, run the site and `npm run bot:continuation` as separate processes. The engine requires Node 24+, an always-on host with an accurate clock, and HTTPS to the site outside localhost. The engine targets one tick per second, streams public RTDS prices, refreshes round/order/position state on the one-second cycle with overlap protection, and the visible tile polls once per second. Slow responses do not manufacture fresh data. A browser tab never submits orders or schedules trading. A minute-level scheduler cannot supply the T−20 timing required here.

The runner streams Polymarket's public RTDS `prices.crypto.chainlink.twap` feed, BTC/USD, 60-second lookback. It retains exact E18 price strings. It requires a boundary observation for the candle open and a price no more than three seconds old for entry. A missing boundary or feed gap skips the round. Polymarket's geographic restrictions are checked before live submission and are never bypassed.

`TWAP_BOT_ENCRYPTION_KEY` is an independent random 32-byte base64 AES-GCM key. Wallet signing keys are encrypted with user/bot-bound additional authenticated data; they never appear in a member API response, localStorage, logs, or source. `TWAP_BOT_RUNNER_TOKEN` is an independent random token for the server-only runner API. Keep both in ignored local environment files or secret hosting configuration. Back up the encryption key securely; rotating it requires re-encrypting saved wallet keys. Run one engine per site; database leases reject concurrent engines.

Apply all append-only migrations through 0008 in order. Register the requested bot with `scripts/bots/register-continuation.sql` separately from schema migrations. All newly deployed instances begin paused. Hosted publication does not automatically provision an always-on runner. No live order should be placed during development or validation.
