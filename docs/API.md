# API reference

## Conventions

- **Base path.** The base path is `/api`. Browsers call it on the web origin, which proxies to the API.
- **Auth.** Authentication uses the `ca_session` httpOnly cookie, or `Authorization: Bearer <token>` for native clients.
- **CSRF.** Unsafe methods sent with cookie auth must include `X-Requested-With: cashads`.
- **Device signals.** The web client sends `X-Device-Key` (persistent random id) and `X-Device-Fp` (hashed fingerprint) for fraud prevention.
- **Money.** Amounts are integer **micros** (`1 USD = 1,000,000`). Request and response shapes are the zod schemas and DTO types in `packages/shared`.

Errors share one envelope:

```json
{ "error": { "code": "payout_requirements", "message": "Verify your phone (one-time)", "details": {…}, "requestId": "…" } }
```

Validation errors use `code: "validation_error"` with `details.issues[] = { path, message }`.

**Rate limits.** Every endpoint has a global limit of 900 requests per minute per IP. Stricter per-route limits apply to auth (12/min), payouts (10/min), claims, tickets and offer starts. Postbacks allow 3000/min.

## Auth

| Method | Path | Notes |
|---|---|---|
| GET | `/auth/providers` | `{ google, demoMode }` |
| POST | `/auth/signup` | `signupSchema` → `MeResponse` + session cookie; reads `ca_ref` cookie |
| POST | `/auth/login` | → `MeResponse`, or `{ twoFactorRequired, challengeId }` |
| POST | `/auth/login/2fa` | `{ challengeId, code }` |
| POST | `/auth/logout` | |
| POST | `/auth/verify-email` | `{ token }` |
| POST | `/auth/resend-verification` | |
| POST | `/auth/forgot-password` · `/auth/reset-password` | Reset revokes all sessions |
| GET | `/auth/google/start` · `/auth/google/callback` | Enabled when `GOOGLE_*` are set |
| GET | `/auth/session` | Lightweight probe |

## Me / account

| Method | Path | Notes |
|---|---|---|
| GET / PATCH | `/me` | `MeResponse` / `profileUpdateSchema` |
| POST | `/me/onboarding` | Interests, daily minutes, data saver, first goal |
| PUT / DELETE | `/me/goal` | Savings goal |
| GET | `/me/health` | Account health with reasons and tips |
| POST | `/me/phone/start` · `/me/phone/verify` | SMS OTP (one verified phone per person) |
| POST | `/me/password` | Revokes other sessions |
| GET / DELETE | `/me/sessions`, `/me/sessions/:id` · POST `/me/sessions/revoke-others` | |
| GET | `/me/devices` · `/me/login-history` | |
| POST | `/me/2fa/setup` · `/me/2fa/enable` · `/me/2fa/disable` | TOTP with QR |
| GET | `/me/export` | GDPR JSON export |
| POST | `/me/delete` | Requires a $0 balance; erases PII, keeps the anonymised ledger |
| GET / POST | `/me/kyc` | Document plus selfie upload ids |
| GET | `/me/tax?year=` | `TaxSummaryDTO` |
| GET | `/me/stream` | **SSE**: `wallet`, `credit`, `notification`, `payout`, `claim`, `video` |

## Wallet

| Method | Path | Notes |
|---|---|---|
| GET | `/wallet` | Available, pending, lifetime, next release |
| GET | `/wallet/transactions?group&status&before&limit` | Cursor pagination |
| GET | `/wallet/transactions.csv?year=` | |

## Offers

| Method | Path | Notes |
|---|---|---|
| GET | `/offers?category&sort&maxMinutes&minHourlyMicros&dataUsage&q` | Sorted by hourly rate by default; anonymous allowed |
| GET | `/offers/:id` | Includes `myStatus`, goals credited, transparent split |
| POST | `/offers/:id/start` | → `{ clickId, redirectUrl }` (price locked) |
| GET | `/offers/clicks` | Started offers, with `claimable` |
| POST | `/offers/clicks/:id/returned` | Member came back from the partner |
| POST | `/offers/:id/review` · `/offers/:id/report` | Repeated reports auto-pause the offer |

## Rewarded video

| Method | Path | Notes |
|---|---|---|
| GET | `/video/status` | Cap, watched, combo, active session |
| POST | `/video/sessions` | `{ takeOver? }`; returns 409 `earning_elsewhere` if another device is active |
| POST | `/video/sessions/:id/events` | `{ type, t }` |
| POST | `/video/sessions/:id/complete` | Server verification → `{ rewarded, amountMicros, status }` |
| POST | `/video/sessions/:id/abandon` | |

## Payouts

| Method | Path | Notes |
|---|---|---|
| GET | `/payouts/methods` | Filtered by country, with FX and real median speed |
| POST | `/payouts/quote` | Fee, net, local amount, requirements, problems |
| POST | `/payouts` | `payoutRequestSchema` (idempotency key required) |
| GET | `/payouts` · `/payouts/:id` | With status timeline |
| POST | `/payouts/:id/cancel` | Only while pending or in review; refund includes the fee |
| GET / DELETE | `/payouts/destinations`, `/payouts/destinations/:id` | Saved destinations, masked |

## Claims, uploads, engagement, referrals, notifications, support

| Method | Path |
|---|---|
| GET / POST | `/claims` · GET `/claims/:id` |
| POST | `/uploads` (multipart image ≤ 5 MB) · GET `/uploads/:id` (owner or staff) |
| GET | `/engagement/summary` · `/engagement/achievements` · `/engagement/leaderboard?period=week\|month` |
| POST | `/engagement/checkin` · `/engagement/plan/claim` |
| GET | `/referrals` |
| GET | `/notifications` · POST `/notifications/read` `{ ids? , all? }` |
| GET | `/support/faq` · GET/POST `/support/tickets` · GET `/support/tickets/:id` · POST `/support/tickets/:id/messages` · POST `/support/tickets/:id/close` |

## Public

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | DB status, driver, uptime, SSE listener count |
| GET | `/public/stats` | Transparency metrics (cached 30 s) |
| GET | `/public/feed?limit=` · `/public/feed/stream` (SSE) | Anonymised completed payouts |
| GET | `/public/offers` · `/public/methods?country=` | |
| POST | `/public/contact` | |
| GET | `/dev/outbox` | Demo mode only |

## Server-to-server

| Method | Path | Notes |
|---|---|---|
| GET / POST | `/postback/:networkId` | Signed partner callbacks. Responses: `1` accepted or duplicate, `0` rejected (logged), `403` bad signature or IP, `500` transient (partner retries) |
| GET | `/ssv/:networkId` | Rewarded-video SSV, replies `{ "isValid": true\|false }` |

Example signature for the default `hmac_sha256_sorted` scheme:

```
params = { click_id, tx_id, payout: "1.2000", status: "1" }
sig    = HMAC_SHA256(secret, "click_id=…&payout=1.2000&status=1&tx_id=…")   // keys sorted, RFC 3986 encoded
GET /api/postback/demo?click_id=…&tx_id=…&payout=1.2000&status=1&sig=<hex>
```

## Sandbox partner (demo network)

| Method | Path | Notes |
|---|---|---|
| GET | `/sandbox/offers/:id?click=` | Partner page content |
| POST | `/sandbox/offers/:id/complete` | `{ clickId, goalId?, answers? }` → schedules a signed postback, or drops it for "broken tracking" offers |
| GET | `/sandbox/conversions/:clickId` | Partner conversion-status API, used by claims |

## Admin (roles `admin` / `support`)

`/admin/overview`, `/admin/analytics`, `/admin/users` (+ `/:id`, `/status`, `/adjust`, `/notes`, `/role`, `/flag`, `/revoke-sessions`), `/admin/payouts` (+ `/approve`, `/reject`, `/retry`, `/bulk-approve`), `/admin/fraud` (+ `/:id/resolve`), `/admin/claims` (+ `/:id/decide`), `/admin/kyc` (+ `/:id/decide`), `/admin/offers` (+ CRUD, `/reports`, `/recompute-stats`), `/admin/networks` (+ PATCH, `/rotate-secret`), `/admin/postbacks` (+ `/:id/replay`, `/:id/simulate-reversal`), `/admin/tickets` (+ `/:id`, `/reply`, `/status`), `/admin/ledger/trial-balance` · `/reconcile` · `/entries`, `/admin/settings` (GET/PUT), `/admin/audit`, `/admin/jobs` (+ `/:id/retry`), `/admin/outbox`.

These actions are **admin only**: adjusting balances, changing roles, creating or editing offers and networks, settings, ledger, audit, jobs, and simulated reversals. Every mutation is written to the audit log.
