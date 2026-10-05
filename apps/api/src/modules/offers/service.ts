import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import {
  type ActivityItemDTO,
  MEASURED_MIN_SAMPLES,
  type OfferDTO,
  type OfferDetailDTO,
  type OfferStartDTO,
  type OffersQuery,
  computeOfferQuality,
  hourlyRate,
} from '@cashads/shared';
import type { AppContext } from '../../context';
import type { DbOrTx } from '../../db/client';
import {
  claims,
  conversions,
  networks,
  offerClicks,
  offerRatings,
  offerReports,
  offers,
  postbackLogs,
} from '../../db/schema';
import type { ClientInfo, UserRow } from '../../http/auth';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { DAY, HOUR, MINUTE } from '../../lib/time';
import { mergePrefs } from '../users/service';
import { userPayoutFor } from '../rewards/service';

type OfferRow = typeof offers.$inferSelect;

/* ── network reliability (postback success rate), cached ───────────────────── */

let reliabilityCache: { at: number; data: Map<string, { rate: number | null; total: number }> } | null = null;

export async function networkReliability(
  db: DbOrTx,
): Promise<Map<string, { rate: number | null; total: number }>> {
  if (reliabilityCache && Date.now() - reliabilityCache.at < 60_000) return reliabilityCache.data;
  const res = await db.execute<{ network_id: string; ok: number | string; total: number | string }>(sql`
    select network_id,
      count(*) filter (where status in ('processed', 'duplicate')) as ok,
      count(*) as total
    from postback_logs where created_at > now() - interval '30 days'
    group by network_id`);
  const data = new Map<string, { rate: number | null; total: number }>();
  for (const r of res.rows) {
    const total = Number(r.total);
    data.set(r.network_id, { rate: total > 0 ? Number(r.ok) / total : null, total });
  }
  reliabilityCache = { at: Date.now(), data };
  return data;
}

export function invalidateReliabilityCache(): void {
  reliabilityCache = null;
}

/* ── DTO mapping ───────────────────────────────────────────────────────────── */

interface UserOfferState {
  status: OfferDTO['myStatus'];
  clickId: string | null;
  completedCount: number;
}

export function toOfferDTO(
  row: OfferRow,
  networkName: string,
  revenueShareBps: number,
  reliability: number | null,
  state?: UserOfferState,
): OfferDTO {
  const userPayout = userPayoutFor(row, revenueShareBps);
  const measuredMinutes =
    row.statSamples >= MEASURED_MIN_SAMPLES && row.statMedianSeconds
      ? Math.round((row.statMedianSeconds / 60) * 10) / 10
      : null;
  const effectiveMinutes = Math.max(0.25, measuredMinutes ?? row.estMinutes);
  return {
    id: row.id,
    networkId: row.networkId,
    networkName,
    title: row.title,
    advertiser: row.advertiser,
    description: row.description,
    category: row.category as OfferDTO['category'],
    icon: row.icon,
    color: row.color,
    userPayoutMicros: userPayout,
    estMinutes: row.estMinutes,
    measuredMinutes,
    measuredSamples: row.statSamples,
    effectiveMinutes,
    hourlyRateMicros: hourlyRate(userPayout, effectiveMinutes),
    paySpeed: row.paySpeed,
    dataMb: row.dataMb,
    isLite: row.isLite,
    tags: row.tags,
    quality: computeOfferQuality({
      clicks: row.statClicks,
      conversions: row.statConversions,
      missingClaims: row.statMissingClaims,
      thumbsUp: row.statThumbsUp,
      thumbsDown: row.statThumbsDown,
      openReports: row.statReportsOpen,
      networkSuccessRate: reliability,
    }),
    myStatus: state?.status ?? null,
    myClickId: state?.clickId ?? null,
    completedByMe: state ? state.completedCount >= row.maxPerUser : false,
    createdAt: row.createdAt.toISOString(),
  };
}

async function userStates(
  db: DbOrTx,
  userId: string,
  offerIds: string[],
): Promise<Map<string, UserOfferState>> {
  const map = new Map<string, UserOfferState>();
  if (offerIds.length === 0) return map;
  const clicks = await db
    .select({
      id: offerClicks.id,
      offerId: offerClicks.offerId,
      status: offerClicks.status,
      startedAt: offerClicks.startedAt,
    })
    .from(offerClicks)
    .where(and(eq(offerClicks.userId, userId), inArray(offerClicks.offerId, offerIds)))
    .orderBy(desc(offerClicks.startedAt));
  const conv = await db
    .select({ offerId: conversions.offerId, n: sql<number>`count(*)::int` })
    .from(conversions)
    .where(
      and(
        eq(conversions.userId, userId),
        inArray(conversions.offerId, offerIds),
        eq(conversions.status, 'credited'),
      ),
    )
    .groupBy(conversions.offerId);
  const convBy = new Map(conv.map((c) => [c.offerId, c.n]));
  for (const c of clicks) {
    if (!map.has(c.offerId))
      map.set(c.offerId, { status: c.status, clickId: c.id, completedCount: convBy.get(c.offerId) ?? 0 });
  }
  for (const [offerId, n] of convBy) {
    if (offerId && !map.has(offerId))
      map.set(offerId, { status: 'credited', clickId: null, completedCount: n });
  }
  return map;
}

function availableIn(row: OfferRow, country: string): boolean {
  return row.countries.length === 0 || row.countries.includes(country);
}

/* ── listing ───────────────────────────────────────────────────────────────── */

export async function listOffersForUser(
  ctx: AppContext,
  user: UserRow,
  q: Partial<OffersQuery> = {},
): Promise<OfferDTO[]> {
  const settings = ctx.settings.get();
  const prefs = mergePrefs(user.prefs);
  const rows = await ctx.db
    .select({ offer: offers, networkName: networks.name })
    .from(offers)
    .innerJoin(networks, eq(networks.id, offers.networkId))
    .where(and(eq(offers.status, 'active'), eq(networks.status, 'active')));
  const visible = rows.filter((r) => availableIn(r.offer, user.country));
  const reliability = await networkReliability(ctx.db);
  const states = await userStates(
    ctx.db,
    user.id,
    visible.map((r) => r.offer.id),
  );
  let list = visible.map((r) =>
    toOfferDTO(
      r.offer,
      r.networkName,
      settings.revenueShareBps,
      reliability.get(r.offer.networkId)?.rate ?? null,
      states.get(r.offer.id),
    ),
  );
  return filterAndSort(list, q, prefs.dataSaver);
}

export function filterAndSort(list: OfferDTO[], q: Partial<OffersQuery>, dataSaver: boolean): OfferDTO[] {
  let out = list;
  if (q.category === 'quick') out = out.filter((o) => o.effectiveMinutes <= 2);
  else if (q.category) out = out.filter((o) => o.category === q.category);
  if (q.q) {
    const needle = q.q.toLowerCase();
    out = out.filter((o) => `${o.title} ${o.advertiser} ${o.tags.join(' ')}`.toLowerCase().includes(needle));
  }
  if (q.minHourlyMicros) out = out.filter((o) => o.hourlyRateMicros >= q.minHourlyMicros!);
  if (q.maxMinutes) out = out.filter((o) => o.effectiveMinutes <= q.maxMinutes!);
  if (q.lite || dataSaver) out = out.filter((o) => o.isLite || o.dataMb <= 5);
  if (q.hideCompleted) out = out.filter((o) => !o.completedByMe);
  const qualityKey = (o: OfferDTO) => o.quality.score ?? 65;
  const sorters: Record<string, (a: OfferDTO, b: OfferDTO) => number> = {
    hourly: (a, b) => b.hourlyRateMicros - a.hourlyRateMicros,
    payout: (a, b) => b.userPayoutMicros - a.userPayoutMicros,
    quick: (a, b) => a.effectiveMinutes - b.effectiveMinutes,
    new: (a, b) => b.createdAt.localeCompare(a.createdAt),
    quality: (a, b) => qualityKey(b) - qualityKey(a),
  };
  const sorter = sorters[q.sort ?? 'hourly']!;
  // Completed offers sink to the bottom so the list always starts with something doable.
  return [...out].sort((a, b) => Number(a.completedByMe) - Number(b.completedByMe) || sorter(a, b));
}

export async function getOfferDetail(
  ctx: AppContext,
  user: UserRow,
  offerId: string,
): Promise<OfferDetailDTO> {
  const settings = ctx.settings.get();
  const rows = await ctx.db
    .select({ offer: offers, networkName: networks.name })
    .from(offers)
    .innerJoin(networks, eq(networks.id, offers.networkId))
    .where(eq(offers.id, offerId));
  const row = rows[0];
  if (!row) throw notFound('Offer');
  const states = await userStates(ctx.db, user.id, [offerId]);
  const state = states.get(offerId);
  if (row.offer.status !== 'active' && !state) throw notFound('Offer');
  const reliability = await networkReliability(ctx.db);
  const rel = reliability.get(row.offer.networkId)?.rate ?? null;
  const dto = toOfferDTO(row.offer, row.networkName, settings.revenueShareBps, rel, state);
  const myRating = await ctx.db
    .select({ value: offerRatings.value })
    .from(offerRatings)
    .where(and(eq(offerRatings.userId, user.id), eq(offerRatings.offerId, offerId)));
  return {
    ...dto,
    steps: row.offer.steps,
    tips: tipsFor(row.offer),
    countries: row.offer.countries,
    networkReliability: rel,
    ratingCounts: { up: row.offer.statThumbsUp, down: row.offer.statThumbsDown },
    myRating: (myRating[0]?.value as 1 | -1 | undefined) ?? null,
    canRate: (state?.completedCount ?? 0) > 0,
  };
}

function tipsFor(offer: OfferRow): string[] {
  const tips = [
    'Use the same device and browser from start to finish — switching breaks tracking.',
    'Turn off VPNs and ad-blockers for this task; advertisers reject masked traffic.',
  ];
  if (offer.category === 'survey')
    tips.push('Answer honestly and consistently — surveys include attention checks.');
  if (offer.category === 'app') tips.push('Install from the link we open, then open the app at least once.');
  if (offer.category === 'financial')
    tips.push('Read the product terms. Only sign up for things you actually want.');
  if (offer.paySpeed !== 'instant')
    tips.push('This advertiser confirms later — we’ll notify you the moment it’s credited.');
  tips.push(
    'Not credited? Tap “Missing credit” in Activity after 10 minutes — we’ll check the network logs for you.',
  );
  return tips;
}

/* ── starting & tracking ───────────────────────────────────────────────────── */

export async function startOffer(
  ctx: AppContext,
  user: UserRow,
  offerId: string,
  client: ClientInfo,
): Promise<OfferStartDTO> {
  const settings = ctx.settings.get();
  return ctx.db.transaction(async (tx) => {
    const rows = await tx
      .select({ offer: offers, network: networks })
      .from(offers)
      .innerJoin(networks, eq(networks.id, offers.networkId))
      .where(eq(offers.id, offerId));
    const row = rows[0];
    if (!row || row.offer.status !== 'active' || row.network.status !== 'active') {
      throw new AppError(410, 'OFFER_UNAVAILABLE', 'This offer is no longer available.');
    }
    if (!availableIn(row.offer, user.country))
      throw new AppError(403, 'OFFER_GEO', 'This offer isn’t available in your country.');
    const done = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(conversions)
      .where(
        and(
          eq(conversions.userId, user.id),
          eq(conversions.offerId, offerId),
          eq(conversions.status, 'credited'),
        ),
      );
    if ((done[0]?.n ?? 0) >= row.offer.maxPerUser)
      throw conflict('ALREADY_COMPLETED', 'You’ve already completed this offer.');

    const now = new Date();
    const open = await tx
      .select()
      .from(offerClicks)
      .where(
        and(
          eq(offerClicks.userId, user.id),
          eq(offerClicks.offerId, offerId),
          inArray(offerClicks.status, ['started', 'reported']),
          gt(offerClicks.expiresAt, now),
        ),
      )
      .orderBy(desc(offerClicks.startedAt))
      .limit(1);
    let click = open[0];
    if (!click) {
      const ttl = row.offer.paySpeed === 'days' ? 30 * DAY : settings.postbackMaxAgeHours * HOUR;
      [click] = await tx
        .insert(offerClicks)
        .values({
          userId: user.id,
          offerId,
          deviceKey: client.deviceKey,
          ip: client.ip,
          userAgent: client.userAgent,
          startedAt: now,
          expiresAt: new Date(now.getTime() + ttl),
        })
        .returning();
      await tx
        .update(offers)
        .set({ statClicks: sql`${offers.statClicks} + 1` })
        .where(eq(offers.id, offerId));
    }
    return {
      clickId: click!.id,
      redirectUrl: buildClickUrl(row.network, row.offer, click!.id, user.id),
      expiresAt: click!.expiresAt.toISOString(),
    };
  });
}

/** Tracking URL with our click id as sub-id (what lets postbacks find the user even across devices). */
function buildClickUrl(
  network: typeof networks.$inferSelect,
  offer: OfferRow,
  clickId: string,
  userId: string,
): string {
  if (network.adapter === 'sandboxnet') return `/sandbox/offer/${clickId}`;
  const template = String(network.config.clickUrlTemplate ?? '');
  if (!template) throw badRequest('NETWORK_MISCONFIGURED', 'This network has no tracking URL configured');
  return template
    .replaceAll('{network_offer_id}', encodeURIComponent(offer.networkOfferId))
    .replaceAll('{click_id}', clickId)
    .replaceAll('{user_id}', userId);
}

export const SANDBOX_CHECK_SCHEDULE = [60_000, 24 * HOUR, 48 * HOUR, 72 * HOUR];
export const CHECK_SCHEDULE = [15 * MINUTE, 24 * HOUR, 48 * HOUR, 72 * HOUR];

/** Member says "I finished": we start actively checking with the network (spec edge case #1). */
export async function reportCompleted(
  ctx: AppContext,
  user: UserRow,
  clickId: string,
): Promise<ActivityItemDTO> {
  await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(offerClicks)
      .where(and(eq(offerClicks.id, clickId), eq(offerClicks.userId, user.id)))
      .for('update');
    const click = rows[0];
    if (!click) throw notFound('Task');
    if (click.status !== 'started') return;
    await tx
      .update(offerClicks)
      .set({ status: 'reported', reportedAt: new Date() })
      .where(eq(offerClicks.id, clickId));
    const schedule = ctx.config.SANDBOX_MODE ? SANDBOX_CHECK_SCHEDULE : CHECK_SCHEDULE;
    for (const [i, delay] of schedule.entries()) {
      await ctx.jobs.enqueue(
        tx,
        'click.check',
        { clickId, attempt: i + 1, final: i === schedule.length - 1 },
        { delayMs: delay, dedupeKey: `click.check:${clickId}:${i + 1}` },
      );
    }
  });
  const items = await listActivity(ctx, user, { clickId });
  return items[0]!;
}

export async function listActivity(
  ctx: AppContext,
  user: UserRow,
  opts: { clickId?: string; limit?: number } = {},
): Promise<ActivityItemDTO[]> {
  const settings = ctx.settings.get();
  const conds = [eq(offerClicks.userId, user.id)];
  if (opts.clickId) conds.push(eq(offerClicks.id, opts.clickId));
  const rows = await ctx.db
    .select({
      click: offerClicks,
      offer: offers,
      networkName: networks.name,
      conversion: conversions,
      claim: claims,
    })
    .from(offerClicks)
    .innerJoin(offers, eq(offers.id, offerClicks.offerId))
    .innerJoin(networks, eq(networks.id, offers.networkId))
    .leftJoin(conversions, eq(conversions.id, offerClicks.conversionId))
    .leftJoin(claims, eq(claims.clickId, offerClicks.id))
    .where(and(...conds))
    .orderBy(desc(offerClicks.startedAt))
    .limit(opts.limit ?? 100);
  const now = Date.now();
  return rows.map(({ click, offer, networkName, conversion, claim }) => {
    const availableAt = click.startedAt.getTime() + settings.claimMinWaitMinutes * MINUTE;
    const withinWindow = now - click.startedAt.getTime() <= 30 * DAY;
    const claimable = !claim && ['started', 'reported', 'expired'].includes(click.status) && withinWindow;
    return {
      clickId: click.id,
      offer: {
        id: offer.id,
        title: offer.title,
        icon: offer.icon,
        color: offer.color,
        category: offer.category as ActivityItemDTO['offer']['category'],
        userPayoutMicros: userPayoutFor(offer, settings.revenueShareBps),
        networkName,
      },
      status: click.status,
      startedAt: click.startedAt.toISOString(),
      reportedAt: click.reportedAt?.toISOString() ?? null,
      creditedAt: click.creditedAt?.toISOString() ?? null,
      expiresAt: click.expiresAt.toISOString(),
      creditedMicros:
        conversion?.userAmountMicros ?? (claim?.status === 'approved' ? claim.amountMicros : null),
      claim: claim ? { id: claim.id, status: claim.status } : null,
      canClaim: claimable && now >= availableAt,
      claimAvailableAt: claimable && now < availableAt ? new Date(availableAt).toISOString() : null,
    };
  });
}

/** Sum of expected payouts for tasks the member reported as finished but not yet credited. */
export async function pendingMicros(ctx: AppContext, user: UserRow): Promise<number> {
  const settings = ctx.settings.get();
  const rows = await ctx.db
    .select({ offer: offers })
    .from(offerClicks)
    .innerJoin(offers, eq(offers.id, offerClicks.offerId))
    // `claimed` clicks move to `credited` or `rejected` when the claim resolves.
    .where(and(eq(offerClicks.userId, user.id), inArray(offerClicks.status, ['reported', 'claimed'])));
  return rows.reduce((s, r) => s + userPayoutFor(r.offer, settings.revenueShareBps), 0);
}

/* ── ratings & reports (community quality control) ─────────────────────────── */

export async function rateOffer(
  ctx: AppContext,
  user: UserRow,
  offerId: string,
  value: 1 | -1,
): Promise<void> {
  const done = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(conversions)
    .where(and(eq(conversions.userId, user.id), eq(conversions.offerId, offerId)));
  if ((done[0]?.n ?? 0) === 0)
    throw new AppError(403, 'RATE_AFTER_COMPLETION', 'You can rate an offer after completing it.');
  await ctx.db
    .insert(offerRatings)
    .values({ userId: user.id, offerId, value })
    .onConflictDoUpdate({
      target: [offerRatings.userId, offerRatings.offerId],
      set: { value, createdAt: new Date() },
    });
  await refreshOfferStats(ctx.db, offerId);
}

const SEVERE_REASONS = ['scam', 'malware', 'hidden_charges'];

export async function reportOffer(
  ctx: AppContext,
  user: UserRow,
  offerId: string,
  reason: string,
  details: string | undefined,
): Promise<{ autoPaused: boolean }> {
  const settings = ctx.settings.get();
  const clicked = await ctx.db
    .select({ id: offerClicks.id })
    .from(offerClicks)
    .where(and(eq(offerClicks.userId, user.id), eq(offerClicks.offerId, offerId)))
    .limit(1);
  if (!clicked[0])
    throw new AppError(403, 'REPORT_AFTER_START', 'You can report an offer after you’ve started it.');
  return ctx.db.transaction(async (tx) => {
    await tx
      .insert(offerReports)
      .values({ userId: user.id, offerId, reason, details: details ?? null })
      .onConflictDoUpdate({
        target: [offerReports.userId, offerReports.offerId],
        set: { reason, details: details ?? null, status: 'open', createdAt: new Date() },
      });
    const severe = await tx
      .select({ n: sql<number>`count(distinct ${offerReports.userId})::int` })
      .from(offerReports)
      .where(
        and(
          eq(offerReports.offerId, offerId),
          eq(offerReports.status, 'open'),
          inArray(offerReports.reason, SEVERE_REASONS),
        ),
      );
    let autoPaused = false;
    if ((severe[0]?.n ?? 0) >= settings.offerAutoPauseReports) {
      const updated = await tx
        .update(offers)
        .set({
          status: 'paused',
          statusReason: 'Auto-paused after multiple member reports — under review',
          statusChangedAt: new Date(),
        })
        .where(and(eq(offers.id, offerId), eq(offers.status, 'active')))
        .returning({ id: offers.id });
      autoPaused = updated.length > 0;
    }
    await refreshOfferStats(tx, offerId);
    return { autoPaused };
  });
}

/** Recompute cached quality stats for one offer (cheap; called after every relevant event). */
export async function refreshOfferStats(db: DbOrTx, offerId: string): Promise<void> {
  await db.execute(sql`
    update offers set
      stat_clicks = (select count(*) from offer_clicks where offer_id = ${offerId}),
      stat_conversions = (select count(*) from conversions where offer_id = ${offerId} and kind = 'complete'),
      stat_missing_claims = (select count(*) from claims where offer_id = ${offerId}),
      stat_thumbs_up = (select count(*) from offer_ratings where offer_id = ${offerId} and value = 1),
      stat_thumbs_down = (select count(*) from offer_ratings where offer_id = ${offerId} and value = -1),
      stat_reports_open = (select count(*) from offer_reports where offer_id = ${offerId} and status = 'open'),
      stat_median_seconds = (select percentile_cont(0.5) within group (order by duration_seconds)::int from conversions
                             where offer_id = ${offerId} and duration_seconds is not null and kind = 'complete'),
      stat_samples = (select count(*) from conversions where offer_id = ${offerId} and duration_seconds is not null and kind = 'complete'),
      updated_at = now()
    where id = ${offerId}`);
}

export async function lastPostbackForClick(db: DbOrTx, clickId: string) {
  const rows = await db
    .select()
    .from(postbackLogs)
    .where(eq(postbackLogs.clickId, clickId))
    .orderBy(desc(postbackLogs.createdAt))
    .limit(5);
  return rows;
}
