# ADR 0004 — Postgres-backed job queue as a transactional outbox

**Status:** accepted

## Context

The spec proposes Redis (BullMQ) for queues. Side effects of a credit (bonuses, referrals, notifications, stats) must
happen **exactly once** and must not be lost if the process crashes between the DB commit and the enqueue.

## Decision

A `jobs` table in the same database. Business code enqueues jobs inside its own transaction (outbox pattern); workers
claim them with `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)`, retry with exponential backoff, park
permanently failed jobs for admin retry, and a scheduler enqueues periodic jobs with per-period dedupe keys.

## Consequences

- Atomicity between “money moved” and “side effects scheduled” with no extra infrastructure.
- Safe with many worker instances; observable via SQL and `/api/metrics`.
- Throughput is plenty for this domain; if it ever isn’t, the `JobQueue` interface can be backed by a dedicated broker.
