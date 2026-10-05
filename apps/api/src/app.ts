import { existsSync } from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyError, type FastifyInstance, LogController } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { Config } from './config';
import type { AppContext } from './context';
import type { Database } from './db/client';
import { authPlugin } from './http/auth';
import { EventBus } from './lib/events';
import { AppError } from './lib/errors';
import { JobQueue } from './jobs/queue';
import { registerJobHandlers } from './jobs/handlers';
import { SettingsStore } from './modules/platform/settings';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { earnRoutes } from './routes/earn';
import { engageRoutes } from './routes/engage';
import { integrationRoutes } from './routes/integrations';
import { meRoutes } from './routes/me';
import { publicRoutes } from './routes/public';
import { sandboxRoutes } from './routes/sandbox';
import { supportRoutes } from './routes/support';
import { systemRoutes } from './routes/system';
import { walletRoutes } from './routes/wallet';

/** Routes called by third-party servers (no browser, no session) are exempt from CSRF. */
const CSRF_EXEMPT = [
  /^\/api\/postback\//,
  /^\/api\/ssv\//,
  /^\/api\/webhooks\//,
  /^\/api\/sandbox\/networks\//,
];

export async function buildApp(
  config: Config,
  database: Database,
): Promise<{ app: FastifyInstance; ctx: AppContext }> {
  const app = Fastify({
    logger: config.isTest
      ? false
      : {
          level: config.LOG_LEVEL,
          redact: ['req.headers.cookie', 'req.headers.authorization'],
          ...(config.isProd
            ? {}
            : {
                transport: {
                  target: 'pino-pretty',
                  options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
                },
              }),
        },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1_048_576,
    genReqId: () => crypto.randomUUID(),
    // Per-request access logs only in production (dev output stays readable).
    logController: new LogController({ disableRequestLogging: !config.isProd }),
  });

  const settings = new SettingsStore();
  await settings.load(database.db);
  const jobs = new JobQueue();
  registerJobHandlers(jobs);

  const ctx: AppContext = {
    config,
    db: database.db,
    engine: database.engine,
    log: app.log,
    events: new EventBus(),
    settings,
    jobs,
    now: () => new Date(),
    selfRequest: async (opts) => {
      const res = await app.inject({
        method: opts.method,
        url: opts.url,
        headers: opts.headers,
        payload: opts.payload as never,
      });
      return { statusCode: res.statusCode, body: res.body };
    },
  };
  app.decorate('ctx', ctx);

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Accept an empty JSON body (e.g. POST /offers/:id/start) instead of a 400.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = (body as string).trim();
    if (text === '') return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch {
      done(new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON'), undefined);
    }
  });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 2, fields: 20 } });
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    allowList: (req) => CSRF_EXEMPT.some((r) => r.test(req.url)) || config.isTest,
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: {
        code: 'RATE_LIMITED',
        message: `Too many requests — please wait ${Math.ceil(context.ttl / 1000)}s and try again.`,
      },
    }),
  });
  await app.register(helmet, {
    // CSP only matters for the HTML we serve in production; the dev server has its own.
    contentSecurityPolicy: config.SERVE_WEB
      ? {
          directives: {
            defaultSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'blob:'],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            connectSrc: ["'self'"],
            frameSrc: ["'self'", 'https://web.bitlabs.ai'],
            // Sandbox demos are embedded by preview tools; real deployments only allow same-origin framing.
            frameAncestors: config.SANDBOX_MODE ? ['*'] : ["'self'"],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false,
    frameguard: false,
  });

  if (config.API_DOCS) {
    await app.register(swagger, {
      openapi: {
        info: {
          title: 'CashAds API',
          version: '0.1.0',
          description:
            'Trust-first rewards wallet API. Money amounts are integer micro-dollars (1 USD = 1,000,000).',
        },
        components: { securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'ca_session' } } },
      },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: '/api/docs' });
  }

  await app.register(authPlugin);

  // CSRF defence: state-changing browser requests must carry a custom header, which
  // cross-site forms cannot send and cross-origin scripts cannot add without CORS.
  app.addHook('onRequest', async (req) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    if (!req.url.startsWith('/api/') || CSRF_EXEMPT.some((r) => r.test(req.url))) return;
    if (req.headers['x-requested-with'] !== 'cashads') {
      throw new AppError(403, 'CSRF', 'Missing request header. Please reload the page and try again.');
    }
  });

  app.addHook('onRequest', async (req) => {
    if (!ctx.settings.get().maintenanceMode) return;
    if (
      !req.url.startsWith('/api/') ||
      req.url.startsWith('/api/admin') ||
      req.url.startsWith('/api/auth') ||
      req.url.startsWith('/api/health')
    )
      return;
    if (req.method === 'GET' || CSRF_EXEMPT.some((r) => r.test(req.url))) return;
    throw new AppError(
      503,
      'MAINTENANCE',
      'CashAds is in a short maintenance window. Your balance is safe — please try again in a few minutes.',
    );
  });

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      const fields: Record<string, string> = {};
      for (const issue of err.validation) {
        const key =
          (issue.instancePath || '').replace(/^\//, '').replaceAll('/', '.') ||
          String(issue.params?.missingProperty ?? 'body');
        fields[key] = issue.message ?? 'Invalid value';
      }
      return reply.status(400).send({
        error: {
          code: 'VALIDATION',
          message: Object.values(fields)[0] ?? 'Please check the highlighted fields',
          fields,
          requestId: req.id,
        },
      });
    }
    if (err instanceof AppError) {
      return reply.status(err.status).send({
        error: {
          code: err.code,
          message: err.message,
          fields: err.fields,
          details: err.details,
          requestId: req.id,
        },
      });
    }
    const status = (err as FastifyError).statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    return reply.status(status).send({
      error: {
        code:
          status === 429
            ? 'RATE_LIMITED'
            : status >= 500
              ? 'INTERNAL'
              : ((err as FastifyError).code ?? 'ERROR'),
        message:
          status >= 500
            ? 'Something went wrong on our side. Your balance is safe — please try again.'
            : err.message,
        requestId: req.id,
      },
    });
  });

  await app.register(systemRoutes, { prefix: '/api' });
  await app.register(publicRoutes, { prefix: '/api/public' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(meRoutes, { prefix: '/api' });
  await app.register(earnRoutes, { prefix: '/api' });
  await app.register(walletRoutes, { prefix: '/api' });
  await app.register(engageRoutes, { prefix: '/api' });
  await app.register(supportRoutes, { prefix: '/api' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.register(integrationRoutes, { prefix: '/api' });
  if (config.SANDBOX_MODE) await app.register(sandboxRoutes, { prefix: '/api' });

  // Production: serve the built SPA with history-API fallback.
  const webDist = path.resolve(config.WEB_DIST_DIR);
  if (config.SERVE_WEB && existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false, maxAge: '1h', immutable: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/'))
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      if (req.url.startsWith('/assets/')) return reply.status(404).send('Not found');
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_req, reply) =>
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } }),
    );
  }

  return { app, ctx };
}
