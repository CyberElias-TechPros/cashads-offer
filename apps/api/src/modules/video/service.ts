import { and, desc, eq, gte, sql } from 'drizzle-orm';
import {
  applyBps,
  dayKey,
  TIER_BY_ID,
  VIDEO_COMBO_MAX_BPS,
  VIDEO_COMBO_STEP_BPS,
  VIDEO_REQUIRED_SEQUENCE,
  type VideoCompleteResponse,
  type VideoCreativeDTO,
  type VideoEvent,
  type VideoSessionDTO,
  type VideoStatusDTO,
} from '@cashads/shared';
import type { AppContext, Uow } from '../../context';
import type { Q } from '../../db/client';
import { networks, users, videoAds, videoSessions, type VideoEventRecord } from '../../db/schema';
import { conflict, forbidden, notFound, tooMany } from '../../lib/errors';
import { clock, DAY } from '../../lib/clock';
import { addSignal } from '../fraud/service';
import { onEarned } from '../rewards/earned';
import { baseUserShare, creditUser } from '../rewards/service';
import { acct } from '../wallet/ledger';

type UserRow = typeof users.$inferSelect;
type AdRow = typeof videoAds.$inferSelect;
type SessionRow = typeof videoSessions.$inferSelect;

export const VIDEO_NETWORK_ID = 'house_video';
const COMBO_GAP_MS = 120_000;
const TIMING_TOLERANCE_MS = 1_500;

function toCreative(ad: AdRow): VideoCreativeDTO {
  return {
    id: ad.id,
    advertiser: ad.advertiser,
    headline: ad.headline,
    tagline: ad.tagline,
    cta: ad.cta,
    brandColor: ad.brandColor,
    accentColor: ad.accentColor,
    emoji: ad.emoji,
    durationSeconds: ad.durationSeconds,
  };
}

async function recentSessions(q: Q, userId: string) {
  return q
    .select()
    .from(videoSessions)
    .where(and(eq(videoSessions.userId, userId), gte(videoSessions.createdAt, new Date(clock.ms() - 2 * DAY))))
    .orderBy(desc(videoSessions.createdAt))
    .limit(200);
}

function comboFrom(sessions: SessionRow[]): number {
  // Consecutive completions, each started within COMBO_GAP of the previous completion.
  const done = sessions.filter((s) => s.status === 'completed' && s.completedAt).sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime());
  if (!done.length || clock.ms() - done[0].completedAt!.getTime() > COMBO_GAP_MS) return 0;
  let n = 1;
  for (let i = 1; i < done.length; i++) {
    if (done[i - 1].createdAt.getTime() - done[i].completedAt!.getTime() > COMBO_GAP_MS) break;
    n++;
  }
  return n;
}

function comboBps(index: number) {
  return Math.min(index * VIDEO_COMBO_STEP_BPS, VIDEO_COMBO_MAX_BPS);
}

async function typicalReward(ctx: AppContext, q: Q, combo: number): Promise<number> {
  const [row] = await q
    .select({ avg: sql<string>`coalesce(avg(${videoAds.partnerPayoutMicros}), 0)` })
    .from(videoAds)
    .where(eq(videoAds.status, 'active'));
  const base = baseUserShare(Math.round(Number(row?.avg ?? 0)), await videoShareBps(ctx, q));
  return base + applyBps(base, comboBps(combo));
}

async function videoShareBps(ctx: AppContext, q: Q): Promise<number> {
  const [net] = await q.select({ share: networks.revenueShareBps }).from(networks).where(eq(networks.id, VIDEO_NETWORK_ID));
  return net?.share ?? ctx.settings.get().revenueShareBps;
}

/** `q` lets callers read inside an open transaction (PGlite has a single connection). */
export async function videoStatus(ctx: AppContext, user: UserRow, deviceId: string | null, q: Q = ctx.db): Promise<VideoStatusDTO> {
  const sessions = await recentSessions(q, user.id);
  const today = dayKey(clock.now(), user.timezone);
  const doneToday = sessions.filter((s) => s.status === 'completed' && s.completedAt && dayKey(s.completedAt, user.timezone) === today);
  const cap = TIER_BY_ID[user.tier].videoDailyCap;
  const combo = comboFrom(sessions);
  const active = sessions.find((s) => s.status === 'active' && s.expiresAt.getTime() > clock.ms());
  const lastDone = sessions.find((s) => s.status === 'completed' && s.completedAt);
  const cooldownMs = ctx.settings.get().videoCooldownSeconds * 1000;
  const cooldownUntil = lastDone && lastDone.completedAt!.getTime() + cooldownMs > clock.ms() ? new Date(lastDone.completedAt!.getTime() + cooldownMs).toISOString() : null;
  return {
    dailyCap: cap,
    watchedToday: doneToday.length,
    remainingToday: Math.max(0, cap - doneToday.length),
    comboIndex: combo,
    comboBonusBps: comboBps(combo),
    nextRewardMicros: await typicalReward(ctx, q, combo),
    cooldownUntil,
    activeSession: active ? { id: active.id, deviceLabel: active.deviceLabel ?? 'another device', sameDevice: !!deviceId && active.deviceId === deviceId } : null,
    earnedTodayMicros: doneToday.reduce((a, s) => a + s.rewardMicros, 0),
  };
}

export async function startSession(
  uow: Uow,
  user: UserRow,
  meta: { deviceId: string | null; deviceLabel: string; ip: string | null; takeOver: boolean },
): Promise<VideoSessionDTO> {
  const { tx, ctx } = uow;
  if (user.status !== 'active') throw forbidden('Earning is paused on your account. See Settings → Account health.', 'account_not_active');
  // Serialise per user so two tabs can't race past the one-active-session rule.
  await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for('update');
  const sessions = await recentSessions(tx, user.id);
  const today = dayKey(clock.now(), user.timezone);
  const cap = TIER_BY_ID[user.tier].videoDailyCap;
  const watched = sessions.filter((s) => s.status === 'completed' && s.completedAt && dayKey(s.completedAt, user.timezone) === today).length;
  if (watched >= cap) throw tooMany(`You’ve watched all ${cap} videos for today. New videos unlock at midnight — higher tiers get more.`, 'daily_cap');

  const lastDone = sessions.find((s) => s.status === 'completed' && s.completedAt);
  const cooldownMs = ctx.settings.get().videoCooldownSeconds * 1000;
  if (lastDone && lastDone.completedAt!.getTime() + cooldownMs > clock.ms()) throw tooMany('One moment — the next video is loading.', 'cooldown');

  const active = sessions.filter((s) => s.status === 'active' && s.expiresAt.getTime() > clock.ms());
  for (const a of active) {
    const sameDevice = !!meta.deviceId && a.deviceId === meta.deviceId;
    if (!sameDevice && !meta.takeOver) {
      throw conflict(`You’re already earning on ${a.deviceLabel ?? 'another device'}. You can earn on one device at a time.`, 'earning_elsewhere', {
        deviceLabel: a.deviceLabel,
      });
    }
    await tx.update(videoSessions).set({ status: 'abandoned', rejectionReason: sameDevice ? 'restarted' : 'taken_over' }).where(eq(videoSessions.id, a.id));
    if (!sameDevice) uow.afterCommit(() => ctx.bus.publishToUser(user.id, { type: 'video', status: 'session_taken_over' }));
  }

  const ads = await tx.select().from(videoAds).where(eq(videoAds.status, 'active'));
  const eligible = ads.filter((a) => a.countries.length === 0 || a.countries.includes(user.country));
  if (!eligible.length) throw notFound('No sponsor videos are available in your region right now — check back soon.', 'no_fill');
  const seen = new Map<string, number>();
  for (const s of sessions) if (!seen.has(s.adId)) seen.set(s.adId, s.createdAt.getTime());
  eligible.sort((a, b) => (seen.get(a.id) ?? 0) - (seen.get(b.id) ?? 0));
  const pool = eligible.slice(0, Math.min(3, eligible.length));
  const ad = pool[Math.floor(Math.random() * pool.length)];

  const combo = comboFrom(sessions);
  const base = baseUserShare(ad.partnerPayoutMicros, await videoShareBps(ctx, tx));
  const bps = comboBps(combo);
  const reward = base + applyBps(base, bps);
  const now = clock.now();
  const [session] = await tx
    .insert(videoSessions)
    .values({
      userId: user.id,
      adId: ad.id,
      deviceId: meta.deviceId,
      deviceLabel: meta.deviceLabel,
      rewardMicros: reward,
      partnerPayoutMicros: ad.partnerPayoutMicros,
      comboIndex: combo,
      comboBonusBps: bps,
      expiresAt: new Date(now.getTime() + ad.durationSeconds * 1000 + 5 * 60_000),
      ip: meta.ip,
      createdAt: now,
    })
    .returning();
  await tx.update(videoAds).set({ impressions: sql`${videoAds.impressions} + 1` }).where(eq(videoAds.id, ad.id));
  return { id: session.id, creative: toCreative(ad), rewardMicros: reward, comboIndex: combo, comboBonusBps: bps, expiresAt: session.expiresAt.toISOString() };
}

async function loadOwned(q: Q, userId: string, sessionId: string, lock = false) {
  const base = q.select().from(videoSessions).where(and(eq(videoSessions.id, sessionId), eq(videoSessions.userId, userId)));
  const [s] = lock ? await base.for('update') : await base;
  if (!s) throw notFound('Video session not found');
  return s;
}

export async function recordEvent(uow: Uow, userId: string, sessionId: string, event: { type: VideoEvent; t: number }) {
  const s = await loadOwned(uow.tx, userId, sessionId, true);
  if (s.status !== 'active') throw conflict('This video session has ended', 'session_closed', { status: s.status, reason: s.rejectionReason });
  const now = clock.now();
  if (s.expiresAt.getTime() < now.getTime()) {
    await uow.tx.update(videoSessions).set({ status: 'abandoned', rejectionReason: 'expired' }).where(eq(videoSessions.id, s.id));
    throw conflict('This video session expired', 'session_expired');
  }
  if (s.events.length >= 80) return;
  const events: VideoEventRecord[] = [...s.events, { type: event.type, t: event.t, at: now.toISOString() }];
  let hiddenMs = s.hiddenMs;
  if (event.type === 'visible') {
    const lastHidden = [...s.events].reverse().find((e) => e.type === 'hidden');
    if (lastHidden) hiddenMs += Math.max(0, now.getTime() - new Date(lastHidden.at).getTime());
  }
  const patch: Partial<typeof videoSessions.$inferInsert> = { events, hiddenMs };
  if (event.type === 'started' && !s.startedAt) patch.startedAt = now;
  if (event.type === 'error') {
    // Ad failed to load/play: doesn't count toward the daily cap, member can retry immediately.
    patch.status = 'failed';
    patch.rejectionReason = 'ad_error';
  }
  await uow.tx.update(videoSessions).set(patch).where(eq(videoSessions.id, s.id));
}

/** Server-side verification of the event chain + wall-clock timing. */
export function verifyEvents(s: Pick<SessionRow, 'events' | 'startedAt'>, durationSeconds: number, now: Date): { ok: true } | { ok: false; reason: string; suspicious: boolean } {
  const durationMs = durationSeconds * 1000;
  let cursor = -1;
  const firstOf: Record<string, VideoEventRecord> = {};
  for (const req of VIDEO_REQUIRED_SEQUENCE) {
    const idx = s.events.findIndex((e, i) => i > cursor && e.type === req);
    if (idx === -1) return { ok: false, reason: `missing_${req}`, suspicious: false };
    cursor = idx;
    firstOf[req] = s.events[idx];
  }
  const startedAt = new Date(firstOf.started.at).getTime();
  const serverElapsed = now.getTime() - startedAt;
  if (serverElapsed + TIMING_TOLERANCE_MS < durationMs) return { ok: false, reason: 'completed_too_fast', suspicious: serverElapsed < durationMs * 0.5 };
  const clientElapsed = firstOf.completed.t - firstOf.started.t;
  if (clientElapsed + TIMING_TOLERANCE_MS < durationMs) return { ok: false, reason: 'client_timing_mismatch', suspicious: true };
  // Quartiles must arrive spaced out in real time — a script firing all events then waiting fails here.
  const checkpoints: Array<[string, number]> = [
    ['q1', 0.25],
    ['mid', 0.5],
    ['q3', 0.75],
  ];
  for (const [type, frac] of checkpoints) {
    const at = new Date(firstOf[type].at).getTime() - startedAt;
    if (at + 2_000 < durationMs * frac) return { ok: false, reason: `${type}_too_early`, suspicious: true };
  }
  return { ok: true };
}

export async function completeSession(uow: Uow, user: UserRow, sessionId: string): Promise<VideoCompleteResponse> {
  const { tx, ctx } = uow;
  const s = await loadOwned(tx, user.id, sessionId, true);
  if (s.status === 'completed') {
    return { rewarded: true, amountMicros: s.rewardMicros, status: await videoStatus(ctx, user, s.deviceId, tx) };
  }
  if (s.status !== 'active') {
    const reason =
      s.rejectionReason === 'taken_over'
        ? 'You started earning on another device, so this video was stopped.'
        : 'This video session has ended.';
    return { rewarded: false, amountMicros: 0, reason, status: await videoStatus(ctx, user, s.deviceId, tx) };
  }
  const [ad] = await tx.select().from(videoAds).where(eq(videoAds.id, s.adId));
  const now = clock.now();
  const check = verifyEvents(s, ad.durationSeconds, now);
  if (!check.ok) {
    await tx.update(videoSessions).set({ status: 'rejected', rejectionReason: check.reason, completedAt: now }).where(eq(videoSessions.id, s.id));
    if (check.suspicious) await addSignal(uow, user.id, 'video_tampering', { sessionId: s.id, reason: check.reason });
    return {
      rewarded: false,
      amountMicros: 0,
      reason: 'We couldn’t confirm the full video was watched, so no reward this time (no penalty). Try another one!',
      status: await videoStatus(ctx, user, s.deviceId, tx),
    };
  }
  await tx.update(videoSessions).set({ status: 'completed', completedAt: now }).where(eq(videoSessions.id, s.id));
  await tx.update(videoAds).set({ completions: sql`${videoAds.completions} + 1` }).where(eq(videoAds.id, ad.id));
  const base = baseUserShare(s.partnerPayoutMicros, await videoShareBps(ctx, tx));
  const bonus = s.rewardMicros - base;
  await creditUser(uow, {
    userId: user.id,
    type: 'video',
    description: `Video: ${ad.advertiser}`,
    idempotencyKey: `video:${s.id}`,
    amountMicros: base,
    bonusMicros: Math.max(0, bonus),
    source: { account: acct.network(VIDEO_NETWORK_ID), grossMicros: s.partnerPayoutMicros },
    referenceType: 'video_session',
    referenceId: s.id,
    meta: { adId: ad.id, comboIndex: s.comboIndex, comboBonusBps: s.comboBonusBps },
    earning: true,
  });
  await onEarned(uow, user.id, { kind: 'video', baseMicros: base });
  return { rewarded: true, amountMicros: s.rewardMicros, status: await videoStatusInTx(uow, user) };
}

async function videoStatusInTx(uow: Uow, user: UserRow): Promise<VideoStatusDTO> {
  // Same as videoStatus but reads inside the open transaction (sees the completion we just wrote).
  const sessions = await recentSessions(uow.tx, user.id);
  const today = dayKey(clock.now(), user.timezone);
  const doneToday = sessions.filter((s) => s.status === 'completed' && s.completedAt && dayKey(s.completedAt, user.timezone) === today);
  const cap = TIER_BY_ID[user.tier].videoDailyCap;
  const combo = comboFrom(sessions);
  const cooldownMs = uow.ctx.settings.get().videoCooldownSeconds * 1000;
  return {
    dailyCap: cap,
    watchedToday: doneToday.length,
    remainingToday: Math.max(0, cap - doneToday.length),
    comboIndex: combo,
    comboBonusBps: comboBps(combo),
    nextRewardMicros: await typicalReward(uow.ctx, uow.tx, combo),
    cooldownUntil: cooldownMs ? new Date(clock.ms() + cooldownMs).toISOString() : null,
    activeSession: null,
    earnedTodayMicros: doneToday.reduce((a, x) => a + x.rewardMicros, 0),
  };
}

export async function abandonSession(uow: Uow, userId: string, sessionId: string, reason: 'closed' | 'hidden_too_long' | 'ad_error') {
  const s = await loadOwned(uow.tx, userId, sessionId, true);
  if (s.status !== 'active') return;
  await uow.tx
    .update(videoSessions)
    .set({ status: reason === 'ad_error' ? 'failed' : 'abandoned', rejectionReason: reason })
    .where(eq(videoSessions.id, s.id));
}

export async function expireStaleSessions(ctx: AppContext) {
  await ctx.db
    .update(videoSessions)
    .set({ status: 'abandoned', rejectionReason: 'expired' })
    .where(and(eq(videoSessions.status, 'active'), sql`${videoSessions.expiresAt} < ${clock.now()}`));
}

