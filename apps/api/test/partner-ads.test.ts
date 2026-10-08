import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { splitByBps } from '@lucrum/shared';
import { adCreatives, adSessions, networks } from '../src/db/schema';
import { encrypt } from '../src/lib/crypto';
import { ssvSign } from '../src/modules/networks/adapters';
import { syncNetworkCatalog } from '../src/modules/networks/service';
import { type TestEnv, balance, createTestEnv, registerUser } from './helpers';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => env.close());

const APPLOVIN_SECRET = 'applovin-ssv-secret';
const SDK_KEY = 'AL-SDK-KEY';
const AD_UNIT = 'al-rewarded-123';

async function upsertNetwork(values: typeof networks.$inferInsert) {
  await env.ctx.db.delete(networks).where(eq(networks.id, values.id));
  await env.ctx.db.insert(networks).values(values);
}

async function upsertPartnerCreative(networkId: string, status: 'active' | 'paused' = 'active') {
  await env.ctx.db.delete(adCreatives).where(eq(adCreatives.id, `partner-${networkId}`));
  await env.ctx.db.insert(adCreatives).values({
    id: `partner-${networkId}`,
    networkId,
    advertiser: 'AppLovin MAX',
    title: 'AppLovin MAX video',
    tagline: 'Watch a short video and earn.',
    durationSeconds: 30,
    revenueMicros: 50_000,
    lite: true,
    theme: { from: '#0f172a', to: '#020617', accent: '#10b981', emoji: '▶️' },
    status,
  });
}

describe('partner rewarded video (native SDK networks)', () => {
  beforeAll(async () => {
    await upsertNetwork({
      id: 'applovin',
      name: 'AppLovin MAX',
      adapter: 'pangle_ssv',
      kind: 'ads',
      status: 'active',
      secretEnc: encrypt(APPLOVIN_SECRET),
      config: {
        catalog: true,
        categories: ['video'],
        regions: [],
        ssv: true,
        sdkKeyEnc: encrypt(SDK_KEY),
        adUnitIdEnc: encrypt(AD_UNIT),
      },
    });
    await upsertNetwork({
      id: 'admob',
      name: 'Google AdMob',
      adapter: 'hmacurl',
      kind: 'ads',
      status: 'active',
      secretEnc: encrypt('x'),
      config: { catalog: true, ssv: true, policyRestricted: true },
    });
    await upsertPartnerCreative('applovin');
  });

  it('lists partner video networks with SDK credentials and an honest reward; hides policy-restricted networks', async () => {
    const { client } = await registerUser(env, { country: 'NG' });
    const res = await client.get('/api/ads/networks');
    expect(res.status).toBe(200);
    const list = res.body.networks as {
      id: string;
      rewardMicros: number;
      sdk: { appId: string | null; sdkKey: string | null; adUnitId: string | null };
    }[];
    const applovin = list.find((n) => n.id === 'applovin');
    expect(applovin).toBeDefined();
    expect(applovin!.rewardMicros).toBe(splitByBps(50_000, env.ctx.settings.get().revenueShareBps).share);
    expect(applovin!.sdk.sdkKey).toBe(SDK_KEY); // decrypted for the native SDK
    expect(applovin!.sdk.adUnitId).toBe(AD_UNIT);
    expect(list.some((n) => n.id === 'admob')).toBe(false); // policy-restricted
  });

  it('runs the full native flow: session → SDK reward → verifying → signed SSV → ledger credit', async () => {
    const { client, user } = await registerUser(env, { country: 'NG' });

    // 1. Server creates the session (honest pre-set reward).
    const start = await client.post('/api/ads/partner-sessions', { networkId: 'applovin' });
    expect(start.status).toBe(200);
    const ps = start.body as {
      session: { id: string; status: string; rewardMicros: number };
      transId: string;
      networkId: string;
    };
    expect(ps.networkId).toBe('applovin');
    expect(ps.transId).toBeTruthy();
    expect(ps.transId).not.toBe(user.id); // opaque session token, never the raw user id
    expect(ps.session.rewardMicros).toBe(30_000);
    expect(ps.session.status).toBe('created');

    // 2. The native SDK "finishes" the video — client-side signal only marks verifying.
    const done = await client.post(`/api/ads/partner-sessions/${ps.session.id}/native-complete`);
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('verifying');
    expect(await balance(client)).toBe(0); // nothing credited yet — SSV has not arrived

    // 3. The network's signed SSV callback arrives (simulated in sandbox for the
    //    session's own network, echoing the transId as user_id like the native flow).
    await env.drain();
    const session = (await env.ctx.db.select().from(adSessions).where(eq(adSessions.id, ps.session.id)))[0];
    expect(session?.status).toBe('rewarded');
    // Ad rewards carry no first-task bonus (kind = 'ad') and no combo at level 0.
    expect(await balance(client)).toBe(30_000);
  });

  it('rejects SSV callbacks with bad signatures and unknown sessions', async () => {
    const bad = await env.app.inject({
      method: 'GET',
      url: `/api/ssv/applovin?trans_id=nope&user_id=nope&sign=${'0'.repeat(64)}`,
    });
    expect(bad.statusCode).toBe(200);
    expect(bad.json()).toEqual({ isValid: false });

    const unknown = await env.app.inject({
      method: 'GET',
      url: `/api/ssv/applovin?trans_id=unknown-txn&user_id=unknown-txn&sign=${ssvSign(APPLOVIN_SECRET, 'unknown-txn')}`,
    });
    expect(unknown.json()).toEqual({ isValid: false });
  });

  it('refuses partner sessions for policy-restricted networks and for non-partner sessions', async () => {
    const { client } = await registerUser(env, { country: 'NG' });
    const admob = await client.post('/api/ads/partner-sessions', { networkId: 'admob' });
    expect(admob.status).toBe(400);
    expect(admob.body.error.code).toBe('NETWORK_UNAVAILABLE');

    // A regular (web-player) session must not be completable through the native endpoint.
    const creative = (await env.ctx.db.select().from(adCreatives)).find(
      (c) => c.status === 'active' && !c.id.startsWith('partner-'),
    );
    expect(creative).toBeDefined();
    const s = await client.post('/api/ads/sessions', { creativeId: creative!.id });
    expect(s.status).toBe(200);
    const native = await client.post(`/api/ads/partner-sessions/${s.body.id}/native-complete`);
    expect(native.status).toBe(400);
    expect(native.body.error.code).toBe('NOT_A_PARTNER_SESSION');
  });

  it('catalog sync creates partner creatives that follow the network status', async () => {
    process.env.LUCRUM_NET_APPLOVIN_SSV_SECRET = 'synced-secret';
    process.env.LUCRUM_NET_APPLOVIN_AD_UNIT_ID = 'synced-unit';
    try {
      await syncNetworkCatalog(env.ctx);
      const rows = await env.ctx.db.select().from(adCreatives);
      const applovinCreative = rows.find((c) => c.id === 'partner-applovin');
      expect(applovinCreative?.status).toBe('active'); // network active → creative active
      expect(applovinCreative?.revenueMicros).toBe(50_000); // default estimate
      const vungleCreative = rows.find((c) => c.id === 'partner-vungle');
      expect(vungleCreative?.status).toBe('paused'); // network paused (no env) → creative paused
      // Policy-restricted networks never get a partner creative.
      expect(rows.some((c) => c.id === 'partner-admob')).toBe(false);
    } finally {
      delete process.env.LUCRUM_NET_APPLOVIN_SSV_SECRET;
      delete process.env.LUCRUM_NET_APPLOVIN_AD_UNIT_ID;
    }
  });
});
