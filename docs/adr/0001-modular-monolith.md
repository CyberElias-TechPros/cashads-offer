# ADR 0001 — Modular monolith, not microservices

**Status:** accepted

## Context

The spec lists ten backend services (Auth, User, Offer, Reward, Postback, Payout, Fraud, Notification, Referral,
Admin). The product is pre-launch, run by a small team, and its hardest problems are _correctness across domains_
(a conversion touches postbacks, the ledger, referrals, fraud and notifications at once).

## Decision

Ship one deployable Fastify application with one module per service (`apps/api/src/modules/*`). Modules expose plain
async functions taking an explicit `AppContext`; cross-domain side effects go through the transactional job outbox.

## Consequences

- Multi-domain operations are a single ACID transaction — no distributed sagas for money.
- One thing to deploy, monitor and debug.
- Boundaries stay explicit, so postbacks or payouts can be extracted later (they only depend on the ledger,
  job queue and event bus interfaces).
