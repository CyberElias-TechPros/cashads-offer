import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { usd } from '@lucrum/shared';
import {
  claims,
  conversions,
  offerClicks,
  payouts,
  sandboxNetworkConversions,
  users,
} from '../src/db/schema';
import {
  SYS,
  balancesMatchEntries,
  getAccountBalance,
  ledgerIsBalanced,
  postTransaction,
  userAccountCode,
} from '../src/modules/wallet/ledger';
import {
  type TestEnv,
  balance,
  completeOffer,
  createTestEnv,
  makeAdmin,
  offerByKey,
  registerUser,
  verifyEmailFor,
} from './helpers';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => env.close());

async function ageClick(clickId: string, minutes: number) {
  await env.ctx.db
    .update(offerClicks)
    .set({ startedAt: new Date(Date.now() - minutes * 60_000) })
    .where(eq(offerClicks.id, clickId));
}

async function fund(userId: string, micros: number) {
  await postTransaction(env.ctx.db, {
    type: 'admin_adjustment',
    userId,
    idempotencyKey: `fund-${userId}-${micros}-${Math.random()}`,
    description: 'test funding',
    entries: [
      { account: SYS.adjustments, direction: 'debit', amount: micros },
      { account: userAccountCode(userId), direction: 'credit', amount: micros },
    ],
  });
}

describe('missing credit', () => {
  it('asks members to wait a few minutes before claiming', async () => {
    const { client } = await registerUser(env);
    const offer = await offerByKey(env, 'svy-streaming');
    const start = await client.post(`/api/offers/${offer.id}/start`);
    const res = await client.post('/api/claims', {
      clickId: start.body.clickId,
      note: 'Finished it but no credit',
    });
    expect(res.status).toBe(425);
    expect(res.body.error.code).toBe('TOO_EARLY');
  });

  it('pays instantly when the network confirms a completion whose postback was lost — and never double-pays', async () => {
    const { client } = await registerUser(env);
    const { clickId, offer } = await completeOffer(env, client, 'svy-shopping-2026', 'drop');
    expect(await balance(client)).toBe(0);
    await ageClick(clickId, 15);
    const filed = await client.post('/api/claims', {
      clickId,
      note: 'Saw the thank-you page, nothing credited.',
    });
    expect(filed.status).toBe(200);
    await env.drain();
    const claim = (await client.get(`/api/claims/${filed.body.id}`)).body;
    expect(claim.status).toBe('approved');
    expect(claim.resolution).toBe('network_confirmed');
    const share = Math.floor(offer.payoutMicros * 0.6);
    const credited = await balance(client);
    expect(credited).toBe(share + env.ctx.settings.get().firstTaskBonusMicros);
    // The "lost" postback finally arrives: idempotent on the network txn id → no double credit.
    const { deliverSandboxPostback } = await import('../src/modules/sandbox/service');
    await deliverSandboxPostback(env.ctx, clickId);
    await env.drain();
    expect(await balance(client)).toBe(credited);
  });

  it('treats a corrupted postback as untrusted, then resolves the claim through the network API', async () => {
    const { client } = await registerUser(env);
    const { clickId } = await completeOffer(env, client, 'svy-fitness', 'bad_signature');
    expect(await balance(client)).toBe(0);
    await ageClick(clickId, 12);
    const filed = await client.post('/api/claims', { clickId, note: 'Postback never arrived.' });
    await env.drain();
    expect((await client.get(`/api/claims/${filed.body.id}`)).body.resolution).toBe('network_confirmed');
  });

  it('pays trusted (Silver+) members as goodwill even when the network has no record', async () => {
    const { client, user } = await registerUser(env);
    await env.ctx.db.update(users).set({ tier: 'silver' }).where(eq(users.id, user.id));
    const offer = await offerByKey(env, 'svy-food-quick');
    const start = await client.post(`/api/offers/${offer.id}/start`);
    await ageClick(start.body.clickId, 20);
    const filed = await client.post('/api/claims', {
      clickId: start.body.clickId,
      note: 'Completed on my phone.',
    });
    await env.drain();
    const claim = (await client.get(`/api/claims/${filed.body.id}`)).body;
    expect(claim.resolution).toBe('goodwill_auto');
    expect(await balance(client)).toBeGreaterThanOrEqual(Math.floor(offer.payoutMicros * 0.6));
    expect(await getAccountBalance(env.ctx.db, SYS.goodwillExpense)).toBeGreaterThan(0);
  });

  it('recovers goodwill (instead of double-paying) if the network pays later', async () => {
    const { client, user } = await registerUser(env);
    await env.ctx.db.update(users).set({ tier: 'gold' }).where(eq(users.id, user.id));
    const offer = await offerByKey(env, 'sgn-greenbox');
    const start = await client.post(`/api/offers/${offer.id}/start`);
    await ageClick(start.body.clickId, 20);
    await client.post('/api/claims', { clickId: start.body.clickId, note: 'Signed up, no credit.' });
    await env.drain();
    const afterGoodwill = await balance(client);
    const goodwillBefore = await getAccountBalance(env.ctx.db, SYS.goodwillExpense);
    // Days later the network finally records the conversion on its side and reports it.
    await env.ctx.db.insert(sandboxNetworkConversions).values({
      networkId: 'sandboxnet',
      clickId: start.body.clickId,
      networkTxnId: `LATE-${start.body.clickId.slice(0, 8)}`,
      userRef: user.id,
      networkOfferId: offer.networkOfferId,
      payoutMicros: offer.payoutMicros,
      deliveryMode: 'deliver',
    });
    const { deliverSandboxPostback } = await import('../src/modules/sandbox/service');
    await deliverSandboxPostback(env.ctx, start.body.clickId);
    await env.drain();
    expect(await balance(client)).toBe(afterGoodwill);
    expect(await getAccountBalance(env.ctx.db, SYS.goodwillExpense)).toBeLessThan(goodwillBefore);
  });

  it('routes Bronze claims without evidence to a human with an SLA, which staff can approve', async () => {
    const { client } = await registerUser(env);
    const offer = await offerByKey(env, 'svy-mobile-money');
    const start = await client.post(`/api/offers/${offer.id}/start`);
    await ageClick(start.body.clickId, 30);
    const filed = await client.post('/api/claims', {
      clickId: start.body.clickId,
      note: 'I really did finish it.',
    });
    await env.drain();
    expect((await client.get(`/api/claims/${filed.body.id}`)).body.status).toBe('needs_review');
    const staff = await registerUser(env);
    await makeAdmin(env, staff.user.id, 'support');
    const approved = await staff.client.post(`/api/admin/claims/${filed.body.id}/approve`, {
      note: 'Screenshot checks out.',
    });
    expect(approved.body.status).toBe('approved');
    expect(await balance(client)).toBeGreaterThan(0);
  });

  it('auto-approves small overdue claims when we miss the 24h SLA', async () => {
    const { client } = await registerUser(env);
    const offer = await offerByKey(env, 'qk-logo-pick');
    const start = await client.post(`/api/offers/${offer.id}/start`);
    await ageClick(start.body.clickId, 30);
    const filed = await client.post('/api/claims', {
      clickId: start.body.clickId,
      note: 'Picked a logo, no credit.',
    });
    await env.drain();
    await env.ctx.db
      .update(claims)
      .set({ slaDueAt: new Date(Date.now() - 60_000) })
      .where(eq(claims.id, filed.body.id));
    const { sweepClaimSla } = await import('../src/modules/claims/service');
    expect(await sweepClaimSla(env.ctx)).toBeGreaterThanOrEqual(1);
    expect((await client.get(`/api/claims/${filed.body.id}`)).body.resolution).toBe('sla_auto');
  });

  it('auto-files a claim for the member if the network still hasn’t confirmed after 72 hours', async () => {
    const { client } = await registerUser(env);
    const offer = await offerByKey(env, 'sgn-clouddrive');
    const start = await client.post(`/api/offers/${offer.id}/start`);
    await client.post(`/api/clicks/${start.body.clickId}/completed`);
    await env.drain({ now: new Date(Date.now() + 73 * 3600_000) });
    const list = (await client.get('/api/claims')).body as { status: string }[];
    expect(list).toHaveLength(1);
    const [claim] = await env.ctx.db.select().from(claims).where(eq(claims.clickId, start.body.clickId));
    expect(claim!.autoFiled).toBe(true);
  });
});

describe('cash-outs', () => {
  it('quotes fees transparently and enforces whole cents and provider floors (not ours)', async () => {
    const { client, user } = await registerUser(env, { country: 'US' });
    await fund(user.id, usd(5));
    const q = (await client.post('/api/payouts/quote', { methodId: 'paypal', amountMicros: usd(2) })).body;
    expect(q.feeMicros).toBe(usd(0.04));
    expect(q.netMicros).toBe(usd(1.96));
    expect(
      (await client.post('/api/payouts/quote', { methodId: 'paypal', amountMicros: 1_234_567 })).body
        .blockers[0],
    ).toMatch(/whole cents/);
    expect(
      (await client.post('/api/payouts/quote', { methodId: 'amazon_gc', amountMicros: usd(0.5) })).body
        .blockers[0],
    ).toMatch(/their floor, not ours/);
    expect(
      (await client.post('/api/payouts/quote', { methodId: 'ng_bank', amountMicros: usd(1) })).status,
    ).toBe(400); // not available in the US
  });

  it('requires a verified email for any cash-out, and a phone above $1', async () => {
    const { client, user, email } = await registerUser(env);
    await fund(user.id, usd(5));
    const noEmail = await client.post('/api/payouts', {
      methodId: 'ng_airtime',
      amountMicros: usd(0.5),
      details: { network: 'mtn', phone: '08031112222' },
      idempotencyKey: 'po-email-1',
    });
    expect(noEmail.body.error.code).toBe('REQUIREMENT_EMAIL');
    await verifyEmailFor(env, client, email);
    const small = await client.post('/api/payouts', {
      methodId: 'ng_airtime',
      amountMicros: usd(0.5),
      details: { network: 'mtn', phone: '08031112222' },
      idempotencyKey: 'po-small-1',
    });
    expect(small.status).toBe(200);
    const big = await client.post('/api/payouts', {
      methodId: 'ng_bank',
      amountMicros: usd(2),
      details: { bankCode: '058', accountNumber: '0123456789' },
      idempotencyKey: 'po-big-1',
    });
    expect(big.body.error.code).toBe('REQUIREMENT_PHONE');
  });

  it('completes a payout end-to-end: balance → clearing → settled, with a live timeline', async () => {
    const { client, user, email } = await registerUser(env);
    await verifyEmailFor(env, client, email);
    await fund(user.id, usd(3));
    const res = await client.post('/api/payouts', {
      methodId: 'btc_lightning',
      amountMicros: usd(0.75),
      details: { address: 'ada@walletofsatoshi.com' },
      idempotencyKey: 'payout-ln-0001',
    });
    expect(res.body.status).toBe('pending');
    expect(await balance(client)).toBe(usd(2.25));
    await env.drain();
    const done = (await client.get(`/api/payouts/${res.body.id}`)).body;
    expect(done.status).toBe('completed');
    expect(done.providerReference).toMatch(/^SBX-/);
    expect(done.events.map((e: { status: string }) => e.status)).toEqual([
      'pending',
      'processing',
      'completed',
    ]);
    // Idempotent retries return the same payout instead of paying twice.
    const again = await client.post('/api/payouts', {
      methodId: 'btc_lightning',
      amountMicros: usd(0.75),
      details: { address: 'ada@walletofsatoshi.com' },
      idempotencyKey: 'payout-ln-0001',
    });
    expect(again.body.id).toBe(res.body.id);
    expect(await balance(client)).toBe(usd(2.25));
  });

  it('prevents double-spends under concurrent requests', async () => {
    const { client, user, email } = await registerUser(env);
    await verifyEmailFor(env, client, email);
    await fund(user.id, usd(1));
    const attempt = (i: number) =>
      client.post('/api/payouts', {
        methodId: 'ng_airtime',
        amountMicros: usd(0.8),
        details: { network: 'mtn', phone: '08035556666' },
        idempotencyKey: `race-key-${i}`,
      });
    const results = await Promise.all([attempt(1), attempt(2), attempt(3)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await balance(client)).toBe(usd(0.2));
  });

  it('retries automatically through a provider outage, then refunds in full if it never recovers', async () => {
    const { client, user, email } = await registerUser(env);
    await verifyEmailFor(env, client, email);
    await fund(user.id, usd(1));
    env.ctx.settings.override({ sandboxProviderOutages: { ng_airtime: true } });
    const res = await client.post('/api/payouts', {
      methodId: 'ng_airtime',
      amountMicros: usd(0.6),
      details: { network: 'glo', phone: '08051112222' },
      idempotencyKey: 'po-outage-1',
    });
    await env.drain();
    let p = (await client.get(`/api/payouts/${res.body.id}`)).body;
    expect(p.status).toBe('processing');
    expect(p.nextAttemptAt).not.toBeNull();
    // Provider recovers → the scheduled retry succeeds.
    env.ctx.settings.override({ sandboxProviderOutages: {} });
    await env.drain({ now: new Date(Date.now() + 2 * 3600_000) });
    p = (await client.get(`/api/payouts/${res.body.id}`)).body;
    expect(p.status).toBe('completed');

    env.ctx.settings.override({ sandboxProviderOutages: { ng_airtime: true } });
    const res2 = await client.post('/api/payouts', {
      methodId: 'ng_airtime',
      amountMicros: usd(0.3),
      details: { network: 'glo', phone: '08051112222' },
      idempotencyKey: 'po-outage-2',
    });
    for (let h = 1; h <= 12; h++) await env.drain({ now: new Date(Date.now() + h * 3 * 3600_000) });
    const failed = (await client.get(`/api/payouts/${res2.body.id}`)).body;
    expect(failed.status).toBe('failed');
    expect(await balance(client)).toBe(usd(0.4)); // the failed $0.30 came back in full
    env.ctx.settings.override({ sandboxProviderOutages: {} });
  });

  it('refunds immediately on a permanent provider failure', async () => {
    const { client, user, email } = await registerUser(env);
    await verifyEmailFor(env, client, email);
    await fund(user.id, usd(1));
    const res = await client.post('/api/payouts', {
      methodId: 'usdt_polygon',
      amountMicros: usd(0.5),
      details: { address: '0x0000000000000000000000000000000000000000' },
      idempotencyKey: 'po-perm-1',
    });
    await env.drain();
    expect((await client.get(`/api/payouts/${res.body.id}`)).body.status).toBe('failed');
    expect(await balance(client)).toBe(usd(1));
  });

  it('holds payouts for review on elevated risk, with specific reasons; finance can approve or decline', async () => {
    const { client, user, email } = await registerUser(env);
    await verifyEmailFor(env, client, email);
    await fund(user.id, usd(2));
    await env.ctx.db.update(users).set({ fraudScore: 40 }).where(eq(users.id, user.id));
    const { recordSignal } = await import('../src/modules/fraud/service');
    await recordSignal(env.ctx, env.ctx.db, user.id, 'too_fast', {}, { severity: 35 });
    const res = await client.post('/api/payouts', {
      methodId: 'ng_airtime',
      amountMicros: usd(0.5),
      details: { network: 'airtel', phone: '08021234567' },
      idempotencyKey: 'po-review-1',
    });
    expect(res.body.status).toBe('review');
    expect(res.body.events.at(-1).message).toMatch(/unusually fast/);
    const finance = await registerUser(env);
    await makeAdmin(env, finance.user.id, 'finance');
    expect((await client.post(`/api/admin/payouts/${res.body.id}/approve`)).status).toBe(403); // members can't approve
    const approved = await finance.client.post(`/api/admin/payouts/${res.body.id}/approve`);
    expect(approved.body.status).toBe('pending');
    await env.drain();
    expect((await client.get(`/api/payouts/${res.body.id}`)).body.status).toBe('completed');

    const res2 = await client.post('/api/payouts', {
      methodId: 'ng_airtime',
      amountMicros: usd(0.5),
      details: { network: 'airtel', phone: '08021234567' },
      idempotencyKey: 'po-review-2',
    });
    const declined = await finance.client.post(`/api/admin/payouts/${res2.body.id}/reject`, {
      reason: 'Could not verify the phone owner',
      refund: true,
    });
    expect(declined.body.status).toBe('reversed');
    expect(await balance(client)).toBe(usd(1.5));
  });

  it('lets members cancel before sending and enforces 3 cash-outs per day', async () => {
    const { client, user, email } = await registerUser(env);
    await verifyEmailFor(env, client, email);
    await fund(user.id, usd(1));
    env.ctx.settings.override({ autoApproveMaxFraudScore: 30 });
    await env.ctx.db.update(users).set({ fraudScore: 0 }).where(eq(users.id, user.id));
    for (let i = 0; i < 3; i++) {
      const r = await client.post('/api/payouts', {
        methodId: 'btc_lightning',
        amountMicros: usd(0.05),
        details: { address: 'a@b.co' },
        idempotencyKey: `daily-key-${i}`,
      });
      expect(r.status).toBe(200);
    }
    const fourth = await client.post('/api/payouts', {
      methodId: 'btc_lightning',
      amountMicros: usd(0.05),
      details: { address: 'a@b.co' },
      idempotencyKey: 'daily-key-4',
    });
    expect(fourth.body.error.code).toBe('REQUIREMENT_LIMITS');
    const [p] = await env.ctx.db.select().from(payouts).where(eq(payouts.userId, user.id));
    const cancel = await client.post(`/api/payouts/${p!.id}/cancel`);
    expect([200, 409]).toContain(cancel.status); // 409 if the worker already sent it
  });

  it('keeps the books balanced: clearing never negative, Σdebits = Σcredits', async () => {
    expect(await getAccountBalance(env.ctx.db, SYS.payoutClearing)).toBeGreaterThanOrEqual(0);
    expect((await ledgerIsBalanced(env.ctx.db)).ok).toBe(true);
    expect(await balancesMatchEntries(env.ctx.db)).toBe(true);
    expect(
      (await env.ctx.db.select().from(conversions)).every(
        (c) => c.userAmountMicros + c.platformAmountMicros === c.payoutMicros || c.userAmountMicros === 0,
      ),
    ).toBe(true);
  });
});
