# TwapTrade

A responsive trading workspace built with React, Vinext, Cloudflare Workers, and D1.

## Routes

- `/`: landing page
- `/login`: shared login for members and administrators; the server directs each account to its permitted workspace
- `/signup`, `/forgot-password`, `/reset-password`: account registration and recovery
- `/app/dashboard`, `/app/wallet`, `/app/transactions`, `/app/bots`, `/app/analytics`, `/app/referrals`, `/app/settings`: member workspace
- `/admin/login`: compatibility redirect to `/login`
- `/admin/overview`, `/admin/users`, `/admin/profit-loss`, `/admin/bots`, `/admin/deployments`, `/admin/transactions`, `/admin/holdings`, `/admin/referrals`, `/admin/audit`, `/admin/settings`, `/admin/security`: administration

## Accounts and permissions

Email/password authentication uses salted scrypt verifiers and opaque, eight-hour sessions. Session tokens are hashed in D1; cookies are HttpOnly and SameSite=Lax, with Secure and a __Host- prefix on HTTPS. Mutation endpoints validate Origin and strict request schemas. Login and recovery attempts are rate limited. Every private API checks the current account status and role in D1.

The initial owner is provisioned on the first successful login using `TWAP_ADMIN_EMAIL` and `TWAP_ADMIN_PASSWORD_HASH`. Configure the verifier in ignored `.dev.vars` for local development and a secret environment binding for hosting. Never put a plaintext password in source or configuration. The bootstrap verifier stops being used after an owner exists; subsequent password changes use the credential record in D1.

Only the owner can appoint or manage other administrators. Administrators manage member profiles, email addresses, access status, internal notes, and sessions. Suspending or archiving retains records and revokes access. The owner's role, email, and active status are protected from administrative edits.

Administrators can create member accounts and issue secure setup or recovery links. These links expire after 30 minutes, can be used once, and invalidate older links. Resetting a password revokes existing sessions. Email delivery is not connected: the recovery form records a request in the audit log and tells the member to contact the administrator. It does not claim that an email was sent.

## Trading and financial records

Every displayed account statistic comes from D1. New accounts have no holdings, transactions, valuations, or deployments and show zero balances. Missing asset valuations are identified as unavailable rather than fabricated. The former sample-data mode and platform identity bypass have been removed.

Only administrators create or publish bot catalog entries. Members deploy published bots when available liquidity covers the minimum and their chosen allocation. Successful deployments are queued automatically; insufficient funds return “Insufficient liquidity balance.” Allocation checks are atomic, reserve pending and running allocations, and prevent duplicate deployments. Members can stop queued deployments; administrators can review legacy requests or stop queued deployments. No interface can pretend to start trading: the execution engine still needs the owner's trading rules and an actual provider connection.

Funding, withdrawals, market valuation ingestion, and trading execution are not connected. Administrators can post account Profit or Loss entries for one active member, selected members, or all active members. A five-minute review fixes the recipient list and shows per-member and total amounts before posting. A D1 transaction rechecks account access and available liquidity, posts the entire batch once, records known portfolio valuations, and retains an administrator audit. Losses cannot consume reserved allocations or overdraw available cash. Entries use standard Profit/Loss labels with no remarks; these ledger adjustments do not claim to be exchange-executed trades. Provider integrations must authenticate their events, record idempotent transaction references, and supply real valuations before enabling these operations.

Bot families are Crypto Shares, Crypto Futures, and Forex Futures. New and edited catalog entries require a family. Names are unique within each family, case-insensitively; the same name can exist in different families. Existing uncategorized records stay unassigned until explicitly classified. Family filters are available in both catalogs. `AGENTS.md` requires future bot-specific work to resolve the named family and bot to its ID and leave other bots unchanged.

## Continuation Strategy · BTC5m

The Crypto Shares catalog now includes Continuation Strategy, with its own paper/live controls, encrypted wallet connection, live round display, marks, and history. See [the bot specification and Polymarket research](docs/bots/continuation-btc5m.md). Run its separate Node 24 engine with `npm run bot:continuation`; hosted use needs an always-on runner. The default deployment is paused. Paper performance stays entirely inside the bot. Apply migration 0005 and run the exact-bot registration SQL after schema updates.

## Referrals and appearance

Registration validates referral codes and attributes each new account once. Members see their own referral counts and join dates; administrators see the platform's actual referral relationships. Reward terms are configurable text; payouts are not implemented.

Dark, light, and system themes. Auto is the default accent and rotates through mint, sky, amber, and rose on each successful login. The chosen color is stored with the session in D1, stays consistent across reloads and tabs, and is preserved when changing a password. Explicit fixed-color choices remain saved account preferences. Appearance applies to the logo and the whole workspace. Account preferences are stored in D1, with safe local storage and in-memory fallbacks. Comfortable/compact density and reduced motion are supported. A brief abstract welcome animation distinguishes the first member login from subsequent logins without displaying invented performance data.

## Development and migrations

Run `npm run dev` for the local preview. Run `npx tsc --noEmit` and `npm run build` for validation. Use the Sites build script for the managed hosting artifact. Keep `.dev.vars`, `.wrangler`, and `.sites-runtime` private and out of source control.

The schema is in `db/schema.ts`. Generate append-only migrations with `npm run db:generate`. Apply migrations in numeric order from `drizzle/0000_stormy_silvermane.sql` through `drizzle/0005_lonely_lenny_balinger.sql`. Migration 0002 stores session accents, 0003 adds reviewed Profit/Loss batches, 0004 adds bot families and the family/name uniqueness index, and 0005 adds the isolated Continuation Strategy state. Existing deployments need every unapplied migration before this code is published. Previously created external-identity profiles retain their records; an administrator must set their email and issue a password setup link to enable email login.

The local admin update has not been published. Hosting requires the new migration and owner verifier environment binding. No visual browser automation was run; validation uses type checking, production builds, and isolated HTTP/API tests.


## Railway deployment

Production uses Next.js on Node 24 with Railway PostgreSQL. The existing Sites/Vinext local workflow remains available. `npm run build:railway` builds the standalone server; the Dockerfile serves it with `node server.js`. The separate `continuation-engine` service runs `node scripts/bots/continuation-runner.mjs` and must remain awake with one replica.

- Project: `twaptrade.com`; web service: `twaptrade.com`; database: `Postgres`; bot service: `continuation-engine`.
- Web secret variables: `DATABASE_URL` (Railway private PostgreSQL reference), `TWAP_ADMIN_EMAIL`, `TWAP_ADMIN_PASSWORD_HASH`, `TWAP_BOT_ENCRYPTION_KEY`, `TWAP_BOT_RUNNER_TOKEN`.
- Engine secrets: the same encryption key and runner token, plus `TWAP_BOT_APP_ORIGIN` pointing to the web service HTTPS URL. Never commit secrets or database exports.
- `node scripts/migrate-postgres.mjs` applies append-only migrations atomically with checksum verification. Production pre-deploy runs it automatically. Integer money uses PostgreSQL bigint with checked conversion; writes are serialized in transactions so concurrent ledger/deployment updates cannot overspend.
- `node scripts/import-sqlite-to-postgres.mjs /absolute/source.sqlite` copies existing application records into an empty migrated PostgreSQL database. It verifies row counts, never overwrites nonempty tables, and leaves the source intact. Existing sessions, rate-limit state, and runner leases are not migrated.
- `npm run test:bot` verifies execution attribution, fees, precision, five-second 99¢ exits, and strategy rules. `scripts/tests/postgres-http.mjs` is an integration harness restricted to an isolated `verification` schema; its local configuration is ignored.

The live 99¢ exit intentionally includes other bots’ shares of the exact same outcome token. Full-wallet fills are persisted separately from this strategy’s allocated proceeds and entry-cost P/L. See [the strategy documentation](docs/bots/continuation-btc5m.md).
