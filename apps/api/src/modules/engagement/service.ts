import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  ACHIEVEMENTS,
  type AchievementDTO,
  type LeaderboardDTO,
  type StreakDTO,
  TIERS,
  type TierProgressDTO,
  formatUsd,
  getTier,
} from '@cashads/shared';
import type { AppContext } from '../../context';
import type { DbOrTx } from '../../db/client';
import {
  achievements,
  conversions,
  dailyPlans,
  donations,
  lessonAttempts,
  offerReports,
  offers,
  payouts,
  pollResponses,
  referrals,
  streaks,
  users,
} from '../../db/schema';
import type { UserRow } from '../../http/auth';
import { AppError } from '../../lib/errors';
import { DAY, localDate, previousDate, startOfWeekUtc } from '../../lib/time';
import { notify } from '../platform/messaging';
import {
  EARNING_TXN_TYPES,
  SYS,
  lifetimeEarnedMicros,
  postTransaction,
  userAccountCode,
} from '../wallet/ledger';

/* ── achievements ──────────────────────────────────────────────────────────── */

export async function evaluateAchievements(ctx: AppContext, db: DbOrTx, userId: string): Promise<string[]> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return [];
  const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const [tasks, polls, lessons, paid, streak, plans, refs, gifts, protector, earned] = await Promise.all([
    count(
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(conversions)
        .where(and(eq(conversions.userId, userId), eq(conversions.status, 'credited'))),
    ),
    count(
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(pollResponses)
        .where(eq(pollResponses.userId, userId)),
    ),
    count(
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(lessonAttempts)
        .where(and(eq(lessonAttempts.userId, userId), eq(lessonAttempts.passed, true))),
    ),
    count(
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(payouts)
        .where(and(eq(payouts.userId, userId), eq(payouts.status, 'completed'))),
    ),
    db.select().from(streaks).where(eq(streaks.userId, userId)),
    count(
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(dailyPlans)
        .where(and(eq(dailyPlans.userId, userId), eq(dailyPlans.bonusPaid, true))),
    ),
    count(
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(referrals)
        .where(and(eq(referrals.referrerId, userId), eq(referrals.status, 'qualified'))),
    ),
    count(
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(donations)
        .where(eq(donations.userId, userId)),
    ),
    count(
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(offerReports)
        .innerJoin(offers, eq(offers.id, offerReports.offerId))
        .where(and(eq(offerReports.userId, userId), inArray(offers.status, ['scam', 'removed']))),
    ),
    lifetimeEarnedMicros(db, userId),
  ]);
  const totalTasks = tasks + polls + lessons;
  const longest = (streak as { longest: number }[])[0]?.longest ?? 0;
  const unlocked = new Set<string>();
  if (totalTasks >= 1) unlocked.add('first_task');
  if (totalTasks >= 10) unlocked.add('tasks_10');
  if (totalTasks >= 50) unlocked.add('tasks_50');
  if (paid >= 1) unlocked.add('first_payout');
  if (earned >= 1_000_000) unlocked.add('earned_1');
  if (earned >= 10_000_000) unlocked.add('earned_10');
  if (earned >= 50_000_000) unlocked.add('earned_50');
  if (longest >= 3) unlocked.add('streak_3');
  if (longest >= 7) unlocked.add('streak_7');
  if (longest >= 30) unlocked.add('streak_30');
  if (plans >= 1) unlocked.add('plan_complete');
  if (refs >= 1) unlocked.add('referral_1');
  if (lessons >= 3) unlocked.add('learner');
  if (gifts >= 1) unlocked.add('giver');
  if (protector >= 1) unlocked.add('protector');
  if (user.phoneVerifiedAt) unlocked.add('verified');

  const have = await db
    .select({ code: achievements.code })
    .from(achievements)
    .where(eq(achievements.userId, userId));
  const haveSet = new Set(have.map((h) => h.code));
  const fresh = [...unlocked].filter((c) => !haveSet.has(c));
  for (const code of fresh) {
    const inserted = await db.insert(achievements).values({ userId, code }).onConflictDoNothing().returning();
    const def = ACHIEVEMENTS.find((a) => a.code === code);
    if (inserted.length && def) {
      await notify(ctx, db, userId, {
        type: 'achievement',
        title: `${def.icon} Achievement unlocked: ${def.title}`,
        body: def.description,
        link: '/app/achievements',
      });
    }
  }
  return fresh;
}

export async function listAchievements(db: DbOrTx, userId: string): Promise<AchievementDTO[]> {
  const rows = await db.select().from(achievements).where(eq(achievements.userId, userId));
  const at = new Map(rows.map((r) => [r.code, r.unlockedAt.toISOString()]));
  return ACHIEVEMENTS.map((a) => ({ ...a, unlockedAt: at.get(a.code) ?? null }));
}

/* ── tiers ─────────────────────────────────────────────────────────────────── */

export async function tierProgress(ctx: AppContext, db: DbOrTx, user: UserRow): Promise<TierProgressDTO> {
  const lifetime = await lifetimeEarnedMicros(db, user.id);
  const ageDays = Math.floor((Date.now() - user.createdAt.getTime()) / DAY);
  const current = getTier(user.tier);
  const idx = TIERS.findIndex((t) => t.id === current.id);
  return {
    current,
    next: TIERS[idx + 1] ?? null,
    lifetimeMicros: lifetime,
    accountAgeDays: ageDays,
    kycVerified: user.kycStatus === 'verified',
  };
}

export async function recomputeTier(ctx: AppContext, db: DbOrTx, userId: string): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return;
  const lifetime = await lifetimeEarnedMicros(db, userId);
  const ageDays = (Date.now() - user.createdAt.getTime()) / DAY;
  const trusted = user.fraudScore <= ctx.settings.get().autoApproveMaxFraudScore && user.status === 'active';
  let next = TIERS[0]!;
  if (trusted) {
    for (const t of TIERS) {
      if (
        lifetime >= t.minLifetimeMicros &&
        ageDays >= t.minAccountAgeDays &&
        (!t.requiresKyc || user.kycStatus === 'verified')
      )
        next = t;
    }
  }
  if (next.id !== user.tier) {
    await db.update(users).set({ tier: next.id }).where(eq(users.id, userId));
    const up = TIERS.findIndex((t) => t.id === next.id) > TIERS.findIndex((t) => t.id === user.tier);
    if (up) {
      await notify(ctx, db, userId, {
        type: 'tier_up',
        title: `You reached ${next.name} tier`,
        body: next.perks[0] ?? 'New perks unlocked.',
        link: '/app/achievements',
      });
    }
  }
}

/* ── daily streak (resets at the member's own midnight) ────────────────────── */

export function streakReward(
  day: number,
  s: { streakBaseMicros: number; streakStepMicros: number; streakMaxMicros: number },
): number {
  return Math.min(s.streakMaxMicros, s.streakBaseMicros + s.streakStepMicros * Math.max(0, day - 1));
}

export async function getStreak(ctx: AppContext, user: UserRow): Promise<StreakDTO> {
  const s = ctx.settings.get();
  const rows = await ctx.db.select().from(streaks).where(eq(streaks.userId, user.id));
  const row = rows[0];
  const today = localDate(user.timezone);
  const claimedToday = row?.lastClaimDate === today;
  const alive = row && (row.lastClaimDate === today || row.lastClaimDate === previousDate(today));
  const current = alive ? row.current : 0;
  // The next claimable day is always current + 1 (today if unclaimed, otherwise tomorrow).
  const nextDay = current + 1;
  return {
    current,
    longest: row?.longest ?? 0,
    claimedToday,
    todayRewardMicros: claimedToday ? streakReward(current, s) : streakReward(nextDay, s),
    upcoming: Array.from({ length: 7 }, (_, i) => ({
      day: nextDay + i,
      rewardMicros: streakReward(nextDay + i, s),
    })),
    lastClaimDate: row?.lastClaimDate ?? null,
  };
}

export async function claimStreak(
  ctx: AppContext,
  user: UserRow,
): Promise<{ rewardMicros: number; streak: number }> {
  const s = ctx.settings.get();
  const today = localDate(user.timezone);
  const result = await ctx.db.transaction(async (tx) => {
    await tx.insert(streaks).values({ userId: user.id }).onConflictDoNothing();
    const [row] = await tx.select().from(streaks).where(eq(streaks.userId, user.id)).for('update');
    if (row!.lastClaimDate === today)
      throw new AppError(
        409,
        'ALREADY_CLAIMED',
        'You already claimed today’s streak bonus. Come back tomorrow!',
      );
    const current = row!.lastClaimDate === previousDate(today) ? row!.current + 1 : 1;
    const reward = streakReward(current, s);
    await tx
      .update(streaks)
      .set({ current, longest: Math.max(row!.longest, current), lastClaimDate: today, updatedAt: new Date() })
      .where(eq(streaks.userId, user.id));
    if (reward > 0) {
      await postTransaction(tx, {
        type: 'bonus_streak',
        userId: user.id,
        idempotencyKey: `streak:${user.id}:${today}`,
        description: `Day ${current} streak bonus`,
        referenceType: 'streak',
        referenceId: today,
        entries: [
          { account: SYS.bonusExpense, direction: 'debit', amount: reward },
          { account: userAccountCode(user.id), direction: 'credit', amount: reward },
        ],
      });
    }
    await ctx.jobs.enqueue(tx, 'engagement.achievements', { userId: user.id });
    return { rewardMicros: reward, streak: current };
  });
  ctx.events.toUser(user.id, 'balance', { reason: 'bonus_streak', amountMicros: result.rewardMicros });
  return result;
}

/* ── weekly leaderboard (opt-in names; "you're in the top X%") ─────────────── */

export async function leaderboard(ctx: AppContext, user: UserRow): Promise<LeaderboardDTO> {
  const start = startOfWeekUtc();
  const end = new Date(start.getTime() + 7 * DAY);
  const earningTypes = sql.join(
    EARNING_TXN_TYPES.map((t) => sql`${t}`),
    sql`, `,
  );
  const res = await ctx.db.execute<{
    user_id: string;
    earned: string | number;
    display_name: string | null;
    prefs: { leaderboardOptIn?: boolean } | null;
    tier: string;
  }>(sql`
    select t.user_id, sum(e.amount_micros) as earned, u.display_name, u.prefs, u.tier
    from ledger_transactions t
    join ledger_entries e on e.transaction_id = t.id and e.direction = 'credit'
    join ledger_accounts a on a.id = e.account_id and a.kind = 'user_available'
    join users u on u.id = t.user_id
    where t.type in (${earningTypes}) and t.created_at >= ${start} and u.status = 'active'
    group by t.user_id, u.display_name, u.prefs, u.tier
    order by earned desc`);
  const rows = res.rows.map((r, i) => ({ ...r, rank: i + 1, earned: Number(r.earned) }));
  const meRow = rows.find((r) => r.user_id === user.id);
  const optedIn = Boolean(user.prefs?.leaderboardOptIn);
  return {
    period: 'week',
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    entries: rows.slice(0, 20).map((r) => ({
      rank: r.rank,
      name:
        r.user_id === user.id
          ? 'You'
          : r.prefs?.leaderboardOptIn && r.display_name
            ? r.display_name
            : `Member #${r.user_id.slice(0, 4).toUpperCase()}`,
      earnedMicros: r.earned,
      isMe: r.user_id === user.id,
      tier: r.tier,
    })),
    me: {
      rank: meRow?.rank ?? null,
      earnedMicros: meRow?.earned ?? 0,
      percentile: meRow ? Math.max(1, Math.ceil((meRow.rank / rows.length) * 100)) : null,
      optedIn,
    },
  };
}

/* ── earning velocity check (fraud) ────────────────────────────────────────── */

export async function earningsInLastHour(db: DbOrTx, userId: string): Promise<number> {
  const res = await db.execute<{ total: string | number | null }>(sql`
    select coalesce(sum(e.amount_micros), 0) as total
    from ledger_transactions t
    join ledger_entries e on e.transaction_id = t.id and e.direction = 'credit'
    join ledger_accounts a on a.id = e.account_id and a.code = ${userAccountCode(userId)}
    where t.type in (${sql.join(
      EARNING_TXN_TYPES.map((t) => sql`${t}`),
      sql`, `,
    )}) and t.created_at > now() - interval '1 hour'`);
  return Number(res.rows[0]?.total ?? 0);
}

export function describeReward(amount: number): string {
  return `+${formatUsd(amount)}`;
}

export async function recentAchievementsCount(db: DbOrTx, userId: string, since: Date): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(achievements)
    .where(and(eq(achievements.userId, userId), gte(achievements.unlockedAt, since)));
  return rows[0]?.n ?? 0;
}

export async function latestNotificationsForUser(db: DbOrTx, userId: string) {
  return db
    .select()
    .from(achievements)
    .where(eq(achievements.userId, userId))
    .orderBy(desc(achievements.unlockedAt))
    .limit(5);
}
