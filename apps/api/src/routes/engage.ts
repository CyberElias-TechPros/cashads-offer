import QRCode from 'qrcode';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireActiveUser, requireUser } from '../http/auth';
import {
  claimStreak,
  getStreak,
  leaderboard,
  listAchievements,
  tierProgress,
} from '../modules/engagement/service';
import { getReferralDTO } from '../modules/referrals/service';
import { getUser } from '../modules/users/service';
import { publicBaseUrl } from './util';

export const engageRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;
  const tags = ['engagement'];

  app.get(
    '/streak',
    { schema: { tags, summary: 'Daily streak (resets at your local midnight)' } },
    async (req) => getStreak(ctx, requireUser(req)),
  );
  app.post('/streak/claim', { schema: { tags, summary: 'Claim today’s streak bonus' } }, async (req) => {
    const user = requireActiveUser(req);
    const res = await claimStreak(ctx, user);
    return { ...res, streak: await getStreak(ctx, user) };
  });
  app.get('/achievements', { schema: { tags, summary: 'Badges' } }, async (req) =>
    listAchievements(ctx.db, requireUser(req).id),
  );
  app.get('/tier', { schema: { tags, summary: 'Trust tier progress' } }, async (req) =>
    tierProgress(ctx, ctx.db, await getUser(ctx.db, requireUser(req).id)),
  );
  app.get(
    '/leaderboard',
    { schema: { tags, summary: 'This week’s leaderboard (opt-in names)' } },
    async (req) => leaderboard(ctx, requireUser(req)),
  );
  app.get('/referrals', { schema: { tags, summary: 'Your referral link and stats' } }, async (req) =>
    getReferralDTO(ctx, requireUser(req), publicBaseUrl(req)),
  );
  app.get(
    '/referrals/qr.svg',
    { schema: { tags, summary: 'Referral QR code (SVG)' } },
    async (req, reply) => {
      const user = requireUser(req);
      const svg = await QRCode.toString(`${publicBaseUrl(req)}/r/${user.referralCode}`, {
        type: 'svg',
        margin: 1,
        width: 240,
        color: { dark: '#0f172a', light: '#ffffff' },
      });
      return reply
        .header('content-type', 'image/svg+xml')
        .header('cache-control', 'private, max-age=3600')
        .send(svg);
    },
  );
};
