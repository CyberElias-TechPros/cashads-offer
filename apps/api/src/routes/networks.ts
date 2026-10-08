import { interruptedSessionSchema } from '@lucrum/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireActiveUser, requireUser } from '../http/auth';
import {
  listAdsNetworksForUser,
  listNetworksForUser,
  logInterruptedSession,
  openWallSession,
} from '../modules/networks/service';

export const networkRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;
  const tags = ['networks'];
  const params = z.object({ networkId: z.string().max(40) });

  /** Connected task walls & survey networks available to the member (geo-filtered). */
  app.get(
    '/networks',
    { schema: { tags, summary: 'Connected task walls & survey networks available to you' } },
    async (req) => ({ networks: await listNetworksForUser(ctx, requireUser(req)) }),
  );

  /** Partner rewarded-video networks available on this device (native SDK, SSV-verified). */
  app.get(
    '/ads/networks',
    { schema: { tags, summary: 'Partner rewarded-video networks available on this device' } },
    async (req) => ({ networks: await listAdsNetworksForUser(ctx, requireUser(req)) }),
  );

  /**
   * Opens a tracked wall session and returns the signed wall URL. The URL carries an
   * opaque session token (never the raw user id); the network's postbacks resolve
   * back through `wall_sessions`.
   */
  app.post(
    '/networks/:networkId/wall',
    {
      schema: {
        tags,
        summary: 'Open a tracked wall session (signed URL, iframe or external)',
        params,
      },
    },
    async (req) => openWallSession(ctx, requireActiveUser(req), req.params.networkId, req.client),
  );

  /** The member's connection dropped mid-task — log it for support & claims. */
  app.post(
    '/networks/sessions/interrupted',
    {
      schema: {
        tags,
        summary: 'Report a wall session interrupted by a connection drop',
        body: interruptedSessionSchema,
      },
    },
    async (req) => logInterruptedSession(ctx, requireUser(req), req.body),
  );
};
