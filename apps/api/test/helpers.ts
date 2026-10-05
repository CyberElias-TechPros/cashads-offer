import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { guardDb, type AppContext } from '../src/context';
import { createDb, rowsOf, runMigrations } from '../src/db/client';
import { outboundMessages, users } from '../src/db/schema';
import { seedCatalog } from '../src/db/seed';
import { jobHandlers } from '../src/jobs/handlers';
import { Worker } from '../src/jobs/queue';
import { clock } from '../src/lib/clock';
import { Vault } from '../src/lib/crypto';
import { EventBus } from '../src/lib/events';
import { SettingsStore } from '../src/modules/settings/store';
import { reconcile, trialBalance } from '../src/modules/admin/service';

const silent = {
  level: 'silent',
  info() {},
  warn() {},
  error() {},
  debug() {},
  fatal() {},
  trace() {},
  silent() {},
  child() {
    return silent;
  },
} as unknown as FastifyBaseLogger;

export interface TestEnv {
  app: FastifyInstance;
  ctx: AppContext;
  worker: Worker;
  offerIds: Map<string, string>;
  sandboxSecret: string;
  videoSecret: string;
  close: () => Promise<void>;
}

export async function createTestEnv(): Promise<TestEnv> {
  clock.reset();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cashads-test-'));
  const config = loadConfig({ NODE_ENV: 'test', DATA_DIR: dataDir, DEMO_MODE: 'true', SEED_ON_START: 'false', WORKER_ENABLED: 'false', LOG_LEVEL: 'silent', RATE_LIMIT_ENABLED: 'false' });
  const handle = await createDb({ dataDir: ':memory:' });
  await runMigrations(handle);
  const ctx: AppContext = {
    db: guardDb(handle.db),
    driver: handle.driver,
    config,
    bus: new EventBus(),
    vault: new Vault(config.appSecret),
    log: silent,
    settings: new SettingsStore(handle.db),
  };
  await ctx.settings.load();
  await ctx.settings.update({ sandboxPayoutFailureRate: 0, videoCooldownSeconds: 0 }, null);
  const { offerIds, sandboxSecret, videoSecret } = await seedCatalog(ctx);
  const app = await buildApp(ctx);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  ctx.config.INTERNAL_API_URL = `http://127.0.0.1:${port}`;
  const worker = new Worker(ctx, jobHandlers());
  return {
    app,
    ctx,
    worker,
    offerIds,
    sandboxSecret,
    videoSecret,
    close: async () => {
      clock.reset();
      await app.close();
      await handle.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export interface Res<T = any> {
  status: number;
  body: T;
  headers: Record<string, unknown>;
}

/** Cookie-carrying client that behaves like the web app (CSRF header + device key). */
export class Agent {
  cookie = '';
  constructor(
    private readonly app: FastifyInstance,
    public deviceKey = `dev-${crypto.randomBytes(8).toString('hex')}`,
  ) {}

  async req<T = any>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<Res<T>> {
    const res = await this.app.inject({
      method,
      url,
      payload: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        'x-requested-with': 'cashads',
        'x-device-key': this.deviceKey,
        'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/130.0',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...extraHeaders,
      },
    });
    const set = res.headers['set-cookie'];
    const cookies = Array.isArray(set) ? set : set ? [set] : [];
    for (const c of cookies) {
      const m = /^ca_session=([^;]*)/.exec(String(c));
      if (m) this.cookie = m[1] ? `ca_session=${m[1]}` : '';
    }
    let parsed: unknown = res.body;
    try {
      parsed = res.json();
    } catch {
      /* text */
    }
    return { status: res.statusCode, body: parsed as T, headers: res.headers };
  }
  get<T = any>(url: string) {
    return this.req<T>('GET', url);
  }
  post<T = any>(url: string, body: unknown = {}) {
    return this.req<T>('POST', url, body);
  }
}

let counter = 0;
export async function signupUser(env: TestEnv, opts: { email?: string; country?: string; referralCode?: string; deviceKey?: string; verify?: boolean } = {}) {
  const agent = new Agent(env.app, opts.deviceKey);
  const email = opts.email ?? `user${++counter}-${crypto.randomBytes(3).toString('hex')}@example.com`;
  const res = await agent.post('/api/auth/signup', {
    email,
    password: 'CorrectHorse9!',
    displayName: 'Test Member',
    country: opts.country ?? 'US',
    timezone: 'UTC',
    referralCode: opts.referralCode ?? '',
    acceptTerms: true,
    confirmAge: true,
  });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  const userId = res.body.user.id as string;
  if (opts.verify !== false) {
    await env.ctx.db.update(users).set({ emailVerifiedAt: new Date(), phone: `+1555${Math.floor(Math.random() * 1e7)}`, phoneVerifiedAt: new Date() }).where(eq(users.id, userId));
  }
  return { agent, userId, email, me: res.body };
}

export async function latestMessage(env: TestEnv, to: string) {
  const rows = await env.ctx.db.select().from(outboundMessages).where(eq(outboundMessages.to, to));
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
}

/** Run background jobs until the queue is idle (also lets real HTTP postbacks land). */
export async function settle(env: TestEnv, rounds = 6) {
  for (let i = 0; i < rounds; i++) {
    const n = await env.worker.drain(20);
    if (n === 0) break;
  }
}

/** Make delayed jobs due now (sandbox postback delays etc.) and run them. */
export async function runAllJobsNow(env: TestEnv) {
  await env.ctx.db.execute(sql`update jobs set run_at = ${clock.now()} where status = 'queued'`);
  await settle(env);
}

export async function wallet(env: TestEnv, agent: Agent) {
  return (await agent.get('/api/wallet')).body as { availableMicros: number; pendingMicros: number; lifetimeEarnedMicros: number; lifetimeWithdrawnMicros: number };
}

export async function expectLedgerHealthy(env: TestEnv) {
  const tb = await trialBalance(env.ctx);
  const rec = await reconcile(env.ctx);
  if (!tb.balanced) throw new Error(`Ledger unbalanced: ${tb.sumMicros}`);
  if (!rec.ok) throw new Error(`Wallet cache mismatch: ${JSON.stringify(rec.mismatches)}`);
  return { tb, rec };
}

/** Complete a sandbox offer end to end like a member would. */
export async function completeSandboxOffer(env: TestEnv, agent: Agent, externalId: string, goalId?: string) {
  const offerId = env.offerIds.get(externalId)!;
  const start = await agent.post(`/api/offers/${offerId}/start`, {});
  if (start.status !== 200) throw new Error(`start failed ${start.status} ${JSON.stringify(start.body)}`);
  const clickId = start.body.clickId as string;
  const done = await agent.post(`/api/sandbox/offers/${offerId}/complete`, { clickId, goalId, answers: externalId.startsWith('learn-') ? [2, 1, 1] : undefined });
  await runAllJobsNow(env);
  return { offerId, clickId, done };
}

export { rowsOf, sql };
