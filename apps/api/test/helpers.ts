import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Settings } from '@cashads/shared';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import type { AppContext } from '../src/context';
import { createDatabase } from '../src/db/client';
import { offers, outboundMessages, users } from '../src/db/schema';
import { configureEncryption } from '../src/lib/crypto';
import { ensureSystemData } from '../src/seed';

export interface TestEnv {
  app: FastifyInstance;
  ctx: AppContext;
  close: () => Promise<void>;
  /** Run every due background job (outbox), repeatedly until the queue is drained. */
  drain: (opts?: { now?: Date }) => Promise<number>;
}

export async function createTestEnv(settings: Partial<Settings> = {}): Promise<TestEnv> {
  const config = loadConfig({
    NODE_ENV: 'test',
    SANDBOX_MODE: 'true',
    WORKER_ENABLED: 'false',
    SEED_DEMO: 'false',
    API_DOCS: 'false',
    COOKIE_SECURE: 'false',
    UPLOAD_DIR: `.data/test-uploads-${process.pid}`,
  });
  configureEncryption(undefined, true);
  const database = await createDatabase({ inMemory: true });
  await database.migrate();
  const { app, ctx } = await buildApp(config, database);
  await ensureSystemData(ctx);
  await ctx.settings.load(ctx.db);
  ctx.settings.override({ sandboxPostbackDelayMs: 0, ...settings });
  await app.ready();
  const drain = async (opts: { now?: Date } = {}) => {
    let total = 0;
    for (let i = 0; i < 20; i++) {
      const n = await ctx.jobs.runDue(ctx, opts);
      total += n;
      if (n === 0) break;
    }
    return total;
  };
  return {
    app,
    ctx,
    drain,
    close: async () => {
      await app.close();
      await database.close();
    },
  };
}

let counter = 0;

/** A browser-like client: keeps the session cookie, sends the CSRF header and a device id. */
export class Client {
  cookie = '';
  constructor(
    private readonly app: FastifyInstance,
    public deviceId = `test-device-${++counter}-${Math.random().toString(36).slice(2, 8)}`,
    public ip = `102.89.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
  ) {}

  async req<T = any>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ) {
    const res = await this.app.inject({
      method,
      url,
      payload: body === undefined ? undefined : (body as never),
      remoteAddress: this.ip,
      headers: {
        'x-requested-with': 'cashads',
        'x-device-id': this.deviceId,
        'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile',
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...extraHeaders,
      },
    });
    const setCookie = res.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    for (const c of cookies) {
      const [pair] = c.split(';');
      if (pair?.startsWith('ca_session=')) this.cookie = pair.endsWith('=') ? '' : pair;
    }
    let json: T;
    try {
      json = JSON.parse(res.body) as T;
    } catch {
      json = res.body as unknown as T;
    }
    return { status: res.statusCode, body: json, raw: res };
  }

  get<T = any>(url: string) {
    return this.req<T>('GET', url);
  }
  post<T = any>(url: string, body?: unknown) {
    return this.req<T>('POST', url, body ?? {});
  }
}

export const PASSWORD = 'correct-horse-42';

export async function registerUser(
  env: TestEnv,
  opts: { email?: string; country?: string; referralCode?: string; client?: Client } = {},
) {
  const client = opts.client ?? new Client(env.app);
  const email = opts.email ?? `member${++counter}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const res = await client.post('/api/auth/register', {
    email,
    password: PASSWORD,
    country: opts.country ?? 'NG',
    acceptTerms: true,
    confirmAdult: true,
    ...(opts.referralCode ? { referralCode: opts.referralCode } : {}),
  });
  if (res.status !== 200) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { client, email, user: res.body.user as { id: string; referralCode: string } };
}

export async function verifyEmailFor(env: TestEnv, client: Client, email: string): Promise<void> {
  const msg = (
    await env.ctx.db
      .select()
      .from(outboundMessages)
      .where(and(eq(outboundMessages.to, email), eq(outboundMessages.channel, 'email')))
      .orderBy(desc(outboundMessages.createdAt))
  ).find((m) => (m.meta as { kind?: string } | null)?.kind === 'email_verify');
  const token = String((msg?.meta as { link: string }).link).split('token=')[1]!;
  const res = await client.post('/api/auth/verify-email', { token });
  if (res.status !== 200) throw new Error(`verify failed: ${JSON.stringify(res.body)}`);
}

export async function makeAdmin(
  env: TestEnv,
  userId: string,
  role: 'admin' | 'support' | 'finance' = 'admin',
) {
  await env.ctx.db.update(users).set({ role }).where(eq(users.id, userId));
}

export async function offerByKey(env: TestEnv, key: string) {
  return (await env.ctx.db.select().from(offers).where(eq(offers.networkOfferId, key)))[0]!;
}

/** Start an offer and complete it on the sandbox network, then process the outbox. */
export async function completeOffer(env: TestEnv, client: Client, offerKey: string, mode = 'deliver') {
  const offer = await offerByKey(env, offerKey);
  const start = await client.post(`/api/offers/${offer.id}/start`);
  if (start.status !== 200) throw new Error(`start failed: ${JSON.stringify(start.body)}`);
  const done = await client.post(`/api/sandbox/clicks/${start.body.clickId}/complete`, { mode });
  if (done.status !== 200) throw new Error(`complete failed: ${JSON.stringify(done.body)}`);
  await env.drain();
  return { clickId: start.body.clickId as string, offer };
}

export async function balance(client: Client): Promise<number> {
  return (await client.get('/api/wallet')).body.availableMicros as number;
}
