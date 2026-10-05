# Lucrum Cloudflare Workers Migration Plan

## Status

Planning document only. This document does not yet migrate the production API or change the current deployment.

## Goal

Deploy **Lucrum** with:

- `apps/web` on Vercel as a Vite frontend.
- `apps/api` optionally as a Cloudflare Worker.
- Cloudflare D1 for relational data.
- Cloudflare R2 for uploads and durable object storage.
- Cloudflare Cron Triggers for scheduled work.
- Cloudflare Queues where the account and workload justify using them.

The existing Node.js/Fastify/Docker deployment should continue to work while the Cloudflare implementation is developed. The Worker runtime should be an optional adapter, not an immediate replacement for the existing app.

## Recommended adapter architecture

Keep the business logic independent from the HTTP and infrastructure runtimes:

```text
packages/domain or apps/api/src/modules
  Business services, validation, policies, ledger rules

apps/api/src/adapters/node
  Fastify bootstrap
  PostgreSQL/PGlite database adapter
  Local filesystem upload adapter
  In-process queue adapter

apps/api/src/adapters/cloudflare
  Worker fetch adapter
  D1 database adapter
  R2 storage adapter
  Queue/Cron job adapters

apps/api/src/worker.ts
  Cloudflare Worker entrypoint

apps/api/src/server.ts
  Existing Node entrypoint
```

Both runtimes should construct the same application services from a runtime-neutral dependency object. The business modules should not import Fastify, Node `fs`, PostgreSQL-specific clients, or Cloudflare `Env` types directly.

A conceptual runtime contract:

```ts
export interface AppRuntime {
  db: AppDatabase;
  storage: ObjectStorage;
  jobs: JobDispatcher;
  config: AppConfig;
  now(): Date;
}
```

The existing Node implementation remains the default for local development, Docker, and current tests. The Cloudflare implementation is selected by the Worker entrypoint.

## Cloudflare resources

### Worker

Suggested name:

```text
lucrum-api
```

Responsibilities:

- Handle `/api/*` requests.
- Apply authentication, CSRF, rate limiting, and CORS policy.
- Construct the D1/R2/queue-backed application runtime.
- Dispatch scheduled work from Cron Triggers.
- Dispatch asynchronous work from Queue consumers when enabled.

### D1

Suggested database name:

```text
lucrum-production
```

Use D1 as the free-tier relational database. Create separate local, preview, and production database bindings where practical.

The existing PostgreSQL schema must be translated to SQLite/D1-compatible SQL. Particular attention is required for:

- UUID generation.
- PostgreSQL enums.
- `jsonb` columns.
- `timestamp with time zone` values.
- Numeric and money precision.
- Unique and partial indexes.
- Transaction semantics.
- `RETURNING` support and query-builder compatibility.
- PostgreSQL-specific operators and functions.

Money values must remain integer micro-units as in the current application. Do not use floating-point values for balances, rewards, or payouts.

### R2

Suggested bucket name:

```text
lucrum-uploads
```

Move uploaded evidence and other durable files out of local disk. Store only object keys and metadata in D1. Use short-lived signed URLs or Worker-mediated downloads rather than exposing the bucket publicly.

The storage abstraction should support:

```ts
interface ObjectStorage {
  put(key: string, body: ArrayBuffer | ReadableStream, metadata?: Metadata): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  createDownloadUrl(key: string, expiresInSeconds: number): Promise<string>;
}
```

The Node adapter can continue using the existing local upload directory during development. The Cloudflare adapter uses R2.

### Cron Triggers

Use a small number of scheduled entry points because free accounts have limited scheduled-trigger capacity. Prefer one dispatcher that selects due work rather than one trigger for every job.

Candidate schedules:

- Frequent maintenance: expired claims, stale sessions, and queue recovery.
- Payout polling and provider reconciliation.
- Offer/statistics refresh and cache invalidation.
- Daily retention, cleanup, and reporting tasks.

Each scheduled operation must be idempotent, bounded, and resumable. A Cron invocation must never assume that all pending work can finish in one run.

### Queues

Use Queues for work that is slow, retryable, or should not block an HTTP response, such as:

- Postback delivery.
- Email/notification delivery if added later.
- Payout polling or reconciliation.
- Fraud and statistics recalculation.

If Queues are not available within the intended free allowance, retain a D1-backed job table and process a bounded batch from Cron Triggers. The job interface should be the same in both modes.

## HTTP migration

The current Fastify server should not be imported into a Worker. Create a Worker-compatible HTTP adapter using a small edge framework such as Hono, or a minimal `fetch` router if the route surface remains manageable.

Preserve existing public paths:

```text
/api/auth/*
/api/offers/*
/api/claims/*
/api/wallet/*
/api/me/*
/api/admin/*
/api/postback/*
/api/ssv/*
/api/webhooks/*
/api/health
/api/ready
```

The Worker should return the same response envelopes and error codes as the Node implementation so the frontend and integrations do not need a second API contract.

The Worker entrypoint should expose:

```ts
export default {
  fetch(request, env, ctx) { ... },
  scheduled(controller, env, ctx) { ... },
  queue(batch, env, ctx) { ... }
};
```

## Database adapter migration

1. Freeze the current schema and generate a D1 baseline migration.
2. Add a D1 schema/migration directory separate from the existing PostgreSQL migrations.
3. Introduce repository interfaces for the highest-risk areas first:
   - users and sessions;
   - ledger and balances;
   - offers and claims;
   - payouts;
   - postbacks and fraud signals.
4. Implement PostgreSQL/PGlite and D1 versions behind the same interfaces.
5. Port queries module by module.
6. Run the existing business tests against both adapters where possible.
7. Add migration/import tooling for existing production data before cutover.

Do not silently change ledger or payout semantics during the database port. Add reconciliation tests that compare balances, transaction totals, and payout states between adapters.

## Authentication, cookies, CORS, and domains

Recommended production domains:

```text
app.lucrum.example       -> Vercel frontend
api.lucrum.example       -> Cloudflare Worker
```

The frontend currently sends relative `/api` requests. For a split deployment, change the API client to use a build-time value:

```ts
const API_BASE_URL = import.meta.env.VITE_API_URL ?? '';
fetch(`${API_BASE_URL}/api${path}`, { ... });
```

Vercel environment variable:

```text
VITE_API_URL=https://api.lucrum.example
```

The Worker must:

- Allow only configured Lucrum frontend origins.
- Allow credentials where cookie authentication requires it.
- Return `Access-Control-Allow-Credentials: true` only for approved origins.
- Handle `OPTIONS` requests.
- Set secure, HTTP-only cookies.
- Use an explicit SameSite policy appropriate to the chosen domains.
- Preserve CSRF protection; CORS is not a replacement for CSRF protection.
- Trust proxy headers only from the expected deployment path.

Before launch, verify browser behavior for login, refresh, logout, uploads, and cross-origin mutations. Cookie behavior differs depending on whether the frontend and API are same-site subdomains or unrelated domains.

## Configuration and secrets

Cloudflare Worker bindings and secrets should replace local process environment access in the Worker entrypoint.

Expected bindings/secrets include:

```text
D1: DB
R2: UPLOADS
Queue: JOBS (optional)

DATA_ENCRYPTION_KEY
COOKIE_SECRET or session secret, if introduced
APP_URL
FRONTEND_ORIGIN
SANDBOX_MODE
WORKER_ENABLED or equivalent feature flags
PAYSTACK_SECRET_KEY
METRICS_TOKEN
```

Never commit production values. Keep `.env.example` for the Node adapter and add a documented `wrangler.toml`/`wrangler.jsonc` example for Cloudflare.

## Suggested Cloudflare configuration shape

The final configuration should be adapted to the actual Cloudflare account IDs and database IDs, but should follow this shape:

```toml
name = "lucrum-api"
main = "apps/api/src/worker.ts"
compatibility_date = "2026-10-05"

[vars]
APP_URL = "https://api.lucrum.example"
FRONTEND_ORIGIN = "https://app.lucrum.example"

[[d1_databases]]
binding = "DB"
database_name = "lucrum-production"
database_id = "REPLACE_ME"
migrations_dir = "apps/api/migrations/d1"

[[r2_buckets]]
binding = "UPLOADS"
bucket_name = "lucrum-uploads"

# Add only if Queues are enabled for the account/workload.
# [[queues.producers]]
# binding = "JOBS"
# queue = "lucrum-jobs"

[triggers]
crons = ["*/5 * * * *", "0 * * * *", "0 3 * * *"]
```

Keep production IDs and account-specific configuration out of the generic plan until the Cloudflare account is selected.

## Lucrum rename plan

The application name should become **Lucrum** in user-facing and deployment-facing locations, while the repository/package migration should be handled carefully.

Rename in stages:

1. User-facing brand text, page titles, metadata, manifest, favicon labels, emails, and documentation.
2. Environment variable comments and deployment names.
3. Cloudflare Worker, D1, R2, and queue names.
4. Package names only after import references and lockfile changes are tested.
5. Keep compatibility aliases temporarily for existing `CASHADS_*` or `cashads` data/configuration where needed.

Do not rename database tables, cookie names, encryption labels, or persisted keys without an explicit data migration and rollback plan. Existing user sessions and encrypted data must remain readable during the transition.

Suggested deployment names:

```text
lucrum-web
lucrum-api
lucrum-production
lucrum-uploads
lucrum-jobs
```

## Testing strategy

### Existing Node path

Continue to run:

```bash
npm run typecheck
npm test
npm run build
```

The current Docker deployment must remain functional during the migration.

### Worker path

Add:

```bash
npx wrangler types
npx wrangler d1 migrations apply lucrum-local --local
npx wrangler dev
```

Add integration tests for:

- authentication and session cookies;
- CORS and preflight requests;
- health/readiness endpoints;
- ledger writes and idempotency;
- claims and payout transitions;
- R2 upload/download behavior;
- scheduled job batches;
- queue retries and dead-letter behavior;
- third-party postback signature validation.

Run both implementations against the same contract tests wherever the behavior is intended to be identical.

## Rollout plan

### Phase 1: Runtime-neutral boundaries

- Extract configuration, storage, jobs, and database interfaces.
- Keep Node adapters as the default.
- Add contract tests.
- Do not change production routing.

### Phase 2: D1 and R2 foundations

- Create D1 schema and migrations.
- Implement D1 adapter for users, sessions, and core wallet/ledger operations.
- Implement R2 storage adapter.
- Add local emulators/test doubles.

### Phase 3: Worker HTTP adapter

- Add `worker.ts`.
- Port health, auth, public, offers, claims, wallet, and user routes.
- Preserve error and response contracts.
- Add CORS and cookie tests.

### Phase 4: Jobs and integrations

- Port postbacks, payouts, fraud, and admin routes.
- Add Cron dispatcher and optional Queue consumer.
- Make every job idempotent and batch-limited.

### Phase 5: Frontend split deployment

- Add `VITE_API_URL` support.
- Deploy a Vercel preview frontend against a Worker preview environment.
- Test authentication, mutations, uploads, and service-worker behavior.

### Phase 6: Data migration and cutover

- Export and transform PostgreSQL data into D1.
- Reconcile balances and payout states.
- Run a read-only comparison period.
- Switch API DNS to the Worker.
- Keep the Node backend available for rollback until reconciliation is complete.

### Phase 7: Lucrum branding

- Apply the Lucrum name after runtime behavior is stable.
- Preserve backwards-compatible configuration and persisted data identifiers.
- Update Vercel and Cloudflare deployment names.

## Risks and constraints

- Cloudflare Workers free-tier CPU and request limits may be too restrictive for heavy admin, payout, or migration operations.
- D1 is SQLite-compatible, not PostgreSQL-compatible; query and transaction behavior must be verified carefully.
- Long-running in-process workers cannot be copied directly into a Worker request.
- R2 must replace every assumption that uploads exist on local disk.
- Cron jobs do not guarantee that an entire backlog can be processed in one invocation.
- External payout providers and webhook retries require explicit idempotency and durable state.
- Browser cookies, CORS, and CSRF behavior must be tested with the final custom domains.
- Free-tier availability and limits can change; confirm current Cloudflare account limits before production launch.

## Definition of done

The migration is complete when:

- The Node/Docker deployment still works.
- The Worker handles the documented API paths.
- D1 migrations create a production-equivalent schema.
- Core business tests pass against the D1 adapter.
- R2 handles uploads without local disk.
- Scheduled and asynchronous jobs are durable and idempotent.
- Vercel frontend authentication works against the Worker API.
- Data import and reconciliation tooling has been tested.
- Lucrum branding is applied without breaking persisted data.
- Rollback to the Node backend is documented and tested.
