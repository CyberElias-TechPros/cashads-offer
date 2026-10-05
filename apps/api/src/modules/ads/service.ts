import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { type AdEventType, type AdNextDTO, type AdSessionDTO, splitByBps } from '@lucrum/shared';
import type { AppContext } from '../../context';
import type { DbOrTx } from '../../db/client';
import { adCreatives, adSessions, earningLocks, networks } from '../../db/schema';
import type { ClientInfo, UserRow } from '../../http/auth';
import { randomToken } from '../../lib/crypto';
import { AppError, conflict, notFound, tooMany } from '../../lib/errors';
import { DAY, MINUTE } from '../../lib/time';
import { recordSignal } from '../fraud/service';
import { creditNative } from '../rewards/service';
import { mergePrefs } from '../users/service';
import { SYS, postTransaction, userAccountCode } from '../wallet/ledger';

/**
 * Rewarded video (spec §4.1 AdPlayer, §4.3, §6.3, §7):
 *  • Honest pricing — shows the real (tiny) reward and points to better-paying tasks.
 *  • Event-chain verification: loaded → started → Q1 → Q2 → Q3 → completed, checked
 *    against *server* timestamps, plus visible-time accounting (tab hidden = paused).
 *  • Networks with server-side verification (SSV) credit via signed callback; others
 *    credit directly once the chain validates.
 *  • One earning device at a time; failed loads never count against the member.
 */

type SessionRow = typeof adSessions.$inferSelect;
type AdEvent = SessionRow['events'][number];

const TOLERANCE_MS = 1_500;
const LOCK_TTL = 2 * MINUTE;

/* ── one earning device at a time ──────────────────────────────────────────── */

export async function acquireEarningLock(
  db: DbOrTx,
  userId: string,
  client: ClientInfo,
  takeover = false,
): Promise<void> {
  const rows = await db.select().from(earningLocks).where(eq(earningLocks.userId, userId));
  const lock = rows[0];
  const now = new Date();
  if (lock && lock.deviceKey !== client.deviceKey && lock.expiresAt > now && !takeover) {
    throw new AppError(
      409,
      'EARNING_ON_OTHER_DEVICE',
      `You’re already earning on another device (${lock.deviceLabel}). Finish there, or take over here.`,
      undefined,
      {
        deviceLabel: lock.deviceLabel,
      },
    );
  }
  await db
    .insert(earningLocks)
    .values({
      userId,
      deviceKey: client.deviceKey,
      deviceLabel: client.label,
      expiresAt: new Date(now.getTime() + LOCK_TTL),
    })
    .onConflictDoUpdate({
      target: earningLocks.userId,
      set: {
        deviceKey: client.deviceKey,
        deviceLabel: client.label,
        expiresAt: new Date(now.getTime() + LOCK_TTL),
      },
    });
}

async function holdsLock(db: DbOrTx, userId: string, deviceKey: string): Promise<boolean> {
  const rows = await db.select().from(earningLocks).where(eq(earningLocks.userId, userId));
  return rows[0]?.deviceKey === deviceKey;
}

/* ── inventory ─────────────────────────────────────────────────────────────── */

async function rewardedLast24h(db: DbOrTx, userId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(adSessions)
    .where(
      and(
        eq(adSessions.userId, userId),
        eq(adSessions.status, 'rewarded'),
        gt(adSessions.createdAt, new Date(Date.now() - DAY)),
      ),
    );
  return rows[0]?.n ?? 0;
}

async function comboLevel(ctx: AppContext, db: DbOrTx, userId: string): Promise<number> {
  const s = ctx.settings.get();
  const recent = await db
    .select({ completedAt: adSessions.completedAt })
    .from(adSessions)
    .where(and(eq(adSessions.userId, userId), eq(adSessions.status, 'rewarded')))
    .orderBy(desc(adSessions.completedAt))
    .limit(s.adComboBps.length);
  let level = 0;
  let cursor = Date.now();
  for (const r of recent) {
    if (!r.completedAt || cursor - r.completedAt.getTime() > s.adComboWindowMinutes * MINUTE) break;
    level++;
    cursor = r.completedAt.getTime();
  }
  return Math.min(level, s.adComboBps.length - 1);
}

export async function nextAd(ctx: AppContext, user: UserRow): Promise<AdNextDTO> {
  const s = ctx.settings.get();
  const prefs = mergePrefs(user.prefs);
  const used = await rewardedLast24h(ctx.db, user.id);
  const level = await comboLevel(ctx, ctx.db, user.id);
  const base: Omit<AdNextDTO, 'creative' | 'rewardMicros'> = {
    comboLevel: level,
    comboMultiplierBps: s.adComboBps[level] ?? 10_000,
    remainingToday: Math.max(0, s.adDailyCap - used),
    dailyCap: s.adDailyCap,
    offersPayMoreHint: 'Honest maths: a 5-minute survey usually pays 50–100× more than a video.',
  };
  if (base.remainingToday === 0) return { ...base, creative: null, rewardMicros: 0 };

  const creatives = await ctx.db
    .select({ c: adCreatives })
    .from(adCreatives)
    .innerJoin(networks, eq(networks.id, adCreatives.networkId))
    .where(and(eq(adCreatives.status, 'active'), eq(networks.status, 'active')));
  const watched = await ctx.db
    .select({ creativeId: adSessions.creativeId, n: sql<number>`count(*)::int` })
    .from(adSessions)
    .where(
      and(
        eq(adSessions.userId, user.id),
        gt(adSessions.createdAt, new Date(Date.now() - DAY)),
        inArray(adSessions.status, ['rewarded', 'verifying']),
      ),
    )
    .groupBy(adSessions.creativeId);
  const counts = new Map(watched.map((w) => [w.creativeId, w.n]));
  const pool = creatives
    .map((r) => r.c)
    .filter((c) => (!prefs.dataSaver || c.lite) && (counts.get(c.id) ?? 0) < 3)
    .sort((a, b) => (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0) || Math.random() - 0.5);
  const creative = pool[0];
  if (!creative) return { ...base, creative: null, rewardMicros: 0, remainingToday: 0 };
  return {
    ...base,
    creative: {
      id: creative.id,
      advertiser: creative.advertiser,
      title: creative.title,
      tagline: creative.tagline,
      durationSeconds: creative.durationSeconds,
      lite: creative.lite,
      theme: creative.theme,
    },
    rewardMicros: splitByBps(creative.revenueMicros, s.revenueShareBps).share,
  };
}

/* ── sessions ──────────────────────────────────────────────────────────────── */

function toDTO(s: SessionRow, durationSeconds: number): AdSessionDTO {
  const last = s.events[s.events.length - 1];
  return {
    id: s.id,
    status: s.status === 'verifying' ? 'verifying' : s.status,
    rewardMicros: s.rewardMicros,
    bonusMicros: s.bonusMicros,
    visibleMs: s.visibleMs,
    requiredMs: durationSeconds * 1000,
    rejectionReason: s.rejectionReason,
    lastEvent: (last?.type as AdEventType | undefined) ?? null,
  };
}

export async function createAdSession(
  ctx: AppContext,
  user: UserRow,
  client: ClientInfo,
  creativeId: string,
  takeover = false,
): Promise<AdSessionDTO> {
  const s = ctx.settings.get();
  return ctx.db.transaction(async (tx) => {
    if ((await rewardedLast24h(tx, user.id)) >= s.adDailyCap)
      throw tooMany('You’ve reached today’s video limit. Tasks and quick polls are still available!');
    const creative = (await tx.select().from(adCreatives).where(eq(adCreatives.id, creativeId)))[0];
    if (!creative || creative.status !== 'active') throw notFound('Video');
    await acquireEarningLock(tx, user.id, client, takeover);
    await tx
      .update(adSessions)
      .set({ status: 'abandoned' })
      .where(and(eq(adSessions.userId, user.id), inArray(adSessions.status, ['created', 'playing'])));
    const [row] = await tx
      .insert(adSessions)
      .values({
        userId: user.id,
        creativeId,
        deviceKey: client.deviceKey,
        transId: randomToken(18),
        rewardMicros: splitByBps(creative.revenueMicros, s.revenueShareBps).share,
        expiresAt: new Date(Date.now() + creative.durationSeconds * 1000 + 10 * MINUTE),
      })
      .returning();
    return toDTO(row!, creative.durationSeconds);
  });
}

async function loadSession(
  db: DbOrTx,
  userId: string,
  sessionId: string,
): Promise<{ session: SessionRow; duration: number }> {
  const rows = await db
    .select({ session: adSessions, duration: adCreatives.durationSeconds })
    .from(adSessions)
    .innerJoin(adCreatives, eq(adCreatives.id, adSessions.creativeId))
    .where(and(eq(adSessions.id, sessionId), eq(adSessions.userId, userId)));
  if (!rows[0]) throw notFound('Video session');
  return rows[0];
}

export async function recordAdEvent(
  ctx: AppContext,
  user: UserRow,
  client: ClientInfo,
  sessionId: string,
  event: { type: AdEventType; mediaTime: number; quartile?: 1 | 2 | 3 | undefined },
): Promise<AdSessionDTO> {
  return ctx.db.transaction(async (tx) => {
    const { session, duration } = await loadSession(tx, user.id, sessionId);
    if (!['created', 'playing'].includes(session.status)) return toDTO(session, duration);
    if (session.expiresAt < new Date()) {
      const [expired] = await tx
        .update(adSessions)
        .set({ status: 'expired' })
        .where(eq(adSessions.id, sessionId))
        .returning();
      return toDTO(expired!, duration);
    }
    if (!(await holdsLock(tx, user.id, client.deviceKey))) {
      const [taken] = await tx
        .update(adSessions)
        .set({ status: 'abandoned', rejectionReason: 'Another device took over earning' })
        .where(eq(adSessions.id, sessionId))
        .returning();
      return toDTO(taken!, duration);
    }
    await acquireEarningLock(tx, user.id, client, true); // refresh TTL
    const ev: AdEvent = {
      type: event.type,
      at: Date.now(),
      mediaTime: event.mediaTime,
      ...(event.quartile ? { quartile: event.quartile } : {}),
    };
    const events = [...session.events, ev].slice(-200);
    let status = session.status;
    let rejectionReason: string | null = null;
    if (event.type === 'started' && status === 'created') status = 'playing';
    if (event.type === 'error') {
      // A failed load never counts against the member (spec §7 "Ad fails to load").
      status = 'abandoned';
      rejectionReason = 'The video failed to load — this doesn’t count against you.';
    }
    const [row] = await tx
      .update(adSessions)
      .set({ events, status, rejectionReason, visibleMs: computeVisibleMs(events) })
      .where(eq(adSessions.id, sessionId))
      .returning();
    return toDTO(row!, duration);
  });
}

/** Visible playback time from server timestamps: hidden/paused segments don't count. */
export function computeVisibleMs(events: AdEvent[]): number {
  let playing = false;
  let visible = true;
  let since = 0;
  let total = 0;
  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    switch (e.type) {
      case 'started':
      case 'resumed':
        if (!playing && visible) {
          playing = true;
          since = e.at;
        }
        break;
      case 'visible':
        visible = true;
        break;
      case 'hidden':
      case 'paused':
      case 'completed':
      case 'closed':
      case 'error':
        if (playing) total += e.at - since;
        playing = false;
        if (e.type === 'hidden') visible = false;
        break;
      default:
        break;
    }
  }
  return total;
}

/** Returns null when the chain is valid, otherwise a human-readable reason. */
export function validateEventChain(
  events: AdEvent[],
  durationSeconds: number,
): { reason: string; tampering: boolean } | null {
  const first = (t: string, q?: number) =>
    events.find((e) => e.type === t && (q === undefined || e.quartile === q));
  const loaded = first('loaded');
  const started = first('started');
  const completed = first('completed');
  const q = [first('quartile', 1), first('quartile', 2), first('quartile', 3)];
  if (!loaded || !started || !completed)
    return { reason: 'The video didn’t finish playing.', tampering: false };
  if (q.some((x) => !x))
    return { reason: 'Playback progress wasn’t recorded — please watch to the end.', tampering: false };
  const chain = [loaded, started, q[0]!, q[1]!, q[2]!, completed];
  for (let i = 1; i < chain.length; i++) {
    if (chain[i]!.at < chain[i - 1]!.at)
      return { reason: 'Playback events arrived out of order.', tampering: true };
  }
  const d = durationSeconds;
  const expected = [0.25, 0.5, 0.75];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(q[i]!.mediaTime - d * expected[i]!) > Math.max(2, d * 0.2))
      return { reason: 'Playback position didn’t match the video.', tampering: true };
  }
  if (completed.mediaTime < d - 1) return { reason: 'The video didn’t reach the end.', tampering: false };
  if (completed.at - started.at < d * 1000 - TOLERANCE_MS)
    return { reason: 'The video finished faster than its real length.', tampering: true };
  if (computeVisibleMs(events) < d * 1000 - TOLERANCE_MS) {
    return {
      reason: 'The video must stay on screen to count — it was hidden or paused for part of it.',
      tampering: false,
    };
  }
  return null;
}

export async function completeAdSession(
  ctx: AppContext,
  user: UserRow,
  client: ClientInfo,
  sessionId: string,
): Promise<AdSessionDTO> {
  const outcome = await ctx.db.transaction(async (tx) => {
    const { session, duration } = await loadSession(tx, user.id, sessionId);
    if (session.status === 'rewarded' || session.status === 'verifying')
      return { dto: toDTO(session, duration), ssv: false, direct: false };
    if (session.status !== 'playing')
      throw conflict(
        'SESSION_NOT_PLAYING',
        session.rejectionReason ?? 'This video session has ended. Start another one.',
      );
    if (session.expiresAt < new Date())
      throw conflict('SESSION_EXPIRED', 'This video session expired. Start another one.');
    if (!(await holdsLock(tx, user.id, client.deviceKey)))
      throw conflict('EARNING_ON_OTHER_DEVICE', 'Another device took over earning.');

    const invalid = validateEventChain(session.events, duration);
    if (invalid) {
      const [row] = await tx
        .update(adSessions)
        .set({ status: 'rejected', rejectionReason: invalid.reason, completedAt: new Date() })
        .where(eq(adSessions.id, sessionId))
        .returning();
      if (invalid.tampering)
        await recordSignal(ctx, tx, user.id, 'ad_tampering', { sessionId, reason: invalid.reason });
      return { dto: toDTO(row!, duration), ssv: false, direct: false };
    }
    const creative = (await tx.select().from(adCreatives).where(eq(adCreatives.id, session.creativeId)))[0]!;
    const network = (await tx.select().from(networks).where(eq(networks.id, creative.networkId)))[0]!;
    const ssv = Boolean(network.config.ssv);
    const level = await comboLevel(ctx, tx, user.id);
    const [row] = await tx
      .update(adSessions)
      .set({
        status: 'verifying',
        comboLevel: level,
        completedAt: new Date(),
        visibleMs: computeVisibleMs(session.events),
      })
      .where(eq(adSessions.id, sessionId))
      .returning();
    if (ssv) {
      // The ad network's server will call our SSV endpoint (simulated in sandbox mode).
      await ctx.jobs.enqueue(
        tx,
        'sandbox.ssv_callback',
        { sessionId },
        { delayMs: ctx.config.isTest ? 0 : 700 },
      );
    }
    return { dto: toDTO(row!, duration), ssv, direct: !ssv };
  });
  if (outcome.direct) {
    await creditAdSession(ctx, sessionId);
    const { session, duration } = await loadSession(ctx.db, user.id, sessionId);
    return toDTO(session, duration);
  }
  return outcome.dto;
}

/** Final credit — from the SSV callback (or directly for non-SSV networks). Idempotent. */
export async function creditAdSession(
  ctx: AppContext,
  sessionId: string,
): Promise<'rewarded' | 'duplicate' | 'invalid'> {
  const s = ctx.settings.get();
  const res = await ctx.db.transaction(async (tx) => {
    const rows = await tx.select().from(adSessions).where(eq(adSessions.id, sessionId)).for('update');
    const session = rows[0];
    if (!session) return { outcome: 'invalid' as const };
    if (session.status === 'rewarded') return { outcome: 'duplicate' as const };
    if (session.status !== 'verifying') return { outcome: 'invalid' as const };
    const creative = (await tx.select().from(adCreatives).where(eq(adCreatives.id, session.creativeId)))[0]!;
    const reward = session.rewardMicros;
    const txnId = await creditNative(ctx, tx, {
      type: 'ad_reward',
      userId: session.userId,
      networkId: creative.networkId,
      sponsorPayoutMicros: creative.revenueMicros,
      userAmountMicros: reward,
      idempotencyKey: `ad:${session.id}`,
      description: `Video — ${creative.advertiser}`,
      referenceType: 'ad_session',
      referenceId: session.id,
    });
    const multiplier = s.adComboBps[session.comboLevel] ?? 10_000;
    const bonus = Math.floor((reward * (multiplier - 10_000)) / 10_000);
    if (bonus > 0) {
      await postTransaction(tx, {
        type: 'bonus_combo',
        userId: session.userId,
        idempotencyKey: `ad_combo:${session.id}`,
        description: `Video combo ×${(multiplier / 10_000).toFixed(2)}`,
        referenceType: 'ad_session',
        referenceId: session.id,
        entries: [
          { account: SYS.bonusExpense, direction: 'debit', amount: bonus },
          { account: userAccountCode(session.userId), direction: 'credit', amount: bonus },
        ],
      });
    }
    await tx
      .update(adSessions)
      .set({ status: 'rewarded', bonusMicros: bonus, ledgerTxnId: txnId })
      .where(eq(adSessions.id, session.id));
    await ctx.jobs.enqueue(tx, 'earning.after', {
      userId: session.userId,
      kind: 'ad',
      amountMicros: reward,
      sourceKey: `ad:${session.id}`,
    });
    return {
      outcome: 'rewarded' as const,
      userId: session.userId,
      reward,
      bonus,
      title: creative.advertiser,
    };
  });
  if (res.outcome === 'rewarded') {
    ctx.events.toUser(res.userId!, 'reward', {
      kind: 'ad',
      amountMicros: res.reward! + res.bonus!,
      title: `Video — ${res.title}`,
      sessionId,
    });
  }
  return res.outcome;
}

export async function getAdSession(ctx: AppContext, user: UserRow, sessionId: string): Promise<AdSessionDTO> {
  const { session, duration } = await loadSession(ctx.db, user.id, sessionId);
  return toDTO(session, duration);
}

export async function expireStaleAdSessions(ctx: AppContext): Promise<void> {
  await ctx.db
    .update(adSessions)
    .set({ status: 'expired' })
    .where(and(inArray(adSessions.status, ['created', 'playing']), sql`${adSessions.expiresAt} < now()`));
}
