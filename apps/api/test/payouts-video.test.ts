import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { withUow } from '../src/context';
import { users } from '../src/db/schema';
import { clock } from '../src/lib/clock';
import { creditUser } from '../src/modules/rewards/service';
import { acct } from '../src/modules/wallet/ledger';
import { Agent, createTestEnv, expectLedgerHealthy, latestMessage, settle, signupUser, wallet, type TestEnv } from './helpers';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => env.close());

async function fund(userId: string, micros: number) {
  await withUow(env.ctx, (uow) =>
    creditUser(uow, { userId, type: 'adjustment', description: 'Test funding', idempotencyKey: `fund-${userId}-${micros}-${Math.random()}`, amountMicros: micros, source: { account: acct.adjustments }, earning: false }),
  );
}

async function makeAdmin() {
  const { agent, userId } = await signupUser(env);
  await env.ctx.db.update(users).set({ role: 'admin' }).where(eq(users.id, userId));
  return agent;
}

const paypal = (email = 'member@example.com') => ({ methodId: 'paypal', destination: { email } });

describe('cash outs', () => {
  it('requires a verified phone before the first cash out, then pays instantly', async () => {
    const { agent, userId, email } = await signupUser(env, { verify: false });
    await env.ctx.db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId));
    await fund(userId, 3_000_000);

    const quote = await agent.post('/api/payouts/quote', { methodId: 'paypal', amountMicros: 1_000_000 });
    expect(quote.body.feeMicros).toBe(20_000); // 2%
    expect(quote.body.netMicros).toBe(980_000);
    expect(quote.body.canSubmit).toBe(false);
    expect(quote.body.requirements.find((r: { id: string }) => r.id === 'phone_verified').met).toBe(false);

    const blocked = await agent.post('/api/payouts', { ...paypal(), amountMicros: 1_000_000, idempotencyKey: 'phone-gate-1' });
    expect(blocked.status).toBe(403);

    await agent.post('/api/me/phone/start', { phone: '+2348012345678' });
    const sms = await latestMessage(env, '+2348012345678');
    const code = /(\d{6})/.exec(sms.text)![1];
    expect((await agent.post('/api/me/phone/verify', { code })).status).toBe(200);

    const res = await agent.post('/api/payouts', { ...paypal(), amountMicros: 1_000_000, idempotencyKey: 'phone-gate-1' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    expect((await wallet(env, agent)).availableMicros).toBe(2_000_000);
    await settle(env);
    const done = await agent.get(`/api/payouts/${res.body.id}`);
    expect(done.body.status).toBe('completed');
    expect(done.body.timeline.map((t: { status: string }) => t.status)).toEqual(['requested', 'processing', 'completed']);
    expect((await wallet(env, agent)).lifetimeWithdrawnMicros).toBe(1_000_000);
    const feed = await new Agent(env.app).get('/api/public/feed');
    expect(feed.body.some((f: { id: string }) => f.id === res.body.id)).toBe(true);
    void email;
    await expectLedgerHealthy(env);
  });

  it('is idempotent: retrying the same request never pays twice', async () => {
    const { agent, userId } = await signupUser(env);
    await fund(userId, 2_000_000);
    const a = await agent.post('/api/payouts', { ...paypal('a@x.io'), amountMicros: 500_000, idempotencyKey: 'same-key-123' });
    const b = await agent.post('/api/payouts', { ...paypal('a@x.io'), amountMicros: 500_000, idempotencyKey: 'same-key-123' });
    expect(a.body.id).toBe(b.body.id);
    expect((await wallet(env, agent)).availableMicros).toBe(1_500_000);
  });

  it('has no platform minimum — only the provider limit', async () => {
    const { agent, userId } = await signupUser(env);
    await fund(userId, 50_000);
    const res = await agent.post('/api/payouts', { methodId: 'charity', amountMicros: 10_000, destination: { charity: 'givedirectly' }, idempotencyKey: 'tiny-cashout-1' });
    expect(res.status).toBe(201);
    expect(res.body.feeMicros).toBe(0);
  });

  it('refunds in full when the provider rejects the destination', async () => {
    const { agent, userId } = await signupUser(env);
    await fund(userId, 2_000_000);
    const res = await agent.post('/api/payouts', { ...paypal('please-fail@example.com'), amountMicros: 1_500_000, idempotencyKey: 'provider-fail-1' });
    await settle(env);
    const p = await agent.get(`/api/payouts/${res.body.id}`);
    expect(p.body.status).toBe('failed');
    expect((await wallet(env, agent)).availableMicros).toBe(2_000_000);
    await expectLedgerHealthy(env);
  });

  it('routes large cash outs to review; staff can approve; members can cancel', async () => {
    const { agent, userId } = await signupUser(env);
    await fund(userId, 120_000_000);
    await env.ctx.db.update(users).set({ kycStatus: 'verified' }).where(eq(users.id, userId));
    const big = await agent.post('/api/payouts', { ...paypal('big@x.io'), amountMicros: 60_000_000, idempotencyKey: 'big-review-1' });
    expect(big.body.status).toBe('review');
    const admin = await makeAdmin();
    expect((await admin.post(`/api/admin/payouts/${big.body.id}/approve`)).status).toBe(200);
    await settle(env);
    expect((await agent.get(`/api/payouts/${big.body.id}`)).body.status).toBe('completed');

    const other = await agent.post('/api/payouts', { ...paypal('big@x.io'), amountMicros: 55_000_000, idempotencyKey: 'big-review-2' });
    expect(other.body.status).toBe('review');
    const canceled = await agent.post(`/api/payouts/${other.body.id}/cancel`);
    expect(canceled.body.status).toBe('canceled');
    // 120 − 60 paid + $0.10 "first cash out" achievement; the canceled 55 is fully refunded.
    expect((await wallet(env, agent)).availableMicros).toBe(60_100_000);
    await expectLedgerHealthy(env);
  });

  it('enforces KYC above the single cash out threshold and rejects overdrafts', async () => {
    const { agent, userId } = await signupUser(env);
    await fund(userId, 150_000_000);
    const kyc = await agent.post('/api/payouts', { ...paypal('k@x.io'), amountMicros: 120_000_000, idempotencyKey: 'kyc-gate-1' });
    expect(kyc.status).toBe(403);
    expect(kyc.body.error.code).toBe('payout_requirements');
    const over = await agent.post('/api/payouts', { ...paypal('k@x.io'), amountMicros: 999_000_000, idempotencyKey: 'overdraft-1' });
    expect(over.status).toBe(400);
  });
});

describe('rewarded video', () => {
  async function watch(agent: Agent, opts: { fast?: boolean } = {}) {
    const start = await agent.post('/api/video/sessions', {});
    expect(start.status).toBe(200);
    const s = start.body;
    const d = s.creative.durationSeconds * 1000;
    const plan: Array<[string, number]> = [['loaded', 200], ['started', 500], ['q1', 500 + d * 0.25], ['mid', 500 + d * 0.5], ['q3', 500 + d * 0.75], ['completed', 500 + d]];
    let elapsed = 0;
    for (const [type, at] of plan) {
      if (!opts.fast) {
        clock.advance(at - elapsed);
        elapsed = at;
      }
      await agent.post(`/api/video/sessions/${s.id}/events`, { type, t: at });
    }
    clock.advance(300);
    return { session: s, result: await agent.post(`/api/video/sessions/${s.id}/complete`, {}) };
  }

  it('rewards a fully watched video and refuses scripted completions', async () => {
    const { agent, userId } = await signupUser(env);
    clock.freeze(Date.now());
    const fast = await watch(agent, { fast: true });
    expect(fast.result.body.rewarded).toBe(false);
    const ok = await watch(agent);
    expect(ok.result.body.rewarded).toBe(true);
    expect((await wallet(env, agent)).availableMicros).toBe(ok.session.rewardMicros);
    expect(ok.result.body.status.watchedToday).toBe(1);
    // Next one in a row earns the combo bonus.
    const next = await agent.post('/api/video/sessions', {});
    expect(next.body.comboIndex).toBe(1);
    expect(next.body.comboBonusBps).toBe(500);
    clock.reset();
    void userId;
    await expectLedgerHealthy(env);
  });

  it('lets a member earn on one device at a time (with one-tap takeover)', async () => {
    const { agent } = await signupUser(env);
    const second = new Agent(env.app);
    second.cookie = agent.cookie;
    expect((await agent.post('/api/video/sessions', {})).status).toBe(200);
    const blocked = await second.post('/api/video/sessions', {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('earning_elsewhere');
    expect((await second.post('/api/video/sessions', { takeOver: true })).status).toBe(200);
  });

  it('does not count failed ad loads against the daily cap', async () => {
    const { agent } = await signupUser(env);
    const s = await agent.post('/api/video/sessions', {});
    await agent.post(`/api/video/sessions/${s.body.id}/events`, { type: 'error', t: 100 });
    const status = await agent.get('/api/video/status');
    expect(status.body.watchedToday).toBe(0);
    expect(status.body.activeSession).toBeNull();
  });
});
