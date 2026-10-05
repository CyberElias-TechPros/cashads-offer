# Spec coverage

How each requirement in [`PRODUCT_BRIEF.md`](PRODUCT_BRIEF.md) maps to the implementation.

**Legend**

- ✅ Implemented and working end to end.
- 🧪 Implemented against a sandbox. Real-provider adapters or interfaces are in place; credentials are needed.
- 🔜 Intentionally deferred (Phase 2/3 or business work), noted in [README → Going live](../README.md#going-live-checklist).

## Positioning & trust (Parts 1–2, 12)

| Requirement | Status | Where |
|---|---|---|
| "A rewards wallet that pays real cash"; avoid saying "watch ads" | ✅ | Copy throughout `apps/web/app/(marketing)`; "real cash for your spare minutes" |
| Instant payouts (Freecash-style minutes) | ✅ | Auto-approved payouts processed immediately; median & p90 published on `/transparency` |
| Low / **no minimum** | ✅ | Platform minimum $0.01; only provider limits (shown); test `has no platform minimum` |
| Transparent, published rules | ✅ | `/how-it-works`, per-offer split, hold explanations, FAQ |
| Real-time payout feed, **real data only** | ✅ | `public/service.ts publicFeed` + SSE `/api/public/feed/stream`; from completed payouts only |
| Clear ban reasons + appeals | ✅ | `statusReason` shown in-app & by email; one-tap appeal ticket (48h SLA) |
| Public revenue share (40–60%) | ✅ | 60% default, admin-editable, shown on every offer and `/transparency` |
| No fake testimonials | ✅ | No testimonials anywhere; live feed instead |
| Points never expire / real currency | ✅ | No points at all; balances in money, never expire |
| Transparent fee display | ✅ | Live quote with fee, net & local currency before confirming |
| Support SLA (24h) + appeals | ✅ | Ticket SLAs (tier-aware), macros, SLA badges in admin |

## Earning mechanics (Parts 3–5)

| Requirement | Status | Where |
|---|---|---|
| Offerwalls via third-party networks | ✅/🧪 | Network registry with param maps & 5 signature schemes; CPX/BitLabs/IP-only presets; sandbox network fully live |
| Postback: verify → dedupe → credit | ✅ | `modules/postbacks`; tests: signature, duplicates, forged tx ids |
| Rewarded video with server-side verification (Pangle-style `sha256(key:transId)`) | ✅ | `/api/ssv/:network` (`sha256_secret_txid`) + event-chain verification for direct sponsors |
| Without SSV: client event chain load→start→complete→close | ✅ | `video/service.ts verifyEvents` incl. quartile spacing & wall-clock timing |
| Instant reward animation + "watch another" | ✅ | `components/app/celebration.tsx`; auto-play next with countdown on `/app/watch` |
| Escalating rewards for consecutive views | ✅ | Combo +5%/view up to +25% |
| Goal gradient ("50 pts from a $10 gift card") | ✅ | Savings goal card with "close the gap" offer suggestion |
| Daily streaks & bonuses | ✅ | Streak ladder $0.01→$0.10/day (local-time days) |
| Light leaderboards ("top 15%") | ✅ | Rolling 7/30-day boards, percentile on dashboard, opt-out anonymity |
| Badges & tiers (Bronze→Silver→Gold) | ✅ | 12 achievements with cash bonuses; 4 tiers with real perks (bonus %, shorter holds, caps, instant claims) |
| Re-engagement, restrained notifications | ✅ | In-app + opt-in email categories; missing-postback nudge; no spam defaults |
| High-CPA / finance offers with safety holds | ✅ | Finance category, per-offer holds, tier multipliers, transparent unlock times |

## Fraud (Part 10)

| Requirement | Status | Where |
|---|---|---|
| Email verification + device fingerprint at sign-up | ✅ | Verification emails; device key + fingerprint headers recorded per device |
| Phone check / light KYC before first withdrawal | ✅ | Phone OTP required (configurable); KYC above $100 single / $500 lifetime |
| Anomaly detection → manual review | ✅ | Weighted signals → score bands → fraud cases; payouts routed to review |
| Referral farming via fingerprint/IP | ✅ | `referral_self` detection; referral rejected; test included |
| One account per device / payout destination | ✅ | `shared_device`, `shared_payout_destination` (HMAC fingerprints) |
| Disposable email, IP velocity, behaviour (speed) | ✅ | `disposable_email`, `ip_signup_velocity`, `fast_completion`, `video_tampering` |
| Score 0–30 auto / 31–60 review / 61+ block | ✅ | `fraud/service.ts levelFor` |
| Velocity limits (3/day, $500/week) | ✅ | Configurable (default 5/day, $500/week) |
| Referral bonus only after first offer | ✅ | `referrals/service.ts onRefereeEarning` |
| Postback within conversion window (72h) | ✅ | Per-offer window (games 14–30 days); out-of-window → `needs_review` + force-credit |
| Same offer not completed twice | ✅ | Click-level idempotency key; single-shot offers hidden once credited |
| Datacenter IP / VPN detection | 🧪 | `country_mismatch` via CDN geo headers; plug an IP-intel provider into the same signal API |

## Edge cases (Part 6)

| Case | Status | Behaviour |
|---|---|---|
| Ad fails to load | ✅ | `error` event → session failed, not counted, "Try another" |
| Tab switch / close mid-ad | ✅ | Pause on hidden; >30s away → abandoned, no reward, **no penalty**; unload → abandon beacon |
| Reward confirmation > 5s | ✅ | "Confirming your reward…" / "Verifying with the partner…" then "taking longer" with claim CTA |
| Missing postback → pending, recheck, admin review, notify each stage | ✅ | Watchdog nudge, claims auto-check, human review, SLA escalation, notifications per stage |
| Duplicate postbacks | ✅ | Ignored with 200 "1" and logged as retries |
| Device switch mid-offer | ✅ | Credits by click/user, not device |
| Cash out while flagged | ✅ | Routed to review (target < 24h), member told why |
| Payout provider down | ✅ | Requeue + exponential backoff + member notified; permanent failure → full refund |
| Threshold reached without verification | ✅ | Requirements checklist with inline phone verification / KYC link |
| Offer pulled mid-completion | ✅ | Postbacks honoured regardless of offer status; otherwise claim → goodwill |
| Multi-device login, one earning device | ✅ | Sessions unlimited; video sessions one-at-a-time with takeover |
| Proactive payout-delay notifications | ✅ | Retry notifications, review emails, status timeline |

## Screens (Part 4)

| Public | Status | Member | Status | Admin | Status |
|---|---|---|---|---|---|
| Landing | ✅ | Dashboard | ✅ | Dashboard (overview) | ✅ |
| How it works | ✅ | Offerwall (filters, micro-task mode) | ✅ | Users (+ 360° detail) | ✅ |
| Offers / earning potential | ✅ | Offer detail | ✅ | Payout queue | ✅ |
| FAQ (searchable) | ✅ | Ad player | ✅ | Fraud review | ✅ |
| Blog | ✅ | Survey flow (partner site) | ✅ | Offer management | ✅ |
| Login / Signup (+referral) / Forgot / Reset / Verify | ✅ | Wallet | ✅ | Postback logs + replay | ✅ |
| Terms / Privacy / Cookies | ✅ | Cash out + status timeline | ✅ | Analytics | ✅ |
| Contact | ✅ | Referrals (link + QR) | ✅ | Settings | ✅ |
| Transparency, Status | ✅ | Profile / Settings / Security (sessions, devices) | ✅ | Support tickets | ✅ |
| | | KYC, Notifications, Achievements, Leaderboard, Support | ✅ | + KYC queue, Missing credit, Networks, Ledger, Audit, Jobs | ✅ |
| | | Onboarding (rules & proof before earning) | ✅ | | |

## Backend services (Parts 7–9)

| Service in brief | Implementation |
|---|---|
| AuthService | `modules/auth` (signup, login + 2FA, verify, reset, Google OAuth, phone OTP) |
| UserService | `modules/account` |
| OfferService | `modules/offers` (catalogue, clicks, ratings, reports, stats) |
| RewardService | `modules/rewards` (credit, holds, release, reversal, post-earning pipeline) |
| PostbackService | `modules/postbacks` |
| WalletService | `modules/wallet/ledger.ts` + account wallet DTOs |
| PayoutService | `modules/payouts` (+ providers) |
| FraudService | `modules/fraud` |
| NotificationService | `modules/notifications` (in-app, email outbox, SMS, SSE) |
| ReferralService | `modules/referrals` |
| AdminService | `modules/admin` |
| AdOrchestration | `modules/video` (ad selection, frequency caps, takeover) |
| API contracts (Part 8) | All listed endpoints exist (paths modernised); see [API.md](API.md) |
| Data models (Part 9) | Superset of the listed tables + ledger, jobs, audit, claims, KYC… |

## Pain points list ("hidden pain points", priority order)

| # | Pain point | Status | Notes |
|---|---|---|---|
| 1 | Missing credit button | ✅ | Auto-replay, partner lookup, fast lane, human SLA, watchdog |
| 2 | Real currency, no points | ✅ | |
| 3 | No minimum payout | ✅ | |
| 4 | Live payout feed | ✅ | |
| 5 | Real hourly rate on offers | ✅ | Uses real median completion time once ≥5 samples |
| 6 | Local payment rails | ✅/🧪 | Paystack, M-Pesa, MoMo, GCash, UPI, Pix, Wise + locked FX; Paystack adapter real |
| 7 | Privacy-first earning | ✅ | Email only to start; phone at first cash out; ID only for large ones; export/delete |
| 8 | Community layer | 🔜 | Needs real Discord/Telegram; not faked |
| 9 | Micro-task mode | ✅ | "< 2 min" filter, quick polls, daily plan |
| 10 | Tax center | ✅ | Yearly summary, CSV, country guidance |
| 11 | Offer quality score + report with consequences | ✅ | Score from reliability/ratings/reports; auto-pause after repeated reports |
| 12 | We eat the loss on bad postbacks | ✅ | Goodwill account + `platform:loss`; recovery when partner pays |
| 13 | Earn + learn | ✅ | Lessons with server-graded quizzes |
| 14 | Gamification (optional, not cringe) | ✅ | Streaks, plan, achievements, tiers, combos — all optional |
| 15 | Charity | ✅ | Donate-to-charity payout rail, zero fees |
| — | Lightweight / data-saver mode | ✅ | Toggle + light-data filter + no animations |
| — | Region-first design | ✅ | Country-filtered offers & rails, local currency display |
| — | Recurring earning / referral residuals | ✅ | 10% commission for 12 months, batched |

## Security & ops (Part 14)

| Item | Status |
|---|---|
| Password hashing, 2FA (TOTP), rate limiting, CSRF, XSS/SQLi prevention, encrypted PII, audit logs, session management | ✅ |
| Analytics: DAU/MAU, ARPU, funnel, retention D1/D7/D30, completion rate, postback success rate, fraud rate, time to first payout | ✅ (Admin → Analytics / Overview) |
| Support: searchable FAQ, tickets, SLA, status page | ✅ (live chat & community 🔜) |
| Infra: Postgres, job queue, CI/CD, Docker | ✅ (Redis optional for scale-out) |
| PWA first | ✅ manifest, icons, service worker, offline page (push notifications 🔜) |
| Testing: unit/integration of money paths, fraud simulations | ✅ 40 integration tests (E2E browser flows verified manually with headless Chromium) |
| i18n / multi-language | 🔜 strings are centralised; locale stored per user |
| Phase 3 neobank (cards, deposits, bill pay) | 🔜 out of scope by design |
