# ADR 0005 — Real Postgres everywhere, with PGlite for development and tests

**Status:** accepted

## Context

Contributors should be able to `npm install && npm run dev` without installing Postgres or Docker, and the integration
tests should exercise real SQL semantics (constraints, `FOR UPDATE SKIP LOCKED`, `percentile_cont`, partial indexes)
rather than mocks or SQLite.

## Decision

`createDatabase()` returns a Drizzle instance backed by **node-postgres** when `DATABASE_URL` is set and by **PGlite**
(Postgres compiled to WASM, in-process) otherwise. Both run the same generated migrations. Each test file gets a fresh
in-memory PGlite database. CI additionally migrates, seeds and smoke-tests the production build on PostgreSQL 17.

## Consequences

- Zero-setup development and fast, isolated, parallel integration tests with real constraints.
- PGlite is single-connection, so it is for development/tests only — production always uses PostgreSQL.
