import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import {
  type AdminOverviewDTO,
  BAN_REASONS,
  type BanReasonCode,
  FRAUD_SIGNAL_LABELS,
  type Role,
  formatUsd,
} from '@lucrum/shared';
import type { z } from 'zod';
import type { adminOfferUpsertSchema } from '@lucrum/shared';
import type { AppContext } from '../../context';
import {
  adminNotes,
  auditLogs,
  claims,
  devices,
  fraudFlags,
  jobs,
  kycSubmissions,
  ledgerAccounts,
  loginEvents,
  networks,
  offerReports,
  offers,
  payouts,
  postbackLogs,
  sessions,
  tickets,
  users,
} from '../../db/schema';
import type { UserRow } from '../../http/auth';
import { AppError, conflict, notFound } from '../../lib/errors';
import { maskEmail } from '../../lib/net';
import { recomputeScore, recordSignal, resolveFlag } from '../fraud/service';
import { refreshOfferStats } from '../offers/service';
import { audit, notify } from '../platform/messaging';
import { toPayoutDTO } from '../payouts/service';
import {
  SYS,
  getAvailableMicros,
  lifetimeEarnedMicros,
  listUserTransactions,
  postTransaction,
  userAccountCode,
} from '../wallet/ledger';

const count = (v: unknown) => Number(v ?? 0);

export async function overview(ctx: AppContext): Promise<AdminOverviewDTO> {
  const q = async <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
    (await ctx.db.execute<T>(query)).rows;
  const [u] = await q<{ total: string; new24h: string; active24h: string; restricted: string }>(sql`
    select count(*) filter (where deleted_at is null) as total,
      count(*) filter (where created_at > now() - interval '24 hours') as new24h,
      count(*) filter (where last_seen_at > now() - interval '24 hours') as active24h,
      count(*) filter (where status in ('restricted', 'banned')) as restricted
    from users`);
  const [liab] = await q<{ total: string }>(sql`
    select coalesce(sum(balance_micros), 0) as total from ledger_accounts where kind = 'user_available' or code = ${SYS.payoutClearing}`);
  const [money] = await q<{ net24: string; user24: string; paid24: string; rev30: string }>(sql`
    select
      (select coalesce(sum(payout_micros), 0) from conversions where credited_at > now() - interval '24 hours') as net24,
      (select coalesce(sum(user_amount_micros), 0) from conversions where credited_at > now() - interval '24 hours') as user24,
      (select coalesce(sum(net_micros), 0) from payouts where status = 'completed' and completed_at > now() - interval '24 hours') as paid24,
      (select coalesce(sum(case when e.direction = 'credit' then e.amount_micros else -e.amount_micros end), 0)
         from ledger_entries e join ledger_accounts a on a.id = e.account_id
         where a.code = ${SYS.platformRevenue} and e.created_at > now() - interval '30 days') as rev30`);
  const [queues] = await q<Record<string, string>>(sql`
    select
      (select count(*) from payouts where status = 'review') as payouts_review,
      (select count(*) from payouts where status = 'processing') as payouts_processing,
      (select count(*) from claims where status = 'needs_review') as claims_review,
      (select count(*) from fraud_flags where status = 'open' and severity > 0) as fraud_open,
      (select count(*) from tickets where status = 'open') as tickets_open,
      (select count(*) from kyc_submissions where status = 'pending') as kyc_pending,
      (select count(*) from offer_reports where status = 'open') as reports_open,
      (select count(*) from jobs where status = 'failed') as jobs_failed`);
  const [pb] = await q<{ total: string; failed: string; ok: string }>(sql`
    select count(*) as total,
      count(*) filter (where status in ('rejected', 'error')) as failed,
      count(*) filter (where status in ('processed', 'duplicate')) as ok
    from postback_logs where created_at > now() - interval '24 hours'`);
  const series = await q<{
    date: string;
    signups: string;
    earnings: string;
    payouts: string;
    revenue: string;
  }>(sql`
    with days as (select generate_series((now() - interval '13 days')::date, now()::date, interval '1 day')::date as d)
    select to_char(days.d, 'YYYY-MM-DD') as date,
      (select count(*) from users where created_at::date = days.d) as signups,
      (select coalesce(sum(user_amount_micros), 0) from conversions where credited_at::date = days.d) as earnings,
      (select coalesce(sum(net_micros), 0) from payouts where status = 'completed' and completed_at::date = days.d) as payouts,
      (select coalesce(sum(platform_amount_micros), 0) from conversions where credited_at::date = days.d) as revenue
    from days order by days.d`);
  return {
    users: {
      total: count(u?.total),
      new24h: count(u?.new24h),
      active24h: count(u?.active24h),
      restricted: count(u?.restricted),
    },
    money: {
      liabilitiesMicros: count(liab?.total),
      networkRevenue24hMicros: count(money?.net24),
      userEarnings24hMicros: count(money?.user24),
      paidOut24hMicros: count(money?.paid24),
      platformRevenue30dMicros: count(money?.rev30),
    },
    queues: {
      payoutsReview: count(queues?.payouts_review),
      payoutsProcessing: count(queues?.payouts_processing),
      claimsReview: count(queues?.claims_review),
      fraudOpen: count(queues?.fraud_open),
      ticketsOpen: count(queues?.tickets_open),
      kycPending: count(queues?.kyc_pending),
      reportsOpen: count(queues?.reports_open),
      jobsFailed: count(queues?.jobs_failed),
    },
    postbacks: {
      last24h: count(pb?.total),
      failed24h: count(pb?.failed),
      successRate24h: count(pb?.total) > 0 ? count(pb?.ok) / count(pb?.total) : null,
    },
    series: series.map((s) => ({
      date: s.date,
      signups: count(s.signups),
      earningsMicros: count(s.earnings),
      payoutsMicros: count(s.payouts),
      revenueMicros: count(s.revenue),
    })),
  };
}

/** Business analytics: unit economics + D1/D7/D30 retention of earning activity. */
export async function analytics(ctx: AppContext, days: number) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = async <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
    (await ctx.db.execute<T>(query)).rows;
  const [unit] = await rows<Record<string, string>>(sql`
    select
      (select coalesce(sum(payout_micros), 0) from conversions where credited_at >= ${since}) as network_revenue,
      (select coalesce(sum(user_amount_micros), 0) from conversions where credited_at >= ${since}) as member_share,
      (select coalesce(sum(case when e.direction = 'debit' then e.amount_micros else -e.amount_micros end), 0)
         from ledger_entries e join ledger_accounts a on a.id = e.account_id where a.code = ${SYS.bonusExpense} and e.created_at >= ${since}) as bonuses,
      (select coalesce(sum(case when e.direction = 'debit' then e.amount_micros else -e.amount_micros end), 0)
         from ledger_entries e join ledger_accounts a on a.id = e.account_id where a.code = ${SYS.goodwillExpense} and e.created_at >= ${since}) as goodwill,
      (select coalesce(sum(case when e.direction = 'debit' then e.amount_micros else -e.amount_micros end), 0)
         from ledger_entries e join ledger_accounts a on a.id = e.account_id where a.code = ${SYS.reversalLoss} and e.created_at >= ${since}) as reversal_loss,
      (select count(distinct user_id) from ledger_transactions where created_at >= ${since} and type in ('conversion', 'ad_reward', 'poll_reward', 'lesson_reward')) as active_earners,
      (select count(*) from users where created_at >= ${since}) as signups,
      (select count(*) from fraud_flags where created_at >= ${since} and severity > 0) as fraud_flags,
      (select coalesce(avg(extract(epoch from (p.first_paid - u.created_at))), 0) from users u
         join (select user_id, min(completed_at) as first_paid from payouts where status = 'completed' group by user_id) p on p.user_id = u.id
         where u.created_at >= ${since}) as time_to_first_payout`);
  const cohorts = await rows<{ cohort: string; size: string; d1: string; d7: string; d30: string }>(sql`
    with cohort as (
      select id, created_at::date as c from users where created_at >= ${since} and deleted_at is null
    ), activity as (
      select distinct user_id, created_at::date as d from ledger_transactions
      where type in ('conversion', 'ad_reward', 'poll_reward', 'lesson_reward', 'bonus_streak')
    )
    select to_char(date_trunc('week', c), 'YYYY-MM-DD') as cohort, count(distinct cohort.id) as size,
      count(distinct cohort.id) filter (where exists (select 1 from activity a where a.user_id = cohort.id and a.d = c + 1)) as d1,
      count(distinct cohort.id) filter (where exists (select 1 from activity a where a.user_id = cohort.id and a.d between c + 6 and c + 8)) as d7,
      count(distinct cohort.id) filter (where exists (select 1 from activity a where a.user_id = cohort.id and a.d between c + 28 and c + 32)) as d30
    from cohort group by 1 order by 1`);
  const networkRevenue = count(unit?.network_revenue);
  const memberShare = count(unit?.member_share);
  const bonuses = count(unit?.bonuses);
  const goodwill = count(unit?.goodwill);
  const reversalLoss = count(unit?.reversal_loss);
  const activeEarners = count(unit?.active_earners);
  return {
    days,
    networkRevenueMicros: networkRevenue,
    memberShareMicros: memberShare,
    bonusesMicros: bonuses,
    goodwillMicros: goodwill,
    reversalLossMicros: reversalLoss,
    contributionMicros: networkRevenue - memberShare - bonuses - goodwill - reversalLoss,
    payoutRatio: networkRevenue > 0 ? (memberShare + bonuses + goodwill) / networkRevenue : null,
    activeEarners,
    signups: count(unit?.signups),
    arpuMicros: activeEarners > 0 ? Math.round((networkRevenue - memberShare) / activeEarners) : 0,
    fraudFlags: count(unit?.fraud_flags),
    avgTimeToFirstPayoutSeconds: Math.round(count(unit?.time_to_first_payout)),
    cohorts: cohorts.map((c) => ({
      cohort: c.cohort,
      size: count(c.size),
      d1: count(c.d1),
      d7: count(c.d7),
      d30: count(c.d30),
    })),
  };
}

/* ── users ─────────────────────────────────────────────────────────────────── */

export async function listUsers(
  ctx: AppContext,
  opts: { q?: string | undefined; status?: string | undefined; page: number },
) {
  const conds = [sql`${users.deletedAt} is null`];
  if (opts.q)
    conds.push(
      or(
        ilike(users.email, `%${opts.q}%`),
        ilike(users.displayName, `%${opts.q}%`),
        eq(users.referralCode, opts.q.toUpperCase()),
      )!,
    );
  if (opts.status) conds.push(eq(users.status, opts.status as UserRow['status']));
  const rows = await ctx.db
    .select({ user: users, balance: ledgerAccounts.balanceMicros })
    .from(users)
    .leftJoin(ledgerAccounts, eq(ledgerAccounts.code, sql`'user:' || ${users.id} || ':available'`))
    .where(and(...conds))
    .orderBy(desc(users.createdAt))
    .limit(50)
    .offset((opts.page - 1) * 50);
  return rows.map(({ user, balance }) => ({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    country: user.country,
    role: user.role,
    status: user.status,
    tier: user.tier,
    fraudScore: user.fraudScore,
    kycStatus: user.kycStatus,
    emailVerified: Boolean(user.emailVerifiedAt),
    phoneVerified: Boolean(user.phoneVerifiedAt),
    balanceMicros: balance ?? 0,
    isDemo: user.isDemo,
    createdAt: user.createdAt.toISOString(),
    lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
  }));
}

export async function userDetail(ctx: AppContext, userId: string) {
  const user = (await ctx.db.select().from(users).where(eq(users.id, userId)))[0];
  if (!user) throw notFound('User');
  const [balance, lifetime, txns, payoutRows, flags, deviceRows, notes, logins, claimRows] =
    await Promise.all([
      getAvailableMicros(ctx.db, userId),
      lifetimeEarnedMicros(ctx.db, userId),
      listUserTransactions(ctx.db, userId, { limit: 30 }),
      ctx.db
        .select()
        .from(payouts)
        .where(eq(payouts.userId, userId))
        .orderBy(desc(payouts.requestedAt))
        .limit(20),
      ctx.db
        .select()
        .from(fraudFlags)
        .where(eq(fraudFlags.userId, userId))
        .orderBy(desc(fraudFlags.createdAt)),
      ctx.db.select().from(devices).where(eq(devices.userId, userId)).orderBy(desc(devices.lastSeenAt)),
      ctx.db
        .select({ note: adminNotes, author: users.email })
        .from(adminNotes)
        .leftJoin(users, eq(users.id, adminNotes.authorId))
        .where(eq(adminNotes.userId, userId))
        .orderBy(desc(adminNotes.createdAt)),
      ctx.db
        .select()
        .from(loginEvents)
        .where(eq(loginEvents.userId, userId))
        .orderBy(desc(loginEvents.createdAt))
        .limit(20),
      ctx.db.select().from(claims).where(eq(claims.userId, userId)).orderBy(desc(claims.createdAt)).limit(20),
    ]);
  // Linked accounts: same device keys (the strongest multi-account signal).
  const keys = deviceRows.map((d) => d.deviceKey).filter((k) => !k.startsWith('anon_'));
  const linked = keys.length
    ? await ctx.db
        .selectDistinct({ id: users.id, email: users.email, status: users.status })
        .from(devices)
        .innerJoin(users, eq(users.id, devices.userId))
        .where(and(inArray(devices.deviceKey, keys), sql`${devices.userId} <> ${userId}`))
    : [];
  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      fullName: user.fullName,
      country: user.country,
      timezone: user.timezone,
      role: user.role,
      status: user.status,
      banReasonCode: user.banReasonCode,
      banMessage: user.banMessage,
      balanceFrozen: user.balanceFrozen,
      tier: user.tier,
      fraudScore: user.fraudScore,
      kycStatus: user.kycStatus,
      emailVerified: Boolean(user.emailVerifiedAt),
      phoneVerified: Boolean(user.phoneVerifiedAt),
      phoneLast4: user.phoneLast4,
      totpEnabled: Boolean(user.totpEnabledAt),
      referralCode: user.referralCode,
      signupIp: user.signupIp,
      isDemo: user.isDemo,
      createdAt: user.createdAt.toISOString(),
      lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
    },
    balanceMicros: balance,
    lifetimeEarnedMicros: lifetime,
    transactions: txns.items,
    payouts: payoutRows.map((p) => toPayoutDTO(p)),
    flags: flags.map((f) => ({
      ...f,
      label: FRAUD_SIGNAL_LABELS[f.type] ?? f.type,
      createdAt: f.createdAt.toISOString(),
    })),
    devices: deviceRows.map((d) => ({
      id: d.id,
      label: d.label,
      lastIp: d.lastIp,
      firstSeenAt: d.firstSeenAt.toISOString(),
      lastSeenAt: d.lastSeenAt.toISOString(),
    })),
    linkedAccounts: linked.map((l) => ({ ...l, email: maskEmail(l.email) })),
    notes: notes.map((n) => ({
      id: n.note.id,
      note: n.note.note,
      author: n.author,
      createdAt: n.note.createdAt.toISOString(),
    })),
    logins: logins.map((l) => ({
      success: l.success,
      ip: l.ip,
      reason: l.reason,
      at: l.createdAt.toISOString(),
    })),
    claims: claimRows.map((c) => ({
      id: c.id,
      status: c.status,
      amountMicros: c.amountMicros,
      createdAt: c.createdAt.toISOString(),
    })),
  };
}

export async function banUser(
  ctx: AppContext,
  actor: UserRow,
  userId: string,
  reasonCode: BanReasonCode,
  message: string,
  ip: string,
): Promise<void> {
  if (actor.id === userId) throw new AppError(400, 'SELF_ACTION', 'You can’t restrict your own account');
  await ctx.db.transaction(async (tx) => {
    const [before] = await tx.select().from(users).where(eq(users.id, userId));
    if (!before) throw notFound('User');
    await tx
      .update(users)
      .set({
        status: 'banned',
        banReasonCode: reasonCode,
        banMessage: message,
        bannedAt: new Date(),
        balanceFrozen: true,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), sql`${sessions.revokedAt} is null`));
    await audit(tx, {
      actorId: actor.id,
      action: 'user.ban',
      targetType: 'user',
      targetId: userId,
      before: { status: before.status },
      after: { status: 'banned', reasonCode, message },
      ip,
    });
    await notify(ctx, tx, userId, {
      type: 'account_restricted',
      title: `Account restricted: ${BAN_REASONS[reasonCode].title}`,
      body: `${BAN_REASONS[reasonCode].explanation} ${message} You can appeal from your dashboard — a person will review it within 72 hours.`,
      link: '/app/restricted',
      email: { category: 'security', subject: 'Your Lucrum account has been restricted' },
    });
  });
}

export async function unbanUser(ctx: AppContext, actor: UserRow, userId: string, ip: string): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        status: 'active',
        banReasonCode: null,
        banMessage: null,
        bannedAt: null,
        balanceFrozen: false,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    await audit(tx, { actorId: actor.id, action: 'user.unban', targetType: 'user', targetId: userId, ip });
    await notify(ctx, tx, userId, {
      type: 'account_restored',
      title: 'Your account is fully restored',
      body: 'Thanks for your patience. Earning and cash-outs are available again.',
      link: '/app',
      email: { category: 'security' },
    });
  });
}

export async function adjustBalance(
  ctx: AppContext,
  actor: UserRow,
  userId: string,
  amountMicros: number,
  reason: string,
  ip: string,
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const credit = amountMicros > 0;
    const abs = Math.abs(amountMicros);
    await postTransaction(tx, {
      type: 'admin_adjustment',
      userId,
      idempotencyKey: `adjust:${userId}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      description: `Adjustment by support: ${reason}`,
      referenceType: 'admin',
      referenceId: actor.id,
      metadata: { reason, actorId: actor.id },
      entries: credit
        ? [
            { account: SYS.adjustments, direction: 'debit', amount: abs },
            { account: userAccountCode(userId), direction: 'credit', amount: abs },
          ]
        : [
            { account: userAccountCode(userId), direction: 'debit', amount: abs },
            { account: SYS.adjustments, direction: 'credit', amount: abs },
          ],
    });
    await audit(tx, {
      actorId: actor.id,
      action: 'user.adjust_balance',
      targetType: 'user',
      targetId: userId,
      after: { amountMicros, reason },
      ip,
    });
    await notify(ctx, tx, userId, {
      type: 'adjustment',
      title: `${credit ? '+' : '−'}${formatUsd(abs)} balance adjustment`,
      body: `Our support team adjusted your balance: ${reason}`,
      link: '/app/wallet',
    });
  });
  ctx.events.toUser(userId, 'balance', { reason: 'admin_adjustment' });
}

export async function addNote(ctx: AppContext, actor: UserRow, userId: string, note: string): Promise<void> {
  await ctx.db.insert(adminNotes).values({ userId, authorId: actor.id, note });
}

export async function setRole(
  ctx: AppContext,
  actor: UserRow,
  userId: string,
  role: Role,
  ip: string,
): Promise<void> {
  if (actor.id === userId) throw new AppError(400, 'SELF_ACTION', 'You can’t change your own role');
  const [before] = await ctx.db.select({ role: users.role }).from(users).where(eq(users.id, userId));
  await ctx.db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, userId));
  await audit(ctx.db, {
    actorId: actor.id,
    action: 'user.role',
    targetType: 'user',
    targetId: userId,
    before,
    after: { role },
    ip,
  });
}

export async function logoutEverywhere(
  ctx: AppContext,
  actor: UserRow,
  userId: string,
  ip: string,
): Promise<void> {
  await ctx.db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), sql`${sessions.revokedAt} is null`));
  await audit(ctx.db, {
    actorId: actor.id,
    action: 'user.logout_all',
    targetType: 'user',
    targetId: userId,
    ip,
  });
}

/* ── queues ────────────────────────────────────────────────────────────────── */

export async function listPayoutsAdmin(ctx: AppContext, status?: string) {
  const rows = await ctx.db
    .select({ payout: payouts, email: users.email, fraudScore: users.fraudScore, country: users.country })
    .from(payouts)
    .innerJoin(users, eq(users.id, payouts.userId))
    .where(status ? eq(payouts.status, status as (typeof payouts.$inferSelect)['status']) : undefined)
    .orderBy(desc(payouts.requestedAt))
    .limit(200);
  return rows.map((r) => ({
    ...toPayoutDTO(r.payout),
    userId: r.payout.userId,
    email: r.email,
    fraudScore: r.fraudScore,
    country: r.country,
    reviewReasons: r.payout.reviewReasons,
  }));
}

export async function payoutsCsv(ctx: AppContext, status?: string): Promise<string> {
  const rows = await listPayoutsAdmin(ctx, status);
  const d = (m: number) => (m / 1_000_000).toFixed(2);
  const header =
    'id,requested_at,completed_at,email,country,method,status,amount_usd,fee_usd,net_usd,local_currency,local_amount,reference';
  const lines = rows.map((r) =>
    [
      r.id,
      r.requestedAt,
      r.completedAt ?? '',
      r.email,
      r.country,
      r.methodId,
      r.status,
      d(r.amountMicros),
      d(r.feeMicros),
      d(r.netMicros),
      r.localCurrency,
      r.localAmount,
      r.providerReference ?? '',
    ]
      .map((v) => `"${String(v).replaceAll('"', '""')}"`)
      .join(','),
  );
  return `${[header, ...lines].join('\n')}\n`;
}

export async function listFraudFlags(ctx: AppContext, status = 'open') {
  const rows = await ctx.db
    .select({ flag: fraudFlags, email: users.email, fraudScore: users.fraudScore, userStatus: users.status })
    .from(fraudFlags)
    .innerJoin(users, eq(users.id, fraudFlags.userId))
    .where(eq(fraudFlags.status, status as 'open'))
    .orderBy(desc(fraudFlags.severity), desc(fraudFlags.createdAt))
    .limit(200);
  return rows.map((r) => ({
    id: r.flag.id,
    userId: r.flag.userId,
    email: r.email,
    type: r.flag.type,
    label: FRAUD_SIGNAL_LABELS[r.flag.type] ?? r.flag.type,
    severity: r.flag.severity,
    occurrences: r.flag.occurrences,
    details: r.flag.details,
    status: r.flag.status,
    fraudScore: r.fraudScore,
    userStatus: r.userStatus,
    createdAt: r.flag.createdAt.toISOString(),
  }));
}

export async function resolveFraudFlag(
  ctx: AppContext,
  actor: UserRow,
  flagId: string,
  action: 'clear' | 'confirm' | 'require_kyc' | 'ban',
  note: string,
  reasonCode: BanReasonCode | undefined,
  ip: string,
): Promise<void> {
  const flag = (await ctx.db.select().from(fraudFlags).where(eq(fraudFlags.id, flagId)))[0];
  if (!flag) throw notFound('Flag');
  if (action === 'clear') await resolveFlag(ctx, ctx.db, flagId, 'clear', actor.id, note);
  else await resolveFlag(ctx, ctx.db, flagId, 'confirm', actor.id, note);
  if (action === 'require_kyc') {
    await ctx.db.update(users).set({ kycStatus: 'none' }).where(eq(users.id, flag.userId));
    await notify(ctx, ctx.db, flag.userId, {
      type: 'kyc_required',
      title: 'Please verify your identity',
      body: 'To keep cash-outs flowing we need a quick ID check. It takes about 2 minutes.',
      link: '/app/kyc',
      email: { category: 'security' },
    });
  }
  if (action === 'ban') await banUser(ctx, actor, flag.userId, reasonCode ?? 'other', note, ip);
  await audit(ctx.db, {
    actorId: actor.id,
    action: `fraud.${action}`,
    targetType: 'fraud_flag',
    targetId: flagId,
    after: { note },
    ip,
  });
}

export async function flagManually(
  ctx: AppContext,
  actor: UserRow,
  userId: string,
  severity: number,
  note: string,
): Promise<void> {
  await recordSignal(ctx, ctx.db, userId, 'manual', { note, by: actor.id }, { severity });
  await recomputeScore(ctx, ctx.db, userId);
}

export async function listClaimsAdmin(ctx: AppContext, status = 'needs_review') {
  const rows = await ctx.db
    .select({
      claim: claims,
      email: users.email,
      tier: users.tier,
      fraudScore: users.fraudScore,
      offerTitle: offers.title,
      networkName: networks.name,
    })
    .from(claims)
    .innerJoin(users, eq(users.id, claims.userId))
    .innerJoin(offers, eq(offers.id, claims.offerId))
    .innerJoin(networks, eq(networks.id, offers.networkId))
    .where(eq(claims.status, status as 'needs_review'))
    .orderBy(claims.slaDueAt)
    .limit(200);
  return rows.map((r) => ({
    id: r.claim.id,
    userId: r.claim.userId,
    email: r.email,
    tier: r.tier,
    fraudScore: r.fraudScore,
    offerTitle: r.offerTitle,
    networkName: r.networkName,
    amountMicros: r.claim.amountMicros,
    note: r.claim.note,
    status: r.claim.status,
    autoFiled: r.claim.autoFiled,
    hasScreenshot: Boolean(r.claim.screenshotPath),
    slaDueAt: r.claim.slaDueAt.toISOString(),
    createdAt: r.claim.createdAt.toISOString(),
    overdue: r.claim.slaDueAt < new Date(),
  }));
}

/* ── offers & reports ──────────────────────────────────────────────────────── */

export async function listOffersAdmin(ctx: AppContext) {
  const rows = await ctx.db
    .select({ offer: offers, networkName: networks.name })
    .from(offers)
    .innerJoin(networks, eq(networks.id, offers.networkId))
    .orderBy(desc(offers.createdAt));
  return rows.map(({ offer, networkName }) => ({
    ...offer,
    networkName,
    createdAt: offer.createdAt.toISOString(),
    updatedAt: offer.updatedAt.toISOString(),
  }));
}

export async function upsertOffer(
  ctx: AppContext,
  actor: UserRow,
  input: z.infer<typeof adminOfferUpsertSchema>,
  offerId: string | null,
  ip: string,
) {
  const values = {
    networkId: input.networkId,
    title: input.title,
    description: input.description,
    advertiser: input.advertiser,
    category: input.category,
    payoutMicros: input.payoutMicros,
    userPayoutOverrideMicros: input.userPayoutOverrideMicros ?? null,
    estMinutes: input.estMinutes,
    dataMb: input.dataMb,
    paySpeed: input.paySpeed,
    countries: input.countries,
    steps: input.steps,
    icon: input.icon,
    color: input.color,
    tags: input.tags,
    isLite: input.isLite,
    updatedAt: new Date(),
  };
  if (offerId) {
    const [row] = await ctx.db.update(offers).set(values).where(eq(offers.id, offerId)).returning();
    if (!row) throw notFound('Offer');
    await audit(ctx.db, {
      actorId: actor.id,
      action: 'offer.update',
      targetType: 'offer',
      targetId: offerId,
      after: values,
      ip,
    });
    return row;
  }
  const [row] = await ctx.db
    .insert(offers)
    .values({ ...values, networkOfferId: `manual_${Date.now().toString(36)}` })
    .returning();
  await audit(ctx.db, {
    actorId: actor.id,
    action: 'offer.create',
    targetType: 'offer',
    targetId: row!.id,
    after: values,
    ip,
  });
  return row!;
}

export async function setOfferStatus(
  ctx: AppContext,
  actor: UserRow,
  offerId: string,
  status: 'active' | 'paused' | 'removed' | 'scam',
  reason: string | undefined,
  ip: string,
) {
  const [row] = await ctx.db
    .update(offers)
    .set({ status, statusReason: reason ?? null, statusChangedAt: new Date(), updatedAt: new Date() })
    .where(eq(offers.id, offerId))
    .returning();
  if (!row) throw notFound('Offer');
  if (status === 'scam' || status === 'removed') {
    const reporters = await ctx.db
      .select({ userId: offerReports.userId })
      .from(offerReports)
      .where(and(eq(offerReports.offerId, offerId), eq(offerReports.status, 'open')));
    await ctx.db
      .update(offerReports)
      .set({ status: 'actioned', resolvedBy: actor.id, resolvedAt: new Date() })
      .where(and(eq(offerReports.offerId, offerId), eq(offerReports.status, 'open')));
    for (const r of reporters) {
      await notify(ctx, ctx.db, r.userId, {
        type: 'report_actioned',
        title: '🛡️ Thanks — your report helped',
        body: `We removed “${row.title}”${status === 'scam' ? ' and added it to our Wall of Shame' : ''}. You’re protecting other members.`,
        link: '/transparency',
      });
      await ctx.jobs.enqueue(ctx.db, 'engagement.achievements', { userId: r.userId });
    }
  }
  await refreshOfferStats(ctx.db, offerId);
  await audit(ctx.db, {
    actorId: actor.id,
    action: 'offer.status',
    targetType: 'offer',
    targetId: offerId,
    after: { status, reason },
    ip,
  });
}

export async function listReports(ctx: AppContext, status = 'open') {
  const rows = await ctx.db
    .select({
      report: offerReports,
      offerTitle: offers.title,
      offerStatus: offers.status,
      email: users.email,
    })
    .from(offerReports)
    .innerJoin(offers, eq(offers.id, offerReports.offerId))
    .innerJoin(users, eq(users.id, offerReports.userId))
    .where(eq(offerReports.status, status as 'open'))
    .orderBy(desc(offerReports.createdAt))
    .limit(200);
  return rows.map((r) => ({
    ...r.report,
    offerTitle: r.offerTitle,
    offerStatus: r.offerStatus,
    email: maskEmail(r.email),
    createdAt: r.report.createdAt.toISOString(),
  }));
}

export async function resolveReport(
  ctx: AppContext,
  actor: UserRow,
  reportId: string,
  action: 'actioned' | 'dismissed',
) {
  const [row] = await ctx.db
    .update(offerReports)
    .set({ status: action, resolvedBy: actor.id, resolvedAt: new Date() })
    .where(eq(offerReports.id, reportId))
    .returning();
  if (!row) throw notFound('Report');
  await refreshOfferStats(ctx.db, row.offerId);
}

/* ── postbacks, tickets, kyc, audit, jobs ──────────────────────────────────── */

export async function listPostbacks(
  ctx: AppContext,
  opts: { status?: string | undefined; networkId?: string | undefined },
) {
  const conds = [];
  if (opts.status) conds.push(eq(postbackLogs.status, opts.status as 'processed'));
  if (opts.networkId) conds.push(eq(postbackLogs.networkId, opts.networkId));
  const rows = await ctx.db
    .select()
    .from(postbackLogs)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(postbackLogs.createdAt))
    .limit(200);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export async function listTicketsAdmin(ctx: AppContext, status?: string) {
  const rows = await ctx.db
    .select({ ticket: tickets, email: users.email })
    .from(tickets)
    .leftJoin(users, eq(users.id, tickets.userId))
    .where(status ? eq(tickets.status, status as 'open') : undefined)
    .orderBy(tickets.slaDueAt)
    .limit(200);
  return rows.map((r) => ({
    id: r.ticket.id,
    subject: r.ticket.subject,
    category: r.ticket.category,
    status: r.ticket.status,
    priority: r.ticket.priority,
    email: r.email ?? r.ticket.email,
    userId: r.ticket.userId,
    slaDueAt: r.ticket.slaDueAt.toISOString(),
    overdue: r.ticket.slaDueAt < new Date() && r.ticket.status === 'open',
    createdAt: r.ticket.createdAt.toISOString(),
    updatedAt: r.ticket.updatedAt.toISOString(),
  }));
}

export async function listKyc(ctx: AppContext, status = 'pending') {
  const rows = await ctx.db
    .select({ sub: kycSubmissions, email: users.email })
    .from(kycSubmissions)
    .innerJoin(users, eq(users.id, kycSubmissions.userId))
    .where(eq(kycSubmissions.status, status as 'pending'))
    .orderBy(desc(kycSubmissions.createdAt));
  return rows.map(({ sub, email }) => ({
    id: sub.id,
    userId: sub.userId,
    email,
    idType: sub.idType,
    idNumberMasked: sub.idNumberMasked,
    fullName: sub.fullName,
    dateOfBirth: sub.dateOfBirth,
    hasDocument: Boolean(sub.documentPath),
    hasSelfie: Boolean(sub.selfiePath),
    status: sub.status,
    createdAt: sub.createdAt.toISOString(),
  }));
}

export async function listAudit(ctx: AppContext, opts: { action?: string | undefined }) {
  const rows = await ctx.db
    .select({ log: auditLogs, actor: users.email })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(opts.action ? ilike(auditLogs.action, `${opts.action}%`) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(300);
  return rows.map((r) => ({ ...r.log, actor: r.actor, createdAt: r.log.createdAt.toISOString() }));
}

export async function listJobs(ctx: AppContext, status = 'failed') {
  const rows = await ctx.db
    .select()
    .from(jobs)
    .where(eq(jobs.status, status as 'failed'))
    .orderBy(desc(jobs.createdAt))
    .limit(100);
  const depth = await ctx.db.execute<{ status: string; n: string }>(
    sql`select status, count(*) as n from jobs group by status`,
  );
  return {
    depth: Object.fromEntries(depth.rows.map((d) => [d.status, Number(d.n)])),
    jobs: rows.map((j) => ({ ...j, runAt: j.runAt.toISOString(), createdAt: j.createdAt.toISOString() })),
  };
}

export async function retryJob(ctx: AppContext, jobId: number): Promise<void> {
  const [row] = await ctx.db
    .update(jobs)
    .set({ status: 'queued', runAt: new Date(), attempts: 0, lastError: null })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, 'failed')))
    .returning();
  if (!row) throw conflict('NOT_FAILED', 'Only failed jobs can be retried');
}

export async function listNetworks(ctx: AppContext) {
  const rows = await ctx.db.select().from(networks);
  return rows.map(({ secretEnc, ...n }) => ({
    ...n,
    secretConfigured: Boolean(secretEnc),
    createdAt: n.createdAt.toISOString(),
  }));
}

export async function patchNetwork(
  ctx: AppContext,
  actor: UserRow,
  networkId: string,
  patch: { status?: 'active' | 'paused' | undefined; ipAllowlist?: string[] | undefined },
  ip: string,
) {
  const values: Partial<typeof networks.$inferInsert> = {};
  if (patch.status) values.status = patch.status;
  if (patch.ipAllowlist) values.ipAllowlist = patch.ipAllowlist;
  const [row] = await ctx.db.update(networks).set(values).where(eq(networks.id, networkId)).returning();
  if (!row) throw notFound('Network');
  await audit(ctx.db, {
    actorId: actor.id,
    action: 'network.update',
    targetType: 'network',
    targetId: networkId,
    after: patch,
    ip,
  });
}
