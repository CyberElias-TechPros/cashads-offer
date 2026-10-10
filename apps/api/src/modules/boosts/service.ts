import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { AdCreativeDTO, AdSessionDTO, BoostDTO, BoostStartDTO, BoostStatusDTO } from '@lucrum/shared';
import type { AppContext } from '../../context';
import type { DbOrTx } from '../../db/client';
import { adCreatives, adSessions, earningBoosts, networks } from '../../db/schema';
import type { ClientInfo, UserRow } from '../../http/auth';
import { DAY } from '../../lib/time';
import { notFound, tooMany } from '../../lib/errors';
import { createAdSession, createPartnerSession } from '../ads/service';

const DAY_MS = DAY;

export function startOfTodayUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function endOfTodayUtc(now = new Date()): Date {
  return new Date(startOfTodayUtc(now).getTime() + DAY_MS);
}

/** Bonus slots from all non-expired boosts, clamped to the platform maximum. */
export async function bonusSlotsForUser(ctx: AppContext, userId: string): Promise<number> {
  const rows = await ctx.db
    .select({ bonusSlots: earningBoosts.bonusSlots })
    .from(earningBoosts)
    .where(and(eq(earningBoosts.userId, userId), gt(earningBoosts.expiresAt, new Date())));
  const total = rows.reduce((sum, r) => sum + r.bonusSlots, 0);
  return Math.min(total, ctx.settings.get().boostMaxBonusSlots);
}

/** The video daily cap including active boosts. */
export async function effectiveAdCap(ctx: AppContext, userId: string): Promise<number> {
  return ctx.settings.get().adDailyCap + (await bonusSlotsForUser(ctx, userId));
}

function boostLabel(kind: 'ad' | 'referral', bonusSlots: number): string {
  return kind === 'ad'
    ? `+${bonusSlots} videos today (boost ad)`
    : `+${bonusSlots} videos/day from a referral`;
}

function toDTO(row: typeof earningBoosts.$inferSelect): BoostDTO {
  return {
    id: row.id,
    kind: row.kind,
    bonusSlots: row.bonusSlots,
    expiresAt: row.expiresAt.toISOString(),
    label: boostLabel(row.kind, row.bonusSlots),
  };
}

/** How many boost videos the user has started today (any non-abandoned status). */
export async function boostAdsUsedToday(db: DbOrTx, userId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(adSessions)
    .where(
      and(
        eq(adSessions.userId, userId),
        gt(adSessions.boostSlots, 0),
        gt(adSessions.createdAt, startOfTodayUtc()),
        inArray(adSessions.status, ['created', 'playing', 'verifying', 'rewarded']),
      ),
    );
  return rows[0]?.n ?? 0;
}

export async function getBoostStatus(ctx: AppContext, user: UserRow): Promise<BoostStatusDTO> {
  const s = ctx.settings.get();
  const activeRows = await ctx.db
    .select()
    .from(earningBoosts)
    .where(and(eq(earningBoosts.userId, user.id), gt(earningBoosts.expiresAt, new Date())));
  const bonusSlots = Math.min(
    activeRows.reduce((sum, r) => sum + r.bonusSlots, 0),
    s.boostMaxBonusSlots,
  );
  const effectiveAdCap = s.adDailyCap + bonusSlots;
  const used = await videosRewardedLast24h(ctx.db, user.id);
  const boostsUsed = await boostAdsUsedToday(ctx.db, user.id);
  return {
    baseAdCap: s.adDailyCap,
    bonusSlots,
    effectiveAdCap,
    videosUsedToday: used,
    videosRemainingToday: Math.max(0, effectiveAdCap - used),
    active: activeRows.map(toDTO).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt)),
    boostsUsedToday: boostsUsed,
    boostsRemainingToday: Math.max(0, s.boostMaxAdPerDay - boostsUsed),
    slotsPerBoostAd: s.boostSlotsPerAd,
  };
}

/** Rewarded + verifying video sessions in the last 24h (mirrors the ads module's count). */
async function videosRewardedLast24h(db: DbOrTx, userId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(adSessions)
    .where(
      and(
        eq(adSessions.userId, userId),
        gt(adSessions.createdAt, new Date(Date.now() - DAY_MS)),
        inArray(adSessions.status, ['rewarded', 'verifying']),
      ),
    );
  return rows[0]?.n ?? 0;
}

/**
 * Starts a boost video. With `networkId` (native app) the video is a real partner
 * ad — the monetization; without it, the in-app player session is used.
 */
export async function startBoostAdSession(
  ctx: AppContext,
  user: UserRow,
  client: ClientInfo,
  networkId?: string,
): Promise<BoostStartDTO> {
  const s = ctx.settings.get();
  if (s.boostSlotsPerAd <= 0) throw notFound('Boost');
  if ((await boostAdsUsedToday(ctx.db, user.id)) >= s.boostMaxAdPerDay)
    throw tooMany('Boost limit reached for today — it resets at midnight UTC.');

  const boost = { slots: s.boostSlotsPerAd, expiresAt: endOfTodayUtc().toISOString() };

  if (networkId) {
    const ps = await createPartnerSession(ctx, user, client, networkId, boost.slots);
    return {
      kind: 'partner',
      session: ps.session,
      transId: ps.transId,
      networkId: ps.networkId,
      networkName: ps.networkName,
      boost,
    };
  }

  // Inline (web player): any active non-partner creative — boost videos are offered
  // even when the normal cap is reached, so the pool must not depend on remaining.
  const creative = (
    await ctx.db
      .select({ c: adCreatives })
      .from(adCreatives)
      .innerJoin(networks, eq(networks.id, adCreatives.networkId))
      .where(and(eq(adCreatives.status, 'active'), eq(networks.status, 'active')))
  )
    .map((r) => r.c)
    .filter((c) => !c.id.startsWith('partner-'))
    .sort(() => Math.random() - 0.5)[0];
  if (!creative) throw notFound('Video');
  const session = await createAdSession(ctx, user, client, creative.id, false, boost.slots);
  const creativeDTO: AdCreativeDTO = {
    id: creative.id,
    advertiser: creative.advertiser,
    title: creative.title,
    tagline: creative.tagline,
    durationSeconds: creative.durationSeconds,
    lite: creative.lite,
    theme: creative.theme,
  };
  return {
    kind: 'inline',
    session: session as AdSessionDTO,
    creative: creativeDTO,
    transId: session.transId,
    boost,
  };
}

/**
 * Grants the slots for a rewarded boost session. Called from creditAdSession
 * inside its transaction; the unique key makes replays harmless.
 */
export async function grantBoostForSession(
  db: DbOrTx,
  session: typeof adSessions.$inferSelect,
): Promise<void> {
  if (session.boostSlots <= 0) return;
  await db
    .insert(earningBoosts)
    .values({
      userId: session.userId,
      kind: 'ad',
      bonusSlots: session.boostSlots,
      sourceRef: session.id,
      expiresAt: endOfTodayUtc(),
    })
    .onConflictDoNothing();
}

/**
 * Grants the referrer a multi-day boost when their referred friend completes their
 * first earning. Idempotent per (referrer, referred user).
 */
export async function grantReferralBoost(
  ctx: AppContext,
  db: DbOrTx,
  referrerId: string,
  refereeId: string,
): Promise<boolean> {
  const s = ctx.settings.get();
  if (s.boostReferralSlots <= 0) return false;
  const [row] = await db
    .insert(earningBoosts)
    .values({
      userId: referrerId,
      kind: 'referral',
      bonusSlots: s.boostReferralSlots,
      sourceRef: refereeId,
      expiresAt: new Date(Date.now() + s.boostReferralDays * DAY_MS),
    })
    .onConflictDoNothing()
    .returning();
  return Boolean(row);
}
