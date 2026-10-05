import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { usd } from '@lucrum/shared';
import { auditLogs, offerClicks, offers, users } from '../src/db/schema';
import { SYS, postTransaction, userAccountCode } from '../src/modules/wallet/ledger';
import { invalidateStatsCache } from '../src/modules/transparency/service';
import {
  Client,
  type TestEnv,
  completeOffer,
  createTestEnv,
  makeAdmin,
  offerByKey,
  registerUser,
  verifyEmailFor,
} from './helpers';

let env: TestEnv;
let admin: Awaited<ReturnType<typeof registerUser>>;
beforeAll(async () => {
  env = await createTestEnv();
  admin = await registerUser(env);
  await makeAdmin(env, admin.user.id, 'admin');
});
afterAll(async () => env.close());

describe('staff access control', () => {
  it('blocks members from every admin endpoint', async () => {
    const { client } = await registerUser(env);
    for (const url of [
      '/api/admin/overview',
      '/api/admin/users',
      '/api/admin/payouts',
      '/api/admin/settings',
      '/api/admin/audit',
    ]) {
      expect((await client.get(url)).status).toBe(403);
    }
    expect((await new Client(env.app).get('/api/admin/overview')).status).toBe(401);
  });

  it('gives support staff the queues but not money/settings powers', async () => {
    const support = await registerUser(env);
    await makeAdmin(env, support.user.id, 'support');
    expect((await support.client.get('/api/admin/overview')).status).toBe(200);
    expect((await support.client.get('/api/admin/fraud')).status).toBe(200);
    expect(
      (
        await support.client.post(`/api/admin/users/${support.user.id}/adjust`, {
          amountMicros: usd(5),
          reason: 'please',
        })
      ).status,
    ).toBe(403);
    expect((await support.client.req('PATCH', '/api/admin/settings', { revenueShareBps: 9000 })).status).toBe(
      403,
    );
  });
});

describe('restrictions & appeals', () => {
  it('requires a specific reason, shows it to the member, and lets a human lift it on appeal', async () => {
    const member = await registerUser(env);
    const noReason = await admin.client.post(`/api/admin/users/${member.user.id}/ban`, {
      reasonCode: 'multi_account',
      message: 'short',
    });
    expect(noReason.status).toBe(400);
    await admin.client.post(`/api/admin/users/${member.user.id}/ban`, {
      reasonCode: 'multi_account',
      message: 'Two accounts cashed out to the same bank account ending 6789.',
    });
    // The ban signed the member out; they sign back in to see why and appeal.
    const again = new Client(env.app);
    await again.post('/api/auth/login', { email: member.email, password: 'correct-horse-42' });
    const me = (await again.get('/api/auth/me')).body.user;
    expect(me.status).toBe('banned');
    expect(me.restriction.title).toBe('Multiple accounts');
    expect(me.restriction.message).toMatch(/ending 6789/);
    const appeal = await again.post('/api/support/appeal', {
      message: 'That is my sister’s account — we share a bank account. Happy to verify ID.',
    });
    expect(appeal.body.category).toBe('appeal');
    const lifted = await admin.client.post(`/api/admin/tickets/${appeal.body.id}/reply`, {
      message: 'Thanks — verified, restriction lifted.',
      status: 'resolved',
      appealDecision: 'lift',
    });
    expect(lifted.status).toBe(200);
    expect((await again.get('/api/auth/me')).body.user.status).toBe('active');
    const trail = await env.ctx.db.select().from(auditLogs).where(eq(auditLogs.targetId, member.user.id));
    expect(trail.map((a) => a.action)).toEqual(expect.arrayContaining(['user.ban', 'user.appeal_lifted']));
  });

  it('audits balance adjustments', async () => {
    const member = await registerUser(env);
    const res = await admin.client.post(`/api/admin/users/${member.user.id}/adjust`, {
      amountMicros: usd(1.5),
      reason: 'Goodwill for support delay',
    });
    expect(res.body.balanceMicros).toBe(usd(1.5));
    const trail = await env.ctx.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'user.adjust_balance'));
    expect(trail.length).toBeGreaterThan(0);
  });
});

describe('settings & moderation', () => {
  it('validates and audits settings changes', async () => {
    const bad = await admin.client.req('PATCH', '/api/admin/settings', {
      autoApproveMaxFraudScore: 80,
      blockMinFraudScore: 70,
    });
    expect(bad.status).toBe(400);
    const ok = await admin.client.req('PATCH', '/api/admin/settings', { revenueShareBps: 6500 });
    expect(ok.body.settings.revenueShareBps).toBe(6500);
    expect((await new Client(env.app).get('/api/public/config')).body.revenueSharePercent).toBe(65);
    await admin.client.req('PATCH', '/api/admin/settings', { revenueShareBps: 6000 });
  });

  it('moves confirmed scams to the Wall of Shame and thanks the reporters', async () => {
    const member = await registerUser(env);
    const offer = await offerByKey(env, 'sgn-greenbox');
    await member.client.post(`/api/offers/${offer.id}/start`);
    expect(
      (
        await member.client.post(`/api/offers/${offer.id}/report`, {
          reason: 'scam',
          details: 'Asked for card details',
        })
      ).status,
    ).toBe(200);
    await admin.client.post(`/api/admin/offers/${offer.id}/status`, {
      status: 'scam',
      reason: 'Collected card details under a newsletter pretext',
    });
    const wall = (await new Client(env.app).get('/api/public/wall-of-shame')).body as { title: string }[];
    expect(wall.some((w) => w.title === offer.title)).toBe(true);
    const notes = (await member.client.get('/api/notifications')).body.items as { type: string }[];
    expect(notes.some((n) => n.type === 'report_actioned')).toBe(true);
    await env.ctx.db.update(offers).set({ status: 'active' }).where(eq(offers.id, offer.id));
  });

  it('auto-pauses an offer after several severe member reports', async () => {
    const offer = await offerByKey(env, 'svy-food-quick');
    for (let i = 0; i < 3; i++) {
      const m = await registerUser(env);
      await m.client.post(`/api/offers/${offer.id}/start`);
      await m.client.post(`/api/offers/${offer.id}/report`, { reason: 'hidden_charges' });
    }
    expect((await offerByKey(env, 'svy-food-quick')).status).toBe('paused');
    await env.ctx.db.update(offers).set({ status: 'active' }).where(eq(offers.id, offer.id));
  });
});

describe('transparency (computed from real data, never scripted)', () => {
  it('reflects real payouts in stats and the live feed', async () => {
    const { client, user, email } = await registerUser(env);
    await verifyEmailFor(env, client, email);
    await env.ctx.db
      .update(users)
      .set({
        displayName: 'Ada O.',
        prefs: { ...(await client.get('/api/auth/me')).body.user.prefs, showOnPayoutWall: true },
      })
      .where(eq(users.id, user.id));
    await postTransaction(env.ctx.db, {
      type: 'admin_adjustment',
      userId: user.id,
      idempotencyKey: `fund-feed-${user.id}`,
      description: 'fund',
      entries: [
        { account: SYS.adjustments, direction: 'debit', amount: usd(1) },
        { account: userAccountCode(user.id), direction: 'credit', amount: usd(1) },
      ],
    });
    invalidateStatsCache();
    const before = (await new Client(env.app).get('/api/public/stats')).body;
    const p = await client.post('/api/payouts', {
      methodId: 'ng_airtime',
      amountMicros: usd(0.4),
      details: { network: 'mtn', phone: '08039990000' },
      idempotencyKey: 'feed-key-0001',
    });
    expect(p.status).toBe(200);
    await env.drain();
    invalidateStatsCache();
    const after = (await new Client(env.app).get('/api/public/stats')).body;
    expect(after.payoutsCompleted).toBe(before.payoutsCompleted + 1);
    expect(after.totalPaidOutMicros).toBe(before.totalPaidOutMicros + usd(0.4));
    const feed = (await new Client(env.app).get('/api/public/feed')).body as {
      name: string;
      amountMicros: number;
    }[];
    expect(feed[0]).toMatchObject({ name: 'Ada O.', amountMicros: usd(0.4) });
  });

  it('measures postback success rate and the revenue share actually paid', async () => {
    const { client } = await registerUser(env);
    await completeOffer(env, client, 'svy-streaming');
    invalidateStatsCache();
    const stats = (await new Client(env.app).get('/api/public/stats')).body;
    expect(stats.postbackSuccessRate).toBeGreaterThan(0);
    expect(stats.actualShareBps30d).toBe(6000);
  });

  it('shows payout-provider outages on the status page', async () => {
    env.ctx.settings.override({ sandboxProviderOutages: { paypal: true } });
    const status = (await new Client(env.app).get('/api/public/status')).body.components as {
      id: string;
      status: string;
    }[];
    expect(status.find((c) => c.id === 'payout_paypal')?.status).toBe('outage');
    env.ctx.settings.override({ sandboxProviderOutages: {} });
  });

  it('serves admin overview, analytics and postback logs', async () => {
    const overview = (await admin.client.get('/api/admin/overview')).body;
    expect(overview.series).toHaveLength(14);
    expect(overview.users.total).toBeGreaterThan(0);
    const analytics = (await admin.client.get('/api/admin/analytics?days=30')).body;
    expect(analytics.networkRevenueMicros).toBeGreaterThan(0);
    expect(analytics.contributionMicros).toBe(
      analytics.networkRevenueMicros -
        analytics.memberShareMicros -
        analytics.bonusesMicros -
        analytics.goodwillMicros -
        analytics.reversalLossMicros,
    );
    const logs = (await admin.client.get('/api/admin/postbacks')).body as unknown[];
    expect(logs.length).toBeGreaterThan(0);
    const clicks = await env.ctx.db.select().from(offerClicks).limit(1);
    expect(clicks.length).toBe(1);
  });
});
