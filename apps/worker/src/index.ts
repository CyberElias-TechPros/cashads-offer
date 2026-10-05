import { claimBatch, complete, retry } from './jobs';
import { runtime } from './runtime';

export interface Env {
  DB: D1Database;
  UPLOADS: R2Bucket;
  FRONTEND_ORIGIN?: string;
  APP_URL?: string;
  SANDBOX_MODE?: string;
  DATA_ENCRYPTION_KEY?: string;
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers ?? {}) },
  });

function cors(request: Request, env: Env): Headers {
  const headers = new Headers();
  const origin = request.headers.get('Origin');
  if (origin && (!env.FRONTEND_ORIGIN || origin === env.FRONTEND_ORIGIN)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Vary', 'Origin');
  }
  headers.set('Access-Control-Allow-Headers', 'content-type, x-requested-with, x-device-id, x-device-fp');
  headers.set('Access-Control-Allow-Methods', 'GET,HEAD,POST,PATCH,PUT,DELETE,OPTIONS');
  return headers;
}

function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  cors(request, env).forEach((value, key) => headers.set(key, value));
  return new Response(response.body, { status: response.status, headers });
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  if (url.pathname === '/api/health') {
    return json({ ok: true, service: 'lucrum-api', runtime: 'cloudflare-workers' });
  }

  if (url.pathname === '/api/ready') {
    try {
      await env.DB.prepare('SELECT 1').run();
      return json({ ok: true, database: 'd1' });
    } catch {
      return json({ ok: false, database: 'd1' }, { status: 503 });
    }
  }

  if (url.pathname === '/api/config' && request.method === 'GET') {
    return json({ brand: { name: 'Lucrum' }, sandbox: env.SANDBOX_MODE === 'true' });
  }

  return json(
    {
      error: {
        code: 'NOT_MIGRATED',
        message: 'This Lucrum API route is not yet enabled on the Cloudflare backend.',
      },
    },
    { status: 501 },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = new URL(request.url).pathname.startsWith('/api/')
      ? await handleApi(request, env)
      : json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
    return withCors(response, request, env);
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const rt = runtime(env);
    const jobs = await claimBatch(rt);
    for (const job of jobs) {
      try {
        // Route-specific handlers are registered as repositories are ported.
        // Unknown jobs are retried instead of being silently discarded.
        throw new Error(`No handler registered for job ${job.kind}`);
      } catch (error) {
        await retry(rt, job.id, error instanceof Error ? error.message : String(error));
      }
    }
    await env.DB.prepare('SELECT 1').run();
  },
};
