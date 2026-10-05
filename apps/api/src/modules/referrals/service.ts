import { and, desc, eq, sql } from 'drizzle-orm';
import { type ReferralDTO, formatUsd } from '@lucrum/shared';
import type { AppContext } from '../../context';
import type { DbOrTx } from '../../db/client';
import { devices, ledgerEntries, ledgerTransactions, referrals, users } from '../../db/schema';
import type { ClientInfo, UserRow } from '../../http/auth';
import { maskEmail } from '../../lib/net';
import { recordSignal } from '../fraud/service';
import { notify } from '../platform/messaging';
import { SYS, postTransaction, userAccountCode } from '../wallet/ledger';

/**
 * Two-sided referrals (spec §14.4): both people get a bonus once the friend completes
 * their first task, plus the referrer earns a residual % of the friend's task earnings
 * forever (pain point #13). Residuals are paid from Lucrum' share — never deducted
 * from the friend.
 */

export async function attachReferral(
  ctx: AppContext,
  db: DbOrTx,
  referee: { id: string },
  code: string,
  client: ClientInfo,
): Promise<void> {
  const rows = await db.select().from(users).where(eq(users.referralCode, code.toUpperCase()));
  const referrer = rows[0];
  if (
    !referrer ||
    referrer.id === referee.id ||
    referrer.status === 'deleted' ||
    referrer.status === 'banned'
  )
    return;

  const sharedDevice = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.userId, referrer.id), eq(devices.deviceKey, client.deviceKey)));
  const linked = sharedDevice.length > 0 && !client.deviceKey.startsWith('anon_');

  await db.update(users).set({ referredBy: referrer.id }).where(eq(users.id, referee.id));
  await db.insert(referrals).values({
    referrerId: referrer.id,
    refereeId: referee.id,
    status: linked ? 'rejected' : 'pending',
    rejectionReason: linked ? 'Accounts share a device' : null,
  });
  if (linked) {
    await recordSignal(ctx, db, referee.id, 'referral_self_dealing', { referrerId: referrer.id });
    await recordSignal(ctx, db, referrer.id, 'referral_self_dealing', { refereeId: referee.id });
  }
}

/** Called after any member earning (conversion / poll / lesson). Qualifies the referral and pays residuals. */
export async function onRefereeEarning(
  ctx: AppContext,
  db: DbOrTx,
  refereeId: string,
  amountMicros: number,
  sourceKey: string,
): Promise<void> {
  if (amountMicros <= 0) return;
  const rows = await db.select().from(referrals).where(eq(referrals.refereeId, refereeId));
  const ref = rows[0];
  if (!ref || ref.status === 'rejected') return;
  const referrerRows = await db.select().from(users).where(eq(users.id, ref.referrerId));
  const referrer = referrerRows[0];
  if (!referrer || referrer.status !== 'active') return;
  const settings = ctx.settings.get();

  if (ref.status === 'pending') {
    const [updated] = await db
      .update(referrals)
      .set({ status: 'qualified', qualifiedAt: new Date() })
      .where(and(eq(referrals.id, ref.id), eq(referrals.status, 'pending')))
      .returning();
    if (updated && settings.referralBonusMicros > 0) {
      const bonus = settings.referralBonusMicros;
      for (const [uid, other] of [
        [referrer.id, 'friend'],
        [refereeId, 'referrer'],
      ] as const) {
        await postTransaction(db, {
          type: 'bonus_referral',
          userId: uid,
          idempotencyKey: `referral_bonus:${ref.id}:${uid}`,
          description:
            other === 'friend'
              ? 'Referral bonus — your friend completed their first task'
              : 'Welcome bonus for joining with a referral',
          referenceType: 'referral',
          referenceId: ref.id,
          entries: [
            { account: SYS.bonusExpense, direction: 'debit', amount: bonus },
            { account: userAccountCode(uid), direction: 'credit', amount: bonus },
          ],
        });
        await notify(ctx, db, uid, {
          type: 'referral_bonus',
          title: `+${formatUsd(bonus)} referral bonus`,
          body:
            other === 'friend'
              ? `Your friend completed their first task. You both earned ${formatUsd(bonus)} — and you’ll get ${settings.referralResidualBps / 100}% of their task earnings from now on.`
              : `Thanks for joining through a friend. ${formatUsd(bonus)} has been added to your balance.`,
          link: '/app/referrals',
        });
        ctx.events.toUser(uid, 'balance', { reason: 'bonus_referral' });
      }
      await ctx.jobs.enqueue(db, 'engagement.achievements', { userId: referrer.id });
    }
  }

  if (settings.referralResidualBps > 0) {
    const residual = Math.floor((amountMicros * settings.referralResidualBps) / 10_000);
    if (residual > 0) {
      await postTransaction(db, {
        type: 'referral_residual',
        userId: referrer.id,
        idempotencyKey: `referral_residual:${sourceKey}`,
        description: 'Referral earnings — 10% of your friend’s task, paid by Lucrum',
        referenceType: 'referral',
        referenceId: ref.id,
        entries: [
          { account: SYS.bonusExpense, direction: 'debit', amount: residual },
          { account: userAccountCode(referrer.id), direction: 'credit', amount: residual },
        ],
      });
      ctx.events.toUser(referrer.id, 'balance', { reason: 'referral_residual' });
    }
  }
}

export async function getReferralDTO(ctx: AppContext, user: UserRow, baseUrl: string): Promise<ReferralDTO> {
  const settings = ctx.settings.get();
  const rows = await ctx.db
    .select({
      id: referrals.id,
      status: referrals.status,
      createdAt: referrals.createdAt,
      refereeId: referrals.refereeId,
      email: users.email,
      displayName: users.displayName,
    })
    .from(referrals)
    .innerJoin(users, eq(users.id, referrals.refereeId))
    .where(eq(referrals.referrerId, user.id))
    .orderBy(desc(referrals.createdAt));

  const earned = await ctx.db
    .select({
      referenceId: ledgerTransactions.referenceId,
      total: sql<string>`sum(${ledgerEntries.amountMicros})`,
    })
    .from(ledgerTransactions)
    .innerJoin(
      ledgerEntries,
      and(eq(ledgerEntries.transactionId, ledgerTransactions.id), eq(ledgerEntries.direction, 'credit')),
    )
    .where(
      and(
        eq(ledgerTransactions.userId, user.id),
        sql`${ledgerTransactions.type} in ('bonus_referral', 'referral_residual')`,
        eq(ledgerTransactions.referenceType, 'referral'),
      ),
    )
    .groupBy(ledgerTransactions.referenceId);
  const earnedBy = new Map(earned.map((e) => [e.referenceId, Number(e.total)]));

  const referees = rows.map((r) => ({
    id: r.id,
    label: r.displayName ?? maskEmail(r.email),
    status: r.status,
    joinedAt: r.createdAt.toISOString(),
    earnedForYouMicros: earnedBy.get(r.id) ?? 0,
  }));
  return {
    code: user.referralCode,
    link: `${baseUrl}/r/${user.referralCode}`,
    bonusMicros: settings.referralBonusMicros,
    residualPercent: settings.referralResidualBps / 100,
    stats: {
      invited: rows.length,
      qualified: rows.filter((r) => r.status === 'qualified').length,
      earnedMicros: referees.reduce((s, r) => s + r.earnedForYouMicros, 0),
    },
    referees,
  };
}
