import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireUser } from '../http/auth';
import { getAdapter, getNetworkSecret } from '../modules/networks/adapters';
import {
  completeSandboxClick,
  devInbox,
  getSandboxClick,
  reverseSandboxConversion,
} from '../modules/sandbox/service';
import { safeEqual } from '../lib/crypto';
import { AppError } from '../lib/errors';

/** Sandbox-only routes: the simulated advertiser page, network status API and developer inbox. */
export const sandboxRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;
  const tags = ['sandbox'];
  const clickParams = z.object({ clickId: z.uuid() });

  app.get(
    '/sandbox/clicks/:clickId',
    { schema: { tags, summary: 'Simulated advertiser page data', params: clickParams } },
    async (req) => getSandboxClick(ctx, requireUser(req), req.params.clickId),
  );

  app.post(
    '/sandbox/clicks/:clickId/complete',
    {
      schema: {
        tags,
        summary: 'Complete the simulated task (developer controls choose how the network reports it)',
        params: clickParams,
        body: z.object({
          mode: z.enum(['deliver', 'drop', 'duplicate', 'bad_signature', 'screenout']).default('deliver'),
        }),
      },
    },
    async (req) => completeSandboxClick(ctx, requireUser(req), req.params.clickId, req.body.mode),
  );

  app.post(
    '/sandbox/clicks/:clickId/reverse',
    { schema: { tags, summary: 'Simulate an advertiser chargeback', params: clickParams } },
    async (req) => {
      await reverseSandboxConversion(ctx, requireUser(req), req.params.clickId);
      return { ok: true };
    },
  );

  /** What a real network's conversion-status API looks like (server-to-server, API key). */
  app.get(
    '/sandbox/networks/:networkId/conversions',
    {
      schema: {
        tags,
        summary: 'Network conversion-status API',
        params: z.object({ networkId: z.string() }),
        querystring: z.object({ click_id: z.uuid() }),
      },
    },
    async (req) => {
      const secret = await getNetworkSecret(ctx.db, req.params.networkId);
      if (!secret || !safeEqual(String(req.headers['x-api-key'] ?? ''), secret))
        throw new AppError(401, 'UNAUTHORIZED', 'Invalid API key');
      const adapter = getAdapter('sandboxnet')!;
      return adapter.checkConversion!(ctx.db, req.params.networkId, req.query.click_id);
    },
  );

  app.get(
    '/dev/inbox',
    { schema: { tags, summary: 'Developer inbox (emails & SMS sent by the platform)' } },
    async () => devInbox(ctx),
  );
};
