import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql } from 'drizzle-orm';
import { contactSchema, offerListQuerySchema } from '@cashads/shared';
import type { AppContext } from '../context';
import { parse } from '../http/plumbing';
import { openSse } from '../http/sse';
import { listOutbox } from '../modules/admin/service';
import { listOffers } from '../modules/offers/service';
import { listMethods } from '../modules/payouts/service';
import { handlePostback } from '../modules/postbacks/service';
import { publicFeed, publicStats, saveContact } from '../modules/public/service';

const START = Date.now();

function flatParams(req: FastifyRequest): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (obj: unknown) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v === undefined || v === null) continue;
      out[k] = Array.isArray(v) ? String(v[0]) : typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
  };
  add(req.query);
  add(req.body);
  return out;
}

export async function publicRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/health', async () => {
    let db = 'ok';
    try {
      await ctx.db.execute(sql`select 1`);
    } catch {
      db = 'down';
    }
    return { status: db === 'ok' ? 'ok' : 'degraded', db, driver: ctx.driver, uptimeSeconds: Math.round((Date.now() - START) / 1000), sseClients: ctx.bus.listenerCount(), version: '1.0.0' };
  });

  app.get('/api/public/stats', async () => publicStats(ctx));
  app.get('/api/public/feed', async (req) => publicFeed(ctx, Math.min(50, Number((req.query as { limit?: string }).limit) || 20)));
  app.get('/api/public/feed/stream', async (req, reply) => {
    openSse(req, reply, (send) => ctx.bus.subscribePublic((e) => send(e.type, e.item)));
  });
  app.get('/api/public/offers', async (req) => {
    const q = parse(offerListQuerySchema, req.query);
    return listOffers(ctx, null, { ...q, limit: q.limit ?? 12 });
  });
  app.get('/api/public/methods', async (req) => listMethods(ctx, ((req.query as { country?: string }).country ?? 'US').toUpperCase()));
  app.post('/api/public/contact', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    await saveContact(ctx, parse(contactSchema, req.body), req.ip);
    return { ok: true };
  });

  /* ------------------------------------------------ server-to-server */
  const postbackHandler = async (req: FastifyRequest<{ Params: { networkId: string } }>) => {
    const url = `${req.protocol}://${req.headers.host ?? 'localhost'}${req.url}`;
    return handlePostback(ctx, {
      networkId: req.params.networkId,
      method: req.method,
      params: flatParams(req),
      fullUrl: url,
      headers: req.headers,
      ip: req.ip ?? null,
    });
  };
  const s2sLimit = { config: { rateLimit: { max: 3000, timeWindow: '1 minute' } } };

  app.get<{ Params: { networkId: string } }>('/api/postback/:networkId', s2sLimit, async (req, reply) => {
    const r = await postbackHandler(req);
    return reply.code(r.httpStatus).type('text/plain').send(r.body);
  });
  app.post<{ Params: { networkId: string } }>('/api/postback/:networkId', s2sLimit, async (req, reply) => {
    const r = await postbackHandler(req);
    return reply.code(r.httpStatus).type('text/plain').send(r.body);
  });
  // Rewarded-video server-side verification: same pipeline, JSON reply as SSV providers expect.
  app.get<{ Params: { networkId: string } }>('/api/ssv/:networkId', s2sLimit, async (req, reply) => {
    const r = await postbackHandler(req);
    return reply.code(r.httpStatus >= 500 ? 500 : 200).send({ isValid: r.status === 'credited' || r.status === 'held' || r.status === 'duplicate' });
  });

  /* ---------------------------------------------------- demo mailbox */
  app.get('/api/dev/outbox', async (_req, reply) => {
    if (!ctx.config.DEMO_MODE) return reply.code(404).send({ error: { code: 'not_found', message: 'Not available' } });
    const rows = await listOutbox(ctx, 60);
    return rows.map((m) => ({ id: m.id, channel: m.channel, to: m.to, subject: m.subject, text: m.text, html: m.html, template: m.template, status: m.status, createdAt: m.createdAt }));
  });
}
