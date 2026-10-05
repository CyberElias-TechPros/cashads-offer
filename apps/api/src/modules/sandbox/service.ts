import { and, desc, eq } from 'drizzle-orm';
import type { AppContext } from '../../context';
import {
  adSessions,
  kycSubmissions,
  networks,
  offerClicks,
  offers,
  outboundMessages,
  sandboxNetworkConversions,
} from '../../db/schema';
import type { UserRow } from '../../http/auth';
import { decrypt, randomToken } from '../../lib/crypto';
import { AppError, conflict, notFound } from '../../lib/errors';
import { decideKyc } from '../finance/service';
import { getNetworkSecret, microsToDecimal, sandboxSign, ssvSign } from '../networks/adapters';
import { userPayoutFor } from '../rewards/service';

/**
 * The sandbox simulates the *outside world* so every flow is demonstrable without
 * real network/provider accounts:
 *   • SandboxNet — an offerwall network with its own conversion records, a signed
 *     server-to-server postback, and a conversion-status API.
 *   • SandboxAds — a rewarded-video network that verifies server-side (SSV).
 * Developer controls let you drop, duplicate or corrupt postbacks to see how the
 * platform (and Missing Credit) behaves when tracking fails.
 */

export type DeliveryMode = 'deliver' | 'drop' | 'duplicate' | 'bad_signature' | 'screenout';

export async function getSandboxClick(ctx: AppContext, user: UserRow, clickId: string) {
  const rows = await ctx.db
    .select({ click: offerClicks, offer: offers, networkName: networks.name })
    .from(offerClicks)
    .innerJoin(offers, eq(offers.id, offerClicks.offerId))
    .innerJoin(networks, eq(networks.id, offers.networkId))
    .where(and(eq(offerClicks.id, clickId), eq(offerClicks.userId, user.id)));
  const row = rows[0];
  if (!row) throw notFound('Task');
  const existing = await ctx.db
    .select()
    .from(sandboxNetworkConversions)
    .where(eq(sandboxNetworkConversions.clickId, clickId));
  return {
    clickId,
    status: row.click.status,
    networkName: row.networkName,
    alreadyConverted: Boolean(existing[0]),
    offer: {
      id: row.offer.id,
      title: row.offer.title,
      advertiser: row.offer.advertiser,
      category: row.offer.category,
      description: row.offer.description,
      steps: row.offer.steps,
      icon: row.offer.icon,
      color: row.offer.color,
      estMinutes: row.offer.estMinutes,
      userPayoutMicros: userPayoutFor(row.offer, ctx.settings.get().revenueShareBps),
    },
  };
}

export async function completeSandboxClick(
  ctx: AppContext,
  user: UserRow,
  clickId: string,
  mode: DeliveryMode,
) {
  const rows = await ctx.db
    .select({ click: offerClicks, offer: offers })
    .from(offerClicks)
    .innerJoin(offers, eq(offers.id, offerClicks.offerId))
    .where(and(eq(offerClicks.id, clickId), eq(offerClicks.userId, user.id)));
  const row = rows[0];
  if (!row) throw notFound('Task');
  if (row.click.status === 'credited') throw conflict('ALREADY_CREDITED', 'This task was already credited.');
  const screenout = mode === 'screenout';
  const payout = screenout
    ? Math.max(50_000, Math.round(row.offer.payoutMicros * 0.1))
    : row.offer.payoutMicros;
  const txnId = `SBN-${randomToken(9).toUpperCase()}`;
  const inserted = await ctx.db
    .insert(sandboxNetworkConversions)
    .values({
      networkId: row.offer.networkId,
      clickId,
      networkTxnId: txnId,
      userRef: user.id,
      networkOfferId: row.offer.networkOfferId,
      payoutMicros: payout,
      kind: screenout ? 'screenout' : 'complete',
      deliveryMode: mode,
    })
    .onConflictDoNothing()
    .returning();
  if (!inserted[0]) throw conflict('ALREADY_CONVERTED', 'The network already recorded this completion.');

  const delay = ctx.config.isTest ? 0 : ctx.settings.get().sandboxPostbackDelayMs;
  if (mode !== 'drop') {
    await ctx.jobs.enqueue(
      ctx.db,
      'sandbox.deliver_postback',
      { clickId, corrupt: mode === 'bad_signature' },
      { delayMs: delay },
    );
    if (mode === 'duplicate')
      await ctx.jobs.enqueue(
        ctx.db,
        'sandbox.deliver_postback',
        { clickId },
        { delayMs: ctx.config.isTest ? 0 : delay + 400 },
      );
  }
  return {
    networkTxnId: txnId,
    mode,
    message:
      mode === 'drop'
        ? 'The network recorded your completion but its postback was “lost” — CashAds won’t hear about it. Try Missing Credit after the wait period.'
        : mode === 'bad_signature'
          ? 'A postback with a corrupted signature is on its way — CashAds will reject it as untrusted.'
          : mode === 'duplicate'
            ? 'The network will send the same postback twice — CashAds will credit it once.'
            : 'Completion recorded. The network is notifying CashAds now…',
  };
}

/** Job: the network's server calls our postback URL (through the real HTTP stack). */
export async function deliverSandboxPostback(
  ctx: AppContext,
  clickId: string,
  corrupt = false,
  statusOverride?: '2',
): Promise<void> {
  const conv = (
    await ctx.db
      .select()
      .from(sandboxNetworkConversions)
      .where(eq(sandboxNetworkConversions.clickId, clickId))
  )[0];
  if (!conv) return;
  const secret = await getNetworkSecret(ctx.db, conv.networkId);
  if (!secret) throw new Error('Sandbox network has no secret');
  const params: Record<string, string> = {
    click_id: conv.clickId,
    user_id: conv.userRef,
    offer_id: conv.networkOfferId,
    txn_id: conv.networkTxnId,
    payout: microsToDecimal(conv.payoutMicros),
    status: statusOverride ?? (conv.kind === 'screenout' ? '3' : '1'),
    ts: String(Math.floor(Date.now() / 1000)),
  };
  params.sig = corrupt ? 'f'.repeat(64) : sandboxSign(params, secret);
  const res = await ctx.selfRequest({
    method: 'GET',
    url: `/api/postback/${conv.networkId}?${new URLSearchParams(params).toString()}`,
    headers: { 'user-agent': 'SandboxNet-Postback/1.0' },
  });
  // Real networks retry on non-2xx; signature failures are not retryable.
  if (res.statusCode >= 500) throw new Error(`Postback endpoint returned ${res.statusCode}`);
}

export async function reverseSandboxConversion(
  ctx: AppContext,
  user: UserRow,
  clickId: string,
): Promise<void> {
  const conv = (
    await ctx.db
      .select()
      .from(sandboxNetworkConversions)
      .where(
        and(eq(sandboxNetworkConversions.clickId, clickId), eq(sandboxNetworkConversions.userRef, user.id)),
      )
  )[0];
  if (!conv) throw notFound('Network conversion');
  if (conv.status === 'reversed') throw conflict('ALREADY_REVERSED', 'Already reversed');
  await ctx.db
    .update(sandboxNetworkConversions)
    .set({ status: 'reversed' })
    .where(eq(sandboxNetworkConversions.id, conv.id));
  await deliverSandboxPostback(ctx, clickId, false, '2');
}

/** Job: the video network's server confirms a view via SSV callback (Pangle-style signature). */
export async function deliverSsvCallback(ctx: AppContext, sessionId: string): Promise<void> {
  const session = (await ctx.db.select().from(adSessions).where(eq(adSessions.id, sessionId)))[0];
  if (!session) return;
  const network = (await ctx.db.select().from(networks).where(eq(networks.id, 'sandbox-ads')))[0];
  if (!network?.secretEnc) throw new Error('SandboxAds has no secret');
  const secret = decrypt(network.secretEnc);
  const params = new URLSearchParams({
    user_id: session.userId,
    trans_id: session.transId,
    reward_amount: String(session.rewardMicros),
    reward_name: session.creativeId,
    extra: session.id,
    sign: ssvSign(secret, session.transId),
  });
  const res = await ctx.selfRequest({
    method: 'GET',
    url: `/api/ssv/sandbox-ads?${params.toString()}`,
    headers: { 'user-agent': 'SandboxAds-SSV/1.0' },
  });
  if (res.statusCode >= 500) throw new Error(`SSV endpoint returned ${res.statusCode}`);
}

/** Job: simulated identity vendor. IDs containing "0000" are rejected so both paths can be demoed. */
export async function sandboxKycReview(ctx: AppContext, userId: string): Promise<void> {
  const sub = (
    await ctx.db
      .select()
      .from(kycSubmissions)
      .where(and(eq(kycSubmissions.userId, userId), eq(kycSubmissions.status, 'pending')))
      .orderBy(desc(kycSubmissions.createdAt))
      .limit(1)
  )[0];
  if (!sub) return;
  const idNumber = decrypt(sub.idNumberEnc);
  if (idNumber.includes('0000')) {
    await decideKyc(
      ctx,
      sub.id,
      'rejected',
      'The ID number could not be matched (sandbox rule: numbers containing 0000 are rejected).',
      null,
    );
  } else {
    await decideKyc(ctx, sub.id, 'verified', 'Matched by sandbox identity vendor.', null);
  }
}

export async function devInbox(ctx: AppContext, limit = 50) {
  if (!ctx.config.SANDBOX_MODE) throw new AppError(404, 'NOT_FOUND', 'Not found');
  const rows = await ctx.db
    .select()
    .from(outboundMessages)
    .orderBy(desc(outboundMessages.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}
