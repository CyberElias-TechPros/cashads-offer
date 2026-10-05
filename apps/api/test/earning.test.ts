import { desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { usd } from '@lucrum/shared';
import { conversions, fraudFlags, offers, postbackLogs, referrals, users } from '../src/db/schema';
import { getNetworkSecret, microsToDecimal, sandboxSign } from '../src/modules/networks/adapters';
import { balancesMatchEntries, ledgerIsBalanced } from '../src/modules/wallet/ledger';
import {
  Client,
  type TestEnv,
  balance,
  completeOffer,
  createTestEnv,
  offerByKey,
  registerUser,
} from './helpers';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => env.close());

async function sendPostback(params: Record<string, string>, corrupt = false) {
  const secret = (await getNetworkSecret(env.ctx.db, 'sandboxnet'))!;
  const p = { ts: String(Math.floor(Date.now() / 1000)), ...params };
  const sig = corrupt ? 'f'.repeat(64) : sandboxSign(p, secret);
  return env.app.inject({
    method: 'GET',
    url: `/api/postback/sandboxnet?${new URLSearchParams({ ...p, sig }).toString()}`,
  });
}

describe('offerwall', () => {
  it('shows only offers available in the member’s country, with real hourly rates', async () => {
    const ng = await registerUser(env, { country: 'NG' });
    const us = await registerUser(env, { country: 'US' });
    const ngOffers = (await ng.client.get('/api/offers')).body as {
      title: string;
      hourlyRateMicros: number;
      userPayoutMicros: number;
      effectiveMinutes: number;
    }[];
    const usOffers = (await us.client.get('/api/offers')).body as { title: string }[];
    expect(ngOffers.some((o) => o.title.includes('SandboxBank'))).toBe(false); // US-only
    expect(usOffers.some((o) => o.title.includes('SandboxBank'))).toBe(true);
    expect(ngOffers.some((o) => o.title.includes('SandboxPay'))).toBe(true); // NG-only
    for (const o of ngOffers)
      expect(o.hourlyRateMicros).toBe(Math.round((o.userPayoutMicros * 60) / o.effectiveMinutes));
    const sorted = [...ngOffers].map((o) => o.hourlyRateMicros);
    expect(sorted).toEqual([...sorted].sort((a, b) => b - a)); // default sort: best $/hr first
  });

  it('never lists removed or scam offers', async () => {
    const { client } = await registerUser(env);
    const titles = ((await client.get('/api/offers')).body as { title: string }[]).map((o) => o.title);
    expect(titles.some((t) => t.includes('VIP unlock'))).toBe(false);
    expect(titles.some((t) => t.includes('SpamDealz'))).toBe(false);
  });

  it('filters quick tasks and data-saver friendly offers', async () => {
    const { client } = await registerUser(env);
    const quick = (await client.get('/api/offers?category=quick')).body as { effectiveMinutes: number }[];
    expect(quick.length).toBeGreaterThan(0);
    expect(quick.every((o) => o.effectiveMinutes <= 2)).toBe(true);
    const lite = (await client.get('/api/offers?lite=true')).body as { isLite: boolean; dataMb: number }[];
    expect(lite.every((o) => o.isLite || o.dataMb <= 5)).toBe(true);
  });
});

describe('postback pipeline', () => {
  it('credits a completed offer at the published 60% revenue share, plus the first-task bonus once', async () => {
    const { client } = await registerUser(env);
    const offer = await offerByKey(env, 'svy-shopping-2026');
    await completeOffer(env, client, 'svy-shopping-2026');
    const firstTask = env.ctx.settings.get().firstTaskBonusMicros;
    expect(await balance(client)).toBe(Math.floor(offer.payoutMicros * 0.6) + firstTask);
    await completeOffer(env, client, 'svy-streaming');
    const streaming = await offerByKey(env, 'svy-streaming');
    expect(await balance(client)).toBe(
      Math.floor(offer.payoutMicros * 0.6) + Math.floor(streaming.payoutMicros * 0.6) + firstTask,
    );
  });

  it('credits exactly once when the network sends duplicate postbacks', async () => {
    const { client } = await registerUser(env);
    const { clickId, offer } = await completeOffer(env, client, 'svy-fitness', 'duplicate');
    const convs = await env.ctx.db.select().from(conversions).where(eq(conversions.clickId, clickId));
    expect(convs).toHaveLength(1);
    const logs = await env.ctx.db.select().from(postbackLogs).where(eq(postbackLogs.clickId, clickId));
    expect(logs.map((l) => l.status).sort()).toEqual(['duplicate', 'processed']);
    expect(await balance(client)).toBe(
      Math.floor(offer.payoutMicros * 0.6) + env.ctx.settings.get().firstTaskBonusMicros,
    );
  });

  it('rejects forged signatures, unknown clicks, stale timestamps — and logs every attempt', async () => {
    const { client, user } = await registerUser(env);
    const offer = await offerByKey(env, 'svy-smb');
    const start = await client.post(`/api/offers/${offer.id}/start`);
    const base = {
      click_id: start.body.clickId,
      user_id: user.id,
      offer_id: offer.networkOfferId,
      txn_id: 'FORGED-1',
      payout: '4.000000',
      status: '1',
    };
    expect((await sendPostback(base, true)).statusCode).toBe(403);
    expect(
      (await sendPostback({ ...base, click_id: '00000000-0000-4000-8000-000000000000', txn_id: 'X-2' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await sendPostback({ ...base, txn_id: 'STALE', ts: String(Math.floor(Date.now() / 1000) - 3600) }))
        .statusCode,
    ).toBe(400);
    expect(await balance(client)).toBe(0);
    const logs = await env.ctx.db.select().from(postbackLogs).orderBy(desc(postbackLogs.createdAt)).limit(3);
    expect(logs.map((l) => l.errorCode).sort()).toEqual(['bad_signature', 'stale', 'unknown_click']);
  });

  it('parses decimal payouts exactly (no float drift)', async () => {
    const { client, user } = await registerUser(env);
    const offer = await offerByKey(env, 'qk-store-hours');
    const start = await client.post(`/api/offers/${offer.id}/start`);
    const res = await sendPostback({
      click_id: start.body.clickId,
      user_id: user.id,
      offer_id: offer.networkOfferId,
      txn_id: 'DEC-1',
      payout: microsToDecimal(333_333),
      status: '1',
    });
    expect(res.statusCode).toBe(200);
    const [conv] = await env.ctx.db.select().from(conversions).where(eq(conversions.networkTxnId, 'DEC-1'));
    expect(conv!.payoutMicros).toBe(333_333);
    expect(conv!.userAmountMicros + conv!.platformAmountMicros).toBe(333_333);
  });

  it('absorbs advertiser reversals by default (member balance untouched)', async () => {
    const { client } = await registerUser(env);
    const { clickId } = await completeOffer(env, client, 'sgn-jobbridge');
    const before = await balance(client);
    expect((await client.post(`/api/sandbox/clicks/${clickId}/reverse`)).status).toBe(200);
    await env.drain();
    expect(await balance(client)).toBe(before);
    const [conv] = await env.ctx.db.select().from(conversions).where(eq(conversions.clickId, clickId));
    expect(conv!.status).toBe('reversed');
    const notes = (await client.get('/api/notifications')).body.items as { type: string }[];
    expect(notes.some((n) => n.type === 'reversal_absorbed')).toBe(true);
  });

  it('claws back reversals when policy is set to clawback', async () => {
    env.ctx.settings.override({ reversalPolicy: 'clawback' });
    const { client } = await registerUser(env);
    const { clickId, offer } = await completeOffer(env, client, 'sgn-clouddrive');
    const before = await balance(client);
    await client.post(`/api/sandbox/clicks/${clickId}/reverse`);
    await env.drain();
    expect(await balance(client)).toBe(before - Math.floor(offer.payoutMicros * 0.6));
    env.ctx.settings.override({ reversalPolicy: 'absorb' });
  });

  it('pays screen-out compensation on surveys', async () => {
    const { client } = await registerUser(env);
    const { clickId } = await completeOffer(env, client, 'svy-mobile-money', 'screenout');
    const [conv] = await env.ctx.db.select().from(conversions).where(eq(conversions.clickId, clickId));
    expect(conv!.kind).toBe('screenout');
    expect(conv!.userAmountMicros).toBeGreaterThan(0);
  });

  it('replays stored postbacks idempotently from the admin console', async () => {
    const { client } = await registerUser(env);
    const { clickId } = await completeOffer(env, client, 'svy-ad-concepts');
    const [log] = await env.ctx.db.select().from(postbackLogs).where(eq(postbackLogs.clickId, clickId));
    const before = await balance(client);
    const { replayPostback } = await import('../src/modules/postbacks/service');
    const res = await replayPostback(env.ctx, log!.id);
    expect(res.outcome).toBe('duplicate');
    expect(await balance(client)).toBe(before);
  });
});

describe('referrals & fraud', () => {
  it('pays both sides when the friend completes their first task, then 10% residuals paid by Lucrum', async () => {
    const referrer = await registerUser(env);
    const friend = await registerUser(env, { referralCode: referrer.user.referralCode });
    const s = env.ctx.settings.get();
    const offer = await offerByKey(env, 'svy-streaming');
    await completeOffer(env, friend.client, 'svy-streaming');
    const friendShare = Math.floor(offer.payoutMicros * 0.6);
    expect(await balance(friend.client)).toBe(friendShare + s.firstTaskBonusMicros + s.referralBonusMicros);
    expect(await balance(referrer.client)).toBe(
      s.referralBonusMicros + Math.floor((friendShare * s.referralResidualBps) / 10_000),
    );
    const [ref] = await env.ctx.db.select().from(referrals).where(eq(referrals.refereeId, friend.user.id));
    expect(ref!.status).toBe('qualified');
  });

  it('rejects self-referrals from the same device and flags both accounts', async () => {
    const referrer = await registerUser(env);
    const sameDevice = new Client(env.app, referrer.client.deviceId);
    const friend = await registerUser(env, { referralCode: referrer.user.referralCode, client: sameDevice });
    const [ref] = await env.ctx.db.select().from(referrals).where(eq(referrals.refereeId, friend.user.id));
    expect(ref!.status).toBe('rejected');
    const flags = await env.ctx.db.select().from(fraudFlags).where(eq(fraudFlags.userId, friend.user.id));
    expect(flags.map((f) => f.type)).toEqual(
      expect.arrayContaining(['shared_device', 'referral_self_dealing']),
    );
  });

  it('flags disposable emails and pauses earning once the score crosses the block line', async () => {
    const { client, user } = await registerUser(env, { email: `x${Date.now()}@mailinator.com` });
    const flags = await env.ctx.db.select().from(fraudFlags).where(eq(fraudFlags.userId, user.id));
    expect(flags.map((f) => f.type)).toContain('disposable_email');
    const { recordSignal } = await import('../src/modules/fraud/service');
    await recordSignal(env.ctx, env.ctx.db, user.id, 'shared_payout_destination', {});
    await recordSignal(env.ctx, env.ctx.db, user.id, 'datacenter_ip', {});
    const [row] = await env.ctx.db.select().from(users).where(eq(users.id, user.id));
    expect(row!.fraudScore).toBeGreaterThanOrEqual(61);
    expect(row!.status).toBe('restricted');
    const offer = await offerByKey(env, 'svy-streaming');
    const blocked = await client.post(`/api/offers/${offer.id}/start`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ACCOUNT_RESTRICTED');
    const me = (await client.get('/api/auth/me')).body.user;
    expect(me.restriction.title).toBe('Security review in progress');
  });

  it('leaves the ledger balanced after all of the above', async () => {
    expect((await ledgerIsBalanced(env.ctx.db)).ok).toBe(true);
    expect(await balancesMatchEntries(env.ctx.db)).toBe(true);
  });
});

describe('engagement', () => {
  it('pays the daily streak once per local day', async () => {
    const { client } = await registerUser(env);
    const first = await client.post('/api/streak/claim');
    expect(first.status).toBe(200);
    expect(first.body.rewardMicros).toBe(env.ctx.settings.get().streakBaseMicros);
    expect((await client.post('/api/streak/claim')).body.error.code).toBe('ALREADY_CLAIMED');
  });

  it('builds a varied daily plan within the time budget and pays a bonus when finished', async () => {
    const { client } = await registerUser(env);
    const plan = (await client.get('/api/plan')).body;
    expect(plan.items.length).toBeGreaterThan(0);
    expect(plan.totalMinutes).toBeLessThanOrEqual(16);
    const categories = plan.items.map((i: { offer: { category: string } }) => i.offer.category);
    expect(new Set(categories).size).toBe(categories.length);
    for (const item of plan.items) {
      const offer = (await env.ctx.db.select().from(offers).where(eq(offers.id, item.offer.id)))[0]!;
      await completeOffer(env, client, offer.networkOfferId);
    }
    const after = (await client.get('/api/plan')).body;
    expect(after.completed).toBe(true);
    expect(after.bonusPaid).toBe(true);
    const txns = (await client.get('/api/wallet/transactions?limit=50')).body.items as { type: string }[];
    expect(txns.some((t) => t.type === 'bonus_plan')).toBe(true);
  });

  it('unlocks achievements from real activity', async () => {
    const { client } = await registerUser(env);
    await completeOffer(env, client, 'svy-food-quick');
    const list = (await client.get('/api/achievements')).body as {
      code: string;
      unlockedAt: string | null;
    }[];
    expect(list.find((a) => a.code === 'first_task')?.unlockedAt).not.toBeNull();
    expect(usd(1)).toBe(1_000_000);
  });
});
