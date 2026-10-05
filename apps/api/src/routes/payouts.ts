import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { payoutQuoteSchema, payoutRequestSchema } from '@cashads/shared';
import { withUow, type AppContext } from '../context';
import { parse, requireActiveUser, requireUser } from '../http/plumbing';
import * as payouts from '../modules/payouts/service';

const idParam = z.object({ id: z.uuid() });

export async function payoutRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/payouts/methods', async (req) => {
    const country = (req.query as { country?: string }).country?.toUpperCase() ?? requireUser(req).user.country;
    return payouts.listMethods(ctx, country);
  });

  app.post('/api/payouts/quote', async (req) => {
    const { user } = requireUser(req);
    const input = parse(payoutQuoteSchema, req.body);
    const { method: _m, ...quote } = await payouts.quotePayout(ctx, user, input.methodId, input.amountMicros);
    return quote;
  });

  app.post('/api/payouts', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { user } = requireActiveUser(req);
    const input = parse(payoutRequestSchema, req.body);
    reply.code(201);
    return withUow(ctx, (uow) => payouts.requestPayout(uow, user, input));
  });

  app.get('/api/payouts', async (req) => payouts.listPayouts(ctx, requireUser(req).user.id));
  app.get('/api/payouts/destinations', async (req) => payouts.listDestinations(ctx, requireUser(req).user.id));
  app.delete('/api/payouts/destinations/:id', async (req) => {
    await payouts.deleteDestination(ctx, requireUser(req).user.id, parse(idParam, req.params).id);
    return { ok: true };
  });
  app.get('/api/payouts/:id', async (req) => payouts.getPayout(ctx, requireUser(req).user.id, parse(idParam, req.params).id));
  app.post('/api/payouts/:id/cancel', async (req) => {
    const { user } = requireUser(req);
    const { id } = parse(idParam, req.params);
    await payouts.cancelPayout(ctx, user.id, id);
    return payouts.getPayout(ctx, user.id, id);
  });
}
