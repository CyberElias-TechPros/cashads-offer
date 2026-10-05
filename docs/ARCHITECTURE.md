# Architecture

CashAds is a TypeScript monorepo with three workspaces:

| Workspace | Role |
|---|---|
| `packages/shared` | Money math, domain constants (tiers, achievements, statuses), zod request schemas, DTO types, FAQ. Imported by both the API and the web app, so validation rules and types never drift. |
| `apps/api` | Fastify 5 HTTP API, server-to-server receivers (postbacks, SSV), Server-Sent Events, and the background worker. |
| `apps/web` | Next.js 16 App Router: SSR marketing site, member app, admin console, sandbox partner site. |

```
                 ┌────────────────────────────── Browser ──────────────────────────────┐
                 │  Marketing (SSR)   Member app (React 19)   Admin console   Partner   │
                 └───────────────┬─────────────────────────────────────────────────────┘
                                 │  same-origin requests only: /api/*  (cookies, CSRF header)
                       ┌─────────▼─────────┐
                       │  Next.js (:3000)  │  rewrites /api/* → API_INTERNAL_URL (streams SSE)
                       └─────────┬─────────┘
 Partner networks ──────────────►│  POST/GET /api/postback/:network   GET /api/ssv/:network
                       ┌─────────▼──────────────────────────────────────────────┐
                       │ Fastify API (:4000)                                    │
                       │  plugins: cookie · helmet · rate-limit · multipart      │
                       │  onRequest: session → req.auth, CSRF check, activity    │
                       │  modules/*  (services; no HTTP inside)                  │
                       │  EventBus ──► SSE (/api/me/stream, /api/public/feed/…) │
                       │  Worker (FOR UPDATE SKIP LOCKED) + scheduler            │
                       └─────────┬──────────────────────────────────────────────┘
                                 │ Drizzle ORM
                       ┌─────────▼─────────┐
                       │ PostgreSQL        │  PGlite (WASM, in-process) in dev/test
                       └───────────────────┘  node-postgres pool in production
```

The browser never talks to the API port directly. Every call uses a relative `/api/...` URL on the web origin, which keeps cookies first-party and works behind any proxy or preview domain.

---

## 1. Money model

### Integer micros
All amounts are **integer micro-dollars** (`1 USD = 1,000,000`). Rewarded video and revenue-share splits produce sub-cent values (60% of $0.037), and floats would drift. JS integers are exact up to $9 billion. `packages/shared/src/money.ts` holds the helpers:

- `applyBps` rounds **down** (we never over-promise).
- `computeFee` rounds **up** (fees are always disclosed first).
- `formatMoney` keeps sub-cent digits for amounts under $1 ($0.018 isn't rounded away).
- Tier bonuses are floored to whole cents so offer prices stay clean.

### Double-entry ledger (`modules/wallet/ledger.ts`)
Every money movement is an **entry** made of postings that **sum to zero**. Money flows *from* an account (negative posting) *to* an account (positive posting):

| Account | Meaning | Sign in steady state |
|---|---|---|
| `user:<id>:available` / `:pending` | What we owe a member | + |
| `network:<id>` | What a partner owes us for recorded conversions | − |
| `platform:revenue` | Our margin after member shares | + |
| `platform:marketing` | Bonuses we funded (welcome, streak, referral, tier, achievements) | − |
| `platform:goodwill` | Missing-credit payouts we fronted | − |
| `platform:loss` | Reversals we couldn't recover (member already cashed out) | − |
| `platform:payouts_in_transit` | Reserved for in-flight cash outs | + |
| `platform:paid_out` | Money that left to members | + |
| `platform:fees` | Payout fees collected | + |
| `platform:adjustments` | Staff corrections | ± |

Examples:

```
Offer credit (partner pays $5.00, member gets 60% + Gold 4%):
  network:demo            −5.00
  user:X:available        +3.12      (3.00 base + 0.12 bonus)
  platform:revenue        +2.00
  platform:marketing      −0.12

Cash out $10 with $0.20 fee:   reserve → complete
  user:X:available −10.00 / payouts_in_transit +10.00
  payouts_in_transit −10.00 / paid_out +9.80 / fees +0.20

Reversal after the member withdrew $2 of a $3 credit:
  user:X:available −1.00, platform:loss −2.00, revenue/marketing/network reversed
```

- Entries are **idempotent** (unique key) and **append-only**. Conversions use `conv:<click>:<goal>`, which is why a missing-credit payout and a late partner postback can never both pay.
- The `wallets` table is a **cache** updated inside the same transaction. *Admin → Ledger → Run reconciliation* re-derives every balance from postings, and the trial balance must sum to exactly zero. Every integration test ends by asserting both.
- `transactions` is the member-facing history (types, statuses, descriptions). The ledger is the accounting truth underneath.

### Holds (`rewards/service.ts → holdHoursFor`)
- An offer-specific hold applies if the partner requires one (bank accounts: 72h).
- Otherwise: ≥ $10 → 72h, ≥ $2 → 24h, under $2 → instant.
- The result is multiplied by the tier factor (Silver ×0.5, Gold ×0.25, Platinum 0). Medium-risk accounts wait at least 72h.
- Pending credits sit in `user:X:pending` with a `hold.release` job. If the account is high-risk or restricted at release time, the release is postponed, not cancelled.

---

## 2. Offer → postback → credit

```
Member ─► POST /offers/:id/start ──► offer_clicks (click id = subid, price snapshot)
       ─► partner site (real network, or /partner/demo/… sandbox)
Partner ─► GET/POST /api/postback/:network?click_id&tx_id&payout&status&sig
             1. network enabled? IP allowlist?
             2. signature (constant time) — hmac_sha256_sorted · md5_txid_secret ·
                hmac_sha1_url · sha256_secret_txid (SSV) · ip_only
                ✗ → 403 + logged (dedupe key NOT set → forgeries can't squat a tx id)
             3. canonicalise params (payout unit, status → credit/reversal)
             4. insert with dedupe_key = network:kind:tx  → conflict = duplicate (200 "1")
             5. resolve click → user, goal; banned/deleted → rejected
             6. already credited?  goodwill-paid claim → post recovery entry
             7. conversion window, fast-completion signal
             8. price-locked amounts (click snapshot), hold policy, risk hold
             9. creditUser → ledger + transaction + wallet + hold job
            10. click status, offer completions, auto-resolve open claim
            11. onEarned: welcome bonus → referral → achievements → tier
            12. notification + SSE (after commit)
          ◄─ 200 "1"  (business rejections 200 "0"; processing errors 500 → partner retries)
```

- **Iframe-offerwall networks** (no click on our side) are supported: user id plus payout in the postback.
- **Reversals** debit pending first, then available; any shortfall goes to `platform:loss`. We don't chase members.
- **Replays** (staff, or the claims auto-check) re-run a logged, signature-valid postback through the same pipeline. Idempotency makes double credit impossible.

---

## 3. Missing-credit claims (`modules/claims`)

```
claim filed ──► job claims.auto_check (seconds)
                 ├─ failed postback for this click?        → replay → auto_approved
                 ├─ partner conversion API confirms?       → credit from network → auto_approved
                 ├─ Gold/Platinum, small amount, low risk? → goodwill credit → auto_approved
                 └─ otherwise                              → in_review (SLA from settings)
staff decision  ─► approve (goodwill credit, reason) / reject (reason, appeal via support)
late postback   ─► duplicate + goodwill recovery entry (books heal themselves)
watchdog job    ─► member returned from partner >2h ago, nothing credited → proactive nudge
SLA breach      ─► escalation entry in the claim timeline
```

---

## 4. Payouts (`modules/payouts`)

```
           request (idempotency key, quote re-validated, requirements, velocity)
              │ reserve (available → in_transit)
   ┌──────────┴───────────┐
review (risk ≠ low,       pending ──► payout.process job
 > auto-approve limit,       │          processing ──provider──► completed (in_transit → paid_out + fees)
 shared destination)         │                        ├─ processing (async) → payout.check polling
   │ approve → pending       │                        ├─ transient error → pending + retry w/ backoff
   │ reject  → rejected ─────┴─ cancel (member) ──────┴─ permanent error → failed
   └──────────────────────────────── refund (in_transit → available, fee included)
```

- Requirements: verified email, verified phone (configurable), KYC above the single or lifetime thresholds, active account.
- Velocity: max N per day and a weekly total.
- Destinations are encrypted (AES-256-GCM) and displayed masked. An HMAC fingerprint detects the same PayPal or bank account used across accounts, which is the strongest multi-accounting signal.
- Providers implement `PayoutProvider.send/check`. PayPal Payouts and Paystack Transfers adapters are included and enabled by env keys. The sandbox provider simulates latency, transient outages, permanent rejections (`fail` in the destination) and async settlement (`slow`).
- Completed payouts publish to the anonymised **public payout feed**. Transparency stats (median and p90 payout time, totals) are computed from the same table.

---

## 5. Rewarded video (`modules/video`)

- `POST /video/sessions` checks the daily cap (by tier), cooldown and **one active session per member**. Another device gets `409 earning_elsewhere`; `takeOver: true` abandons the other session and notifies it over SSE.
- The client posts events as they happen: `loaded → started → q1 → mid → q3 → completed`, plus `hidden/visible/paused/resumed/error`.
- `complete` verifies:
  - the required sequence, in order;
  - server wall-clock time since `started` ≥ the creative duration;
  - client time deltas ≥ the duration;
  - each quartile arrived no earlier than its fraction of the duration (defeats scripts that fire everything and then wait).
  
  Clear tampering adds a `video_tampering` risk signal. Honest failures carry no penalty.
- `error` marks the session failed and it doesn't count against the cap. Consecutive views within 2 minutes earn +5% each, up to +25%, funded by marketing.
- `GET /api/ssv/:network` implements Pangle-style server-side verification (`sha256("{secret}:{trans_id}")`, reply `{ isValid }`) through the same postback pipeline.

---

## 6. Fraud & risk (`modules/fraud`)

Signals are **named and weighted**, and the score is the clamped sum of active signals. Event-type signals count at most 3 times.

| Signal | Weight | Source |
|---|---|---|
| shared_payout_destination | +35 | payout request / KYC document reuse |
| shared_device | +30 | device key or fingerprint seen on other accounts |
| referral_self | +40 | referee shares a device/IP with the referrer |
| disposable_email | +25 | sign-up |
| high_reversal_rate | +20 | ≥3 reversals and ≥30% of credits in 60d |
| bot_user_agent | +20 | sign-up |
| ip_signup_velocity | +15 | ≥3 sign-ups from the same IP in 24h |
| video_tampering | +15 | video verification |
| country_mismatch | +10 | IP country ≠ profile country |
| fast_completion | +8 | conversion in < 20% of the expected time |
| manual_flag | +35 | staff |
| phone_verified / kyc_verified | −10 / −20 | verification |

Score bands:

- **0–30** low: everything is automatic.
- **31–60** medium: a fraud case opens, cash outs go to review, holds last at least 72h.
- **61+** high: earnings are held and cash outs blocked until review.

Nothing auto-bans. Staff clear, restrict or ban with a reason the member sees, and appeals go to a different reviewer within 48h. Clearing a case marks the signals reviewed and re-queues held payouts automatically.

---

## 7. Background work

- **Jobs table + worker** (`jobs/queue.ts`): enqueued *inside* the business transaction (transactional outbox) and claimed with `FOR UPDATE SKIP LOCKED`. Failures retry with exponential backoff and jitter, then dead-letter after `maxAttempts`; dead jobs can be retried from Admin → Jobs. Stale locks are recovered after 5 minutes. It's multi-instance safe without Redis.
- **Scheduler**: recurring tasks deduplicated by time bucket:

| Interval | Tasks |
|---|---|
| Every minute | Expire video sessions, escalate claim SLAs |
| Every 10 min | Recompute offer stats (real median time, tracking reliability, quality score) |
| Every 15 min | Settle referral commissions in batches; missing-postback watchdog |
| Daily | Prune finished jobs and tokens, auto-close stale tickets |

- **Messages**: emails and SMS are written to `outbound_messages` in the transaction and delivered by the worker (Resend when configured). In demo mode they're readable at `/dev/mailbox`.

## 8. Real-time

`EventBus` is an in-process pub/sub that fans out to SSE connections:

- `/api/me/stream` carries wallet, credit (celebration), notification, payout, claim and video events.
- `/api/public/feed/stream` carries live payouts.

Events are published **after commit** (`withUow(...).afterCommit`), so clients never see rolled-back state. The streams use heartbeats and 2 KB padding to defeat proxy buffering, and the client falls back to polling if the stream can't be held. For multiple API instances, swap the bus for Redis pub/sub or Postgres `LISTEN/NOTIFY` behind the same two methods.

## 9. Units of work & the deadlock guard

`withUow(ctx, fn)` opens one transaction and collects after-commit hooks. PGlite has a single connection, so using the root `db` inside a transaction would deadlock (and on Postgres it would silently escape the transaction). `guardDb` wraps the root handle and **throws immediately** if it's used inside a unit of work. That turns a class of subtle bugs into instant, testable errors.

## 10. Security

| Concern | Implementation |
|---|---|
| Passwords | scrypt (N=2¹⁴, r=8, p=1), timing-equalised for unknown users; 5 failures → 15-min lockout |
| Sessions | Opaque 256-bit tokens; only the SHA-256 is stored; sliding 30 days; device-labelled; revocable individually or all at once |
| Cookies | `httpOnly`; over HTTPS `Secure; SameSite=None; Partitioned` (CHIPS, so embedded previews work); `Lax` over HTTP |
| CSRF | Unsafe methods require `X-Requested-With: cashads`, and `Sec-Fetch-Site` must not be cross-site or same-site. Bearer tokens (future native apps) are exempt. |
| 2FA | RFC 6238 TOTP with ±1 step and replay protection; QR enrolment |
| Secrets at rest | AES-256-GCM via HKDF from `APP_SECRET` (TOTP secrets, payout destinations, partner secrets) |
| Input | zod everywhere (shared schemas); Drizzle parameterised SQL; uploads validated by magic bytes, 5 MB cap, private storage |
| Abuse | Global and per-route rate limits; offer-start, claim and payout velocity limits |
| Headers | CSP, HSTS, nosniff, referrer and permissions policies; `frame-ancestors` configurable |
| Audit | Every staff action and automatic enforcement in `audit_logs` with before/after values for settings |

## 11. Data model

The schema lives in `apps/api/src/db/schema.ts`, with migrations in `apps/api/drizzle`.

| Area | Tables |
|---|---|
| Identity | `users`, `sessions`, `verification_tokens`, `devices`, `login_events`, `user_activity_days` |
| Money | `wallets`, `transactions`, `ledger_entries`, `ledger_postings`, `payout_methods`, `payout_destinations`, `payouts`, `payout_events`, `fx_rates` |
| Offers | `networks`, `offers`, `offer_clicks`, `postbacks`, `offer_reviews`, `offer_reports`, `sandbox_conversions` |
| Video | `video_ads`, `video_sessions` |
| Trust | `claims`, `kyc_submissions`, `uploads`, `risk_signals`, `fraud_cases` |
| Growth | `referrals`, `checkins`, `plan_claims`, `user_achievements` |
| Comms | `notifications`, `outbound_messages`, `support_tickets`, `ticket_messages`, `contact_messages` |
| Ops | `audit_logs`, `user_notes`, `settings`, `jobs` |

## 12. Scaling notes

- The API is stateless apart from the SSE bus. Put it behind a load balancer with sticky SSE, or swap in the Redis/PG-notify bus.
- Workers can run as separate processes (`WORKER_ENABLED=true` only there).
- Read-heavy public stats are cached for 30 s. Leaderboards and analytics are single SQL aggregates; add materialised views if they grow hot.
- Hot paths are indexed: postback dedupe and status, transactions by user and time, pending by `available_at`, jobs by status and `run_at`, payouts by status.
