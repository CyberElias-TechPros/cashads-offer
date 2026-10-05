import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { BRAND, type PublicConfigDTO, countrySchema, ticketCreateSchema } from '@lucrum/shared';
import { z } from 'zod';
import { createTicket } from '../modules/support/service';
import {
  networkList,
  offersPreview,
  publicFeed,
  publicStats,
  systemStatus,
  wallOfShame,
} from '../modules/transparency/service';
import { openEventStream } from './util';

export const publicRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;
  const tags = ['public'];

  app.get(
    '/config',
    { schema: { tags, summary: 'Public configuration (sandbox flag, revenue share, FX rates)' } },
    async (): Promise<PublicConfigDTO> => {
      const s = ctx.settings.get();
      return {
        sandbox: ctx.config.SANDBOX_MODE,
        revenueSharePercent: s.revenueShareBps / 100,
        fxRates: s.fxRates,
        brand: {
          name: BRAND.name,
          tagline: BRAND.tagline,
          community: { discord: 'https://discord.gg/lucrum', telegram: 'https://t.me/lucrum' },
        },
        referralBonusMicros: s.referralBonusMicros,
        referralResidualPercent: s.referralResidualBps / 100,
      };
    },
  );

  app.get('/stats', { schema: { tags, summary: 'Live transparency metrics' } }, async () => publicStats(ctx));

  app.get(
    '/feed',
    {
      schema: {
        tags,
        summary: 'Recent completed payouts (anonymised)',
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }),
      },
    },
    async (req) => publicFeed(ctx, req.query.limit),
  );

  app.get('/feed/stream', { schema: { hide: true } }, async (req, reply) => {
    openEventStream(req, reply, (send) => ctx.events.subscribePublic(send));
  });

  app.get(
    '/offers-preview',
    {
      schema: {
        tags,
        summary: 'Best-paying offers for a country (logged out)',
        querystring: z.object({ country: countrySchema.default('NG') }),
      },
    },
    async (req) => offersPreview(ctx, req.query.country),
  );

  app.get(
    '/wall-of-shame',
    { schema: { tags, summary: 'Offers removed after confirmed member reports' } },
    async () => wallOfShame(ctx),
  );
  app.get('/networks', { schema: { tags, summary: 'Network postback reliability' } }, async () =>
    networkList(ctx),
  );
  app.get('/status', { schema: { tags, summary: 'System status by component' } }, async () => ({
    components: await systemStatus(ctx),
    updatedAt: new Date().toISOString(),
  }));

  app.post(
    '/contact',
    {
      schema: { tags, summary: 'Contact support without an account', body: ticketCreateSchema },
      config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
    },
    async (req) => createTicket(ctx, req.auth?.user ?? null, req.body),
  );
};
