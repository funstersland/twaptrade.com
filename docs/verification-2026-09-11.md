# TwapTrade review — 11 September 2026

## Request coverage

| Requested behavior | Implementation and verification |
| --- | --- |
| Premium responsive landing and authentication | Landing, shared login, signup, recovery and reset pages; responsive CSS, reduced motion and lightweight CSS/SVG transitions. No ChatGPT login or administrator credentials in placeholders. Subjective design quality remains a visual judgment. |
| User navigation and real data | Dashboard, wallet, transactions, bots, analytics, referrals and settings use authenticated database records. Empty accounts display zero/empty states. No generated trades or balances are seeded in production. |
| Database personalization | Theme, accent, density and motion persist per profile. Auto is the default; a new login cycles its accent while existing sessions keep theirs. Logo uses the chosen accent. |
| Security and shared admin login | Password hashing, secure session cookies, database role checks, password changes, session revocation and single-use reset links. Admins use the same login page. No administrator credential is embedded in the client. |
| Administration | User roles/status, bot catalog/families, deployment controls, platform settings, referrals, transactions, security sessions and audit history. Profit/loss can be posted to one user, selected users or all eligible users, with atomic balance guards and duplicate prevention. |
| Admin publishes; members deploy | Members cannot create/publish catalog bots. Generic deployment checks available balance and reserves its allocation. Insufficient liquidity produces an explicit error. |
| Three isolated bot families | Crypto Shares, Crypto Futures and Forex Futures. Continuation Strategy is scoped to Crypto Shares / BTC5m; unrelated strategies are not modified. |
| Continuation entry | Next round only, T−10 seconds, observed continuation direction, flat skips, no new entry while an order/position is unresolved. Dollar lot, double after confirmed loss, reset after win. |
| Bot controls and paper mode | Play/pause, lot and encrypted wallet settings, $1,000 recommendation with force/paper choices. Paper is labelled and isolated from account balances, ledger and analytics. Bot tile shows positions, history, results and execution records. |
| Accurate order accounting | Persist signed order identities before submission. Confirm fills against exact exchange events, token, wallet and order. Record actual shares, prices, fees and proceeds; duplicate events cannot post twice. |
| Latest full-wallet exit change | After an executable 99¢ bid remains eligible for five seconds, sell the entire available wallet balance of that exact outcome token. Record the entire sale separately and allocate only this bot’s share of proceeds to its P/L. No other outcome/round or unrelated order is cancelled. |
| One-second updates | Public price stream and one-second engine/API cycles with non-overlap guards. Stale data resets exit stability and skips entries; slow networks do not create artificial ticks. |
| GitHub and Railway | Repository `funstersland/twaptrade.com`, main branch. Separate web and engine services plus managed PostgreSQL in project `twaptrade.com`. Database migration checksums, atomic writes and point-in-time backups. |

## Flaws corrected during review

- Separated Railway web and worker start commands; removed shared config files that conflicted with service settings.
- The Railway runtime excludes development dependencies. Local Sites/Cloudflare build tooling still has upstream development-only audit advisories; those packages are not shipped in the production runtime.
- Updated the framework and vulnerable transitive dependencies identified by npm audit, including the [Next.js image-optimization advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4).
- Fixed origin validation behind Railway’s TLS proxy with an explicit domain allowlist; session cookies remain Secure and HttpOnly.
- Restored the Railway web domain and corrected the existing custom domain’s target port to 3000.
- Kept the Continuation tile visible outside the generic deployment tabs, whose counts do not include strategy-specific runs.
- Removed unstable render-time clock reads, reset admin view state on navigation, and fixed async loading/effect issues reported by lint.
- Made paused bot configuration updates conditional on the absence of an open position at write time.
- Abort before order submission if the atomically claimed martingale lot differs from the lot used to prepare the order.
- Verified PostgreSQL concurrency: simultaneous losses cannot overspend; reserved bot allocations remain protected.

## Validation and limits

- `npm audit --omit=dev` reports zero production dependency advisories after patching. This does not replace a security review or prove the absence of unknown vulnerabilities.
- Automated verification: 12 bot unit tests, four origin-security tests, 62 PostgreSQL strategy/API checks, 28 account checks and 15 ledger/concurrency checks.
- Bot unit tests cover strategy timing, exact prices/fees, unrelated-order exclusion, execution replay, paper liquidity and full-wallet 99¢ stability.
- PostgreSQL HTTP suites use a separate `verification` schema and synthetic fixtures, never production user records. They cover admin/member authorization, settings, referrals, password changes/reset replay, deployment constraints, paper isolation, own versus full-wallet P/L, ledger idempotence and concurrent balance updates.
- Lint, TypeScript, native Next.js production build and the local Sites/Vinext build are checked.
- Publication must additionally verify public HTTPS health and both Railway runtime commands against the pushed GitHub commit. A successful web build alone does not prove the engine is running.
- No funded live trade is submitted during development or validation.

The following external integrations remain incomplete and must not be represented as finished:

1. Automated password-recovery email delivery. Requests are recorded and an administrator can issue a working secure reset link.
2. Internal wallet deposit/withdrawal payment rails. Existing balance and ledger views work; funds are not fabricated.
3. Referral cash rewards. Attribution works; no reward formula or payout funding was supplied.
4. Strategies for other bots. Their deployments remain queued until their execution rules are provided.
5. Live Polymarket validation with a funded, approved wallet. The user must connect and start the bot. Missing wallet approvals or redemption may require completing those actions on Polymarket. Geographic restrictions are enforced.
6. Railway’s GitHub account/app authorization must permit repository access for repository discovery and automatic push deployments. A public-repository deployment does not by itself prove that authorization is healthy.
