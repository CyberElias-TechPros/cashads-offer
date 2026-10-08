import { boostStartSchema } from '@lucrum/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireActiveUser, requireUser } from '../http/auth';
import { getBoostStatus, startBoostAdSession } from '../modules/boosts/service';

export const boostRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;
  const tags = ['boosts'];

  /** The member's earning-rate boosts and today's effective video cap. */
  app.get(
    '/boosts',
    { schema: { tags, summary: 'Earning-rate boost status (ad-funded + referral)' } },
    async (req) => getBoostStatus(ctx, requireUser(req)),
  );

  /**
   * Starts a boost video. Watch it to the end and the session's SSV reward unlocks
   * extra daily video slots. With `networkId` (native app) the video is a real
   * partner-network ad — the monetization; without it, the in-app player is used.
   */
  app.post(
    '/boosts/ad/start',
    {
      schema: {
        tags,
        summary: 'Start a boost video (watch to unlock extra daily earning slots)',
        body: boostStartSchema,
      },
    },
    async (req) => startBoostAdSession(ctx, requireActiveUser(req), req.client, req.body.networkId),
  );
};
