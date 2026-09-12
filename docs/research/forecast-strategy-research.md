# Forecast: evidence and design for upcoming BTC rounds

Forecast is a separate Crypto Shares bot for BTC 5-minute, 15-minute and hourly Polymarket rounds. It combines completed 1m, 5m, 15m and 1h Binance BTC/USDT candles, identifies trend agreement and price-action patterns, and attempts an order between 25 and 20 seconds before the target round starts. Each trading window has its own entry switch.

The central finding is negative: the first fixed specification does **not** demonstrate a winning edge. A six-week historical spot-direction check produced 48.4% accuracy for 5m, 42.3% for 15m and 46.9% for hourly forecasts. These results do not include actual Polymarket outcomes or executable historical quotes. They cannot establish a profitable trading strategy, and the observed winning streaks should not be advertised as expected future performance.

Forecast therefore ships as an experimental strategy, with paper mode selected and ARM off. It has explicit entry diagnostics, fixed stakes, bounded exposure, settled P/L, maximum drawdown and both maximum streaks. Its implementation is complete as an execution and evaluation system; the user's desired consistently good winning streak remains unproven.

## What the bot is predicting

A BTC chart candle is not automatically the event being purchased. The next contract's opening reference has not been finalized when Forecast submits at T−25 to T−20. A rise from the current price to the end of the next round does not necessarily produce an Up result: the next round could open higher still. The target is the next round's ending reference relative to its own opening reference, never the current round's color.

The actual upcoming market records inspected on September 12, 2026 used Chainlink **60-second TWAP** for both 5m and 15m. The inspected hourly record used the finalized Binance BTC/USDT one-hour candle, with equality resolving Up. The parser checks the exact UTC start/end, duration, token mapping, resolution source and fee schedule before accepting a market. The inspected short-window configuration overrides conflicting summaries elsewhere on the web; a generic statement that all 5m contracts use a different lookback is insufficient.[^1][^2][^3]

The forecast chart is labeled **Binance BTC spot**. It is an input source, not a reconstruction of Chainlink's custom TWAP. The public TWAP stream does not provide historical replay, and the documented custom TWAP calculation is not fully specified. Using Binance candle averages as purported historical Chainlink settlement would create false precision.[^4]

For example, a green Binance five-minute candle can coexist with a Down Chainlink outcome. Feed composition, smoothing and boundary values can differ. Forecast retains the market's actual resolved winner instead of deriving a winner from its signal chart. This distinction also separates the research proxy from the bot's future paper results.

## What research supports—and what it does not

There is a research basis for formalizing price patterns rather than judging them retrospectively by eye. Lo, Mamaysky and Wang developed computational approaches to technical pattern recognition and statistical inference. That supports defining observable rules that can be tested. It does not establish that a particular combination of engulfing candles, moving averages and support levels predicts the next BTC binary contract.[^5]

Osler's work on foreign-exchange orders offers a microstructural explanation for both reversals near support/resistance and acceleration after breaks. Clusters of take-profit and stop-loss orders can produce different behavior at the same apparent level. This motivates distinguishing a rejection from a breakout instead of always fading a touch. The evidence concerns a different market and period; it is a design hypothesis for BTC, not direct validation.[^6]

Liu and Tsyvinski document time-series momentum and investor-attention effects in cryptocurrency returns. The research supports considering trend as a feature. It does not justify extrapolating results across horizons into a reliable next-five-minute forecast, nor does it remove execution costs.[^7]

More directly relevant negative evidence comes from OpenMarket, a public Polymarket–Binance research release. Its walk-forward model using 43 microstructure features did not beat the probability implied by Polymarket's own book out of sample, and its simulated economic result was negative under the authors' assumptions. This is a preprint with its own sampling and simulation limits, but it is a useful counterweight to selectively reported trading screenshots.[^8]

Backtest selection is another material risk. Bailey and coauthors explain why trying many strategies and selecting the best historical curve can produce misleading performance. The deflated Sharpe framework likewise addresses selection and non-normality. Forecast's first check used one fixed specification, with no threshold sweep or reversal of the losing signals after looking at their results.[^9][^10]

That restraint matters here. Inverting the 15m predictions after observing their 42.3% hit rate would display 57.7% on the same sample, but it would be a newly selected strategy, not independent evidence of an edge. It would need a fresh test with unchanged rules. Choosing only the weeks that won would have the same problem.

The design conclusion is modest: transparent features, causal timing, realistic accounting and abstention are appropriate engineering choices. None of the sources establishes that this exact implementation will produce a superior winning streak. The local data check also fails to establish that claim.

## The fixed strategy specification

Each decision uses the latest 64 available completed candles in each of the four frames, with at least 55 required. The history must be consecutive, complete and aligned to UTC interval boundaries. Every frame must include the latest candle that should already have closed at decision time. An unfinished higher-timeframe candle never contributes its final high, low or close.

History is loaded from Binance's public market-data endpoint. Kline close times are inclusive; Forecast converts them into exclusive interval ends and excludes bars ending after the observation time. The service checks the provider clock and refreshes a frame when its next closed bar becomes available. This avoids requiring days of uninterrupted local collection to reconstruct an hourly trend.[^11]

There are three components to each frame's signed strength: the difference between EMA8 and EMA21 scaled by ATR14, the three-bar price displacement scaled by twice ATR14, and the latest candle's signed body divided by its range. Their weights are 55%, 30% and 15%. The first two components are clipped to −1 through +1; the combined value is also bounded. ATR uses true ranges against prior closes.

These are engineering choices, fixed before the first evaluation, not parameters established by the cited papers. EMA calculations use the same bounded history in research and production. Because all four views come from one asset, agreement is correlated evidence rather than four independent votes.

| Target contract | 1m contribution | 5m contribution | 15m contribution | 1h contribution | Pattern trigger |
|---|---:|---:|---:|---:|---|
| 5m | 35% | 35% | 20% | 10% | Last closed 1m candle |
| 15m | 20% | 35% | 30% | 15% | Last closed 5m candle |
| 1h | 10% | 20% | 35% | 35% | Last closed 5m candle |

A frame is classified Up above +0.08, Down below −0.08, and mixed otherwise. A candidate requires at least three frame classifications to agree and absolute weighted strength of at least 0.25. A strong opposing hourly score below −0.35 in the proposed direction vetoes the candidate. The displayed strength is the absolute weighted score multiplied by 100. **It is not a calibrated probability.**

Support and resistance are confirmed swing lows and highs. A pivot must beat two neighboring bars on each side. Its availability time is the close of the second bar on the right. Nearby same-kind pivots within 0.15 ATR form a zone with a touch count. The trigger candle is excluded from the pivot construction, preventing it from confirming a level retroactively.

A candidate also needs one of four patterns in the trigger frame. Each requires a directional body occupying at least 30% of the candle range, with a range no larger than 2.5 ATR. A support/resistance rejection must touch a known zone, close beyond it in the proposed direction, have a rejection wick of at least 30% of range and close within the directional outer 30%. An engulfing body must cover the previous opposite body. A breakout must close at least 0.05 ATR beyond the preceding 20-bar high or low, with body at least 55% of range and an open on the original side. A trend pullback must recover EMA8 and break the preceding bar in the trend direction.

Pattern priority is rejection, breakout, engulfing, then pullback. This makes the recorded explanation deterministic when a candle matches more than one pattern. A bullish trigger must support an Up forecast; a bearish trigger must support Down. A green candle alone is insufficient.

Two final price checks limit chasing. The current fresh BTC midpoint must stay within 1.5 times the 1m ATR of the latest closed 1m price. A known opposing support/resistance level within 0.5 context ATR blocks entry. The context chart is 5m for a 5m target, 15m for a 15m target and 1h for an hourly target.

These gates deliberately skip mixed or incomplete setups. Skips are not recorded as losses or concealed wins. A visible forecast is also not an executed order: quote, timing, risk and market-identity checks remain independent requirements.

## Historical check and reproducibility

The reproducible evaluator is `scripts/research/forecast-evaluate.mjs`. Its machine-readable output is `docs/research/forecast-proxy-results.json`. It downloads public BTCUSDT one-minute klines, verifies consecutive timestamps, constructs the larger frames without partial bars, and runs the same analysis function as the bot. The data include 64,800 minutes: 72 hours of warmup followed by 42 evaluation days.

The evaluation interval is August 1, 2026 00:00 UTC through September 12, 2026 00:00 UTC, exclusive. Decisions occur at the target start minus 25 seconds. Only bars closed by then enter the features. The target label uses the next Binance candle's close relative to its open, with equality Up. Each result is recorded chronologically, and the output includes SHA-256 hashes of the raw data, strategy source and selected predictions.

The minute archive cannot reproduce the live quote 25 seconds before the boundary. The evaluator therefore uses the last completed one-minute close as an explicitly labeled proxy for that quote. Consequently, the live displacement check is not meaningfully tested by this historical run. The assessment tests structural direction forecasts, not the complete live entry path.

| Target | Available rounds | Selected signals | Correct / incorrect | Direction accuracy | Approx. 95% Wilson interval | Longest win / loss sequence |
|---|---:|---:|---:|---:|---|---:|
| 5m | 12,096 | 748 | 362 / 386 | 48.4% | 44.8–52.0% | 11 / 18 |
| 15m | 4,032 | 293 | 124 / 169 | 42.3% | 36.8–48.0% | 7 / 9 |
| 1h | 1,008 | 64 | 30 / 34 | 46.9% | 35.2–58.9% | 3 / 4 |

Signal coverage was approximately 6.2%, 7.3% and 6.3%, respectively. These are historical selection rates, not promised order frequencies. Spread, depth, minimum size, disabled windows and exposure restrictions can reduce executed orders further.

Weekly results also show instability. The 5m rule had three positive and three negative weeks by correct-versus-incorrect counts; 15m had one positive and five negative weeks; hourly had two positive, two negative and two tied weeks. The hourly sample is particularly small. Combining these horizons as if they were independent would overstate the evidence because decisions and target periods overlap.

Wilson intervals are included as descriptive uncertainty measures under an independence approximation. Serial dependence and correlated windows weaken that approximation. They are not a certification that future accuracy lies in those ranges. This run contains no fit/holdout split because the initial rules were not fitted to this archive; it is a single historical check, not an independently replicated prospective experiment.

Most importantly, these are **not Polymarket trade wins**. They omit Chainlink labels for the short windows, contemporaneous binary books, actual execution and inventory constraints. A dollar P/L curve calculated from an assumed constant entry price would look precise while depending on invented fills. No such curve is supplied.

The 11-signal winning sequence on 5m sits alongside an 18-signal losing sequence and a sub-50% aggregate accuracy. It illustrates why the longest winning streak is a poor optimization target on its own. A system can produce a memorable streak and still lose after costs.

## Execution and accounting

The bot resolves the upcoming market before planning an entry. It requires the expected BTC duration, UTC boundaries, known resolution source, distinct Up/Down tokens, supported fee exponent, accepting status and expected exchange type. Unexpected metadata causes a skip rather than a guess. Final settlement requires a resolved market and exactly one winning outcome; price proximity or a proposed result does not qualify.[^12]

Order planning runs before the submission window. The worker prepares the appropriate outcome and, for live runs, a signed order. During T−25 through strictly before T−20, it rechecks the signal, enabled window, configuration, member status, platform status, available cash and executable quote. A persisted reservation precedes submission. Missing the cutoff means skipping the target; it never catches up inside the current round.

The five-second submission window provides scheduling room when 5m, 15m and hourly boundaries coincide. The least frequent window receives priority: hourly, then 15m, then 5m. Pending live confirmation can still block later attempts; priority does not bypass that protection. It is an attempted-submission deadline, not a promise about exchange latency. FOK execution prevents a partially filled resting order from being intentionally left behind. An uncertain exchange response pauses new entries and is reconciled using the original order identity; no provider submission is retried.[^13]

The quote comes from a newly requested uncached REST book with a bounded request time and rejected positive cache age. Its observation timestamp means when that request began. It is not a claim that the exchange last changed the book at that instant. Missing or crossed quotes, excessive spread, insufficient ask depth, an unsupported fee schedule, an entry above the member's limit or insufficient venue minimum shares all block the attempt.[^14]

Defaults are a $10 all-in stake, a $1,000 risk bankroll, a 2% maximum stake limit, a 5% combined daily realized loss plus open exposure limit, a 52¢ maximum entry and a 2¢ spread cap. The same fixed stake applies after wins and losses. There is no Forecast martingale: increasing size after losses changes exposure without improving forecast accuracy.

The fee-inclusive unit cost matters more than raw win count. With one fill at price 0.50 and the inspected rate 0.07, the documented fee formula gives 0.0175 per share, so the all-in break-even probability is approximately 51.75%. At 0.52 the corresponding value is 53.7472%, before additional execution effects. The implementation reads the market schedule and walks executable asks rather than assuming those example values are permanent.[^15]

Confirmed positions may overlap, up to two unresolved positions per horizon and within the combined exposure cap. This lets the next round be considered before the preceding one has officially resolved. Prepared, submitting or uncertain orders block further entries until reconciled. A position still awaiting official resolution continues to consume exposure; its outcome is never assumed to free capacity.

Turning a window off prevents new submissions for that horizon. Turning it on does not arm an idle bot, change stake size or erase an existing position. All three windows can be off. Risk-setting edits still require disarming and resolving positions. Member actions and worker changes use revision checks so a stale configuration cannot silently overwrite a newer one.

Paper fills use the observed quote and explicitly remain simulated. Live fills are attributed only from confirmed receipts matching the order, wallet, token and exchange. Fees are included once in total entry cost. Winning shares pay their recorded share quantity; losing shares pay zero. Shared account ledgers, holdings and unrelated bots are not used for Forecast's paper bookkeeping.

The tile reports settled P/L, win/loss counts, win rate, maximum winning streak, maximum losing streak and maximum **settled** drawdown. Drawdown tracks peak-to-trough cumulative settled P/L; it is not a mark-to-market liquidation estimate for open positions. Across simultaneous windows, streak order follows recorded resolutions and can differ from ordering by target start. That limitation matters when comparing the live tile with the historical per-window sequence table.

## How a stronger claim could become justified

The next evidence should be actual forward paper outcomes generated by the frozen code. Before evaluating that record, decide the observation period and acceptance criteria. Collect every eligible target, signal explanation, rejection reason, requested quote, simulated fill and confirmed outcome. Keep disabled windows, unavailable data and skipped orders distinguishable from predictions that lost.

Assess each horizon separately before pooling. Compare the selected forecasts with simple fixed-direction and market-price baselines over the same eligible targets. Report net returns after observed fees and conservative fills, not just hit rate. Include drawdown, losing sequences, selection frequency and performance by calendar block. Strong aggregate results that depend on one week or a few large positions would not establish stability.

A calibrated probability model would require a separate training period and genuinely untouched forward evaluation. It would also need enough observations near the intended price range to compare its uncertainty with fee-inclusive break-even. The current agreement score does not satisfy those conditions and must not be used in a Kelly-sizing formula.

Any changed pattern, threshold, reversal rule or execution filter starts a new specification. Earlier outcomes remain part of the research record rather than being overwritten. Repeatedly adjusting until the existing archive shows an attractive streak is precisely the selection risk the research literature warns about.

The present conclusion is therefore specific: Forecast supplies the requested windows, four-timeframe analysis, candle and level explanations, advance-entry scheduling and isolated controls. Neither the literature review nor the first historical check supports promising a profitable edge or reliably long winning streaks. That limitation is visible in the bot and retained with the evaluation files.

## Sources

[^1]: Polymarket Gamma, [inspected upcoming BTC 5m market](https://gamma-api.polymarket.com/markets/slug/btc-updown-5m-1789181700), retrieved September 12, 2026. Exact record: asset BTC, duration 5m, TWAP enabled, lookback 60 seconds.
[^2]: Polymarket Gamma, [inspected upcoming BTC 15m market](https://gamma-api.polymarket.com/markets/slug/btc-updown-15m-1789182000), retrieved September 12, 2026. Exact record: asset BTC, duration 15m, lookback 60 seconds.
[^3]: Polymarket Gamma, [inspected upcoming BTC hourly market](https://gamma-api.polymarket.com/markets/slug/bitcoin-up-or-down-september-11-2026-11pm-et), retrieved September 12, 2026. Rules use the finalized Binance BTC/USDT one-hour candle.
[^4]: Polymarket, [Chainlink TWAP Prices](https://docs.polymarket.com/market-data/chainlink-twap), accessed September 12, 2026. Public streaming behavior, timestamp semantics and limitations of independent TWAP reproduction.
[^5]: Andrew W. Lo, Harry Mamaysky and Jiang Wang, [Foundations of Technical Analysis: Computational Algorithms, Statistical Inference, and Empirical Implementation](https://onlinelibrary.wiley.com/doi/10.1111/0022-1082.00265), *Journal of Finance* 55(4), 2000, pp. 1705–1765. Publisher record and abstract consulted.
[^6]: Carol L. Osler, [Currency Orders and Exchange-Rate Dynamics: Explaining the Success of Technical Analysis](https://www.newyorkfed.org/research/staff_reports/sr125.html), Federal Reserve Bank of New York Staff Report 125, 2001; published version 2003.
[^7]: Yukun Liu and Aleh Tsyvinski, [Risks and Returns of Cryptocurrency](https://www.nber.org/papers/w24877), NBER Working Paper 24877, 2018. Momentum and investor-attention findings concern the authors' sample and horizons.
[^8]: Gregory Young, [OpenMarket: A Synchronized Polymarket–Binance Dataset for High-Frequency Prediction-Market Research](https://arxiv.org/html/2607.26245v1), arXiv:2607.26245, 2026. Preprint; negative forecasting benchmark and simulation limitations.
[^9]: David H. Bailey, Jonathan M. Borwein, Marcos López de Prado and Qiji Jim Zhu, [The Probability of Backtest Overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf), author-hosted paper.
[^10]: David H. Bailey and Marcos López de Prado, [The Deflated Sharpe Ratio](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf), author-hosted paper, 2014.
[^11]: Binance, [public market-data-only endpoints](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md) and [Spot REST API](https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md), accessed September 12, 2026. Actual public klines were retrieved from data-api.binance.vision.
[^12]: Polymarket, [Resolution](https://docs.polymarket.com/concepts/resolution), accessed September 12, 2026.
[^13]: Polymarket, [Order Lifecycle](https://docs.polymarket.com/concepts/order-lifecycle) and [Place Orders](https://docs.polymarket.com/trading/place-orders), accessed September 12, 2026.
[^14]: Polymarket, [Get order book](https://docs.polymarket.com/api-reference/market-data/get-order-book), accessed September 12, 2026. Snapshot fields and minimum-size metadata.
[^15]: Polymarket, [Fees](https://docs.polymarket.com/trading/fees), accessed September 12, 2026. Numerical examples calculated using the inspected markets' rate 0.07 and exponent 1.
