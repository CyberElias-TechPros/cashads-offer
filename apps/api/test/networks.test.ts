import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { splitByBps } from '@lucrum/shared';
import { conversions, networks, wallSessions } from '../src/db/schema';
import { encrypt, hmacHex, md5 } from '../src/lib/crypto';
import { type PostbackRequest, getAdapter, hmacqCanonical } from '../src/modules/networks/adapters';
import { NETWORK_CATALOG, WALL_FRAME_HOSTS } from '../src/modules/networks/catalog';
import { syncNetworkCatalog } from '../src/modules/networks/service';
import { type TestEnv, balance, createTestEnv, registerUser } from './helpers';

let env: TestEnv;
beforeAll(async () => {
  // Clawback so the chargeback test can assert the member's balance is reclaimed.
  env = await createTestEnv({ reversalPolicy: 'clawback' });
});
afterAll(async () => env.close());

const CPX_SECRET = 'cpx-test-secret';

/** Replace any catalog-synced row with our test fixture (delete + insert). */
async function upsertNetwork(values: typeof networks.$inferInsert) {
  await env.ctx.db.delete(networks).where(eq(networks.id, values.id));
  await env.ctx.db.insert(networks).values(values);
}

/** A live CPX Research wall network (as the catalog sync would create it). */
async function insertCpxNetwork(status: 'active' | 'paused' = 'active') {
  await upsertNetwork({
    id: 'cpx-research',
    name: 'CPX Research',
    adapter: 'cpx',
    kind: 'survey_wall',
    status,
    secretEnc: encrypt(CPX_SECRET),
    config: {
      catalog: true,
      categories: ['surveys'],
      regions: ['NG', 'KE'],
      iframeUrlTemplate: 'https://cpx-research.com/surveys?app_id=APP123&ext_user_id={user_id}',
      appId: 'APP123',
    },
  });
}

async function insertTapjoyNetwork() {
  await upsertNetwork({
    id: 'tapjoy',
    name: 'Tapjoy',
    adapter: 'hmacq',
    kind: 'offerwall',
    status: 'active',
    secretEnc: encrypt('tapjoy-secret'),
    config: {
      catalog: true,
      categories: ['app_installs'],
      regions: [],
      clickUrlTemplate: 'https://www.tapjoy.com/offerwall?app_id=TJ&user_id={user_id}',
    },
  });
}

const req = (fullUrl: string): PostbackRequest => {
  const u = new URL(fullUrl);
  return {
    method: 'GET',
    url: u.pathname + u.search,
    fullUrl,
    query: Object.fromEntries(u.searchParams),
    body: null,
    headers: {},
    ip: '1.2.3.4',
  };
};

/* ── adapter dialects ──────────────────────────────────────────────────────── */

describe('network adapters (new dialects)', () => {
  it('cpx: md5(trans_id-user_id-amount-secret), status 1 = credit, 2 = reversal', () => {
    const adapter = getAdapter('cpx')!;
    const hash = md5(`TX-1-u-1-1.50-${CPX_SECRET}`);
    const url = `https://x.test/api/postback/cpx-research?status=1&trans_id=TX-1&user_id=u-1&amount=1.50&hash=${hash}`;
    expect(adapter.verify(req(url), CPX_SECRET)).toBe(true);
    expect(adapter.verify(req(url.replace('amount=1.50', 'amount=9.99')), CPX_SECRET)).toBe(false);
    expect(adapter.parse(req(url))).toMatchObject({
      networkTxnId: 'TX-1',
      userRef: 'u-1',
      payoutMicros: 1_500_000,
      status: 'credit',
    });
    expect(adapter.parse(req(url.replace('status=1', 'status=2'))).status).toBe('reversal');
    expect(adapter.respond('ok')).toEqual({ status: 200, body: '1' });
    expect(adapter.respond('invalid')).toEqual({ status: 403, body: '0' });
  });

  it('hmacq: HMAC-SHA256 over the sorted query minus sig (Tapjoy-style)', () => {
    const adapter = getAdapter('hmacq')!;
    const secret = 'tapjoy-secret';
    const params: Record<string, string> = {
      txn_id: 'TJ-9',
      user_id: 'wall-token-abc',
      amount: '0.75',
      status: '1',
      ts: String(Math.floor(Date.now() / 1000)),
    };
    const sig = hmacHex('sha256', secret, hmacqCanonical(params));
    const url = `https://x.test/p?${new URLSearchParams({ ...params, sig })}`;
    expect(adapter.verify(req(url), secret)).toBe(true);
    expect(adapter.verify(req(url.replace('amount=0.75', 'amount=7.50')), secret)).toBe(false);
    // Parameter order must not matter.
    const shuffled = `https://x.test/p?${new URLSearchParams({ sig, status: '1', amount: '0.75', user_id: 'wall-token-abc', txn_id: 'TJ-9', ts: params.ts! })}`;
    expect(adapter.verify(req(shuffled), secret)).toBe(true);
    expect(adapter.parse(req(url))).toMatchObject({
      networkTxnId: 'TJ-9',
      userRef: 'wall-token-abc',
      payoutMicros: 750_000,
      status: 'credit',
    });
  });

  it('hmacurl: AdMob-SSV-style HMAC-SHA256 over the full URL minus the signature param', () => {
    const adapter = getAdapter('hmacurl')!;
    const secret = 'admob-ssv-key';
    const network = {
      id: 'admob',
      name: 'Google AdMob',
      adapter: 'hmacurl',
      kind: 'ads',
      secretEnc: null,
      ipAllowlist: [],
      status: 'active',
      config: { hashAlgo: 'sha256', sigParam: 'signature' },
      createdAt: new Date(),
    } as unknown as typeof networks.$inferSelect;
    const base = 'https://lucrum.example/api/ssv/admob?transaction_id=TX-77&user_id=tok-1&reward_amount=0.05';
    const signature = hmacHex('sha256', secret, base);
    const url = `${base}&signature=${signature}`;
    expect(adapter.verify(req(url), secret, network)).toBe(true);
    expect(adapter.verify(req(url.replace('reward_amount=0.05', 'reward_amount=5')), secret, network)).toBe(
      false,
    );
    expect(adapter.parse(req(url))).toMatchObject({
      networkTxnId: 'TX-77',
      userRef: 'tok-1',
      payoutMicros: 50_000,
      status: 'credit',
    });
  });

  it('unsigned: static token (query or bearer) compared in constant time', () => {
    const adapter = getAdapter('unsigned')!;
    const secret = 'pollfish-token';
    const ok = req('https://x.test/p?transId=P-1&subId=tok&reward=0.10&status=1&token=pollfish-token');
    expect(adapter.verify(ok, secret)).toBe(true);
    expect(
      adapter.verify(req('https://x.test/p?transId=P-1&subId=tok&reward=0.10&token=wrong'), secret),
    ).toBe(false);
    const bearer: PostbackRequest = {
      ...req('https://x.test/p?transId=P-1&subId=tok&reward=0.10'),
      headers: { authorization: 'Bearer pollfish-token' },
    };
    expect(adapter.verify(bearer, secret)).toBe(true);
  });
});

/* ── catalog sync ──────────────────────────────────────────────────────────── */

describe('network catalog sync', () => {
  it('creates catalog networks paused (unconfigured) and activates them when env credentials appear', async () => {
    const before = (await env.ctx.db.select().from(networks)).map((n) => n.id);
    expect(before.some((id) => NETWORK_CATALOG.some((c) => c.id === id))).toBe(false);

    const first = await syncNetworkCatalog(env.ctx);
    expect(first.created).toBe(NETWORK_CATALOG.length);
    let rows = await env.ctx.db.select().from(networks);
    const cpx = rows.find((n) => n.id === 'cpx-research');
    expect(cpx?.status).toBe('paused');
    expect((cpx?.config as Record<string, unknown>).unconfigured).toBe(true);
    const lootably = rows.find((n) => n.id === 'lootably');
    expect(lootably?.status).toBe('paused');

    // Credentials appear → the unconfigured network activates on the next sync.
    process.env.LUCRUM_NET_LOOTABLY_SECRET = 'lootably-live-secret';
    try {
      const second = await syncNetworkCatalog(env.ctx);
      expect(second.activated).toBe(1);
      rows = await env.ctx.db.select().from(networks);
      const activated = rows.find((n) => n.id === 'lootably');
      expect(activated?.status).toBe('active');
      expect(activated?.secretEnc).toBeTruthy();
      expect((activated?.config as Record<string, unknown>).unconfigured).toBe(false);
    } finally {
      delete process.env.LUCRUM_NET_LOOTABLY_SECRET;
    }

    // An admin-paused network is NOT re-activated by a sync.
    await env.ctx.db.update(networks).set({ status: 'paused' }).where(eq(networks.id, 'lootably'));
    process.env.LUCRUM_NET_LOOTABLY_SECRET = 'lootably-live-secret';
    try {
      await syncNetworkCatalog(env.ctx);
      const after = (await env.ctx.db.select().from(networks)).find((n) => n.id === 'lootably');
      expect(after?.status).toBe('paused');
    } finally {
      delete process.env.LUCRUM_NET_LOOTABLY_SECRET;
    }
  });

  it('exports a CSP frame host for every embeddable wall', () => {
    expect(WALL_FRAME_HOSTS).toContain('https://web.bitlabs.ai');
    expect(WALL_FRAME_HOSTS).toContain('https://cpx-research.com');
    expect(WALL_FRAME_HOSTS).toContain('https://lootably.com');
  });
});

/* ── member-facing wall endpoints ──────────────────────────────────────────── */

describe('member wall endpoints', () => {
  beforeAll(async () => {
    await insertCpxNetwork();
    await insertTapjoyNetwork();
    await upsertNetwork({
      id: 'paused-wall',
      name: 'Paused Wall',
      adapter: 'hmacq',
      kind: 'offerwall',
      status: 'paused',
      secretEnc: encrypt('x'),
      config: { clickUrlTemplate: 'https://x.test/{user_id}' },
    });
    await upsertNetwork({
      id: 'admob',
      name: 'Google AdMob',
      adapter: 'hmacurl',
      kind: 'ads',
      status: 'active',
      secretEnc: encrypt('x'),
      config: { hashAlgo: 'sha256', sigParam: 'signature' },
    });
  });

  it('lists active wall networks, geo-filtered; hides paused and non-wall kinds', async () => {
    const ng = await registerUser(env, { country: 'NG' });
    const us = await registerUser(env, { country: 'US' });
    const ngList = (await ng.client.get('/api/networks')).body.networks as {
      id: string;
      embeddable: boolean;
    }[];
    const ids = ngList.map((n) => n.id);
    expect(ids).toContain('cpx-research');
    expect(ids).toContain('tapjoy');
    expect(ids).not.toContain('paused-wall');
    expect(ids).not.toContain('admob'); // ads networks are not walls
    expect(ngList.find((n) => n.id === 'cpx-research')?.embeddable).toBe(true);
    expect(ngList.find((n) => n.id === 'tapjoy')?.embeddable).toBe(false);

    const usList = (await us.client.get('/api/networks')).body.networks as { id: string }[];
    expect(usList.map((n) => n.id)).not.toContain('cpx-research'); // NG/KE only
    expect(usList.map((n) => n.id)).toContain('tapjoy'); // global
  });

  it('opens a tracked wall session: signed URL carries an opaque token, never the user id', async () => {
    const { client, user } = await registerUser(env, { country: 'NG' });
    const res = await client.post('/api/networks/cpx-research/wall');
    expect(res.status).toBe(200);
    const wall = res.body as {
      url: string;
      mode: string;
      sessionId: string;
      networkId: string;
    };
    expect(wall.mode).toBe('iframe');
    expect(wall.networkId).toBe('cpx-research');
    const url = new URL(wall.url);
    expect(url.searchParams.get('app_id')).toBe('APP123');
    const token = url.searchParams.get('ext_user_id')!;
    expect(token).toBeTruthy();
    expect(token).not.toBe(user.id); // opaque session token, not the raw user id
    expect(wall.url).not.toContain(user.id);

    const session = (
      await env.ctx.db.select().from(wallSessions).where(eq(wallSessions.id, wall.sessionId))
    )[0];
    expect(session?.userId).toBe(user.id);
    expect(session?.sessionToken).toBe(token);
    expect(session?.networkId).toBe('cpx-research');
  });

  it('non-embeddable walls open externally; paused walls are unavailable; geo is enforced', async () => {
    const { client } = await registerUser(env, { country: 'NG' });
    const external = (await client.post('/api/networks/tapjoy/wall')).body as { mode: string; url: string };
    expect(external.mode).toBe('external');
    expect(new URL(external.url).searchParams.get('user_id')).toBeTruthy();

    const paused = await client.post('/api/networks/paused-wall/wall');
    expect(paused.status).toBe(410);

    const us = await registerUser(env, { country: 'US' });
    const blocked = await us.client.post('/api/networks/cpx-research/wall');
    expect(blocked.status).toBe(403);
  });

  it('logs interrupted sessions for connection-drop recovery', async () => {
    const { client, user } = await registerUser(env, { country: 'NG' });
    const wall = (await client.post('/api/networks/cpx-research/wall')).body as { sessionId: string };
    const res = await client.post('/api/networks/sessions/interrupted', {
      sessionId: wall.sessionId,
      networkId: 'cpx-research',
      startedAt: new Date().toISOString(),
      networkType: 'cellular',
      reason: 'connection_lost',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const session = (
      await env.ctx.db.select().from(wallSessions).where(eq(wallSessions.id, wall.sessionId))
    )[0];
    expect(session?.status).toBe('interrupted');
    expect(session?.userId).toBe(user.id);
  });
});

/* ── full pipeline: wall session → signed postback → ledger credit ─────────── */

describe('wall postback pipeline', () => {
  it('credits a wall conversion, dedupes retries, rejects bad signatures, and reverses chargebacks', async () => {
    const { client, user } = await registerUser(env, { country: 'NG' });
    const wall = (await client.post('/api/networks/cpx-research/wall')).body as { url: string };
    const token = new URL(wall.url).searchParams.get('ext_user_id')!;
    expect(token).not.toBe(user.id);

    const sign = (params: Record<string, string>) =>
      md5(`${params.trans_id}-${params.user_id}-${params.amount}-${CPX_SECRET}`);
    const send = (params: Record<string, string>) =>
      env.app.inject({
        method: 'GET',
        url: `/api/postback/cpx-research?${new URLSearchParams({ ...params, hash: sign(params) })}`,
      });

    const credit = { status: '1', trans_id: 'CPX-1', user_id: token, amount: '1.50' };
    const res = await send(credit);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('1');
    await env.drain();

    const share = splitByBps(1_500_000, env.ctx.settings.get().revenueShareBps).share;
    const bonus = env.ctx.settings.get().firstTaskBonusMicros;
    const conv = (
      await env.ctx.db.select().from(conversions).where(eq(conversions.networkTxnId, 'CPX-1'))
    )[0];
    expect(conv?.userId).toBe(user.id);
    expect(conv?.userAmountMicros).toBe(share);
    expect(conv?.source).toBe('postback');
    expect(await balance(client)).toBe(share + bonus);

    // The wall session counted the conversion.
    const session = (
      await env.ctx.db.select().from(wallSessions).where(eq(wallSessions.sessionToken, token))
    )[0];
    expect(session?.conversions).toBe(1);

    // Retry (network redelivery) — idempotent, no double credit.
    const retry = await send(credit);
    expect(retry.statusCode).toBe(200);
    await env.drain();
    expect(await balance(client)).toBe(share + bonus);
    expect(
      (await env.ctx.db.select().from(conversions)).filter((c) => c.networkTxnId === 'CPX-1').length,
    ).toBe(1);

    // Tampered signature — rejected, no credit.
    const forged = await env.app.inject({
      method: 'GET',
      url: `/api/postback/cpx-research?${new URLSearchParams({ ...credit, trans_id: 'CPX-FRAUD', hash: '0'.repeat(32) })}`,
    });
    expect(forged.statusCode).toBe(403);

    // A postback for an unknown session token is rejected (clean '1' so the network stops retrying).
    const ghost = await env.app.inject({
      method: 'GET',
      url: `/api/postback/cpx-research?${new URLSearchParams({
        status: '1',
        trans_id: 'CPX-GHOST',
        user_id: 'not-a-real-token',
        amount: '5.00',
        hash: md5(`CPX-GHOST-not-a-real-token-5.00-${CPX_SECRET}`),
      })}`,
    });
    expect(ghost.statusCode).toBe(200);
    expect(ghost.body).toBe('1');

    // Chargeback (status=2) reverses the conversion (clawback policy in this env).
    const reversal = await send({ status: '2', trans_id: 'CPX-1', user_id: token, amount: '1.50' });
    expect(reversal.statusCode).toBe(200);
    await env.drain();
    expect(await balance(client)).toBe(bonus);
  });
});
