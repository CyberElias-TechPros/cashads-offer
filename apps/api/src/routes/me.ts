import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { deleteAccountSchema, updatePrefsSchema, updateProfileSchema } from '@lucrum/shared';
import { z } from 'zod';
import { notifications, users } from '../db/schema';
import { clearSessionCookie, requireUser } from '../http/auth';
import { deleteAccount, exportUserData, toMeDTO, updatePrefs, updateProfile } from '../modules/users/service';
import { openEventStream } from './util';

export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;
  const tags = ['me'];

  app.patch(
    '/me/profile',
    { schema: { tags, summary: 'Update profile', body: updateProfileSchema } },
    async (req) => {
      const user = await updateProfile(ctx, requireUser(req), req.body);
      return { user: await toMeDTO(ctx, ctx.db, user) };
    },
  );

  app.patch(
    '/me/prefs',
    {
      schema: {
        tags,
        summary: 'Update preferences (data-saver, privacy, charity…)',
        body: updatePrefsSchema,
      },
    },
    async (req) => {
      const user = await updatePrefs(ctx, requireUser(req), req.body);
      return { user: await toMeDTO(ctx, ctx.db, user) };
    },
  );

  app.post(
    '/me/onboarding/complete',
    { schema: { tags, summary: 'Mark onboarding as seen' } },
    async (req) => {
      const u = requireUser(req);
      const [user] = await ctx.db
        .update(users)
        .set({ onboardingDoneAt: new Date() })
        .where(eq(users.id, u.id))
        .returning();
      return { user: await toMeDTO(ctx, ctx.db, user!) };
    },
  );

  app.get(
    '/me/export',
    { schema: { tags, summary: 'Download all your data (JSON)' } },
    async (req, reply) => {
      const data = await exportUserData(ctx, requireUser(req));
      return reply
        .header('content-type', 'application/json; charset=utf-8')
        .header(
          'content-disposition',
          `attachment; filename="lucrum-data-${new Date().toISOString().slice(0, 10)}.json"`,
        )
        .send(JSON.stringify(data, null, 2));
    },
  );

  app.post(
    '/me/delete',
    {
      schema: {
        tags,
        summary: 'Delete account (PII erased, ledger retained anonymously)',
        body: deleteAccountSchema,
      },
    },
    async (req, reply) => {
      await deleteAccount(ctx, requireUser(req), req.body.password, req.client.ip);
      clearSessionCookie(reply, ctx.config.COOKIE_SECURE);
      return { ok: true };
    },
  );

  /* notifications */

  app.get(
    '/notifications',
    {
      schema: {
        tags,
        summary: 'Notification feed',
        querystring: z.object({
          before: z.iso.datetime().optional(),
          limit: z.coerce.number().int().min(1).max(50).default(30),
        }),
      },
    },
    async (req) => {
      const user = requireUser(req);
      const conds = [eq(notifications.userId, user.id)];
      if (req.query.before) conds.push(lt(notifications.createdAt, new Date(req.query.before)));
      const rows = await ctx.db
        .select()
        .from(notifications)
        .where(and(...conds))
        .orderBy(desc(notifications.createdAt))
        .limit(req.query.limit);
      const unread = await ctx.db
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
      return {
        unread: unread.length,
        items: rows.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          link: n.link,
          readAt: n.readAt?.toISOString() ?? null,
          createdAt: n.createdAt.toISOString(),
        })),
      };
    },
  );

  app.post(
    '/notifications/read',
    {
      schema: {
        tags,
        summary: 'Mark notifications as read',
        body: z.object({ ids: z.array(z.uuid()).max(200).optional(), all: z.boolean().optional() }),
      },
    },
    async (req) => {
      const user = requireUser(req);
      const conds = [eq(notifications.userId, user.id), isNull(notifications.readAt)];
      if (!req.body.all) {
        if (!req.body.ids?.length) return { ok: true };
        conds.push(inArray(notifications.id, req.body.ids));
      }
      await ctx.db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(and(...conds));
      return { ok: true };
    },
  );

  /** Real-time stream: balance changes, rewards, payouts, claims, notifications. */
  app.get('/events/stream', { schema: { hide: true } }, async (req, reply) => {
    const user = requireUser(req);
    openEventStream(req, reply, (send) => ctx.events.subscribeUser(user.id, send));
  });
};
