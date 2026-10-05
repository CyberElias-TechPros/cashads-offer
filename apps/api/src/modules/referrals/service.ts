import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { applyBps, formatMoney, type Micros, type ReferralSummaryDTO } from '@cashads/shared';
import { withUow, type AppContext, type Uow } from '../../context';
import { devices, referrals, users } from '../../db/schema';
import { clock, DAY } from '../../lib/clock';
import { publicName } from '../../lib/mask';
import { addSignal } from '../fraud/service';
import { notify } from '../notifications/service';
import { creditUser } from '../rewards/service';
import { acct } from '../wallet/ledger';

/** On sign-up: attach the referral (pending until the friend's first completed offer). */
export async function attachReferral(uow: Uow, refereeId: string, code: string, meta: { ip: string | null; deviceKey?: string | null }) {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return;
  const [referrer] = await uow.tx.select().from(users).where(eq(users.referralCode, normalized));
  if (!referrer || referrer.id === refereeId || referrer.status === 'deleted') return;
  const months = uow.ctx.settings.get().referralCommissionMonths;
  const commissionUntil = new Date(clock.ms() + months * 30 * DAY);

  // Self-referral detection: same device or same sign-up IP.
  let selfReferral = false;
  if (meta.deviceKey) {
    const [shared] = await uow.tx
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.userId, referrer.id), eq(devices.deviceKey, meta.deviceKey)))
      .limit(1);
    if (shared) selfReferral = true;
  }
  if (meta.ip && meta.ip !== '127.0.0.1' && meta.ip !== '::1' && referrer.signupIp === meta.ip) selfReferral = true;

  await uow.tx.update(users).set({ referredById: referrer.id }).where(eq(users.id, refereeId));
  await uow.tx
    .insert(referrals)
    .values({
      referrerId: referrer.id,
      refereeId,
      status: selfReferral ? 'rejected' : 'pending',
      rejectReason: selfReferral ? 'Referrer and new account share a device or network' : null,
      commissionUntil,
      createdAt: clock.now(),
    })
    .onConflictDoNothing();
  if (selfReferral) {
    await addSignal(uow, refereeId, 'referral_self', { referrerId: referrer.id });
  }
}

/** Called for every earning of a referred member. */
export async function onRefereeEarning(uow: Uow, refereeId: string, baseMicros: Micros, kind: 'offer' | 'video' | 'goodwill') {
  const [ref] = await uow.tx.select().from(referrals).where(eq(referrals.refereeId, refereeId)).for('update');
  if (!ref || ref.status === 'rejected') return;
  const s = uow.ctx.settings.get();
  const now = clock.now();

  if (ref.status === 'pending' && (kind === 'offer' || kind === 'goodwill')) {
    await uow.tx.update(referrals).set({ status: 'qualified', qualifiedAt: now }).where(eq(referrals.id, ref.id));
    const [referee] = await uow.tx.select({ displayName: users.displayName }).from(users).where(eq(users.id, refereeId));
    if (s.referralRefereeBonusMicros > 0) {
      await creditUser(uow, {
        userId: refereeId,
        type: 'referral_bonus',
        description: 'Bonus for joining with a friend’s invite',
        idempotencyKey: `ref:referee:${ref.id}`,
        amountMicros: s.referralRefereeBonusMicros,
        source: { account: acct.marketing },
        earning: false,
        celebrate: false,
      });
    }
    if (s.referralReferrerBonusMicros > 0) {
      await creditUser(uow, {
        userId: ref.referrerId,
        type: 'referral_bonus',
        description: `${publicName(referee?.displayName)} completed their first offer`,
        idempotencyKey: `ref:referrer:${ref.id}`,
        amountMicros: s.referralReferrerBonusMicros,
        source: { account: acct.marketing },
        earning: false,
      });
    }
    await notify(uow, ref.referrerId, {
      type: 'referral',
      title: `Your friend ${publicName(referee?.displayName)} just earned 🎉`,
      body: `You got ${formatMoney(s.referralReferrerBonusMicros)} — plus ${s.referralCommissionBps / 100}% of what they earn for ${s.referralCommissionMonths} months (paid by us, not them).`,
      link: '/app/referrals',
    });
    ref.status = 'qualified';
  }

  if (ref.status === 'qualified' && ref.commissionUntil && ref.commissionUntil > now && s.referralCommissionBps > 0) {
    const commission = applyBps(baseMicros, s.referralCommissionBps);
    if (commission > 0) {
      await uow.tx
        .update(referrals)
        .set({ accruedMicros: sql`${referrals.accruedMicros} + ${commission}`, accruedCount: sql`${referrals.accruedCount} + 1` })
        .where(eq(referrals.id, ref.id));
    }
  }
}

/** Hourly job: settle accrued commissions as one tidy transaction per friend (no sub-cent spam). */
export async function settleCommissions(ctx: AppContext): Promise<number> {
  const due = await ctx.db.select().from(referrals).where(gte(referrals.accruedMicros, 10_000));
  let settled = 0;
  for (const r of due) {
    await withUow(ctx, async (uow) => {
      const { tx } = uow;
      const [row] = await tx.select().from(referrals).where(eq(referrals.id, r.id)).for('update');
      if (!row || row.accruedMicros < 10_000) return;
      const [referee] = await tx.select({ displayName: users.displayName }).from(users).where(eq(users.id, row.refereeId));
      await creditUser(uow, {
        userId: row.referrerId,
        type: 'referral_commission',
        description: `Commission: ${publicName(referee?.displayName)} (${row.accruedCount} ${row.accruedCount === 1 ? 'task' : 'tasks'})`,
        idempotencyKey: `comm:${row.id}:${row.earnedMicros}:${row.accruedMicros}`,
        amountMicros: row.accruedMicros,
        source: { account: acct.marketing },
        earning: false,
        celebrate: false,
      });
      await tx
        .update(referrals)
        .set({ earnedMicros: row.earnedMicros + row.accruedMicros, accruedMicros: 0, accruedCount: 0 })
        .where(eq(referrals.id, row.id));
      settled++;
    });
  }
  return settled;
}

export async function referralSummary(ctx: AppContext, user: typeof users.$inferSelect, baseUrl: string): Promise<ReferralSummaryDTO> {
  const s = ctx.settings.get();
  const rows = await ctx.db
    .select({
      id: referrals.id,
      status: referrals.status,
      createdAt: referrals.createdAt,
      earned: referrals.earnedMicros,
      accrued: referrals.accruedMicros,
      name: users.displayName,
    })
    .from(referrals)
    .innerJoin(users, eq(users.id, referrals.refereeId))
    .where(eq(referrals.referrerId, user.id))
    .orderBy(desc(referrals.createdAt))
    .limit(200);
  const qualified = rows.filter((r) => r.status === 'qualified');
  const bonusTotal = qualified.length * s.referralReferrerBonusMicros;
  return {
    code: user.referralCode,
    link: `${baseUrl.replace(/\/$/, '')}/r/${user.referralCode}`,
    refereeBonusMicros: s.referralRefereeBonusMicros,
    referrerBonusMicros: s.referralReferrerBonusMicros,
    commissionBps: s.referralCommissionBps,
    commissionMonths: s.referralCommissionMonths,
    totals: {
      invited: rows.length,
      qualified: qualified.length,
      earnedMicros: bonusTotal + rows.reduce((a, r) => a + r.earned, 0),
    },
    referrals: rows.map((r) => ({
      id: r.id,
      name: publicName(r.name),
      joinedAt: r.createdAt.toISOString(),
      status: r.status,
      earnedForYouMicros: r.earned + r.accrued + (r.status === 'qualified' ? s.referralReferrerBonusMicros : 0),
    })),
  };
}

