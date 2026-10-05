import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  type FeedItemDTO,
  type NetworkReliabilityDTO,
  type OfferDTO,
  type PublicStatsDTO,
  type StatusComponentDTO,
  type WallOfShameDTO,
  PAYOUT_METHODS,
  getCountry,
  getPayoutMethod,
} from '@cashads/shared';
import type { AppContext } from '../../context';
import { jobs, networks, offers, payouts, users } from '../../db/schema';
import { filterAndSort, networkReliability, toOfferDTO } from '../offers/service';

/**
 * Radical transparency (spec pain point #14 + §6.4): every number on the public
 * page is computed from the live database. The payout feed shows real completed
 * payouts only — anonymised unless the member opted in to the payout wall.
 */

let statsCache: { at: number; value: PublicStatsDTO } | null = null;

export async function publicStats(ctx: AppContext): Promise<PublicStatsDTO> {
  if (statsCache && Date.now() - statsCache.at < 30_000) return statsCache.value;
  const settings = ctx.settings.get();
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const [paid, median, usersCount, postbacks, claimsAgg, share, removed] = await Promise.all([
    ctx.db.execute<{ total: string; count: string }>(
      sql`select coalesce(sum(net_micros), 0) as total, count(*) as count from payouts where status = 'completed'`,
    ),
    ctx.db.execute<{ median: string | null }>(sql`
      select percentile_cont(0.5) within group (order by extract(epoch from (completed_at - requested_at))) as median
      from payouts where status = 'completed' and completed_at > now() - interval '30 days'`),
    ctx.db.execute<{ count: string }>(sql`select count(*) as count from users where deleted_at is null`),
    ctx.db.execute<{ ok: string; total: string }>(sql`
      select count(*) filter (where status in ('processed', 'duplicate')) as ok, count(*) as total
      from postback_logs where created_at > now() - interval '30 days'`),
    ctx.db.execute<{ total: string; resolved: string; fast: string; approved: string }>(sql`
      select count(*) as total,
        count(*) filter (where resolved_at is not null) as resolved,
        count(*) filter (where resolved_at is not null and resolved_at - created_at <= interval '24 hours') as fast,
        count(*) filter (where status = 'approved') as approved
      from claims where created_at > now() - interval '30 days'`),
    ctx.db.execute<{ network: string; members: string }>(sql`
      select coalesce(sum(payout_micros), 0) as network, coalesce(sum(user_amount_micros), 0) as members
      from conversions where credited_at > now() - interval '30 days' and status = 'credited'`),
    ctx.db.execute<{ count: string }>(
      sql`select count(*) as count from offers where status in ('scam', 'removed')`,
    ),
  ]);
  const pb = postbacks.rows[0]!;
  const cl = claimsAgg.rows[0]!;
  const sh = share.rows[0]!;
  const networkRevenue = Number(sh.network);
  const value: PublicStatsDTO = {
    sandbox: ctx.config.SANDBOX_MODE,
    totalPaidOutMicros: Number(paid.rows[0]!.total),
    payoutsCompleted: Number(paid.rows[0]!.count),
    medianPayoutSeconds:
      n(median.rows[0]?.median) === null ? null : Math.round(Number(median.rows[0]!.median)),
    usersCount: Number(usersCount.rows[0]!.count),
    postbackSuccessRate: Number(pb.total) > 0 ? Number(pb.ok) / Number(pb.total) : null,
    postbacksReceived30d: Number(pb.total),
    claimsTotal30d: Number(cl.total),
    claimsResolvedWithin24hRate: Number(cl.resolved) > 0 ? Number(cl.fast) / Number(cl.resolved) : null,
    claimsApprovedRate: Number(cl.resolved) > 0 ? Number(cl.approved) / Number(cl.resolved) : null,
    revenueShareBps: settings.revenueShareBps,
    actualShareBps30d: networkRevenue > 0 ? Math.round((Number(sh.members) / networkRevenue) * 10_000) : null,
    networkRevenue30dMicros: networkRevenue,
    userEarnings30dMicros: Number(sh.members),
    offersRemovedAfterReports: Number(removed.rows[0]!.count),
    updatedAt: new Date().toISOString(),
  };
  statsCache = { at: Date.now(), value };
  return value;
}

export function invalidateStatsCache(): void {
  statsCache = null;
}

export async function publicFeed(ctx: AppContext, limit = 20): Promise<FeedItemDTO[]> {
  const rows = await ctx.db
    .select({
      id: payouts.id,
      methodId: payouts.methodId,
      net: payouts.netMicros,
      requestedAt: payouts.requestedAt,
      completedAt: payouts.completedAt,
      country: users.country,
      displayName: users.displayName,
      prefs: users.prefs,
    })
    .from(payouts)
    .innerJoin(users, eq(users.id, payouts.userId))
    .where(and(eq(payouts.status, 'completed'), isNotNull(payouts.completedAt)))
    .orderBy(desc(payouts.completedAt))
    .limit(limit);
  return rows.map((r) => {
    const country = getCountry(r.country);
    const method = getPayoutMethod(r.methodId);
    const optedIn = Boolean(r.prefs?.showOnPayoutWall && r.displayName);
    return {
      id: r.id,
      name: optedIn ? r.displayName! : `A member in ${country.name}`,
      countryCode: country.code,
      flag: country.flag,
      methodName: method?.name ?? r.methodId,
      methodIcon: method?.icon ?? '💸',
      amountMicros: r.net,
      completedAt: r.completedAt!.toISOString(),
      durationSeconds: r.completedAt
        ? Math.round((r.completedAt.getTime() - r.requestedAt.getTime()) / 1000)
        : null,
    };
  });
}

export async function networkList(ctx: AppContext): Promise<NetworkReliabilityDTO[]> {
  const rel = await networkReliability(ctx.db);
  const rows = await ctx.db
    .select()
    .from(networks)
    .where(inArray(networks.status, ['active', 'paused']));
  return rows
    .filter((n) => n.kind !== 'native')
    .map((n) => ({
      id: n.id,
      name: n.name,
      postbackSuccessRate: rel.get(n.id)?.rate ?? null,
      postbacks30d: rel.get(n.id)?.total ?? 0,
      status: n.status,
    }));
}

export async function wallOfShame(ctx: AppContext): Promise<WallOfShameDTO[]> {
  const rows = await ctx.db
    .select({ offer: offers, networkName: networks.name })
    .from(offers)
    .innerJoin(networks, eq(networks.id, offers.networkId))
    .where(eq(offers.status, 'scam'))
    .orderBy(desc(offers.statusChangedAt));
  return rows.map(({ offer, networkName }) => ({
    id: offer.id,
    title: offer.title,
    advertiser: offer.advertiser,
    networkName,
    reason: offer.statusReason ?? 'Removed after member reports were confirmed',
    reports: offer.statReportsOpen,
    removedAt: (offer.statusChangedAt ?? offer.updatedAt).toISOString(),
  }));
}

/** Logged-out earning preview for a country ("Pricing/Offers — show earning potential"). */
export async function offersPreview(ctx: AppContext, country: string): Promise<OfferDTO[]> {
  const settings = ctx.settings.get();
  const rows = await ctx.db
    .select({ offer: offers, networkName: networks.name })
    .from(offers)
    .innerJoin(networks, eq(networks.id, offers.networkId))
    .where(and(eq(offers.status, 'active'), eq(networks.status, 'active')));
  const rel = await networkReliability(ctx.db);
  const list = rows
    .filter((r) => r.offer.countries.length === 0 || r.offer.countries.includes(country))
    .map((r) =>
      toOfferDTO(r.offer, r.networkName, settings.revenueShareBps, rel.get(r.offer.networkId)?.rate ?? null),
    );
  return filterAndSort(list, { sort: 'hourly' }, false).slice(0, 8);
}

export async function systemStatus(ctx: AppContext): Promise<StatusComponentDTO[]> {
  const settings = ctx.settings.get();
  const pb = await ctx.db.execute<{ failed: string; total: string }>(sql`
    select count(*) filter (where status in ('error')) as failed, count(*) as total
    from postback_logs where created_at > now() - interval '1 hour'`);
  const failedJobs = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(eq(jobs.status, 'failed'));
  const total = Number(pb.rows[0]?.total ?? 0);
  const failed = Number(pb.rows[0]?.failed ?? 0);
  const outages = Object.entries(settings.sandboxProviderOutages)
    .filter(([, down]) => down)
    .map(([id]) => id);
  const components: StatusComponentDTO[] = [
    {
      id: 'api',
      name: 'App & API',
      status: settings.maintenanceMode ? 'degraded' : 'operational',
      detail: settings.maintenanceMode ? 'Scheduled maintenance' : 'All systems normal',
    },
    {
      id: 'postbacks',
      name: 'Task tracking (postbacks)',
      status: total > 10 && failed / total > 0.1 ? 'degraded' : 'operational',
      detail:
        total === 0
          ? 'No postbacks in the last hour'
          : `${total - failed}/${total} processed in the last hour`,
    },
    {
      id: 'jobs',
      name: 'Background processing',
      status: (failedJobs[0]?.n ?? 0) > 20 ? 'degraded' : 'operational',
      detail: `${failedJobs[0]?.n ?? 0} jobs need attention`,
    },
  ];
  for (const m of PAYOUT_METHODS) {
    const down = outages.includes(m.id);
    components.push({
      id: `payout_${m.id}`,
      name: `Cash-outs · ${m.name}`,
      status: down ? 'outage' : 'operational',
      detail: down ? 'Provider outage — payouts retry automatically' : m.speed,
    });
  }
  return components;
}
