import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ledgerIsBalanced } from '../modules/wallet/ledger';

export const systemRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;

  app.get('/health', { schema: { hide: true } }, async () => ({ ok: true, at: new Date().toISOString() }));

  app.get('/ready', { schema: { hide: true } }, async (_req, reply) => {
    try {
      await ctx.db.execute(sql`select 1`);
      return { ok: true, db: ctx.engine, sandbox: ctx.config.SANDBOX_MODE };
    } catch {
      return reply.status(503).send({ ok: false });
    }
  });

  /** Prometheus metrics (protect with METRICS_TOKEN in production). */
  app.get('/metrics', { schema: { hide: true } }, async (req, reply) => {
    const token = ctx.config.METRICS_TOKEN;
    if (token && req.headers.authorization !== `Bearer ${token}`)
      return reply.status(401).send('unauthorized');
    const rows = (q: ReturnType<typeof sql>) => ctx.db.execute<Record<string, string>>(q).then((r) => r.rows);
    const [pb, jobs, payouts, users] = await Promise.all([
      rows(
        sql`select status, count(*) as n from postback_logs where created_at > now() - interval '1 hour' group by status`,
      ),
      rows(sql`select status, count(*) as n from jobs group by status`),
      rows(sql`select status, count(*) as n from payouts group by status`),
      rows(sql`select count(*) as n from users where deleted_at is null`),
    ]);
    const balanced = await ledgerIsBalanced(ctx.db);
    const lines = [
      '# HELP lucrum_postbacks_1h Postbacks received in the last hour by status',
      '# TYPE lucrum_postbacks_1h gauge',
      ...pb.map((r) => `lucrum_postbacks_1h{status="${r.status}"} ${r.n}`),
      '# HELP lucrum_jobs Jobs by status',
      '# TYPE lucrum_jobs gauge',
      ...jobs.map((r) => `lucrum_jobs{status="${r.status}"} ${r.n}`),
      '# HELP lucrum_payouts Payouts by status',
      '# TYPE lucrum_payouts gauge',
      ...payouts.map((r) => `lucrum_payouts{status="${r.status}"} ${r.n}`),
      '# HELP lucrum_users Registered users',
      '# TYPE lucrum_users gauge',
      `lucrum_users ${users[0]?.n ?? 0}`,
      '# HELP lucrum_ledger_balanced 1 when total debits equal total credits',
      '# TYPE lucrum_ledger_balanced gauge',
      `lucrum_ledger_balanced ${balanced.ok ? 1 : 0}`,
      '# HELP lucrum_sse_listeners Open real-time listeners',
      '# TYPE lucrum_sse_listeners gauge',
      `lucrum_sse_listeners ${ctx.events.listenerCount()}`,
    ];
    return reply.header('content-type', 'text/plain; version=0.0.4').send(`${lines.join('\n')}\n`);
  });
};
