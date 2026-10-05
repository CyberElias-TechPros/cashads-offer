# Lucrum Cloudflare Worker backend

This is the optional Cloudflare runtime adapter for Lucrum. It is intentionally separate from the existing Node/Fastify backend so the current Docker deployment remains available during migration.

## Local development

```bash
npm install
npx wrangler d1 migrations apply lucrum-production --local
npm run dev -w @lucrum/worker
```

The current Worker foundation provides:

- `/api/health`
- `/api/ready` with a D1 connectivity check
- `/api/config`
- CORS handling for the Vercel frontend
- D1 and R2 bindings
- A scheduled entrypoint

Business routes currently return `501 NOT_MIGRATED`. They must be ported behind the runtime-neutral interfaces described in `docs/cloudflare-workers-migration-plan.md`; this avoids shipping a backend that silently changes ledger, payout, or authentication behavior.

Before deployment:

1. Replace the placeholder D1 database ID in `wrangler.toml`.
2. Create the production D1 database and R2 bucket.
3. Set `FRONTEND_ORIGIN` to the production Vercel/custom-domain URL.
4. Add secrets with `wrangler secret put`.
5. Apply migrations with `wrangler d1 migrations apply`.
