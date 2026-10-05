import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  formatMoney,
  hourlyRate,
  type MyOfferStatus,
  type OfferClickDTO,
  type OfferDTO,
  type OfferListQuery,
  type OfferReportReason,
  type StartOfferResponse,
} from '@cashads/shared';
import type { AppContext, Uow } from '../../context';
import type { Q } from '../../db/client';
import { auditLogs, claims, networks, offerClicks, offerReports, offerReviews, offers, postbacks, transactions, users } from '../../db/schema';
import { badRequest, conflict, forbidden, notFound, tooMany } from '../../lib/errors';
import { clock, DAY, HOUR } from '../../lib/clock';
import { baseUserShare, holdHoursFor, tierBonus } from '../rewards/service';

type OfferRow = typeof offers.$inferSelect;
type UserRow = typeof users.$inferSelect;
type ClickRow = typeof offerClicks.$inferSelect;

const DATA_RANK = { light: 0, medium: 1, heavy: 2 } as const;

export function effectiveMinutes(o: OfferRow): number {
  return o.medianMinutes ?? o.estimatedMinutes;
}

function revenueShareFor(ctx: AppContext, networkShare: number | null | undefined): number {
  return networkShare ?? ctx.settings.get().revenueShareBps;
}

export function offerToDTO(
  ctx: AppContext,
  o: OfferRow,
  opts: {
    user: UserRow | null;
    networkName: string;
    networkShareBps?: number | null;
    click?: ClickRow | null;
    clickTxStatus?: string | null;
    claimOpen?: boolean;
    myRating?: number | null;
    creditedGoals?: Set<string>;
  },
): OfferDTO {
  const settings = ctx.settings.get();
  const shareBps = revenueShareFor(ctx, opts.networkShareBps);
  const tier = opts.user?.tier ?? 'bronze';
  const base = baseUserShare(o.partnerPayoutMicros, shareBps);
  const bonus = tierBonus(base, tier);
  const userPayout = base + bonus;
  const minutes = effectiveMinutes(o);

  let myStatus: MyOfferStatus = 'not_started';
  const click = opts.click;
  if (click) {
    if (click.status === 'reversed') myStatus = 'reversed';
    else if (click.status === 'credited') myStatus = opts.clickTxStatus === 'pending' ? 'pending' : 'credited';
    else if (opts.claimOpen) myStatus = 'claimed';
    else myStatus = 'started';
  }

  return {
    id: o.id,
    networkId: o.networkId,
    networkName: opts.networkName,
    title: o.title,
    advertiser: o.advertiser,
    shortDescription: o.shortDescription,
    description: o.description,
    category: o.category,
    icon: o.icon,
    brandColor: o.brandColor,
    partnerPayoutMicros: o.partnerPayoutMicros,
    userPayoutMicros: userPayout,
    baseUserPayoutMicros: base,
    tierBonusMicros: bonus,
    revenueShareBps: shareBps,
    estimatedMinutes: o.estimatedMinutes,
    medianMinutes: o.medianMinutes,
    hourlyRateMicros: hourlyRate(userPayout, minutes),
    dataUsage: o.dataUsage,
    steps: o.steps,
    requirements: o.requirements,
    goals: o.goals.map((g) => {
      const gb = baseUserShare(g.partnerPayoutMicros, shareBps);
      return { id: g.id, label: g.label, userPayoutMicros: gb + tierBonus(gb, tier), credited: opts.creditedGoals?.has(g.id) ?? false };
    }),
    platforms: o.platforms,
    holdHours: holdHoursFor(settings, { offerHoldHours: o.holdHours, amount: userPayout, tier, riskLevel: opts.user?.riskLevel ?? 'low' }),
    trackingReliability: o.trackingReliability,
    medianCreditSeconds: o.medianCreditSeconds,
    qualityScore: o.qualityScore,
    ratingAvg: o.ratingCount > 0 ? Math.round((o.ratingSum / o.ratingCount) * 10) / 10 : null,
    ratingCount: o.ratingCount,
    completions: o.completions,
    featured: o.featured,
    isNew: clock.ms() - o.createdAt.getTime() < 7 * DAY,
    myStatus,
    myClickId: click?.id ?? null,
    myRating: opts.myRating ?? null,
  };
}

async function networkMap(q: Q) {
  const rows = await q.select({ id: networks.id, name: networks.name, share: networks.revenueShareBps, status: networks.status }).from(networks);
  return new Map(rows.map((r) => [r.id, r]));
}

async function userOfferState(q: Q, userId: string) {
  const clicks = await q.select().from(offerClicks).where(eq(offerClicks.userId, userId)).orderBy(desc(offerClicks.startedAt));
  const latest = new Map<string, ClickRow>();
  for (const c of clicks) if (!latest.has(c.offerId)) latest.set(c.offerId, c);
  const clickIds = [...latest.values()].map((c) => c.id);
  const txStatus = new Map<string, string>();
  const openClaims = new Set<string>();
  if (clickIds.length) {
    const txs = await q
      .select({ ref: transactions.referenceId, status: transactions.status })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.referenceType, 'click'), inArray(transactions.referenceId, clickIds)));
    for (const t of txs) if (t.ref) txStatus.set(t.ref, t.status === 'pending' || txStatus.get(t.ref) === 'pending' ? 'pending' : t.status);
    const cl = await q
      .select({ clickId: claims.clickId })
      .from(claims)
      .where(and(eq(claims.userId, userId), inArray(claims.status, ['submitted', 'in_review'])));
    for (const c of cl) openClaims.add(c.clickId);
  }
  return { latest, txStatus, openClaims };
}

export async function listOffers(ctx: AppContext, user: UserRow | null, query: OfferListQuery): Promise<OfferDTO[]> {
  const conds = [eq(offers.status, 'active')];
  if (query.category && query.category !== 'all') conds.push(eq(offers.category, query.category));
  const rows = await ctx.db.select().from(offers).where(and(...conds));
  const nets = await networkMap(ctx.db);
  const state = user ? await userOfferState(ctx.db, user.id) : null;
  const q = query.q?.toLowerCase();

  let list = rows.filter((o) => {
    const net = nets.get(o.networkId);
    if (!net || net.status !== 'active') return false;
    if (user && o.countries.length > 0 && !o.countries.includes(user.country)) return false;
    if (query.dataUsage && DATA_RANK[o.dataUsage] > DATA_RANK[query.dataUsage]) return false;
    if (query.maxMinutes && effectiveMinutes(o) > query.maxMinutes) return false;
    if (query.featured && !o.featured) return false;
    if (q && !`${o.title} ${o.advertiser} ${o.shortDescription}`.toLowerCase().includes(q)) return false;
    // Hide single-shot offers the member already finished — they live in history.
    const click = state?.latest.get(o.id);
    if (click && click.status === 'credited' && o.goals.length === 0) return false;
    return true;
  });

  const dtos = list.map((o) =>
    offerToDTO(ctx, o, {
      user,
      networkName: nets.get(o.networkId)?.name ?? o.networkId,
      networkShareBps: nets.get(o.networkId)?.share,
      click: state?.latest.get(o.id) ?? null,
      clickTxStatus: state ? (state.txStatus.get(state.latest.get(o.id)?.id ?? '') ?? null) : null,
      claimOpen: state ? state.openClaims.has(state.latest.get(o.id)?.id ?? '') : false,
    }),
  );
  let result = dtos;
  if (query.minHourlyMicros) result = result.filter((d) => d.hourlyRateMicros >= query.minHourlyMicros!);
  const sort = query.sort ?? 'hourly';
  result.sort((a, b) => {
    switch (sort) {
      case 'payout':
        return b.userPayoutMicros - a.userPayoutMicros;
      case 'quickest':
        return (a.medianMinutes ?? a.estimatedMinutes) - (b.medianMinutes ?? b.estimatedMinutes);
      case 'quality':
        return b.qualityScore - a.qualityScore;
      case 'newest':
        return Number(b.isNew) - Number(a.isNew) || b.userPayoutMicros - a.userPayoutMicros;
      default:
        return b.hourlyRateMicros - a.hourlyRateMicros;
    }
  });
  list = [];
  return query.limit ? result.slice(0, query.limit) : result;
}

export async function getOffer(ctx: AppContext, user: UserRow | null, offerId: string): Promise<OfferDTO> {
  const [o] = await ctx.db.select().from(offers).where(eq(offers.id, offerId));
  if (!o || o.status === 'archived') throw notFound('This offer is no longer available');
  const nets = await networkMap(ctx.db);
  let click: ClickRow | null = null;
  let clickTxStatus: string | null = null;
  let claimOpen = false;
  let myRating: number | null = null;
  const creditedGoals = new Set<string>();
  if (user) {
    const state = await userOfferState(ctx.db, user.id);
    click = state.latest.get(o.id) ?? null;
    clickTxStatus = click ? (state.txStatus.get(click.id) ?? null) : null;
    claimOpen = click ? state.openClaims.has(click.id) : false;
    const [r] = await ctx.db
      .select({ rating: offerReviews.rating })
      .from(offerReviews)
      .where(and(eq(offerReviews.userId, user.id), eq(offerReviews.offerId, o.id)));
    myRating = r?.rating ?? null;
    if (click && o.goals.length) {
      const pbs = await ctx.db
        .select({ goalId: postbacks.goalId })
        .from(postbacks)
        .where(and(eq(postbacks.clickId, click.id), inArray(postbacks.status, ['credited', 'held'])));
      for (const p of pbs) if (p.goalId) creditedGoals.add(p.goalId);
    }
  }
  return offerToDTO(ctx, o, {
    user,
    networkName: nets.get(o.networkId)?.name ?? o.networkId,
    networkShareBps: nets.get(o.networkId)?.share,
    click,
    clickTxStatus,
    claimOpen,
    myRating,
    creditedGoals,
  });
}

export async function startOffer(
  uow: Uow,
  user: UserRow,
  offerId: string,
  meta: { ip: string | null; userAgent: string | null; deviceId: string | null },
): Promise<StartOfferResponse> {
  const { tx, ctx } = uow;
  if (user.status !== 'active') throw forbidden('Earning is paused on your account. See Settings → Account health.', 'account_not_active');
  const [o] = await tx.select().from(offers).where(eq(offers.id, offerId));
  if (!o || o.status !== 'active') throw notFound('This offer is no longer available');
  if (o.countries.length > 0 && !o.countries.includes(user.country)) throw badRequest('This offer isn’t available in your country', 'country_ineligible');
  const [net] = await tx.select().from(networks).where(eq(networks.id, o.networkId));
  if (!net || net.status !== 'active') throw badRequest('This partner is temporarily unavailable', 'network_disabled');

  const [recent] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(offerClicks)
    .where(and(eq(offerClicks.userId, user.id), gte(offerClicks.startedAt, new Date(clock.ms() - HOUR))));
  if (Number(recent?.n ?? 0) >= 40) throw tooMany('You’ve started a lot of offers in the last hour — take a short break and try again.');

  const [existing] = await tx
    .select()
    .from(offerClicks)
    .where(and(eq(offerClicks.userId, user.id), eq(offerClicks.offerId, o.id)))
    .orderBy(desc(offerClicks.startedAt))
    .limit(1);
  if (existing?.status === 'credited' && o.goals.length === 0) throw conflict('You’ve already completed this offer', 'already_completed');

  let click = existing && existing.status === 'started' && clock.ms() - existing.startedAt.getTime() < 7 * DAY ? existing : null;
  if (!click) {
    const shareBps = net.revenueShareBps ?? ctx.settings.get().revenueShareBps;
    const base = baseUserShare(o.partnerPayoutMicros, shareBps);
    const bonus = tierBonus(base, user.tier);
    const goalsSnapshot = o.goals.map((g) => {
      const gb = baseUserShare(g.partnerPayoutMicros, shareBps);
      const gbonus = tierBonus(gb, user.tier);
      return { ...g, baseMicros: gb, bonusMicros: gbonus, userPayoutMicros: gb + gbonus };
    });
    [click] = await tx
      .insert(offerClicks)
      .values({
        userId: user.id,
        offerId: o.id,
        deviceId: meta.deviceId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        partnerPayoutMicros: o.partnerPayoutMicros,
        baseUserPayoutMicros: base,
        tierBonusMicros: bonus,
        userPayoutMicros: base + bonus,
        goalsSnapshot,
        startedAt: clock.now(),
        createdAt: clock.now(),
      })
      .returning();
  }

  const redirectUrl = o.trackingUrl
    ? o.trackingUrl
        .replaceAll('{click_id}', encodeURIComponent(click.id))
        .replaceAll('{user_id}', encodeURIComponent(user.id))
        .replaceAll('{offer_id}', encodeURIComponent(o.externalId))
    : `/partner/${o.networkId}/${o.id}?click=${click.id}`;
  return { clickId: click.id, redirectUrl };
}

export async function markReturned(ctx: AppContext, userId: string, clickId: string) {
  await ctx.db
    .update(offerClicks)
    .set({ returnedAt: clock.now() })
    .where(and(eq(offerClicks.id, clickId), eq(offerClicks.userId, userId), sql`${offerClicks.returnedAt} is null`));
}

export async function listMyClicks(ctx: AppContext, userId: string): Promise<OfferClickDTO[]> {
  const rows = await ctx.db
    .select({ click: offerClicks, title: offers.title, icon: offers.icon, category: offers.category })
    .from(offerClicks)
    .innerJoin(offers, eq(offers.id, offerClicks.offerId))
    .where(eq(offerClicks.userId, userId))
    .orderBy(desc(offerClicks.startedAt))
    .limit(100);
  const claimRows = await ctx.db.select({ id: claims.id, clickId: claims.clickId }).from(claims).where(eq(claims.userId, userId));
  const claimByClick = new Map(claimRows.map((c) => [c.clickId, c.id]));
  return rows.map(({ click, title, icon, category }) => ({
    id: click.id,
    offerId: click.offerId,
    offerTitle: title,
    offerIcon: icon,
    category,
    status: click.status,
    userPayoutMicros: click.userPayoutMicros,
    startedAt: click.startedAt.toISOString(),
    creditedAt: click.creditedAt?.toISOString() ?? null,
    claimable: click.status === 'started' && !claimByClick.has(click.id) && clock.ms() - click.startedAt.getTime() < 30 * DAY,
    claimId: claimByClick.get(click.id) ?? null,
  }));
}

export async function rateOffer(ctx: AppContext, userId: string, offerId: string, rating: number, comment?: string) {
  const [credited] = await ctx.db
    .select({ id: offerClicks.id })
    .from(offerClicks)
    .where(and(eq(offerClicks.userId, userId), eq(offerClicks.offerId, offerId), eq(offerClicks.status, 'credited')))
    .limit(1);
  if (!credited) throw badRequest('You can rate an offer after completing it', 'not_completed');
  await ctx.db.transaction(async (tx) => {
    const [prev] = await tx.select().from(offerReviews).where(and(eq(offerReviews.userId, userId), eq(offerReviews.offerId, offerId)));
    if (prev) {
      await tx
        .update(offerReviews)
        .set({ rating, comment: comment ?? null, updatedAt: clock.now() })
        .where(and(eq(offerReviews.userId, userId), eq(offerReviews.offerId, offerId)));
      await tx
        .update(offers)
        .set({ ratingSum: sql`${offers.ratingSum} + ${rating - prev.rating}` })
        .where(eq(offers.id, offerId));
    } else {
      await tx.insert(offerReviews).values({ userId, offerId, rating, comment: comment ?? null });
      await tx
        .update(offers)
        .set({ ratingSum: sql`${offers.ratingSum} + ${rating}`, ratingCount: sql`${offers.ratingCount} + 1` })
        .where(eq(offers.id, offerId));
    }
  });
}

/** Reports have teeth: enough of them auto-pause an offer pending staff review. */
export async function reportOffer(ctx: AppContext, userId: string, offerId: string, reason: OfferReportReason, details?: string) {
  const [o] = await ctx.db.select().from(offers).where(eq(offers.id, offerId));
  if (!o) throw notFound();
  const [dupe] = await ctx.db
    .select({ id: offerReports.id })
    .from(offerReports)
    .where(and(eq(offerReports.userId, userId), eq(offerReports.offerId, offerId), eq(offerReports.status, 'open')));
  if (dupe) throw conflict('You already reported this offer — our team is on it', 'already_reported');
  await ctx.db.transaction(async (tx) => {
    await tx.insert(offerReports).values({ userId, offerId, reason, details: details ?? null });
    const [updated] = await tx
      .update(offers)
      .set({ reportsOpen: sql`${offers.reportsOpen} + 1` })
      .where(eq(offers.id, offerId))
      .returning({ reportsOpen: offers.reportsOpen });
    const severe = reason === 'scam' || reason === 'malware';
    const [severeCount] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(offerReports)
      .where(and(eq(offerReports.offerId, offerId), eq(offerReports.status, 'open'), inArray(offerReports.reason, ['scam', 'malware'])));
    if (updated.reportsOpen >= 5 || (severe && Number(severeCount.n) >= 3)) {
      await tx.update(offers).set({ status: 'paused', updatedAt: clock.now() }).where(eq(offers.id, offerId));
      await tx.insert(auditLogs).values({
        actorId: null,
        action: 'offer.auto_paused',
        targetType: 'offer',
        targetId: offerId,
        details: { reportsOpen: updated.reportsOpen, trigger: reason },
      });
    }
  });
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Periodic: real completion times, tracking reliability and quality score from actual member data. */
export async function recomputeOfferStats(ctx: AppContext): Promise<void> {
  const since = new Date(clock.ms() - 90 * DAY);
  const all = await ctx.db.select().from(offers);
  for (const o of all) {
    const clicks = await ctx.db
      .select()
      .from(offerClicks)
      .where(and(eq(offerClicks.offerId, o.id), gte(offerClicks.startedAt, since)));
    const credited = clicks.filter((c) => c.status === 'credited' || c.status === 'reversed');
    const minutes = credited
      .filter((c) => c.creditedAt)
      .map((c) => ((c.returnedAt ?? c.creditedAt)!.getTime() - c.startedAt.getTime()) / 60_000)
      .filter((m) => m > 0 && m < 60 * 24 * 30);
    const creditSecs = credited
      .filter((c) => c.creditedAt && c.returnedAt)
      .map((c) => Math.max(0, (c.creditedAt!.getTime() - c.returnedAt!.getTime()) / 1000));
    const claimRows = await ctx.db
      .select({ status: claims.status, resolution: claims.resolution })
      .from(claims)
      .where(and(eq(claims.offerId, o.id), gte(claims.createdAt, since)));
    // A conversion "tracked" if the partner's signal credited it without a member having to claim.
    const trackedOk = credited.length;
    const trackingFailures = claimRows.filter((c) => c.status !== 'rejected').length;
    const sample = trackedOk + trackingFailures;
    const reliability = sample >= 5 ? trackedOk / sample : o.trackingReliability;
    const ratingAvg = o.ratingCount > 0 ? o.ratingSum / o.ratingCount : 4;
    const quality = Math.round(
      100 * (0.5 * (reliability ?? 0.9) + 0.35 * (ratingAvg / 5) + 0.15 * (1 - Math.min(1, o.reportsOpen / 5))),
    );
    const medMinutes = minutes.length >= 5 ? Math.round(median(minutes)! * 10) / 10 : o.medianMinutes;
    const medCredit = creditSecs.length >= 3 ? Math.round(median(creditSecs)!) : o.medianCreditSeconds;
    await ctx.db
      .update(offers)
      .set({
        completions: credited.length > o.completions ? credited.length : o.completions,
        medianMinutes: medMinutes,
        medianCreditSeconds: medCredit,
        trackingReliability: reliability,
        qualityScore: Math.max(0, Math.min(100, quality)),
      })
      .where(eq(offers.id, o.id));
  }
}

export function payoutLabel(micros: number) {
  return formatMoney(micros);
}
