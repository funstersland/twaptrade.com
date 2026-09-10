# TwapTrade

A responsive trading product built with React, Vinext, and Cloudflare Workers. Shared appearance tokens cover the landing page, authentication screens, and the seven-section workspace.

## Product surfaces

- `/`: landing page
- `/login`, `/signup`, `/forgot-password`, `/reset-password`: account entry screens
- `/app/dashboard`, `/app/wallet`, `/app/transactions`, `/app/bots`, `/app/analytics`, `/app/referrals`, `/app/settings`: workspace
- Add `?demo=1` to workspace routes for illustrative data. Demo mode is explicit and cannot move money or place trades.

## Accounts and referrals

ChatGPT sign-in is the connected identity method. Server-side identity gates every real workspace route and account mutation. Profiles, immutable referral attribution, and account appearance preferences are stored in D1. A unique code is generated per profile; new sign-ups are attributed once and self-referrals are excluded. Referral reports expose join dates, not invitees’ private profile information.

Email/password forms are designed but deliberately fail closed until a production identity service is selected. The endpoint does not store credentials, send reset emails, or claim successful authentication. Security settings explain that the current password is managed by the sign-in provider. An email identity provider must be connected before email login, password change, and recovery can launch.

Wallet funding, withdrawals, rewards, and bot execution require the owner’s provider choices and trading rules. Real accounts start empty. All sample metrics are explicitly illustrative.

## Appearance

Dark, light, and system modes; mint, sky, amber, rose, or a fresh automatic accent per explicit sign-in. Appearance applies to the logo, charts, controls, and workspace. Device-local preferences persist immediately and signed-in users can save them to D1. Compact density and reduced motion are supported; OS reduced motion always takes precedence. The short login animation distinguishes first account creation from returning logins using the server-created profile.

## Development

Run `npm run dev`. Run `npx tsc --noEmit` for type checking and `npm run build` for the Worker build. D1 schema is in `db/schema.ts`; migrations are in `drizzle/`. Apply migrations to the local database before testing account flows. Hosted migration application is handled by Sites.

The development starter provides a loopback-only mock sign-in at `/signin-with-chatgpt?return_to=/app/dashboard`. It is not compiled into hosted authentication.

## Validation boundaries

HTTP route and API checks cover rendering, authentication gating, account persistence, and referral behavior. Visual browser testing was not requested. WebMCP appearance registration is feature-detected; a permitted supported browser context was unavailable for direct WebMCP validation.
