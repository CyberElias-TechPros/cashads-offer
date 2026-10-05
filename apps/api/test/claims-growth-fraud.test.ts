import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { claims, fraudCases, payouts, referrals, riskSignals, transactions, users } from '../src/db/schema';
import { clock, DAY } from '../src/lib/clock';
import { signHmacSorted } from '../src/modules/postbacks/adapters';
import { accountBalance, acct } from '../src/modules/wallet/ledger';
import { withUow } from '../src/context';
import { creditUser } from '../src/modules/rewards/service';
import { completeSandboxOffer, createTestEnv, expectLedgerHealthy, runAllJobsNow, settle, signupUser, wallet, type TestEnv } from './helpers';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => env.close());

async function makeAdmin() {
  const { agent, userId } = await signupUser(env);
  await env.ctx.db.update(users).set({ role: 'admin' }).where(eq(users.id, userId));
  return agent;
}

describe('missing-credit claims', () => {
  it('auto-approves when the partner confirms a conversion whose postback was lost — and never double-pays', async () => {
    const { agent } = await signupUser(env);
    const { clickId, done } = await completeSandboxOffer(env, agent, 'svy-travel');
    expect(done.body.dropped).toBe(true);
    expect((await wallet(env, agent)).availableMicros).toBe(0);

    const claim = await agent.post('/api/claims', { clickId, completedAt: new Date().toISOString(), note: 'Finished it!' });
    expect(claim.status).toBe(201);
    await settle(env);
    const c = await agent.get(`/api/claims/${claim.body.id}`);
    expect(c.body.status).toBe('auto_approved');
    const w = await wallet(env, agent);
    expect(w.availableMicros).toBe(960_000 + 500_000 + 100_000);

    // The partner's postback finally shows up — must not pay again.
    const params = { click_id: clickId, tx_id: 'LATE-1', payout: '1.6000', status: '1' };
    const res = await env.app.inject({ method: 'GET', url: `/api/postback/demo?${new URLSearchParams({ ...params, sig: signHmacSorted(params, env.sandboxSecret) })}` });
    expect(res.body).toBe('1');
    expect((await wallet(env, agent)).availableMicros).toBe(w.availableMicros);
    await expectLedgerHealthy(env);
  });

  it('sends unverifiable claims to a human; approval pays from goodwill; a late partner payment recovers it', async () => {
    const { agent } = await signupUser(env);
    const offerId = env.offerIds.get('svy-carrier')!;
    const start = await agent.post(`/api/offers/${offerId}/start`);
    const claim = await agent.post('/api/claims', { clickId: start.body.clickId, completedAt: new Date().toISOString() });
    await settle(env);
    expect((await agent.get(`/api/claims/${claim.body.id}`)).body.status).toBe('in_review');

    const goodwillBefore = await accountBalance(env.ctx.db, acct.goodwill);
    const admin = await makeAdmin();
    const decide = await admin.post(`/api/admin/claims/${claim.body.id}/decide`, { decision: 'approve', reason: 'Screenshot shows completion — paying now.' });
    expect(decide.status).toBe(200);
    expect((await agent.get(`/api/claims/${claim.body.id}`)).body.status).toBe('approved');
    expect(await accountBalance(env.ctx.db, acct.goodwill)).toBe(goodwillBefore - 840_000);

    const params = { click_id: start.body.clickId, tx_id: 'LATE-2', payout: '1.4000', status: '1' };
    await env.app.inject({ method: 'GET', url: `/api/postback/demo?${new URLSearchParams({ ...params, sig: signHmacSorted(params, env.sandboxSecret) })}` });
    expect(await accountBalance(env.ctx.db, acct.goodwill)).toBe(goodwillBefore);
    await expectLedgerHealthy(env);
  });

  it('proactively nudges members whose credit never arrived', async () => {
    const { agent, userId } = await signupUser(env);
    const offerId = env.offerIds.get('svy-sports')!;
    const start = await agent.post(`/api/offers/${offerId}/start`);
    await agent.post(`/api/offers/clicks/${start.body.clickId}/returned`);
    clock.freeze(Date.now() + 3 * 60 * 60 * 1000);
    await env.ctx.db.execute((await import('drizzle-orm')).sql`insert into jobs (type, payload, run_at) values ('clicks.nudge_missing', '{}', ${clock.now()})`);
    await settle(env);
    const list = await agent.get('/api/notifications');
    const nudge = list.body.find((n: { title: string }) => n.title.startsWith('Still waiting on'));
    expect(nudge?.link).toBe(`/app/claims?click=${start.body.clickId}`);
    // Only once.
    await env.ctx.db.execute((await import('drizzle-orm')).sql`insert into jobs (type, payload, run_at) values ('clicks.nudge_missing', '{}', ${clock.now()})`);
    await settle(env);
    const again = await agent.get('/api/notifications');
    expect(again.body.filter((n: { title: string }) => n.title.startsWith('Still waiting on')).length).toBe(1);
    clock.reset();
    void userId;
  });

  it('refuses claims for offers that already credited', async () => {
    const { agent } = await signupUser(env);
    const { clickId } = await completeSandboxOffer(env, agent, 'poll-coffee');
    const res = await agent.post('/api/claims', { clickId, completedAt: new Date().toISOString() });
    expect(res.status).toBe(409);
  });
});

describe('streaks, achievements & referrals', () => {
  it('grows the streak day by day and resets after a missed day', async () => {
    const { agent } = await signupUser(env);
    clock.freeze(Date.parse('2026-06-01T12:00:00Z'));
    expect((await agent.post('/api/engagement/checkin')).body).toEqual({ streak: 1, bonusMicros: 10_000 });
    expect((await agent.post('/api/engagement/checkin')).status).toBe(409);
    clock.advance(DAY);
    expect((await agent.post('/api/engagement/checkin')).body.streak).toBe(2);
    clock.advance(2 * DAY);
    expect((await agent.post('/api/engagement/checkin')).body.streak).toBe(1);
    clock.reset();
  });

  it('pays both sides of a referral after the friend’s first offer and settles commission in batches', async () => {
    const referrer = await signupUser(env);
    const code = referrer.me.user.referralCode;
    const friend = await signupUser(env, { referralCode: code });
    const [ref] = await env.ctx.db.select().from(referrals).where(eq(referrals.refereeId, friend.userId));
    expect(ref.status).toBe('pending');
    await completeSandboxOffer(env, friend.agent, 'svy-stream');
    await completeSandboxOffer(env, friend.agent, 'svy-banking');
    const [after] = await env.ctx.db.select().from(referrals).where(eq(referrals.refereeId, friend.userId));
    expect(after.status).toBe('qualified');
    expect(after.accruedMicros).toBe(72_000 + 180_000); // 10% of the friend's earnings, funded by us
    const rw = await wallet(env, referrer.agent);
    expect(rw.availableMicros).toBe(1_000_000);
    await env.ctx.db.execute((await import('drizzle-orm')).sql`insert into jobs (type, payload, run_at) values ('referrals.settle', '{}', now())`);
    await settle(env);
    expect((await wallet(env, referrer.agent)).availableMicros).toBe(1_000_000 + 252_000);
    const summary = await referrer.agent.get('/api/referrals');
    expect(summary.body.totals.qualified).toBe(1);
    await expectLedgerHealthy(env);
  });

  it('rejects self-referrals from the same device', async () => {
    const referrer = await signupUser(env);
    const friend = await signupUser(env, { referralCode: referrer.me.user.referralCode, deviceKey: referrer.agent.deviceKey });
    const [ref] = await env.ctx.db.select().from(referrals).where(eq(referrals.refereeId, friend.userId));
    expect(ref.status).toBe('rejected');
    const signals = await env.ctx.db.select().from(riskSignals).where(eq(riskSignals.userId, friend.userId));
    expect(signals.map((s) => s.code)).toEqual(expect.arrayContaining(['referral_self', 'shared_device']));
  });

  it('unlocks achievements with real bonuses', async () => {
    const { agent } = await signupUser(env);
    await completeSandboxOffer(env, agent, 'poll-snack');
    const list = await agent.get('/api/engagement/achievements');
    expect(list.body.find((a: { id: string }) => a.id === 'first_offer').unlockedAt).toBeTruthy();
    const summary = await agent.get('/api/engagement/summary');
    expect(summary.body.achievementsUnlocked).toBeGreaterThanOrEqual(1);
  });
});

describe('fraud controls', () => {
  it('routes risky accounts’ cash outs to review, and clearing the case releases them', async () => {
    const first = await signupUser(env);
    const second = await signupUser(env, { deviceKey: first.agent.deviceKey, email: 'x2@mailinator.com' });
    const [u] = await env.ctx.db.select().from(users).where(eq(users.id, second.userId));
    expect(u.riskLevel).toBe('medium');
    await withUow(env.ctx, (uow) =>
      creditUser(uow, { userId: second.userId, type: 'adjustment', description: 'funding', idempotencyKey: 'fraud-fund', amountMicros: 2_000_000, source: { account: acct.adjustments }, earning: false }),
    );
    const p = await second.agent.post('/api/payouts', { methodId: 'paypal', amountMicros: 1_000_000, destination: { email: 'x2@example.com' }, idempotencyKey: 'fraud-p1' });
    expect(p.body.status).toBe('review');
    const health = await second.agent.get('/api/me/health');
    expect(health.body.level).toBe('attention');

    const admin = await makeAdmin();
    const cases = await admin.get('/api/admin/fraud');
    const kase = cases.body.find((c: { userId: string }) => c.userId === second.userId);
    expect(kase).toBeTruthy();
    await admin.post(`/api/admin/fraud/${kase.id}/resolve`, { action: 'clear', note: 'Siblings sharing a laptop — verified by phone.' });
    await settle(env);
    const [paid] = await env.ctx.db.select().from(payouts).where(eq(payouts.id, p.body.id));
    expect(paid.status).toBe('completed');
    const [closed] = await env.ctx.db.select().from(fraudCases).where(eq(fraudCases.id, kase.id));
    expect(closed.status).toBe('cleared');
  });

  it('banned members can still log in to see why and appeal — but cannot earn', async () => {
    const { agent, userId } = await signupUser(env);
    const admin = await makeAdmin();
    await admin.post(`/api/admin/users/${userId}/status`, { status: 'banned', reason: 'Multiple accounts on one device' });
    const me = await agent.get('/api/me');
    expect(me.body.user.status).toBe('banned');
    expect(me.body.user.statusReason).toBe('Multiple accounts on one device');
    const start = await agent.post(`/api/offers/${env.offerIds.get('svy-stream')}/start`);
    expect(start.status).toBe(403);
    const ticket = await agent.post('/api/support/tickets', { subject: 'Appeal', category: 'appeal', message: 'Please review — my brother and I share a laptop.' });
    expect(ticket.status).toBe(201);
    expect(ticket.body.messages.length).toBe(2);
  });

  it('keeps the books balanced after everything above', async () => {
    const { tb } = await expectLedgerHealthy(env);
    expect(tb.entries).toBeGreaterThan(10);
    const credited = await env.ctx.db.select().from(transactions).where(and(eq(transactions.type, 'offer')));
    expect(credited.length).toBeGreaterThan(3);
    void claims;
    void runAllJobsNow;
  });
});
