import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { FeedItemDTO, PublicStatsDTO } from '@cashads/shared';
import type { AppContext } from '../../context';
import { claims, contactMessages, offers, payoutMethods, payouts, users } from '../../db/schema';
import { clock, DAY } from '../../lib/clock';
import { publicName } from '../../lib/mask';
import { postbackStats } from '../postbacks/service';

let statsCache: { at: number; value: PublicStatsDTO } | null = null;

/** Every number on the Transparency page is computed from real ledger data — never hard-coded. */
export async function publicStats(ctx: AppContext, fresh = false): Promise<PublicStatsDTO> {
  if (!fresh && statsCache && Date.now() - statsCache.at < 30_000) return statsCache.value;
  const since30 = new Date(clock.ms() - 30 * DAY);
  const since24 = new Date(clock.ms() - DAY);
  const [[totals], [timing], pb, [claimRow], [offerCount], methods] = await Promise.all([
    ctx.db
      .select({
        total: sql<string>`coalesce(sum(${payouts.netMicros}), 0)`,
        count: sql<number>`count(*)::int`,
        users: sql<number>`count(distinct ${payouts.userId})::int`,
        last24: sql<string>`coalesce(sum(${payouts.netMicros}) filter (where ${payouts.completedAt} >= ${since24}), 0)`,
        largest: sql<string>`coalesce(max(${payouts.netMicros}), 0)`,
      })
      .from(payouts)
      .where(eq(payouts.status, 'completed')),
    ctx.db
      .select({
        median: sql<number | null>`percentile_cont(0.5) within group (order by extract(epoch from (${payouts.completedAt} - ${payouts.createdAt})))`,
        p90: sql<number | null>`percentile_cont(0.9) within group (order by extract(epoch from (${payouts.completedAt} - ${payouts.createdAt})))`,
      })
      .from(payouts)
      .where(and(eq(payouts.status, 'completed'), gte(payouts.completedAt, since30))),
    postbackStats(ctx, 30),
    ctx.db
      .select({
        resolved: sql<number>`count(*) filter (where ${claims.status} in ('approved','auto_approved','rejected'))::int`,
        approved: sql<number>`count(*) filter (where ${claims.status} in ('approved','auto_approved'))::int`,
        medianHours: sql<number | null>`percentile_cont(0.5) within group (order by extract(epoch from (${claims.resolvedAt} - ${claims.createdAt})) / 3600) filter (where ${claims.resolvedAt} is not null)`,
      })
      .from(claims)
      .where(gte(claims.createdAt, new Date(clock.ms() - 90 * DAY))),
    ctx.db.select({ n: sql<number>`count(*)::int` }).from(offers).where(eq(offers.status, 'active')),
    ctx.db
      .select({ name: payoutMethods.name, logo: payoutMethods.logo, count: sql<number>`count(*)::int` })
      .from(payouts)
      .innerJoin(payoutMethods, eq(payoutMethods.id, payouts.methodId))
      .where(eq(payouts.status, 'completed'))
      .groupBy(payoutMethods.name, payoutMethods.logo)
      .orderBy(desc(sql`count(*)`))
      .limit(6),
  ]);
  const value: PublicStatsDTO = {
    totalPaidMicros: Number(totals.total),
    payoutsCount: Number(totals.count),
    usersPaid: Number(totals.users),
    paidLast24hMicros: Number(totals.last24),
    medianPayoutSeconds: timing?.median != null ? Math.round(Number(timing.median)) : null,
    p90PayoutSeconds: timing?.p90 != null ? Math.round(Number(timing.p90)) : null,
    trackingSuccessRate: pb.successRate,
    claimsApprovedRate: Number(claimRow.resolved) > 0 ? Number(claimRow.approved) / Number(claimRow.resolved) : null,
    medianClaimHours: claimRow.medianHours != null ? Math.round(Number(claimRow.medianHours) * 10) / 10 : null,
    revenueShareBps: ctx.settings.get().revenueShareBps,
    activeOffers: Number(offerCount.n),
    largestPayoutMicros: Number(totals.largest),
    methods: methods.map((m) => ({ name: m.name, logo: m.logo, count: Number(m.count) })),
    updatedAt: clock.now().toISOString(),
  };
  statsCache = { at: Date.now(), value };
  return value;
}

export async function publicFeed(ctx: AppContext, limit = 20): Promise<FeedItemDTO[]> {
  const rows = await ctx.db
    .select({
      id: payouts.id,
      net: payouts.netMicros,
      createdAt: payouts.createdAt,
      completedAt: payouts.completedAt,
      name: users.displayName,
      country: users.country,
      prefs: users.preferences,
      methodName: payoutMethods.name,
      logo: payoutMethods.logo,
    })
    .from(payouts)
    .innerJoin(users, eq(users.id, payouts.userId))
    .innerJoin(payoutMethods, eq(payoutMethods.id, payouts.methodId))
    .where(and(eq(payouts.status, 'completed'), inArray(users.status, ['active', 'restricted'])))
    .orderBy(desc(payouts.completedAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    name: r.prefs?.leaderboardOptIn === false ? 'A member' : publicName(r.name),
    country: r.country,
    methodName: r.methodName,
    methodLogo: r.logo,
    amountMicros: r.net,
    durationSeconds: r.completedAt ? Math.round((r.completedAt.getTime() - r.createdAt.getTime()) / 1000) : null,
    at: (r.completedAt ?? r.createdAt).toISOString(),
  }));
}

export async function saveContact(ctx: AppContext, input: { name: string; email: string; message: string }, ip: string | null) {
  await ctx.db.insert(contactMessages).values({ ...input, ip });
}
