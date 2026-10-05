import { and, desc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import {
  ACHIEVEMENTS,
  addDaysToKey,
  dayKey,
  formatMoney,
  hourlyRate,
  streakBonusFor,
  TIER_BY_ID,
  TIERS,
  type AchievementDTO,
  type AchievementMetric,
  type DailyPlanDTO,
  type EngagementSummaryDTO,
  type LeaderboardDTO,
  type StreakDTO,
  type TierId,
  type TierProgressDTO,
} from '@cashads/shared';
import type { AppContext, Uow } from '../../context';
import type { Q } from '../../db/client';
import {
  checkins,
  offerClicks,
  offers,
  payouts,
  planClaims,
  referrals,
  transactions,
  userAchievements,
  users,
  videoSessions,
  wallets,
} from '../../db/schema';
import { conflict, badRequest } from '../../lib/errors';
import { clock, DAY } from '../../lib/clock';
import { publicName } from '../../lib/mask';
import { notify } from '../notifications/service';
import { creditUser } from '../rewards/service';
import { acct } from '../wallet/ledger';

type UserRow = typeof users.$inferSelect;
const EARNING_TYPES = ['offer', 'video', 'goodwill'] as const;

/* ------------------------------------------------------------------ tiers */

function tierEligible(u: UserRow, lifetime: number, tier: (typeof TIERS)[number]): string[] {
  const missing: string[] = [];
  if (lifetime < tier.minLifetimeMicros) missing.push(`Earn ${formatMoney(tier.minLifetimeMicros - lifetime)} more`);
  const ageDays = (clock.ms() - u.createdAt.getTime()) / DAY;
  if (ageDays < tier.minAccountAgeDays) missing.push(`Account age ${tier.minAccountAgeDays} days (${Math.ceil(tier.minAccountAgeDays - ageDays)} to go)`);
  if (tier.requires.includes('email') && !u.emailVerifiedAt) missing.push('Verify your email');
  if (tier.requires.includes('phone') && !u.phoneVerifiedAt) missing.push('Verify your phone');
  if (tier.requires.includes('kyc') && u.kycStatus !== 'verified') missing.push('Verify your identity');
  return missing;
}

export async function tierProgress(q: Q, u: UserRow): Promise<TierProgressDTO> {
  const [w] = await q.select({ lifetime: wallets.lifetimeEarnedMicros }).from(wallets).where(eq(wallets.userId, u.id));
  const lifetime = w?.lifetime ?? 0;
  const idx = TIERS.findIndex((t) => t.id === u.tier);
  const next = TIERS[idx + 1] ?? null;
  return {
    current: u.tier,
    next: next?.id ?? null,
    lifetimeMicros: lifetime,
    nextThresholdMicros: next?.minLifetimeMicros ?? null,
    missing: next ? tierEligible(u, lifetime, next) : [],
  };
}

/** Tiers only go up automatically (staff can override). */
export async function recomputeTier(uow: Uow, userId: string): Promise<TierId> {
  const [u] = await uow.tx.select().from(users).where(eq(users.id, userId));
  if (!u) return 'bronze';
  const [w] = await uow.tx.select({ lifetime: wallets.lifetimeEarnedMicros }).from(wallets).where(eq(wallets.userId, userId));
  const lifetime = w?.lifetime ?? 0;
  let best: TierId = 'bronze';
  for (const t of TIERS) if (tierEligible(u, lifetime, t).length === 0) best = t.id;
  const rank = (id: TierId) => TIERS.findIndex((t) => t.id === id);
  if (rank(best) > rank(u.tier)) {
    await uow.tx.update(users).set({ tier: best, updatedAt: clock.now() }).where(eq(users.id, userId));
    const def = TIER_BY_ID[best];
    await notify(uow, userId, {
      type: 'tier',
      title: `You reached ${def.label} 🎉`,
      body: def.perks.join(' · '),
      link: '/app/rewards',
    });
    return best;
  }
  return u.tier;
}

/* ----------------------------------------------------------- achievements */

export async function achievementMetrics(q: Q, userId: string): Promise<Record<AchievementMetric, number>> {
  const [[offersRow], [payoutsRow], [w], [u], [refRow], [videoRow], [learnRow]] = await Promise.all([
    q
      .select({ n: sql<number>`count(*)::int` })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.type, 'offer'), inArray(transactions.status, ['pending', 'completed']))),
    q.select({ n: sql<number>`count(*)::int` }).from(payouts).where(and(eq(payouts.userId, userId), eq(payouts.status, 'completed'))),
    q.select({ lifetime: wallets.lifetimeEarnedMicros }).from(wallets).where(eq(wallets.userId, userId)),
    q.select({ best: users.streakBest }).from(users).where(eq(users.id, userId)),
    q.select({ n: sql<number>`count(*)::int` }).from(referrals).where(and(eq(referrals.referrerId, userId), eq(referrals.status, 'qualified'))),
    q.select({ n: sql<number>`count(*)::int` }).from(videoSessions).where(and(eq(videoSessions.userId, userId), eq(videoSessions.status, 'completed'))),
    q
      .select({ n: sql<number>`count(*)::int` })
      .from(offerClicks)
      .innerJoin(offers, eq(offers.id, offerClicks.offerId))
      .where(and(eq(offerClicks.userId, userId), eq(offers.category, 'learn'), eq(offerClicks.status, 'credited'))),
  ]);
  return {
    offers: Number(offersRow?.n ?? 0),
    payouts: Number(payoutsRow?.n ?? 0),
    earned: w?.lifetime ?? 0,
    streak: u?.best ?? 0,
    referrals: Number(refRow?.n ?? 0),
    videos: Number(videoRow?.n ?? 0),
    learn: Number(learnRow?.n ?? 0),
  };
}

export async function checkAchievements(uow: Uow, userId: string): Promise<string[]> {
  const unlockedRows = await uow.tx.select({ id: userAchievements.achievementId }).from(userAchievements).where(eq(userAchievements.userId, userId));
  const unlocked = new Set(unlockedRows.map((r) => r.id));
  const pending = ACHIEVEMENTS.filter((a) => !unlocked.has(a.id));
  if (!pending.length) return [];
  const metrics = await achievementMetrics(uow.tx, userId);
  const newly: string[] = [];
  for (const a of pending) {
    if (metrics[a.metric] < a.threshold) continue;
    const inserted = await uow.tx
      .insert(userAchievements)
      .values({ userId, achievementId: a.id, unlockedAt: clock.now() })
      .onConflictDoNothing()
      .returning();
    if (!inserted.length) continue;
    newly.push(a.id);
    if (a.rewardMicros > 0) {
      await creditUser(uow, {
        userId,
        type: 'achievement_bonus',
        description: `Achievement: ${a.title}`,
        idempotencyKey: `achievement:${userId}:${a.id}`,
        amountMicros: a.rewardMicros,
        source: { account: acct.marketing },
        earning: false,
        celebrate: false,
      });
    }
    await notify(uow, userId, {
      type: 'achievement',
      title: `${a.emoji} Achievement unlocked: ${a.title}`,
      body: `${a.description}${a.rewardMicros ? ` — ${formatMoney(a.rewardMicros)} added to your balance.` : ''}`,
      link: '/app/rewards',
    });
  }
  return newly;
}

export async function listAchievements(ctx: AppContext, userId: string): Promise<AchievementDTO[]> {
  const [rows, metrics] = await Promise.all([
    ctx.db.select().from(userAchievements).where(eq(userAchievements.userId, userId)),
    achievementMetrics(ctx.db, userId),
  ]);
  const map = new Map(rows.map((r) => [r.achievementId, r.unlockedAt]));
  return ACHIEVEMENTS.map((a) => ({
    id: a.id,
    title: a.title,
    description: a.description,
    emoji: a.emoji,
    rewardMicros: a.rewardMicros,
    threshold: a.threshold,
    progress: Math.min(metrics[a.metric], a.threshold),
    unlockedAt: map.get(a.id)?.toISOString() ?? null,
  }));
}

/* ---------------------------------------------------------------- streaks */

export async function streakInfo(q: Q, u: UserRow): Promise<StreakDTO> {
  const today = dayKey(clock.now(), u.timezone);
  const yesterday = addDaysToKey(today, -1);
  const alive = u.lastCheckinDay === today || u.lastCheckinDay === yesterday;
  const current = alive ? u.streakCurrent : 0;
  const checkedInToday = u.lastCheckinDay === today;
  const from = addDaysToKey(today, -6);
  const rows = await q
    .select({ day: checkins.day })
    .from(checkins)
    .where(and(eq(checkins.userId, u.id), gte(checkins.day, from)));
  const set = new Set(rows.map((r) => r.day));
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = addDaysToKey(from, i);
    return { day: d, checked: set.has(d) };
  });
  return {
    current,
    best: u.streakBest,
    checkedInToday,
    todayBonusMicros: streakBonusFor(checkedInToday ? current : current + 1),
    nextBonusMicros: streakBonusFor((checkedInToday ? current : current + 1) + 1),
    last7,
  };
}

export async function checkin(uow: Uow, userId: string): Promise<{ streak: number; bonusMicros: number }> {
  const [u] = await uow.tx.select().from(users).where(eq(users.id, userId)).for('update');
  if (!u) throw badRequest('User not found');
  if (u.status !== 'active') throw badRequest('Check-ins are paused while your account is under review', 'account_not_active');
  const today = dayKey(clock.now(), u.timezone);
  if (u.lastCheckinDay === today) throw conflict('You already checked in today — come back tomorrow!', 'already_checked_in');
  const streak = u.lastCheckinDay === addDaysToKey(today, -1) ? u.streakCurrent + 1 : 1;
  const bonus = streakBonusFor(streak);
  const inserted = await uow.tx.insert(checkins).values({ userId, day: today, streak, bonusMicros: bonus, createdAt: clock.now() }).onConflictDoNothing().returning();
  if (!inserted.length) throw conflict('You already checked in today — come back tomorrow!', 'already_checked_in');
  await uow.tx
    .update(users)
    .set({ streakCurrent: streak, streakBest: Math.max(u.streakBest, streak), lastCheckinDay: today, updatedAt: clock.now() })
    .where(eq(users.id, userId));
  await creditUser(uow, {
    userId,
    type: 'streak_bonus',
    description: `Day ${streak} streak bonus`,
    idempotencyKey: `streak:${userId}:${today}`,
    amountMicros: bonus,
    source: { account: acct.marketing },
    earning: false,
  });
  await checkAchievements(uow, userId);
  return { streak, bonusMicros: bonus };
}

/* ------------------------------------------------------------- daily plan */

function seededRandom(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function dailyPlan(q: Q, u: UserRow, revenueShareBps: number, planBonusMicros: number): Promise<DailyPlanDTO> {
  const today = dayKey(clock.now(), u.timezone);
  const startOfWindow = new Date(clock.ms() - 2 * DAY);
  const clicks = await q
    .select({ offerId: offerClicks.offerId, status: offerClicks.status, creditedAt: offerClicks.creditedAt })
    .from(offerClicks)
    .where(and(eq(offerClicks.userId, u.id), eq(offerClicks.status, 'credited')));
  const creditedBeforeToday = new Set(clicks.filter((c) => c.creditedAt && dayKey(c.creditedAt, u.timezone) !== today).map((c) => c.offerId));
  const creditedToday = new Set(clicks.filter((c) => c.creditedAt && dayKey(c.creditedAt, u.timezone) === today).map((c) => c.offerId));
  void startOfWindow;

  const all = await q.select().from(offers).where(eq(offers.status, 'active'));
  const eligible = all.filter(
    (o) =>
      !creditedBeforeToday.has(o.id) &&
      (o.countries.length === 0 || o.countries.includes(u.country)) &&
      (o.medianMinutes ?? o.estimatedMinutes) <= 15 &&
      o.goals.length === 0,
  );
  const interests = new Set(u.preferences?.interests ?? []);
  const rand = seededRandom(`${u.id}:${today}`);
  const scored = eligible
    .map((o) => {
      const pay = Math.floor((o.partnerPayoutMicros * revenueShareBps) / 10_000);
      const rate = hourlyRate(pay, o.medianMinutes ?? o.estimatedMinutes);
      return { o, pay, score: rate * (interests.has(o.category) ? 1.3 : 1) * (0.85 + rand() * 0.3) };
    })
    .sort((a, b) => b.score - a.score);

  const picked: typeof scored = [];
  const quick = scored.find((s) => s.o.category === 'poll' || ((s.o.medianMinutes ?? s.o.estimatedMinutes) <= 5 && s.o.category === 'survey'));
  if (quick) picked.push(quick);
  for (const s of scored) {
    if (picked.length >= 3) break;
    if (picked.some((p) => p.o.id === s.o.id || p.o.category === s.o.category)) continue;
    picked.push(s);
  }
  for (const s of scored) {
    if (picked.length >= 3) break;
    if (!picked.some((p) => p.o.id === s.o.id)) picked.push(s);
  }

  const items = picked.map((s) => ({
    offerId: s.o.id,
    title: s.o.title,
    icon: s.o.icon,
    category: s.o.category,
    userPayoutMicros: s.pay,
    estimatedMinutes: Math.round((s.o.medianMinutes ?? s.o.estimatedMinutes) * 10) / 10,
    done: creditedToday.has(s.o.id),
  }));
  const [claim] = await q.select().from(planClaims).where(and(eq(planClaims.userId, u.id), eq(planClaims.day, today)));
  return {
    day: today,
    items,
    totalMicros: items.reduce((s, i) => s + i.userPayoutMicros, 0),
    totalMinutes: Math.round(items.reduce((s, i) => s + i.estimatedMinutes, 0)),
    completed: items.filter((i) => i.done).length,
    bonusMicros: planBonusMicros,
    bonusClaimed: !!claim,
  };
}

export async function claimPlanBonus(uow: Uow, u: UserRow): Promise<number> {
  const s = uow.ctx.settings.get();
  const plan = await dailyPlan(uow.tx, u, s.revenueShareBps, s.planBonusMicros);
  if (plan.items.length === 0 || plan.completed < plan.items.length) throw badRequest('Finish all tasks in today’s plan first', 'plan_incomplete');
  const inserted = await uow.tx.insert(planClaims).values({ userId: u.id, day: plan.day, bonusMicros: s.planBonusMicros, createdAt: clock.now() }).onConflictDoNothing().returning();
  if (!inserted.length) throw conflict('Plan bonus already claimed today', 'already_claimed');
  await creditUser(uow, {
    userId: u.id,
    type: 'plan_bonus',
    description: 'Daily plan complete',
    idempotencyKey: `plan:${u.id}:${plan.day}`,
    amountMicros: s.planBonusMicros,
    source: { account: acct.marketing },
    earning: false,
  });
  return s.planBonusMicros;
}

/* ------------------------------------------------------------ leaderboard */

/**
 * Rolling windows (last 7 / 30 days) rather than calendar weeks: always populated,
 * identical for every timezone, and "today" can never exceed "this week".
 */
export function periodWindow(period: 'week' | 'month', now = clock.now()): { start: Date; end: Date } {
  const days = period === 'month' ? 30 : 7;
  return { start: new Date(now.getTime() - days * DAY), end: new Date(now.getTime() + 1000) };
}

export async function leaderboard(ctx: AppContext, me: UserRow | null, period: 'week' | 'month'): Promise<LeaderboardDTO> {
  const { start, end } = periodWindow(period);
  const totals = ctx.db
    .select({
      userId: transactions.userId,
      earned: sql<string>`sum(${transactions.amountMicros})`.as('earned'),
    })
    .from(transactions)
    .where(
      and(
        inArray(transactions.type, [...EARNING_TYPES]),
        inArray(transactions.status, ['pending', 'completed']),
        gte(transactions.createdAt, start),
        lt(transactions.createdAt, end),
      ),
    )
    .groupBy(transactions.userId)
    .as('totals');
  const rows = await ctx.db
    .select({
      userId: totals.userId,
      earned: totals.earned,
      displayName: users.displayName,
      country: users.country,
      tier: users.tier,
      preferences: users.preferences,
    })
    .from(totals)
    .innerJoin(users, eq(users.id, totals.userId))
    .where(and(eq(users.status, 'active'), ne(users.role, 'admin')))
    .orderBy(desc(totals.earned));

  const entries = rows.slice(0, 50).map((r, i) => ({
    rank: i + 1,
    name: r.preferences?.leaderboardOptIn === false ? 'Anonymous member' : publicName(r.displayName),
    country: r.country,
    tier: r.tier,
    earnedMicros: Number(r.earned),
    isMe: r.userId === me?.id,
  }));
  const myIndex = me ? rows.findIndex((r) => r.userId === me.id) : -1;
  const myEarned = myIndex >= 0 ? Number(rows[myIndex].earned) : 0;
  return {
    period,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    entries,
    me: {
      rank: myIndex >= 0 ? myIndex + 1 : null,
      earnedMicros: myEarned,
      percentile: myIndex >= 0 ? Math.max(1, Math.round(((myIndex + 1) / rows.length) * 100)) : null,
      optedIn: me?.preferences?.leaderboardOptIn !== false,
    },
    participants: rows.length,
  };
}

/* ---------------------------------------------------------------- summary */

export async function engagementSummary(ctx: AppContext, u: UserRow): Promise<EngagementSummaryDTO> {
  const s = ctx.settings.get();
  const today = dayKey(clock.now(), u.timezone);
  const { start: weekStart } = periodWindow('week');
  const [streak, tier, plan, unlocked, earnedRows, board] = await Promise.all([
    streakInfo(ctx.db, u),
    tierProgress(ctx.db, u),
    dailyPlan(ctx.db, u, s.revenueShareBps, s.planBonusMicros),
    ctx.db.select({ n: sql<number>`count(*)::int` }).from(userAchievements).where(eq(userAchievements.userId, u.id)),
    ctx.db
      .select({ amount: transactions.amountMicros, createdAt: transactions.createdAt, type: transactions.type })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, u.id),
          gte(transactions.createdAt, new Date(Math.min(weekStart.getTime(), clock.ms() - 2 * DAY))),
          inArray(transactions.status, ['pending', 'completed']),
          sql`${transactions.amountMicros} > 0`,
          ne(transactions.type, 'payout_refund'),
        ),
      ),
    leaderboard(ctx, u, 'week'),
  ]);
  const earnedTodayMicros = earnedRows.filter((r) => dayKey(r.createdAt, u.timezone) === today).reduce((a, r) => a + r.amount, 0);
  const earnedWeekMicros = earnedRows.filter((r) => r.createdAt >= weekStart).reduce((a, r) => a + r.amount, 0);
  return {
    streak,
    tier,
    plan,
    achievementsUnlocked: Number(unlocked[0]?.n ?? 0),
    achievementsTotal: ACHIEVEMENTS.length,
    earnedTodayMicros,
    earnedWeekMicros,
    weekRankPercentile: board.me.percentile,
  };
}
