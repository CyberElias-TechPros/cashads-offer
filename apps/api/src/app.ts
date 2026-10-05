import crypto from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { dayKey } from '@cashads/shared';
import { eq } from 'drizzle-orm';
import type { AppContext } from './context';
import { sessions, userActivityDays, users } from './db/schema';
import { AppError } from './lib/errors';
import { clock } from './lib/clock';
import { sessionToken, usedBearer } from './http/plumbing';
import { resolveSession } from './modules/auth/service';
import { authRoutes } from './routes/auth';
import { accountRoutes } from './routes/account';
import { earnRoutes } from './routes/earn';
import { payoutRoutes } from './routes/payouts';
import { publicRoutes } from './routes/public';
import { adminRoutes } from './routes/admin';

const S2S_PREFIXES = ['/api/postback/', '/api/ssv/'];

export async function buildApp(ctx: AppContext, opts: { logger?: boolean | object } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: true,
    bodyLimit: 1024 * 1024,
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(cookie);
  await app.register(helmet, {
    // JSON API: no HTML to protect with CSP; framing is controlled by the web app.
    contentSecurityPolicy: false,
    frameguard: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  if (ctx.config.RATE_LIMIT_ENABLED) await app.register(rateLimit, {
    global: true,
    max: 900,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (_req, c) => ({
      statusCode: 429,
      error: { code: 'rate_limited', message: `Too many requests — try again in ${Math.ceil(c.ttl / 1000)}s` },
    }),
  });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10 } });

  // Partners often POST postbacks as form data.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (req) => {
    const token = sessionToken(req);
    if (token) {
      const row = await resolveSession(ctx, token);
      if (row) {
        req.auth = { user: row.user, session: row.session };
        // Sliding session + daily-active tracking, at most every 5 minutes.
        if (clock.ms() - row.session.lastSeenAt.getTime() > 5 * 60_000) {
          const now = clock.now();
          void Promise.all([
            ctx.db.update(sessions).set({ lastSeenAt: now, ip: req.ip }).where(eq(sessions.id, row.session.id)),
            ctx.db.update(users).set({ lastSeenAt: now }).where(eq(users.id, row.user.id)),
            ctx.db.insert(userActivityDays).values({ userId: row.user.id, day: dayKey(now) }).onConflictDoNothing(),
          ]).catch((err) => ctx.log.warn({ err }, 'session touch failed'));
        }
      }
    }
    // CSRF: browsers can't add custom headers to cross-site form posts, and
    // cross-origin fetches with them are blocked by CORS (we send no CORS headers).
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS' && !S2S_PREFIXES.some((p) => req.url.startsWith(p)) && !usedBearer(req)) {
      const xrw = req.headers['x-requested-with'];
      const site = req.headers['sec-fetch-site'];
      if (xrw !== 'cashads' || site === 'cross-site' || site === 'same-site') {
        throw new AppError(403, 'csrf', 'Request blocked by CSRF protection — please refresh the page');
      }
    }
  });

  app.setErrorHandler((err, req, reply) => {
    const e = err as Error & { statusCode?: number; code?: string; validation?: unknown };
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details, requestId: req.id } });
    }
    if (e.statusCode === 429) {
      return reply.code(429).send({ error: { code: 'rate_limited', message: e.message || 'Too many requests', requestId: req.id } });
    }
    if (e.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ error: { code: 'file_too_large', message: 'Files must be under 5 MB', requestId: req.id } });
    }
    if (e.statusCode && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: { code: e.code ?? 'bad_request', message: e.message, requestId: req.id } });
    }
    req.log.error({ err }, 'unhandled error');
    ctx.log.error({ err, url: req.url }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'internal', message: 'Something went wrong on our side. It has been logged — please try again.', requestId: req.id } });
  });

  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: { code: 'not_found', message: `No route for ${req.method} ${req.url}` } }));

  await app.register(async (r) => publicRoutes(r, ctx));
  await app.register(async (r) => authRoutes(r, ctx));
  await app.register(async (r) => accountRoutes(r, ctx));
  await app.register(async (r) => earnRoutes(r, ctx));
  await app.register(async (r) => payoutRoutes(r, ctx));
  await app.register(async (r) => adminRoutes(r, ctx));

  return app;
}
