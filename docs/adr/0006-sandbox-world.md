# ADR 0006 — A sandbox world behind production interfaces

**Status:** accepted

## Context

Every core flow depends on third parties — offer networks (postbacks, conversion APIs), ad networks (SSV), payout
providers, email/SMS and identity vendors — none of which can be used before the business has accounts. The riskiest
code (signature verification, idempotency, retries, refunds, claims) must still be exercised end to end.

## Decision

`SANDBOX_MODE` enables simulated parties that talk to the platform **through the same interfaces as real ones**:
SandboxNet sends HMAC-signed postbacks through the real HTTP pipeline and exposes a conversion-status API; SandboxAds
calls the real SSV endpoint; sandbox payout rails have latency, outages and permanent-failure destinations; emails and
SMS land in a developer inbox; a sandbox identity vendor reviews KYC. Developer controls on the simulated advertiser
page drop, duplicate or corrupt postbacks on purpose. The UI labels sandbox mode everywhere.

## Consequences

- The whole product is demonstrable and testable today, including failure modes.
- Going live is configuration + provider adapters ([going-live.md](../going-live.md)); the pipeline code doesn’t change.
- `SANDBOX_MODE` must never be enabled with real members (the dev inbox exposes messages).
