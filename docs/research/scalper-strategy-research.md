# Scalper: BTC TWAP rejection strategy research and specification

**Prepared 11 September 2026. Family: Crypto Shares. Markets: BTC 5-minute, 15-minute and hourly Up/Down shares.**

## Decision

Scalper is a deliberately selective, testable support/resistance rejection strategy. It builds candles from published BTC/USD 60-second Chainlink TWAP observations, identifies previously confirmed body-based levels, and buys the selected outcome of the **next** round before the twenty-second cutoff. It uses completed candles only. The requested martingale setting is available, disabled initially, with independent loss sequences for each duration and hard stake/exposure limits.

There is **no defensible evidence that this particular combination delivers the best winning streaks, a particular win rate, or positive net returns**. The implementation is a hypothesis suitable for paper observation. Neither the sources reviewed nor software tests establish its trading edge. Choosing it reflects the requested market structure and a preference for explicit, reproducible rules, not a claim that the numerical thresholds have been optimized.

Two distinctions materially affect the design. First, the current round has not closed twenty seconds before the next round starts: its final body cannot legitimately be used. Second, the reviewed hourly contract settles using Binance BTC/USDT, whereas the reviewed 5m and 15m contracts use Chainlink TWAP. A TWAP signal is therefore not an hourly settlement measurement. The implementation labels both sources and refuses mismatched market metadata.[1][2][3]

## Research scope and method

This review combined current official Polymarket documentation, actual market rules and metadata, original central-bank research, academic paper abstracts and accessible manuscripts, and statistical methodology. It investigated TWAP availability, short-round settlement, execution costs, support/resistance, candle patterns, overfitting, uncertainty, and stake progression. Sources were selected for relevance and authority rather than the volume of search results. A search cannot exhaust the whole internet; inaccessible full texts and incomplete historical datasets limit what can be established.

The market snapshots inspected were BTC 5m starting 11 September 2026 at 13:50 UTC, BTC 15m starting at 14:00 UTC, and BTC hourly starting at 14:00 UTC. Rules can change. Those observations guide identity checks; they are not timeless assumptions. The application reads each market's actual fee schedule and rejects unsupported schedules or settlement metadata. Historical results for a different underlying price, rule version, or contract duration cannot validate this implementation.

The literature review distinguishes what a paper actually tested from what would need to be tested here. Publisher abstracts were sufficient for narrow statements about study design and headline findings; they were not treated as access to unreviewed methods or tables. No trading influencer's advertised win rate is used as an input. No hypothetical performance figures below are backtest results.

## What the evidence supports

### Support and resistance provide a research hypothesis, not a transferred BTC edge

Carol Osler's New York Fed study examined support/resistance levels supplied by six foreign-exchange firms and found information about intraday trend interruptions, with differences across firms and currencies. This is relevant evidence that objectively identified price levels can deserve investigation. It does not establish that two pivots in BTC TWAP candles predict the direction of a future binary contract after fees.[4]

A separate New York Fed study describes how take-profit and stop-loss order placement can help explain reversals around some levels and acceleration after a level breaks. For Scalper, the useful implication is conditional: touching a level alone is insufficient. The proposed system waits for a closed rejection and filters unusually strong opposing movement. Its TWAP chart does not reveal the underlying stop-order distribution, so the mechanism remains an analogy rather than an observed explanation of individual BTC signals.[5]

Lo, Mamaysky and Wang studied algorithmically recognized chart patterns using historical daily US equities and found that some patterns contained incremental information. Their work supports formalizing a visual idea so that it can be tested consistently. It does not establish a profitable BTC candle rule or justify labeling a candle pattern as a calibrated probability.[6]

### Short-horizon technical results are mixed and sensitive to testing choices

Marshall, Cahan and Cahan's study of 7,846 intraday technical rules on five-minute SPDR data found no profitable rules after accounting for data snooping in its setting. This is a relevant counterweight to selecting a visually appealing rule from many candidates. It is neither a proof that Scalper must fail nor evidence that a more elaborate collection of filters must succeed.[7]

Research on candlestick strategies also reports that conclusions can depend on the trend definition and holding strategy. An abstract reporting profitability for particular daily-equity patterns and holding periods cannot be transferred to the much shorter Polymarket payoff. Candle names such as “hammer” are insufficient specifications; body proportions, preceding trend, decision time, execution price and holding period must all be fixed.[8]

A July 2026 preprint, OpenMarket, reports a synchronized BTC 15m prediction-market dataset and a walk-forward logistic-regression baseline that failed to outperform market-implied probabilities; its execution simulation produced negative net results. This directly relevant but preliminary work reinforces the need to compare against the order book and deduct costs. Its February–May sample does not cover the current TWAP contract setup reviewed here, so it cannot supply an empirical win rate for Scalper.[9]

### Multiple trials make impressive backtests easy to overstate

Bailey and coauthors explain why selecting an investment strategy from many backtested alternatives can produce an apparently successful model that disappoints outside the selection sample. Their discussion of the probability of backtest overfitting is especially relevant when tuning pivot widths, wick ratios, timeframe combinations and martingale parameters. A repeatedly consulted holdout is no longer a clean final test. All attempted variants must be logged; future validation should freeze a version before forward evaluation.[10]

These findings lead to a restrained design choice: explicit initial constants, a small number of interpretable filters, and an honest “unproven” status. Adding filters may increase apparent win rate simply by reducing the number of trades. It must be judged alongside coverage, net return, uncertainty and drawdown.

## Market mechanics that govern Scalper

### Signal candles and settlement candles are different objects

The official TWAP guide specifies the `prices.crypto.chainlink.twap` subscription with an explicit `windowSeconds` value and symbol. It describes real-time observations rather than an automatically replayed historical candle series; reconnecting does not recover missed messages. The public updates also do not reveal the complete underlying sampling and rounding process needed to recreate the official TWAP from spot ticks.[1]

Scalper therefore aggregates the **published TWAP values themselves** into OHLC candles. A fifteen-second signal candle contains observations of a rolling sixty-second TWAP; it is not a fifteen-second TWAP. Adjacent observations share much of the same underlying lookback, so apparent smoothness and successive candle agreement should not be interpreted as independent confirmations. That correlation is a mathematical consequence of overlapping windows, not evidence of momentum predictability.

The engine records source timestamps with exact E18 price values, rejects stale or future observations, and invalidates candles containing gaps longer than three seconds. A candle only becomes closed after a subsequent observation crosses its boundary. This freshness tolerance is an engineering default requiring operational measurement; if normal feed delivery violates it, the consequence is fewer valid signals, not interpolation of missing prices.

### Verify the contract before selecting an outcome

The reviewed 5m and 15m contracts explicitly use the BTC/USD sixty-second Chainlink TWAP source. Scalper checks the asset, duration, TWAP enablement/lookback, UTC start/end, condition, outcome mapping and tokens. It does not infer these from a chart label alone.[2]

The reviewed hourly contract instead specifies the finalized Binance BTC/USDT one-hour candle: a close at or above its open is Up. Its year-bearing Eastern Time slug must match the actual UTC interval; omitting the year can locate an older contract. The hourly strategy still uses the requested TWAP signal, with this cross-source basis risk disclosed in the interface.[3]

For both types, buying before the round starts means the future opening reference is unknown. The rule forecasts subsequent direction without pretending to know that reference. A bullish rejection relative to a historical support zone can still lose an Up share if price rises before the opening boundary and then closes below that new opening value. For hourly markets, a difference between the TWAP and Binance paths introduces an additional mismatch.

Settlement uses official resolved market metadata and exactly one winning outcome. A candle close, high token price, or bot prediction never substitutes for a confirmed market resolution. Settlement may occur after the nominal round end, and winning shares may require redemption before the wallet's cash balance changes.[11]

### Fees and executable prices determine the required accuracy

Polymarket's current fee documentation gives the taker fee as shares × fee rate × `p(1−p)` for the supported crypto schedule. Scalper reads the market's actual schedule and includes fees inside the spend budget. The displayed quote uses ask-side depth; the midpoint is not a simulated execution.[12]

For a binary share held to resolution, define `p` as the purchase price, `f` as the fee per share and `q` as the true win probability. Ignoring other costs, expected net dollars per share are `q − p − f`, so break-even is `q = p + f`. This arithmetic does not estimate `q`.

| Purchase price | Illustrative fee at rate 0.07 | Break-even probability |
|---|---:|---:|
| 50¢ | 1.75¢ per share | 51.75% |
| 52¢ | 1.7472¢ per share | 53.7472% |
| 60¢ | 1.68¢ per share | 61.68% |

The examples assume one fill price, exponent one and no additional costs. Actual depth can produce several prices. The initial 52¢ ceiling controls purchase cost; it does not prove that a qualifying signal has a probability above 53.7472%. The runner cannot honestly apply an “estimated edge” filter without a calibrated model and relevant validation data.

FOK orders either fill immediately in full or do not execute; the SDK also supports maximum price/spend constraints. Scalper checks spread, available ask depth and minimum order size before committing an attempt. A quoted book can change before the request arrives, so paper fills remain estimates and live orders may fail.[13]

## Proposed strategy, frozen initial version

The following rules are original implementation choices. They are not reported academic findings or an optimized formula.

| Contract | Structural candles | Rejection candles | Minimum structural warmup |
|---|---|---|---|
| BTC 5m | 1 minute | 15 seconds | About 40 minutes |
| BTC 15m | 3 minutes | 1 minute | About 2 hours |
| BTC hourly | 5 minutes | 5 minutes | About 3 hours 20 minutes |

Warmup can take longer because partial startup candles, gaps, and unavailable repeated pivots do not count. Use 40–60 consecutive complete structural candles. Structure must be known before the rejection candle begins. The current round's unfinished candle is never supplied as a final close.

**1. Establish levels.** A support pivot is a candle body low strictly below the body lows of two candles on each side; resistance uses the opposite comparison on body highs. Both right-side candles must already have closed. Group pivots of the same kind within 0.15 of the twenty-candle average true range and require two touches. Body levels implement the requested body-language emphasis; high/low wicks remain relevant to rejection.

**2. Confirm support rejection.** The completed signal candle must touch the zone, close bullish above it, and show a body at least 25% of its full range. Its lower wick must occupy at least 35% of the range, and its close must lie in the top quarter. The previous signal candle must be bearish or flat; the new close must recover more than half of that previous body. Resistance uses the mirrored conditions and produces a Down candidate.

**3. Reject weak or displaced setups.** Reject an indecisive body, zero range, or a signal candle larger than three structural ATRs. The latest fresh TWAP must remain on the rejected side and no more than half an ATR from the rejection close. Reject a five-context-candle move exceeding two ATRs against the proposed direction, conflicting directional candidates, or a known opposing level less than one ATR away. These filters can eliminate opportunities without improving out-of-sample performance; each needs later ablation testing.

**4. Select the exact next market.** Pre-check and, for live mode, pre-sign only the matching upcoming contract. The submission window opens twenty-two seconds before its start and closes strictly before twenty seconds remain. Recheck ARM, signal direction, configuration, price, funding and risk during that window. A missed deadline is a skipped opportunity. Network delivery and exchange matching times are not guaranteed by the scheduler.

**5. Enter once and hold.** Buy only the predicted outcome, using FOK and the configured all-in lot. Persist an attempt and signed order hash before a live submission. Each horizon has at most one unresolved position. Consequently, the immediately following round is normally skipped while that position awaits resolution; trade coverage must reflect this. Do not resubmit an uncertain order. Hold until official resolution; there is no speculative early sale, whole-wallet liquidation, or inferred settlement in this version.

**6. Account only for Scalper.** The strategy has separate paper/live records and per-horizon stake sequences. Live attribution requires this exact order, outcome token, wallet and confirmed receipt. Unrelated bots' proceeds and holdings never become Scalper's profits. Closed P/L includes entry fees; the tile shows maximum drawdown and longest losing streak alongside winning streak and win rate.

## Martingale: requested option, not a forecasting improvement

A martingale multiplies the next stake after a loss. It does not change the information in a rejection candle or raise the next trade's probability of winning. Its characteristic tradeoff is many recoveries punctuated by a larger loss when a sequence reaches a capital, step, liquidity or exposure limit.

With base stake `b` and doubling, `n` successive lost stakes total `b(2^n−1)`. Starting at $10, the first four stakes are $10, $20, $40 and $80; losing all four costs $150. This is arithmetic, not a forecast of the probability of those losses. Correlated BTC horizons and persistent market regimes can make independence assumptions particularly misleading.

Even a doubled winning stake need not recover prior losses. At 52¢ and the illustrative fee above, a $20 all-in winning purchase earns about $17.21 net. Following losses of $10 and $20, an $40 winning purchase earns about $34.42, but later recovery arithmetic depends on price, fees, fill size and the length of the sequence. A cap reached before that win leaves the accumulated losses intact. Transaction expenses outside the purchase calculation would reduce recovery further.

Defaults are $10 base stake, $1,000 risk bankroll, 2% maximum stake and 5% daily realized loss plus open exposure. These imply a $20 per-trade ceiling and a $50 daily loss/exposure ceiling. Thus enabling martingale under otherwise unchanged defaults permits $10 then $20; a subsequent $40 stake is blocked even though the step setting allows three doublings. The UI reports a limit reached rather than silently increasing risk or resetting the sequence. This conservatism is intentional and should be understood before changing settings.

The loss counter is separate for 5m, 15m and hourly. A negative realized result increments it; a nonnegative result resets it. Skips and unfilled orders leave it unchanged. The overall tile's longest losing streak instead follows actual settlement order across the run, because that is the sequence of realized account outcomes. Those two sequences answer different questions.

## How to evaluate the candidate honestly

### Required dataset

Collect a chronological archive of the official sixty-second TWAP messages and receive times, completed/incomplete candles, discovered market identities and rule versions, pre-entry bid/ask depth and minimum sizes, fees, all signal decisions including skips, selected order identifiers, execution events, and eventual official outcomes. For hourly evaluation, retain finalized Binance settlement information as well. Include market discovery failures and feed outages instead of deleting inconvenient periods.

The current application retains a rolling operational candle window and trade journal; that is not a complete research archive. A dedicated archival pipeline or correctly sourced historical dataset is still needed for a reproducible long-period performance study. Public RTDS reconnection alone cannot recover missed history. Do not create an apparent backtest by replacing TWAP candles with spot candles or today's settlement rules with historical ones.[1]

### Predeclare comparisons and selection rules

Begin with fixed stakes and martingale off so that signal behavior can be assessed separately from sizing. Freeze the initial version, list every tested variant, and use chronological training/selection periods followed by an untouched forward period. Compare against always-Up/always-Down where executable and against order-book implied probabilities at the same decision times, including fees and identical eligibility constraints. A favorable comparison only on a hand-picked set of fills is insufficient.

Report each duration separately before pooling them. BTC 5m, 15m and hourly positions can overlap and share the same underlying move; three wins are not necessarily three independent pieces of evidence. Examine directional balance, volatility regimes, time-of-day, days with outages, entry-price bands, and rejection frequency. An ablation should test whether each additional filter improves results after costs rather than merely producing a nicer historical streak.

### Metrics and uncertainty

Track number of eligible rounds, number of signals, fill/skip rate, net P/L, average win and loss, return per dollar risked, worst closed-equity drawdown, longest losing sequence, longest winning sequence, exposure concentration, fees and operational errors. Closed-equity drawdown is the maximum decline from a preceding cumulative realized-P/L peak, beginning at zero; it excludes interim mark-to-market movements. Report an additional mark-to-market measure only if executable valuation data support it.

A win rate without a trade count and uncertainty interval is incomplete. The NIST reference describes Wilson intervals for binomial proportions. Those intervals are useful under their sampling assumptions, but overlapping BTC contracts and streak dependence require further treatment; day/block-based uncertainty estimates and separately reported horizon results are more appropriate than claiming every trade is independent.[14]

For illustration only, if independent trades each won with probability 0.55, the probability that one specified block of eight trades all wins would be `0.55^8`, about 0.84%. This is not the probability of encountering at least one eight-win run over a long history, nor an estimate for Scalper. Optimizing the longest observed streak encourages selecting a lucky sample. Net expected value and tolerable drawdown are better primary acceptance criteria.

### Acceptance and failure conditions

A sensible future go/no-go review would require stable data capture, no identity or duplicate-order failures, positive out-of-sample net results with uncertainty disclosed, sufficient observations across regimes, and tolerable drawdown under fixed sizing. Exact capital and confidence requirements should be predeclared for the intended operating scale. The current evidence does not supply enough data to assign a justified universal sample threshold or approve live profitability.

Pause evaluation when market rules change, the required source disappears, order responses are uncertain, or record reconciliation fails. Do not reinterpret a failed live submission as a simulated win. Paper/live differences must be measured rather than assumed away. A successful software test shows that a rule was implemented and guarded; it is not a successful trading experiment.

## Outcome of this work

The implementation provides an isolated Crypto Shares / Scalper bot, the three requested BTC durations, closed TWAP candles and confirmed support/resistance, an early next-round entry window, fee/liquidity gates, optional capped martingale, and explicit realized-risk reporting. Its initial configuration is paper with ARM off. The research supports testing the hypothesis carefully; it does not support a “best winning streak” promise.

## Sources

[1] Polymarket, [Chainlink TWAP market data](https://docs.polymarket.com/market-data/chainlink-twap). Official source format, explicit window, availability and history limitations; reviewed 11 September 2026.

[2] Polymarket, [BTC 5m, 11 September 2026, 13:50 UTC](https://polymarket.com/event/btc-updown-5m-1789134600) and [BTC 15m, 11 September 2026, 14:00 UTC](https://polymarket.com/event/btc-updown-15m-1789135200). Actual rules and associated Gamma metadata inspected read-only.

[3] Polymarket, [Bitcoin Up or Down, 11 September 2026, 10am ET](https://polymarket.com/event/bitcoin-up-or-down-september-11-2026-10am-et). Actual hourly Binance settlement rule and UTC metadata inspected read-only.

[4] Carol L. Osler, [Support for Resistance: Technical Analysis and Intraday Exchange Rates](https://www.newyorkfed.org/research/epr/00v06n2/0007osle.html), Federal Reserve Bank of New York Economic Policy Review, 2000.

[5] Carol L. Osler, [Currency Orders and Exchange-Rate Dynamics: Explaining the Success of Technical Analysis](https://www.newyorkfed.org/research/staff_reports/sr125.html), Federal Reserve Bank of New York Staff Report 125, April 2001.

[6] Andrew W. Lo, Harry Mamaysky and Jiang Wang, [Foundations of Technical Analysis: Computational Algorithms, Statistical Inference, and Empirical Implementation](https://www.nber.org/papers/w7613), NBER Working Paper 7613, March 2000. Abstract reviewed; full-page access was restricted.

[7] Ben R. Marshall, Rochester H. Cahan and Jared M. Cahan, [Does intraday technical analysis in the U.S. equity market have value?](https://www.sciencedirect.com/science/article/pii/S0927539807000588), Journal of Empirical Finance, 2008. Publisher abstract reviewed.

[8] [Trend definition or holding strategy: What determines the profitability of candlestick charting?](https://www.sciencedirect.com/science/article/pii/S0378426615002678), Journal of Banking & Finance, 2015. Publisher abstract reviewed; cited only for dependence on study design, not as evidence for Scalper.

[9] Gregory Young, [OpenMarket](https://arxiv.org/abs/2607.26245), arXiv preprint, July 2026. Abstract reviewed; preliminary evidence and an earlier market regime.

[10] David H. Bailey, Jonathan M. Borwein, Marcos López de Prado and Qiji Jim Zhu, [The Probability of Backtest Overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf), manuscript dated 27 February 2015.

[11] Polymarket, [Resolution](https://docs.polymarket.com/concepts/resolution) and [Market details](https://docs.polymarket.com/market-data/market-details). Official resolution and metadata references.

[12] Polymarket, [Fees](https://docs.polymarket.com/trading/fees). Current crypto fee formula and schedule; market-specific metadata remain authoritative inputs.

[13] Polymarket, [Place orders](https://docs.polymarket.com/trading/place-orders), [Order lifecycle](https://docs.polymarket.com/concepts/order-lifecycle), and [Wallets and authentication](https://docs.polymarket.com/trading/wallets-auth). Execution, funding-wallet and lifecycle references. Installed `@polymarket/client` version 0.10.0 was also inspected for the implementation.

[14] NIST/SEMATECH, [Confidence limits for a binomial proportion](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm). Wilson interval methodology and binomial setting.
