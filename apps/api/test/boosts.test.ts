import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BoostStatusDTO, BoostStartDTO } from '@lucrum/shared';
import { adCreatives, earningBoosts, networks } from '../src/db/schema';
import { encrypt } from '../src/lib/crypto';
import { type Client, type TestEnv, balance, createTestEnv, registerUser } from './helpers';

let env: TestEnv;
let cappedEnv: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
  cappedEnv = await createTestEnv({ adDailyCap: 0 }); // simulate "cap reached"
});
afterAll(async () => {
  await env.close();
  await cappedEnv.close();
});

/** Plays a session to completion with a valid event chain (fake timers). */
async function watchSession(client: Client, sessionId: string, durationSeconds: number) {
  vi.useFakeTimers({ toFake: ['Date'] });
  let now = Date.now();
  vi.setSystemTime(now);
  const ev = (type: string, mediaTime: number, quartile?: number) =>
    client.post(`/api/ads/sessions/${sessionId}/events`, {
      type,
      mediaTime,
      ...(quartile ? { quartile } : {}),
    });
  const advance = async (ms: number) => {
    now += ms;
    vi.setSystemTime(now);
  };
  await ev('loaded', 0);
  await ev('started', 0);
  for (const q of [1, 2, 3] as const) {
    await advance((durationSeconds * 250) / 1);
    await ev('quartile', (durationSeconds * q) / 4, q);
  }
  await advance(durationSeconds * 250 + 200);
  await ev('completed', durationSeconds);
  const done = await client.post(`/api/ads/sessions/${sessionId}/complete`);
  vi.useRealTimers();
  return done;
}

async function startBoost(client: Client, networkId?: string) {
  return client.post('/api/boosts/ad/start', networkId ? { networkId } : {});
}

async function boostStatus(client: Client): Promise<BoostStatusDTO> {
  return (await client.get('/api/boosts')).body;
}

describe('earning-rate boosts', () => {
  it('reports the base cap with no boosts', async () => {
    const { client } = await registerUser(env);
    const status = await boostStatus(client);
    expect(status.baseAdCap).toBe(30);
    expect(status.bonusSlots).toBe(0);
    expect(status.effectiveAdCap).toBe(30);
    expect(status.active).toEqual([]);
    expect(status.boostsRemainingToday).toBe(3);
    expect(status.slotsPerBoostAd).toBe(5);
  });

  it('ad-funded boost: a boost video bypasses the daily cap and unlocks slots on reward', async () => {
    const { client } = await registerUser(cappedEnv);

    // With the cap at 0, a normal video session is refused…
    const next = await client.get('/api/ads/next');
    expect(next.body.creative).toBeNull();
    const normal = await client.post('/api/ads/sessions', { creativeId: 'ad-sunfresh' });
    expect(normal.status).toBe(429);

    // …but a boost video is allowed.
    const started = await startBoost(client);
    expect(started.status).toBe(200);
    const boost = started.body as BoostStartDTO;
    expect(boost.kind).toBe('inline');
    expect(boost.boost.slots).toBe(5);
    expect(boost.creative).toBeDefined();
    expect(boost.session.status).toBe('created');

    // Watch it to the end; the slots unlock only when the SSV reward lands.
    const done = await watchSession(client, boost.session.id, boost.creative!.durationSeconds);
    expect(done.body.status).toBe('verifying');
    let status = await boostStatus(client);
    expect(status.bonusSlots).toBe(0); // not yet — SSV has not arrived

    await cappedEnv.drain({ now: new Date(Date.now() + 120_000) });
    status = await boostStatus(client);
    expect(status.bonusSlots).toBe(5);
    expect(status.effectiveAdCap).toBe(5); // 0 base + 5 boosted
    expect(status.videosUsedToday).toBe(1);
    expect(status.active[0]?.kind).toBe('ad');
    // The boost video still pays its honest reward.
    expect(await balance(client)).toBeGreaterThan(0);
  });

  it('limits boost videos per day', async () => {
    const { client } = await registerUser(env);
    for (let i = 0; i < 3; i++) {
      const started = await startBoost(client);
      expect(started.status).toBe(200);
      const boost = started.body as BoostStartDTO;
      const done = await watchSession(client, boost.session.id, boost.creative!.durationSeconds);
      expect(done.body.status).toBe('verifying');
      await env.drain({ now: new Date(Date.now() + 120_000) });
    }
    const fourth = await startBoost(client);
    expect(fourth.status).toBe(429);
    const status = await boostStatus(client);
    expect(status.boostsUsedToday).toBe(3);
    expect(status.boostsRemainingToday).toBe(0);
    // Slots stack up to the platform clamp (3 × 5 = 15 ≤ 30).
    expect(status.bonusSlots).toBe(15);
    expect(status.effectiveAdCap).toBe(45);
  });

  it('ad-funded boost through a native partner network grants slots the same way', async () => {
    await env.ctx.db.delete(networks).where(eq(networks.id, 'applovin'));
    await env.ctx.db.insert(networks).values({
      id: 'applovin',
      name: 'AppLovin MAX',
      adapter: 'pangle_ssv',
      kind: 'ads',
      status: 'active',
      secretEnc: encrypt('al-secret'),
      config: { catalog: true, categories: ['video'], regions: [], ssv: true },
    });
    await env.ctx.db.delete(adCreatives).where(eq(adCreatives.id, 'partner-applovin'));
    await env.ctx.db.insert(adCreatives).values({
      id: 'partner-applovin',
      networkId: 'applovin',
      advertiser: 'AppLovin MAX',
      title: 'AppLovin MAX video',
      tagline: 'Watch a short video and earn.',
      durationSeconds: 30,
      revenueMicros: 50_000,
      lite: true,
      theme: { from: '#0f172a', to: '#020617', accent: '#10b981', emoji: '▶️' },
      status: 'active',
    });

    const { client } = await registerUser(env, { country: 'NG' });
    const started = await startBoost(client, 'applovin');
    expect(started.status).toBe(200);
    const boost = started.body as BoostStartDTO;
    expect(boost.kind).toBe('partner');
    expect(boost.networkId).toBe('applovin');
    expect(boost.transId).toBeTruthy();

    const done = await client.post(`/api/ads/partner-sessions/${boost.session.id}/native-complete`);
    expect(done.body.status).toBe('verifying');
    await env.drain({ now: new Date(Date.now() + 120_000) });

    const status = await boostStatus(client);
    expect(status.bonusSlots).toBe(5);
    expect(status.active.some((b) => b.kind === 'ad')).toBe(true);
    expect(await balance(client)).toBe(30_000); // partner video reward, no first-task bonus on ads
  });

  it('referral boost: a referred friend’s first earning unlocks slots for the referrer', async () => {
    const referrer = await registerUser(env);
    const referee = await registerUser(env, { referralCode: referrer.user.referralCode });

    // The referee answers a quick poll (a non-ad earning qualifies the referral).
    const { poll } = (await referee.client.get('/api/polls/next')).body;
    await referee.client.post(`/api/polls/${poll.id}/answer`, { optionIndex: 0 });
    await env.drain();

    const status = await boostStatus(referrer.client);
    const referralBoost = status.active.find((b) => b.kind === 'referral');
    expect(referralBoost).toBeDefined();
    expect(referralBoost!.bonusSlots).toBe(10);
    expect(status.effectiveAdCap).toBe(40); // 30 base + 10 referral
    // The multi-day window is reflected in the expiry.
    const days = (new Date(referralBoost!.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6);
    expect(days).toBeLessThanOrEqual(7);
  });

  it('ignores expired boosts', async () => {
    const { client, user } = await registerUser(env);
    await env.ctx.db.insert(earningBoosts).values({
      userId: user.id,
      kind: 'ad',
      bonusSlots: 99,
      sourceRef: 'expired-session',
      expiresAt: new Date(Date.now() - 1000),
    });
    const status = await boostStatus(client);
    expect(status.bonusSlots).toBe(0);
    expect(status.effectiveAdCap).toBe(30);
  });
});
