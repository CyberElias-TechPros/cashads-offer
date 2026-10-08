import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { adSessions, networks, payouts, postbackLogs } from '../db/schema';
import { creditAdSession } from '../modules/ads/service';
import { type PostbackRequest, getAdapter, getNetworkSecret } from '../modules/networks/adapters';
import { handlePostback } from '../modules/postbacks/service';
import { failAndRefund, pollPayout } from '../modules/payouts/service';
import { verifyPaystackSignature } from '../modules/payouts/providers';
import { publicBaseUrl } from './util';

function toPostbackRequest(req: FastifyRequest): PostbackRequest {
  const query = Object.fromEntries(
    Object.entries((req.query ?? {}) as Record<string, unknown>).map(([k, v]) => [
      k,
      String(Array.isArray(v) ? v[0] : v),
    ]),
  );
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : undefined;
  // Some networks POST form/JSON bodies instead of query strings — merge them in.
  if (body)
    for (const [k, v] of Object.entries(body))
      if (query[k] === undefined && v !== undefined) query[k] = String(v);
  const fullUrl = `${publicBaseUrl(req)}${req.url}`;
  return {
    method: req.method,
    url: req.url,
    fullUrl,
    query,
    body: req.body ?? null,
    headers: { ...(req.headers as Record<string, string | undefined>), 'x-full-url': fullUrl },
    ip: req.ip,
  };
}

export const integrationRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;
  const tags = ['integrations'];
  const params = z.object({ networkId: z.string().max(40) });

  /** Offerwall postbacks (server-to-server). Most networks use GET; some POST. */
  for (const method of ['GET', 'POST'] as const) {
    app.route({
      method,
      url: '/postback/:networkId',
      schema: { tags, summary: `Offer network postback (${method})`, params },
      handler: async (req, reply) => {
        const res = await handlePostback(ctx, req.params.networkId, toPostbackRequest(req));
        reply.status(res.status);
        return typeof res.body === 'string' ? reply.type('text/plain').send(res.body) : reply.send(res.body);
      },
    });
  }

  /** Rewarded-video server-side verification (Pangle-style). */
  app.get(
    '/ssv/:networkId',
    { schema: { tags, summary: 'Rewarded video SSV callback', params } },
    async (req) => {
      const started = Date.now();
      const pr = toPostbackRequest(req);
      const network = (await ctx.db.select().from(networks).where(eq(networks.id, req.params.networkId)))[0];
      const adapter = network ? getAdapter(network.adapter) : undefined;
      const log = async (status: 'processed' | 'duplicate' | 'rejected', errorCode?: string) => {
        await ctx.db.insert(postbackLogs).values({
          networkId: req.params.networkId,
          method: 'GET',
          url: req.url,
          query: pr.query,
          headers: { 'user-agent': String(req.headers['user-agent'] ?? '') },
          ip: req.ip,
          signatureValid: errorCode !== 'bad_signature',
          status,
          errorCode: errorCode ?? null,
          networkTxnId: pr.query.trans_id ?? null,
          userId: pr.query.user_id ?? null,
          processingMs: Date.now() - started,
        });
      };
      // SSV-capable dialects: sha256(secret:trans_id) family + URL-HMAC (AdMob-style).
      if (!network || !adapter || !['pangle_ssv', 'hmacurl'].includes(network.adapter))
        return { isValid: false };
      const secret = await getNetworkSecret(ctx.db, network.id);
      if (!secret || !adapter.verify(pr, secret, network)) {
        await log('rejected', 'bad_signature');
        return { isValid: false };
      }
      const session = (
        await ctx.db
          .select()
          .from(adSessions)
          .where(eq(adSessions.transId, pr.query.trans_id ?? ''))
      )[0];
      // The trans_id lookup is the proof; the echoed user_id may be the member's id
      // (web flow) or the opaque session token (native SDK flow) — both are accepted.
      if (!session || (session.userId !== pr.query.user_id && session.transId !== pr.query.user_id)) {
        await log('rejected', 'unknown_session');
        return { isValid: false };
      }
      const outcome = await creditAdSession(ctx, session.id);
      if (outcome === 'invalid') {
        await log('rejected', 'session_not_verified');
        return { isValid: false };
      }
      await log(outcome === 'duplicate' ? 'duplicate' : 'processed');
      return { isValid: true };
    },
  );

  /**
   * Paystack transfer webhooks (live NG bank payouts). The signature covers the exact
   * raw bytes, so this scope keeps the unparsed body alongside the parsed JSON.
   */
  await app.register(async (scope) => {
    scope.removeContentTypeParser('application/json');
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
      (req as FastifyRequest & { rawBody?: string }).rawBody = body as string;
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        done(err as Error, undefined);
      }
    });
    scope.post('/webhooks/paystack', { schema: { hide: true } }, async (req, reply) => {
      const secret = ctx.config.PAYSTACK_SECRET_KEY;
      if (!secret) return reply.status(404).send();
      const raw = (req as FastifyRequest & { rawBody?: string }).rawBody ?? '';
      if (!verifyPaystackSignature(secret, raw, req.headers['x-paystack-signature'] as string | undefined))
        return reply.status(401).send();
      const event = req.body as { event?: string; data?: { reference?: string; reason?: string } };
      const reference = event.data?.reference ?? '';
      const payoutId = reference.startsWith('lucrum_') ? reference.slice(7) : null;
      if (payoutId) {
        const p = (await ctx.db.select().from(payouts).where(eq(payouts.id, payoutId)))[0];
        if (p && p.status === 'processing') {
          if (event.event === 'transfer.success') await pollPayout(ctx, payoutId);
          if (event.event === 'transfer.failed' || event.event === 'transfer.reversed') {
            await failAndRefund(ctx, payoutId, event.data?.reason ?? 'The bank rejected the transfer.');
          }
        }
      }
      return { ok: true };
    });
  });
};
