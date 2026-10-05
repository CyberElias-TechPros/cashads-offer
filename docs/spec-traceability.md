# Spec traceability

How every requirement in [`product-spec.md`](product-spec.md) maps to the implementation.

Legend: ✅ built · 🧪 built against a simulated provider (sandbox) — swap in a real account to go live · 🛣️ roadmap

## Positioning & strategy

| Spec                                                                                       | Status | Where                                                                                                           |
| ------------------------------------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------- |
| Trust-first positioning: “turn spare time into certain rewards”, not “watch ads”           | ✅     | Landing copy, onboarding (`apps/web/src/routes/public/Landing.tsx`, `app/Onboarding.tsx`)                       |
| One-line pitch (“real money, instantly, no minimum, no points … pays when tracking fails”) | ✅     | `BRAND.pitch` in `packages/shared/src/index.ts`, landing hero                                                   |
| Publish the revenue-share percentage and keep it                                           | ✅     | Setting `revenueShareBps` (60%), measured `actualShareBps30d` on `/transparency`                                |
| High-CPA verticals (financial, apps, surveys) over penny ads                               | ✅     | Offer catalogue with financial/app/signup/survey categories; videos shown with honest “tasks pay 50–100× more”  |
| Region-first (Nigeria first)                                                               | ✅     | Country-targeted offers, local payout rails, NGN display, Africa/Lagos defaults                                 |
| Offerwall networks as the “access hack”                                                    | ✅🧪   | Network adapters (BitLabs, md5-wall family, Pangle SSV) + simulated SandboxNet; see [going-live](going-live.md) |
| Graduate to neobank (card, float, early pay)                                               | 🛣️     | Ledger + payout rails are the foundation; see roadmap below                                                     |

## Screens (spec Part 4)

| Screen                                                                                                                                                                                | Status | Route                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| Landing (proof, testimonials→live feed, FAQ, CTA)                                                                                                                                     | ✅     | `/`                                                                                        |
| How it works                                                                                                                                                                          | ✅     | `/how-it-works`                                                                            |
| Pricing/Offers preview (earning potential)                                                                                                                                            | ✅     | `/#preview` (country selector, best $/hr offers, rails)                                    |
| FAQ (searchable, categorised)                                                                                                                                                         | ✅     | `/faq`                                                                                     |
| Blog / resources                                                                                                                                                                      | ✅     | `/blog`, `/blog/:slug`                                                                     |
| Login / Signup / Forgot / Reset / Verify email                                                                                                                                        | ✅     | `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`                |
| Terms / Privacy / Cookies (versioned) + Earnings policy                                                                                                                               | ✅     | `/legal/:doc`                                                                              |
| Contact / support (logged out)                                                                                                                                                        | ✅     | `/contact`                                                                                 |
| Status page                                                                                                                                                                           | ✅     | `/status`                                                                                  |
| Dashboard (balance, quick offers, progress, streaks, payout feed)                                                                                                                     | ✅     | `/app`                                                                                     |
| Offerwall (categories, filters, search, est. payout)                                                                                                                                  | ✅     | `/app/earn`                                                                                |
| Offer detail (description, payout, time, requirements, CTA)                                                                                                                           | ✅     | `/app/earn/:id`                                                                            |
| Ad player (fullscreen, countdown, progress)                                                                                                                                           | ✅     | `/app/watch`                                                                               |
| Survey flow                                                                                                                                                                           | ✅🧪   | Simulated advertiser at `/sandbox/offer/:clickId`; native quick polls at `/app/earn/quick` |
| Wallet (balance, history, filters, export)                                                                                                                                            | ✅     | `/app/wallet`                                                                              |
| Cashout (methods, amounts, fees, confirmation)                                                                                                                                        | ✅     | `/app/cashout`                                                                             |
| Cashout status (timeline, ETA)                                                                                                                                                        | ✅     | `/app/payouts/:id`                                                                         |
| Referrals (link, QR, earnings)                                                                                                                                                        | ✅     | `/app/referrals`                                                                           |
| Profile (settings, security, 2FA)                                                                                                                                                     | ✅     | `/app/profile`                                                                             |
| KYC verification                                                                                                                                                                      | ✅🧪   | `/app/kyc` (sandbox identity vendor auto-reviews)                                          |
| Notifications                                                                                                                                                                         | ✅     | `/app/notifications`                                                                       |
| Achievements · Leaderboard                                                                                                                                                            | ✅     | `/app/achievements`, `/app/leaderboard`                                                    |
| Support (FAQ, tickets)                                                                                                                                                                | ✅     | `/app/support`, `/app/support/:id`                                                         |
| Account security (sessions, devices, login history)                                                                                                                                   | ✅     | `/app/profile?tab=security`                                                                |
| Admin dashboard · users · payout queue · fraud review · offers · postback logs · analytics · settings · support tickets                                                               | ✅     | `/admin/*`                                                                                 |
| Extra: Activity & claims, Missing Credit claim, Onboarding, Quick tasks, Earn+learn, Charity, Tax centre, Community, Restricted/appeal, Transparency, Dev inbox, KYC queue, Audit log | ✅     | see router in `apps/web/src/router.tsx`                                                    |

## Flows (spec Part 5)

| Flow                                                                      | Status | Verified by                                                                                     |
| ------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| New user → first payout                                                   | ✅     | Browser E2E: sign-up → onboarding → quick task → verify email → offer → credit → $0.05 cash-out |
| Returning daily session (streak, offers, leaderboard, referral, cash-out) | ✅     | `earning.test.ts` (streak, plan), UI                                                            |
| High-value financial offer (slow-confirming, 30-day click window)         | ✅     | `paySpeed: 'days'` offers, click TTL in `offers/service.ts`                                     |
| EC1 postback never arrives → checks at 24/48/72h → review                 | ✅     | `click.check` job; auto-filed claim at 72h (`claims-payouts.test.ts`)                           |
| EC2 duplicate postback                                                    | ✅     | Unique `(network, txn)`; test “credits exactly once”                                            |
| EC3 device switch mid-offer                                               | ✅     | Credit keyed on click id → user, not device                                                     |
| EC4 ad fails to load (no penalty)                                         | ✅     | `error` event → abandoned, not counted (`native-earning.test.ts`)                               |
| EC5 tab closed / switched mid-ad                                          | ✅     | Pause on hidden; hidden time never counts; session expires without penalty                      |
| EC6 cash-out during fraud flag                                            | ✅     | Payout routed to `review` with specific reasons; finance approve/decline                        |
| EC7 payment provider down                                                 | ✅     | Retries 1m→6h, member notified, full refund if exhausted (test)                                 |
| EC8 threshold reached but not verified (KYC)                              | ✅     | Phone > $1, ID > $100 single cash-out, inline verification                                      |
| EC9 referral fraud                                                        | ✅     | Same-device self-referral rejected + flagged (test)                                             |
| EC10 offer pulled mid-completion                                          | ✅     | Postbacks for paused offers still credited; claims honour completions                           |
| Multi-device: allow login, one device earns at a time                     | ✅     | Earning lock with explicit takeover (test)                                                      |
| Account ban with clear reason + appeal                                    | ✅     | Ban reason codes + message, appeal tickets, lift/uphold (test)                                  |
| Reward confirmation > 5 s → “Reward is being confirmed”                   | ✅     | `Watch.tsx`                                                                                     |

## Architecture, APIs and data (spec Parts 6–9, 13)

| Spec                                                                                        | Status         | Where                                                                                                           |
| ------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------- |
| Frontend component tree (BalanceCard, OfferCard, AdPlayer, CashoutPanel, ProgressTracker…)  | ✅             | `apps/web/src/components`, `routes/app/*`                                                                       |
| State: global (Zustand), server (TanStack Query), real-time (SSE)                           | ✅             | `store/ui.ts`, `lib/queries.ts`                                                                                 |
| Services: Auth, User, Offer, Reward, Postback, Payout, Fraud, Notification, Referral, Admin | ✅             | `apps/api/src/modules/*`                                                                                        |
| Postback → verify → dedupe → fraud → credit → notify → live update                          | ✅             | `postbacks/service.ts`, `rewards/service.ts`                                                                    |
| SSV (`sha256(appSecurityKey:transId)`, `{"isValid": true}`)                                 | ✅🧪           | `networks/adapters.ts` (`pangle_ssv`), `/api/ssv/:network`                                                      |
| Event-sequence verification for web rewarded ads (load→start→complete→close)                | ✅             | `ads/service.ts#validateEventChain`                                                                             |
| API contracts (auth, user, offers, postbacks, payouts, referrals, admin)                    | ✅             | 134 documented endpoints at `/api/docs` (OpenAPI from Zod)                                                      |
| Data models (users, offers, transactions, postbacks, payouts, fraud flags, devices)         | ✅             | `apps/api/src/db/schema.ts` (45 tables incl. double-entry ledger)                                               |
| PostgreSQL primary                                                                          | ✅             | node-postgres in production; PGlite (real Postgres in WASM) for dev/tests                                       |
| Redis for sessions/queues                                                                   | ✅ (by design) | Replaced by Postgres sessions + `FOR UPDATE SKIP LOCKED` queue — see [ADR 0004](adr/0004-postgres-job-queue.md) |

## Fraud (spec Part 10)

| Rule                                                                       | Status                                                                                                     |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Device fingerprint, emulator/VPN/datacenter, IP velocity, disposable email | ✅ (random device id + coarse hash; curated datacenter list + admin CIDR rules; IP intelligence vendor 🛣️) |
| Behaviour: completion speed, earning velocity, poll speed, ad tampering    | ✅                                                                                                         |
| Postback: duplicate, timing (72h window), signature                        | ✅                                                                                                         |
| Scoring 0–30 auto · 31–60 review · 61–100 block                            | ✅ (61+ pauses earning pending human review — never an automatic ban)                                      |
| One account per device / per IP (with shared-network exceptions)           | ✅ (signals + `shared_ok` CIDR rules)                                                                      |
| Email before first payout · phone before payout (> $1) · KYC > $100        | ✅                                                                                                         |
| Velocity: 3 payouts/day, weekly cap ($500, tier-dependent)                 | ✅                                                                                                         |
| Referral bonus only after referee’s first task                             | ✅                                                                                                         |
| Same offer can’t be completed twice                                        | ✅ (`maxPerUser`)                                                                                          |

## Payouts (spec Part 11)

| Method                                                                                                                                                               | Status                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Nigerian bank transfer (Paystack) with account-name enquiry                                                                                                          | ✅ live adapter (`createPaystackProvider`) + 🧪 sandbox |
| Airtime & data (NG), MoMo (GH), M-Pesa (KE), PayShap (ZA), UPI (IN), GCash (PH), Pix (BR), UK FPS, US ACH, PayPal, Amazon gift card, Lightning, USDT (Polygon), Wise | 🧪 (provider interface ready; see going-live)           |
| Statuses pending → review → processing → completed / failed / reversed (+ cancelled)                                                                                 | ✅                                                      |

## Pain points (spec “hidden pain points”, priority table)

| #   | Pain point                                                 | Status | Implementation                                                                                                 |
| --- | ---------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| 1   | “Is it worth my time?” → real hourly rate                  | ✅     | Hourly rate on every card, measured medians, min-$/hr filter, sort                                             |
| 2   | “Did it, didn’t track” → Missing Credit button             | ✅     | Claim ladder, SLA, auto-approval, auto-filed claims                                                            |
| 3   | “Points feel fake” → real currency everywhere              | ✅     | USD + local currency; no points anywhere                                                                       |
| 4   | “Never reach the minimum” → no minimum                     | ✅     | Only provider floors; $0.05 test cash-outs                                                                     |
| 5   | “Will the payout come?” → live payout feed + public ledger | ✅     | Real-row feed (SSE), transparency stats                                                                        |
| 6   | Slow phone / bad internet → lightweight mode               | ✅     | Data-saver, per-offer MB estimate, text-only quick tasks, code splitting, PWA                                  |
| 7   | Can’t access money → local rails                           | ✅🧪   | Country-specific methods with fees & speeds                                                                    |
| 8   | “What do I do next?” → personalised daily plan             | ✅     | Plan with bonus                                                                                                |
| 9   | “I feel like a number” → community                         | ✅     | Community ideas board (votes, shipped notifications), opt-in payout wall & leaderboard, Telegram/Discord links |
| 10  | Scam offers → quality score + reports + Wall of Shame      | ✅     | A–F grade, reports auto-pause, public Wall of Shame                                                            |
| 11  | “I’m busy” → micro-task mode                               | ✅     | `/app/earn/quick`                                                                                              |
| 12  | Taxes → tax centre                                         | ✅     | Year summaries, CSV, US 1099 thresholds ($600 for 2025, $2,000 from 2026 per OBBBA)                            |
| 13  | Done all offers → recurring streams                        | ✅     | Streaks, referral residuals (10% forever), daily plan, polls, lessons                                          |
| 14  | “Is this legit?” → radical transparency page               | ✅     | `/transparency`                                                                                                |
| 15  | Earn for a cause                                           | ✅     | Auto-donate %, one-off donations, impact units                                                                 |
| 16  | Privacy-first earning                                      | ✅     | Email-only sign-up, verification only at thresholds, privacy mode, export/delete                               |
| 17  | Earn + learn                                               | ✅     | Sponsored lessons with server-side graded quizzes                                                              |
| 18  | Not in the US → region-first                               | ✅     | Geo-targeted offers, local rails, local currency                                                               |
| 19  | Don’t trust the network → “you eat the loss”               | ✅     | Goodwill credits, absorbed reversals (default policy)                                                          |
| 20  | Make it fun (without cringe)                               | ✅     | Streaks, achievements, combos, tiers — all optional, no gambling mechanics                                     |

## Retention mechanics (spec §3)

| Mechanic                                                      | Status                                                                |
| ------------------------------------------------------------- | --------------------------------------------------------------------- |
| Instant feedback with escalating rewards (consecutive videos) | ✅ celebration + video combo multiplier                               |
| Progress visualisation / goal gradient                        | ✅ savings goal, plan progress, tier progress, streak milestones      |
| Time-of-day reminders, restrained                             | ✅ one evening streak reminder in the member’s timezone, opt-in email |
| Light leaderboards (“top 15% this week”)                      | ✅ opt-in names, percentile, no prizes                                |
| Behavioural retargeting (“the reward you missed is waiting”)  | ✅ in-app “awaiting confirmation” prompts, auto-claims                |

## Things the spec flagged “you didn’t ask about but need” (Part 14)

| Area                                                                                                                                                         | Status                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| Legal docs (versioned), age 18+, NDPA/GDPR/CCPA framing                                                                                                      | ✅                                            |
| Security: HTTPS-ready cookies, argon2id, 2FA, rate limits, CSRF, XSS (React + CSP), SQLi (parameterised ORM), PII encryption, audit logs, session management | ✅                                            |
| Analytics: DAU/active earners, ARPU, payout ratio, fraud rate, retention D1/D7/D30, postback success                                                         | ✅ admin analytics + metrics endpoint         |
| Support: FAQ, tickets with SLA, appeals, status page                                                                                                         | ✅ (live chat 🛣️)                             |
| Infrastructure: Docker, CI (GitHub Actions), health/readiness, Prometheus metrics                                                                            | ✅                                            |
| Testing: unit, integration, E2E, fraud scenarios                                                                                                             | ✅ (load & penetration testing 🛣️)            |
| Mobile: PWA first                                                                                                                                            | ✅ (React Native 🛣️)                          |
| Multi-language                                                                                                                                               | 🛣️ (copy is centralised; i18n framework next) |

## Roadmap (not in this PR)

- Real network accounts (AdGate, BitLabs, CPX, Lootably…) and their offer-feed sync; iframe partner walls in the UI.
- Remaining live payout providers (Flutterwave, M-Pesa B2C, PayPal Payouts, Tremendous, Lightning, custody for USDT).
- Email/SMS providers (Postmark/SES, Termii/Africa’s Talking) and web push.
- KYC vendor (Smile ID / Youverify / Dojah for Nigeria) and IP-intelligence vendor.
- i18n (Hausa, Yoruba, Igbo, Pidgin, French, Portuguese), React Native apps.
- Neobank layer: rewards debit card, balances/float, early direct deposit.
