import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { offers, postbacks, transactions } from '../src/db/schema';
import { clock, HOUR } from '../src/lib/clock';
import { signHmacSorted } from '../src/modules/postbacks/adapters';
import { accountBalance, acct } from '../src/modules/wallet/ledger';
import { completeSandboxOffer, createTestEnv, expectLedgerHealthy, runAllJobsNow, settle, signupUser, wallet, type TestEnv } from './helpers';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => env.close());

async function sendPostback(params: Record<string, string>, secret = env.sandboxSecret) {
  const signed = { ...params, sig: signHmacSorted(params, secret) };
  const res = await env.app.inject({ method: 'GET', url: `/api/postback/demo?${new URLSearchParams(signed)}` });
  return { status: res.statusCode, body: res.body };
}

describe('offer → postback → credit', () => {
  it('credits exactly the price the member saw (60% revenue share) via a real signed HTTP postback', async () => {
    const { agent, userId } = await signupUser(env);
    const { clickId } = await completeSandboxOffer(env, agent, 'svy-stream');
    const [tx] = await env.ctx.db.select().from(transactions).where(eq(transactions.referenceId, clickId));
    expect(tx.type).toBe('offer');
    expect(tx.status).toBe('completed');
    expect(tx.amountMicros).toBe(720_000); // $1.20 × 60%
    const w = await wallet(env, agent);
    // + $0.50 welcome bonus + $0.10 "first win" achievement
    expect(w.availableMicros).toBe(720_000 + 500_000 + 100_000);
    const [pb] = await env.ctx.db.select().from(postbacks).where(eq(postbacks.clickId, clickId));
    expect(pb.status).toBe('credited');
    expect(pb.signatureValid).toBe(true);
    void userId;
    await expectLedgerHealthy(env);
  });

  it('ignores duplicate postbacks (idempotent by partner transaction id)', async () => {
    const { agent } = await signupUser(env);
    const { clickId } = await completeSandboxOffer(env, agent, 'svy-grocery');
    const before = await wallet(env, agent);
    const [pb] = await env.ctx.db.select().from(postbacks).where(eq(postbacks.clickId, clickId));
    const res = await sendPostback({ click_id: clickId, tx_id: pb.externalTxId!, payout: '0.8500', status: '1', offer_id: 'svy-grocery' });
    expect(res).toEqual({ status: 200, body: '1' });
    expect((await wallet(env, agent)).availableMicros).toBe(before.availableMicros);
  });

  it('rejects forged signatures and logs them without letting them squat the tx id', async () => {
    const { agent } = await signupUser(env);
    const offerId = env.offerIds.get('svy-sports')!;
    const { body } = await agent.post(`/api/offers/${offerId}/start`);
    const forged = await sendPostback({ click_id: body.clickId, tx_id: 'TX-REAL-1', payout: '99', status: '1' }, 'wrong-secret');
    expect(forged.status).toBe(403);
    const real = await sendPostback({ click_id: body.clickId, tx_id: 'TX-REAL-1', payout: '1.0000', status: '1' });
    expect(real.body).toBe('1');
    const rows = await env.ctx.db.select().from(postbacks).where(eq(postbacks.clickId, body.clickId));
    expect(rows.find((r) => r.status === 'credited')).toBeTruthy();
    const all = await env.ctx.db.select().from(postbacks).where(eq(postbacks.externalTxId, 'TX-REAL-1'));
    expect(all.some((r) => r.statusReason === 'invalid_signature')).toBe(true);
  });

  it('logs unknown clicks as rejected', async () => {
    const res = await sendPostback({ click_id: '7b0e9c5e-2b8e-4d55-9a49-7b1a4b3f5d11', tx_id: 'TX-UNKNOWN', payout: '1', status: '1' });
    expect(res).toEqual({ status: 200, body: '0' });
  });

  it('honours the price lock even if the partner lowers the payout later', async () => {
    const { agent } = await signupUser(env);
    const offerId = env.offerIds.get('svy-carrier')!;
    const { body } = await agent.post(`/api/offers/${offerId}/start`);
    await env.ctx.db.update(offers).set({ partnerPayoutMicros: 100_000 }).where(eq(offers.id, offerId));
    await sendPostback({ click_id: body.clickId, tx_id: 'TX-LOCK', payout: '0.1000', status: '1' });
    const [tx] = await env.ctx.db.select().from(transactions).where(eq(transactions.referenceId, body.clickId));
    expect(tx.amountMicros).toBe(840_000); // still 60% of the original $1.40
    await expectLedgerHealthy(env);
  });

  it('holds high-value credits and releases them automatically', async () => {
    const { agent } = await signupUser(env, { country: 'US' });
    clock.freeze(Date.now());
    const { clickId } = await completeSandboxOffer(env, agent, 'fin-novabank');
    let w = await wallet(env, agent);
    expect(w.pendingMicros).toBe(24_000_000);
    const [tx] = await env.ctx.db.select().from(transactions).where(eq(transactions.referenceId, clickId));
    expect(tx.status).toBe('pending');
    clock.advance(73 * HOUR);
    await runAllJobsNow(env);
    w = await wallet(env, agent);
    expect(w.pendingMicros).toBe(0);
    expect(w.availableMicros).toBeGreaterThanOrEqual(24_000_000);
    clock.reset();
    await expectLedgerHealthy(env);
  });

  it('pays milestone goals separately', async () => {
    const { agent } = await signupUser(env);
    const offerId = env.offerIds.get('game-merge')!;
    const { body } = await agent.post(`/api/offers/${offerId}/start`);
    for (const goalId of ['lvl5', 'lvl12']) await agent.post(`/api/sandbox/offers/${offerId}/complete`, { clickId: body.clickId, goalId });
    await runAllJobsNow(env);
    const txs = await env.ctx.db.select().from(transactions).where(eq(transactions.referenceId, body.clickId));
    expect(txs.map((t) => t.amountMicros).sort((a, b) => a - b)).toEqual([240_000, 1_080_000]);
    const detail = await agent.get(`/api/offers/${offerId}`);
    expect(detail.body.goals.filter((g: { credited: boolean }) => g.credited).length).toBe(2);
    expect(detail.body.myStatus).toBe('started');
  });

  it('reverses a pending credit on chargeback', async () => {
    const { agent } = await signupUser(env);
    clock.freeze(Date.now());
    const offerId = env.offerIds.get('fin-creditpath')!;
    const { body } = await agent.post(`/api/offers/${offerId}/start`);
    await sendPostback({ click_id: body.clickId, tx_id: 'TX-CB-1', payout: '8', status: '1' });
    expect((await wallet(env, agent)).pendingMicros).toBe(4_800_000);
    const res = await sendPostback({ click_id: body.clickId, tx_id: 'TX-CB-1', payout: '8', status: '2' });
    expect(res.body).toBe('1');
    expect((await wallet(env, agent)).pendingMicros).toBe(0);
    const [tx] = await env.ctx.db.select().from(transactions).where(eq(transactions.referenceId, body.clickId));
    expect(tx.status).toBe('reversed');
    clock.reset();
    await expectLedgerHealthy(env);
  });

  it('absorbs the loss when a reversed credit was already cashed out', async () => {
    const { agent } = await signupUser(env);
    const { clickId } = await completeSandboxOffer(env, agent, 'svy-banking');
    const w = await wallet(env, agent);
    const lossBefore = await accountBalance(env.ctx.db, acct.loss);
    const payout = await agent.post('/api/payouts', { methodId: 'usdc_polygon', amountMicros: w.availableMicros, destination: { address: `0x${'a'.repeat(40)}` }, idempotencyKey: 'drain-all-1' });
    expect(payout.status).toBe(201);
    await settle(env);
    const [pb] = await env.ctx.db.select().from(postbacks).where(eq(postbacks.clickId, clickId));
    await sendPostback({ click_id: clickId, tx_id: pb.externalTxId!, payout: '3', status: '2' });
    const after = await wallet(env, agent);
    expect(after.availableMicros).toBe(0);
    // The $0.10 "first cash out" achievement landed after the payout, so we recover that and absorb the rest.
    expect(await accountBalance(env.ctx.db, acct.loss)).toBe(lossBefore - 1_700_000);
    await expectLedgerHealthy(env);
  });
});
