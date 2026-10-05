import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { offerListQuerySchema, offerReportSchema, offerReviewSchema, videoEventSchema } from '@cashads/shared';
import { withUow, type AppContext } from '../context';
import { clientMeta, parse, requireActiveUser, requireUser } from '../http/plumbing';
import { deviceLabel } from '../lib/useragent';
import { upsertDevice } from '../modules/auth/service';
import * as offersSvc from '../modules/offers/service';
import * as sandbox from '../modules/sandbox/service';
import * as video from '../modules/video/service';

const idParam = z.object({ id: z.uuid() });

export async function earnRoutes(app: FastifyInstance, ctx: AppContext) {
  const fallback = ctx.config.PUBLIC_WEB_URL;

  /* ------------------------------------------------------------- offers */
  app.get('/api/offers', async (req) => offersSvc.listOffers(ctx, req.auth?.user ?? null, parse(offerListQuerySchema, req.query)));
  app.get('/api/offers/clicks', async (req) => offersSvc.listMyClicks(ctx, requireUser(req).user.id));
  app.get('/api/offers/:id', async (req) => offersSvc.getOffer(ctx, req.auth?.user ?? null, parse(idParam, req.params).id));

  app.post('/api/offers/:id/start', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const { user } = requireActiveUser(req);
    const { id } = parse(idParam, req.params);
    const meta = clientMeta(req, fallback);
    return withUow(ctx, async (uow) => {
      const device = await upsertDevice(uow.tx, user.id, meta);
      return offersSvc.startOffer(uow, user, id, { ip: meta.ip, userAgent: meta.userAgent, deviceId: device?.id ?? null });
    });
  });

  app.post('/api/offers/clicks/:id/returned', async (req) => {
    const { user } = requireUser(req);
    await offersSvc.markReturned(ctx, user.id, parse(idParam, req.params).id);
    return { ok: true };
  });

  app.post('/api/offers/:id/review', async (req) => {
    const { user } = requireUser(req);
    const input = parse(offerReviewSchema, req.body);
    await offersSvc.rateOffer(ctx, user.id, parse(idParam, req.params).id, input.rating, input.comment);
    return { ok: true };
  });

  app.post('/api/offers/:id/report', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { user } = requireUser(req);
    const input = parse(offerReportSchema, req.body);
    await offersSvc.reportOffer(ctx, user.id, parse(idParam, req.params).id, input.reason, input.details);
    return { ok: true, message: 'Thanks — our team reviews every report. Offers with repeated reports are paused automatically.' };
  });

  /* -------------------------------------------------------------- video */
  async function deviceFor(req: Parameters<typeof clientMeta>[0], userId: string) {
    const meta = clientMeta(req, fallback);
    const d = await upsertDevice(ctx.db, userId, meta);
    return { deviceId: d?.id ?? null, label: deviceLabel(meta.userAgent), ip: meta.ip };
  }

  app.get('/api/video/status', async (req) => {
    const { user } = requireUser(req);
    const d = await deviceFor(req, user.id);
    return video.videoStatus(ctx, user, d.deviceId);
  });

  app.post('/api/video/sessions', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const { user } = requireActiveUser(req);
    const body = parse(z.object({ takeOver: z.boolean().optional() }), req.body ?? {});
    const d = await deviceFor(req, user.id);
    return withUow(ctx, (uow) => video.startSession(uow, user, { deviceId: d.deviceId, deviceLabel: d.label, ip: d.ip, takeOver: !!body.takeOver }));
  });

  app.post('/api/video/sessions/:id/events', { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } }, async (req) => {
    const { user } = requireUser(req);
    const event = parse(videoEventSchema, req.body);
    await withUow(ctx, (uow) => video.recordEvent(uow, user.id, parse(idParam, req.params).id, event));
    return { ok: true };
  });

  app.post('/api/video/sessions/:id/complete', async (req) => {
    const { user } = requireActiveUser(req);
    return withUow(ctx, (uow) => video.completeSession(uow, user, parse(idParam, req.params).id));
  });

  app.post('/api/video/sessions/:id/abandon', async (req) => {
    const { user } = requireUser(req);
    const body = parse(z.object({ reason: z.enum(['closed', 'hidden_too_long', 'ad_error']).default('closed') }), req.body ?? {});
    await withUow(ctx, (uow) => video.abandonSession(uow, user.id, parse(idParam, req.params).id, body.reason));
    return { ok: true };
  });

  /* ------------------------------------------------- sandbox partner */
  app.get('/api/sandbox/offers/:id', async (req) => {
    const { click } = parse(z.object({ click: z.uuid() }), req.query);
    return sandbox.partnerView(ctx, parse(idParam, req.params).id, click);
  });

  app.post('/api/sandbox/offers/:id/complete', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const body = parse(z.object({ clickId: z.uuid(), goalId: z.string().max(40).optional(), answers: z.array(z.number().int()).max(20).optional() }), req.body);
    return sandbox.completeTask(ctx, { offerId: parse(idParam, req.params).id, ...body });
  });

  app.get('/api/sandbox/conversions/:id', async (req) => sandbox.lookupConversion(ctx.db, parse(idParam, req.params).id));
}
