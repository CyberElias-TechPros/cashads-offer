# ADR 0003 — Opaque server-side sessions instead of JWT access/refresh tokens

**Status:** accepted

## Context

The spec sketches `/auth/refresh` with JWTs. Lucrum is a first-party web app where account takeover means stolen
money, and the product needs remote sign-out, instant revocation on ban/password reset and a device list.

## Decision

Random 32-byte session tokens in an httpOnly, SameSite=Lax cookie; only a SHA-256 hash is stored server-side
(`sessions` table) with device, IP, sliding 30-day expiry and `revoked_at`. CSRF is blocked by requiring a custom
request header on mutations.

## Consequences

- Revocation is immediate (bans, password resets, “sign out other devices”).
- No token refresh dance in the client; no secrets in JavaScript-readable storage.
- One indexed lookup per request (cheap; cacheable later if needed).
