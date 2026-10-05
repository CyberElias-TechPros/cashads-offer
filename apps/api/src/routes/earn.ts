import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  adEventSchema,
  adSessionCreateSchema,
  claimCreateSchema,
  lessonSubmitSchema,
  offerRateSchema,
  offerReportSchema,
  offersQuerySchema,
  pollAnswerSchema,
} from '@lucrum/shared';
import { z } from 'zod';
import { claims } from '../db/schema';
import { requireActiveUser, requireUser } from '../http/auth';
import { notFound } from '../lib/errors';
import {
  completeAdSession,
  createAdSession,
  getAdSession,
  nextAd,
  recordAdEvent,
} from '../modules/ads/service';
import { createClaim, getClaimDTO, listClaims } from '../modules/claims/service';
import { storeUpload } from '../modules/finance/service';
import { answerPoll, getLessonDTO, listLessons, nextPoll, submitLesson } from '../modules/native/service';
import { getPlan } from '../modules/offers/plan';
import {
  getOfferDetail,
  listActivity,
  listOffersForUser,
  rateOffer,
  reportCompleted,
  reportOffer,
  startOffer,
} from '../modules/offers/service';

const id = z.object({ id: z.uuid() });

export const earnRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;
  const tags = ['earn'];

  /* offers */
  app.get(
    '/offers',
    {
      schema: {
        tags,
        summary: 'Offerwall for your country, with real hourly rates and quality grades',
        querystring: offersQuerySchema,
      },
    },
    async (req) => listOffersForUser(ctx, requireUser(req), req.query),
  );
  app.get('/offers/:id', { schema: { tags, summary: 'Offer detail', params: id } }, async (req) =>
    getOfferDetail(ctx, requireUser(req), req.params.id),
  );
  app.post(
    '/offers/:id/start',
    { schema: { tags, summary: 'Start an offer (creates a tracked click)', params: id } },
    async (req) => startOffer(ctx, requireActiveUser(req), req.params.id, req.client),
  );
  app.post(
    '/offers/:id/rate',
    { schema: { tags, summary: 'Thumbs up / down after completion', params: id, body: offerRateSchema } },
    async (req) => {
      await rateOffer(ctx, requireUser(req), req.params.id, req.body.value);
      return { ok: true };
    },
  );
  app.post(
    '/offers/:id/report',
    { schema: { tags, summary: 'Report a bad offer', params: id, body: offerReportSchema } },
    async (req) => reportOffer(ctx, requireUser(req), req.params.id, req.body.reason, req.body.details),
  );
  app.post(
    '/clicks/:id/completed',
    { schema: { tags, summary: '“I finished” — start active checks with the network', params: id } },
    async (req) => reportCompleted(ctx, requireUser(req), req.params.id),
  );
  app.get('/activity', { schema: { tags, summary: 'Your tracked tasks and their status' } }, async (req) =>
    listActivity(ctx, requireUser(req)),
  );
  app.get('/plan', { schema: { tags, summary: 'Today’s personalised plan' } }, async (req) =>
    getPlan(ctx, requireUser(req)),
  );

  /* quick tasks */
  app.get('/polls/next', { schema: { tags, summary: 'Next quick task' } }, async (req) => ({
    poll: await nextPoll(ctx, requireUser(req)),
  }));
  app.post(
    '/polls/:pollId/answer',
    {
      schema: {
        tags,
        summary: 'Answer a quick task',
        params: z.object({ pollId: z.string().max(60) }),
        body: pollAnswerSchema,
      },
    },
    async (req) =>
      answerPoll(ctx, requireActiveUser(req), req.client, req.params.pollId, req.body.optionIndex),
  );

  /* lessons */
  app.get('/lessons', { schema: { tags, summary: 'Earn + learn lessons' } }, async (req) =>
    listLessons(ctx, requireUser(req)),
  );
  app.get(
    '/lessons/:lessonId',
    {
      schema: {
        tags,
        summary: 'Lesson content and quiz',
        params: z.object({ lessonId: z.string().max(60) }),
      },
    },
    async (req) => getLessonDTO(ctx, requireUser(req), req.params.lessonId),
  );
  app.post(
    '/lessons/:lessonId/submit',
    {
      schema: {
        tags,
        summary: 'Submit quiz answers',
        params: z.object({ lessonId: z.string().max(60) }),
        body: lessonSubmitSchema,
      },
    },
    async (req) => submitLesson(ctx, requireActiveUser(req), req.params.lessonId, req.body.answers),
  );

  /* rewarded video */
  app.get(
    '/ads/next',
    { schema: { tags, summary: 'Next rewarded video (honest reward shown)' } },
    async (req) => nextAd(ctx, requireUser(req)),
  );
  app.post(
    '/ads/sessions',
    { schema: { tags, summary: 'Start a video session', body: adSessionCreateSchema } },
    async (req) =>
      createAdSession(ctx, requireActiveUser(req), req.client, req.body.creativeId, req.body.takeover),
  );
  app.post(
    '/ads/sessions/:id/events',
    { schema: { tags, summary: 'Report a playback event', params: id, body: adEventSchema } },
    async (req) => recordAdEvent(ctx, requireActiveUser(req), req.client, req.params.id, req.body),
  );
  app.post(
    '/ads/sessions/:id/complete',
    { schema: { tags, summary: 'Finish a video session (server verifies the event chain)', params: id } },
    async (req) => completeAdSession(ctx, requireActiveUser(req), req.client, req.params.id),
  );
  app.get(
    '/ads/sessions/:id',
    { schema: { tags, summary: 'Video session status', params: id } },
    async (req) => getAdSession(ctx, requireUser(req), req.params.id),
  );

  /* missing credit */
  app.get('/claims', { schema: { tags, summary: 'Your missing-credit claims' } }, async (req) =>
    listClaims(ctx, requireUser(req).id),
  );
  app.get('/claims/:id', { schema: { tags, summary: 'Claim with timeline', params: id } }, async (req) =>
    getClaimDTO(ctx, req.params.id, requireUser(req).id),
  );
  app.post(
    '/claims',
    { schema: { tags, summary: 'File a missing-credit claim', body: claimCreateSchema } },
    async (req) => {
      const claimId = await createClaim(ctx, requireUser(req), req.body);
      return getClaimDTO(ctx, claimId, requireUser(req).id);
    },
  );
  app.post(
    '/claims/:id/screenshot',
    { schema: { tags, summary: 'Attach a screenshot to a claim (multipart)', params: id } },
    async (req) => {
      const user = requireUser(req);
      const owned = await ctx.db
        .select({ id: claims.id })
        .from(claims)
        .where(and(eq(claims.id, req.params.id), eq(claims.userId, user.id)));
      if (!owned[0]) throw notFound('Claim');
      const file = await req.file();
      if (!file) throw notFound('File');
      const stored = await storeUpload(ctx, await file.toBuffer(), file.mimetype, 'claims');
      await ctx.db.update(claims).set({ screenshotPath: stored }).where(eq(claims.id, req.params.id));
      return getClaimDTO(ctx, req.params.id, user.id);
    },
  );
};
