import { and, eq, inArray, sql } from 'drizzle-orm';
import { formatUsd, splitByBps } from '@lucrum/shared';
import type { AppContext } from '../../context';
import type { DbOrTx, Tx } from '../../db/client';
import {
  charities,
  claims,
  conversions,
  donations,
  fraudFlags,
  offerClicks,
  offers,
  users,
} from '../../db/schema';
import { notify } from '../platform/messaging';
import { SYS, getAvailableMicros, postTransaction, userAccountCode } from '../wallet/ledger';

type OfferRow = typeof offers.$inferSelect;
type ClickRow = typeof offerClicks.$inferSelect;

/** What the member earns for an offer right now (published revenue share unless overridden). */
export function userPayoutFor(
  offer: Pick<OfferRow, 'payoutMicros' | 'userPayoutOverrideMicros'>,
  revenueShareBps: number,
): number {
  if (offer.userPayoutOverrideMicros) return offer.userPayoutOverrideMicros;
  return splitByBps(offer.payoutMicros, revenueShareBps).share;
}

export interface CreditConversionInput {
  networkId: string;
  networkTxnId: string;
  userId: string;
  offer: OfferRow | null;
  click: ClickRow | null;
  payoutMicros: number;
  kind: 'complete' | 'screenout';
  source: 'postback' | 'network_api' | 'claim' | 'replay';
  title?: string;
  postbackLogId?: string | null;
}

export interface CreditResult {
  duplicate: boolean;
  conversionId: string;
  userAmountMicros: number;
  recoveredGoodwill: boolean;
}

/**
 * Credit a confirmed conversion. Idempotent on (network, networkTxnId): a network
 * retrying a postback, a replay from the admin console, or a claim that already
 * credited the same transaction can never pay twice.
 */
export async function creditConversion(ctx: AppContext, input: CreditConversionInput): Promise<CreditResult> {
  const settings = ctx.settings.get();
  const result = await ctx.db.transaction(async (tx) => {
    const dup = await tx
      .select({ id: conversions.id, userAmount: conversions.userAmountMicros })
      .from(conversions)
      .where(
        and(eq(conversions.networkId, input.networkId), eq(conversions.networkTxnId, input.networkTxnId)),
      );
    if (dup[0])
      return {
        duplicate: true,
        conversionId: dup[0].id,
        userAmountMicros: dup[0].userAmount,
        recoveredGoodwill: false,
        title: '',
      };

    const payout = input.payoutMicros;
    let userAmount = input.offer
      ? userPayoutFor({ ...input.offer, payoutMicros: payout }, settings.revenueShareBps)
      : splitByBps(payout, settings.revenueShareBps).share;
    if (input.kind === 'screenout') userAmount = splitByBps(payout, settings.revenueShareBps).share;
    const platformAmount = payout - userAmount;
    const durationSeconds = input.click
      ? Math.max(0, Math.round((Date.now() - input.click.startedAt.getTime()) / 1000))
      : null;
    const title = input.title ?? input.offer?.title ?? 'Partner task';

    // If we already paid this click as goodwill (tracking failed, we paid anyway),
    // the late network payment *recovers* our goodwill expense instead of paying twice.
    let recovered = false;
    if (input.click) {
      const goodwill = await tx
        .select({ id: claims.id })
        .from(claims)
        .where(
          and(
            eq(claims.clickId, input.click.id),
            eq(claims.status, 'approved'),
            inArray(claims.resolution, ['goodwill_auto', 'goodwill_manual', 'sla_auto']),
          ),
        );
      recovered = goodwill.length > 0;
    }

    const inserted = await tx
      .insert(conversions)
      .values({
        networkId: input.networkId,
        networkTxnId: input.networkTxnId,
        clickId: input.click?.id ?? null,
        userId: input.userId,
        offerId: input.offer?.id ?? null,
        title,
        kind: input.kind,
        payoutMicros: payout,
        userAmountMicros: recovered ? 0 : userAmount,
        platformAmountMicros: platformAmount,
        source: input.source,
        durationSeconds,
        postbackLogId: input.postbackLogId ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: conversions.id });
    if (!inserted[0]) {
      const again = await tx
        .select({ id: conversions.id, userAmount: conversions.userAmountMicros })
        .from(conversions)
        .where(
          and(eq(conversions.networkId, input.networkId), eq(conversions.networkTxnId, input.networkTxnId)),
        );
      return {
        duplicate: true,
        conversionId: again[0]!.id,
        userAmountMicros: again[0]!.userAmount,
        recoveredGoodwill: false,
        title,
      };
    }
    const conversionId = inserted[0].id;

    const entries: { account: string; direction: 'debit' | 'credit'; amount: number }[] = [
      { account: SYS.networkReceivable(input.networkId), direction: 'debit', amount: payout },
    ];
    if (recovered) {
      entries.push({
        account: SYS.goodwillExpense,
        direction: 'credit',
        amount: Math.min(userAmount, payout),
      });
      if (payout - Math.min(userAmount, payout) > 0)
        entries.push({
          account: SYS.platformRevenue,
          direction: 'credit',
          amount: payout - Math.min(userAmount, payout),
        });
    } else {
      entries.push({ account: userAccountCode(input.userId), direction: 'credit', amount: userAmount });
      if (platformAmount > 0)
        entries.push({ account: SYS.platformRevenue, direction: 'credit', amount: platformAmount });
      if (platformAmount < 0)
        entries.push({ account: SYS.bonusExpense, direction: 'debit', amount: -platformAmount });
    }
    const posted = await postTransaction(tx, {
      type: 'conversion',
      userId: input.userId,
      idempotencyKey: `conversion:${conversionId}`,
      description: input.kind === 'screenout' ? `Screen-out compensation — ${title}` : title,
      referenceType: 'conversion',
      referenceId: conversionId,
      metadata: {
        networkId: input.networkId,
        networkTxnId: input.networkTxnId,
        source: input.source,
        recoveredGoodwill: recovered,
      },
      entries: entries.filter((e) => e.amount > 0),
    });
    await tx.update(conversions).set({ ledgerTxnId: posted.id }).where(eq(conversions.id, conversionId));

    if (input.click) {
      await tx
        .update(offerClicks)
        .set({ status: 'credited', creditedAt: new Date(), conversionId })
        .where(eq(offerClicks.id, input.click.id));
    }
    if (input.offer) {
      await tx
        .update(offers)
        .set({ statConversions: sql`${offers.statConversions} + 1` })
        .where(eq(offers.id, input.offer.id));
    }
    if (!recovered) {
      await autoDonate(ctx, tx, input.userId, userAmount, `conversion:${conversionId}`);
      await ctx.jobs.enqueue(tx, 'earning.after', {
        userId: input.userId,
        kind: 'conversion',
        amountMicros: userAmount,
        offerId: input.offer?.id ?? null,
        sourceKey: `conversion:${conversionId}`,
        durationSeconds,
        estSeconds: input.offer ? Math.round(input.offer.estMinutes * 60) : null,
      });
    }
    return {
      duplicate: false,
      conversionId,
      userAmountMicros: recovered ? 0 : userAmount,
      recoveredGoodwill: recovered,
      title,
    };
  });

  if (!result.duplicate && !result.recoveredGoodwill) {
    ctx.events.toUser(input.userId, 'reward', {
      kind: 'conversion',
      amountMicros: result.userAmountMicros,
      title: result.title,
      clickId: input.click?.id ?? null,
    });
  }
  const { title: _t, ...rest } = result;
  return rest;
}

/**
 * Advertiser chargeback. Default policy ("absorb"): Lucrum eats the loss and the
 * member's balance is untouched — unless the completion was fraudulent.
 */
export async function reverseConversion(
  ctx: AppContext,
  input: { networkId: string; networkTxnId: string },
): Promise<{ outcome: 'reversed' | 'duplicate' | 'unknown'; clawedBack: number }> {
  const settings = ctx.settings.get();
  const res = await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(conversions)
      .where(
        and(eq(conversions.networkId, input.networkId), eq(conversions.networkTxnId, input.networkTxnId)),
      )
      .for('update');
    const conv = rows[0];
    if (!conv) return { outcome: 'unknown' as const, clawedBack: 0, userId: null, title: '' };
    if (conv.status === 'reversed')
      return { outcome: 'duplicate' as const, clawedBack: 0, userId: conv.userId, title: conv.title };

    const [user] = await tx.select().from(users).where(eq(users.id, conv.userId));
    const confirmedFraud = await tx
      .select({ id: fraudFlags.id })
      .from(fraudFlags)
      .where(and(eq(fraudFlags.userId, conv.userId), eq(fraudFlags.status, 'confirmed')));
    const clawback =
      settings.reversalPolicy === 'clawback' || user?.status === 'banned' || confirmedFraud.length > 0;

    // The network takes back the full payout P. Debits must total P:
    //   platform's share (if positive) + whatever we reclaim from the member + our loss.
    const platformPart = Math.max(conv.platformAmountMicros, 0);
    const remaining = conv.payoutMicros - platformPart;
    // Goodwill-recovered conversions paid the goodwill account, not the member.
    const recovered = conv.userAmountMicros === 0 && remaining > 0;
    let fromUser = 0;
    if (clawback && conv.userAmountMicros > 0) {
      const available = await getAvailableMicros(tx, conv.userId);
      fromUser = Math.min(available, conv.userAmountMicros);
    }
    const lossAmount = remaining - fromUser;
    const entries: { account: string; direction: 'debit' | 'credit'; amount: number }[] = [
      { account: SYS.networkReceivable(conv.networkId), direction: 'credit', amount: conv.payoutMicros },
      { account: SYS.platformRevenue, direction: 'debit', amount: platformPart },
      { account: userAccountCode(conv.userId), direction: 'debit', amount: fromUser },
    ];
    if (lossAmount > 0)
      entries.push({
        account: recovered ? SYS.goodwillExpense : SYS.reversalLoss,
        direction: 'debit',
        amount: lossAmount,
      });
    // Reclaimed more than the network's share (promo override) → offsets the promo expense.
    if (lossAmount < 0) entries.push({ account: SYS.bonusExpense, direction: 'credit', amount: -lossAmount });
    await postTransaction(tx, {
      type: fromUser > 0 ? 'clawback' : 'conversion_reversal',
      userId: conv.userId,
      idempotencyKey: `reversal:${conv.id}`,
      description:
        fromUser > 0
          ? `Reversed by advertiser (fraud) — ${conv.title}`
          : `Reversed by advertiser — covered by Lucrum — ${conv.title}`,
      referenceType: 'conversion',
      referenceId: conv.id,
      metadata: { policy: clawback ? 'clawback' : 'absorb' },
      entries: entries.filter((e) => e.amount > 0),
    });
    await tx
      .update(conversions)
      .set({ status: 'reversed', reversedAt: new Date() })
      .where(eq(conversions.id, conv.id));
    if (!clawback) {
      await notify(ctx, tx, conv.userId, {
        type: 'reversal_absorbed',
        title: 'An advertiser reversed a task — we covered it',
        body: `The advertiser behind “${conv.title}” reversed your completion. Under our policy Lucrum absorbs that loss, so your balance is unchanged.`,
        link: '/app/wallet',
      });
    }
    return { outcome: 'reversed' as const, clawedBack: fromUser, userId: conv.userId, title: conv.title };
  });
  if (res.userId && res.clawedBack > 0) ctx.events.toUser(res.userId, 'balance', { reason: 'clawback' });
  return { outcome: res.outcome, clawedBack: res.clawedBack };
}

/** "We pay even when tracking fails": credit from Lucrum' own goodwill budget. */
export async function creditGoodwill(
  ctx: AppContext,
  tx: Tx,
  input: { userId: string; claimId: string; amountMicros: number; title: string },
): Promise<string> {
  const posted = await postTransaction(tx, {
    type: 'goodwill',
    userId: input.userId,
    idempotencyKey: `goodwill:${input.claimId}`,
    description: `Missing credit paid by Lucrum — ${input.title}`,
    referenceType: 'claim',
    referenceId: input.claimId,
    entries: [
      { account: SYS.goodwillExpense, direction: 'debit', amount: input.amountMicros },
      { account: userAccountCode(input.userId), direction: 'credit', amount: input.amountMicros },
    ],
  });
  await autoDonate(ctx, tx, input.userId, input.amountMicros, `goodwill:${input.claimId}`);
  return posted.id;
}

/** Native sponsored earnings (quick polls, lessons, videos): sponsor payout split by revenue share. */
export async function creditNative(
  ctx: AppContext,
  tx: Tx,
  input: {
    type: 'poll_reward' | 'lesson_reward' | 'ad_reward';
    userId: string;
    networkId: string;
    sponsorPayoutMicros: number;
    userAmountMicros: number;
    idempotencyKey: string;
    description: string;
    referenceType: string;
    referenceId: string;
  },
): Promise<string> {
  const platform = input.sponsorPayoutMicros - input.userAmountMicros;
  const entries = [
    {
      account: SYS.networkReceivable(input.networkId),
      direction: 'debit' as const,
      amount: input.sponsorPayoutMicros,
    },
    { account: userAccountCode(input.userId), direction: 'credit' as const, amount: input.userAmountMicros },
  ];
  if (platform > 0) entries.push({ account: SYS.platformRevenue, direction: 'credit', amount: platform });
  if (platform < 0) entries.push({ account: SYS.bonusExpense, direction: 'debit', amount: -platform });
  const posted = await postTransaction(tx, {
    type: input.type,
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    description: input.description,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    entries: entries.filter((e) => e.amount > 0),
  });
  if (input.type !== 'ad_reward')
    await autoDonate(ctx, tx, input.userId, input.userAmountMicros, input.idempotencyKey);
  return posted.id;
}

/** "Earn for a cause" (pain point #15): route a % of every earning to the member's chosen charity. */
export async function autoDonate(
  ctx: AppContext,
  tx: DbOrTx,
  userId: string,
  earnedMicros: number,
  sourceKey: string,
): Promise<void> {
  const [user] = await tx.select({ prefs: users.prefs }).from(users).where(eq(users.id, userId));
  const pct = user?.prefs?.charityPercent ?? 0;
  const charityId = user?.prefs?.charityId;
  if (!pct || !charityId) return;
  const amount = Math.floor((earnedMicros * pct) / 100);
  if (amount <= 0) return;
  const charity = (await tx.select().from(charities).where(eq(charities.id, charityId)))[0];
  if (!charity || !charity.active) return;
  const posted = await postTransaction(tx, {
    type: 'charity_donation',
    userId,
    idempotencyKey: `donation:auto:${sourceKey}`,
    description: `Auto-donation to ${charity.name} (${pct}%)`,
    referenceType: 'charity',
    referenceId: charity.id,
    entries: [
      { account: userAccountCode(userId), direction: 'debit', amount },
      { account: SYS.charityPayable(charity.id), direction: 'credit', amount },
    ],
  });
  if (!posted.duplicate) {
    await tx.insert(donations).values({
      userId,
      charityId: charity.id,
      amountMicros: amount,
      source: 'auto',
      ledgerTxnId: posted.id,
    });
  }
}

export function rewardToast(amount: number, title: string): string {
  return `+${formatUsd(amount)} — ${title}`;
}
