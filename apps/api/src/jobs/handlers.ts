import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { formatUsd } from '@lucrum/shared';
import type { AppContext } from '../context';
import { claims, networks, offerClicks, offers, streaks, users } from '../db/schema';
import { creditAdSession, expireStaleAdSessions } from '../modules/ads/service';
import { autoResolveClaim, createClaim, sweepClaimSla } from '../modules/claims/service';
import { earningsInLastHour, evaluateAchievements, recomputeTier } from '../modules/engagement/service';
import { recordSignal } from '../modules/fraud/service';
import { getAdapter } from '../modules/networks/adapters';
import { onPlanOfferCompleted } from '../modules/offers/plan';
import { refreshOfferStats } from '../modules/offers/service';
import { pollPayout, processPayout } from '../modules/payouts/service';
import { notify } from '../modules/platform/messaging';
import { onRefereeEarning } from '../modules/referrals/service';
import { creditConversion } from '../modules/rewards/service';
import { deliverSandboxPostback, deliverSsvCallback, sandboxKycReview } from '../modules/sandbox/service';
import { invalidateStatsCache } from '../modules/transparency/service';
import { SYS, postTransaction, userAccountCode } from '../modules/wallet/ledger';
import { localDate, localHour, previousDate } from '../lib/time';
import type { JobQueue } from './queue';

/** Side effects of any member earning — decoupled from the hot path via the outbox. */
async function earningAfter(ctx: AppContext, p: Record<string, unknown>): Promise<void> {
  const userId = String(p.userId);
  const kind = String(p.kind);
  const amount = Number(p.amountMicros ?? 0);
  const offerId = (p.offerId as string | null) ?? null;
  const sourceKey = String(p.sourceKey);
  const settings = ctx.settings.get();
  const db = ctx.db;

  // First-task bonus — exactly once per member thanks to the idempotency key.
  if (kind !== 'ad' && settings.firstTaskBonusMicros > 0) {
    const posted = await postTransaction(db, {
      type: 'bonus_first_task',
      userId,
      idempotencyKey: `first_task:${userId}`,
      description: 'First-task bonus — welcome to Lucrum!',
      referenceType: 'bonus',
      referenceId: sourceKey,
      entries: [
        { account: SYS.bonusExpense, direction: 'debit', amount: settings.firstTaskBonusMicros },
        { account: userAccountCode(userId), direction: 'credit', amount: settings.firstTaskBonusMicros },
      ],
    });
    if (!posted.duplicate) {
      await notify(ctx, db, userId, {
        type: 'first_task_bonus',
        title: `🌱 +${formatUsd(settings.firstTaskBonusMicros)} first-task bonus`,
        body: 'You just proved it works. Cash out any amount — even $0.05 — to see the money land.',
        link: '/app/cashout',
      });
      ctx.events.toUser(userId, 'balance', { reason: 'bonus_first_task' });
    }
  }
  if (kind !== 'ad') await onRefereeEarning(ctx, db, userId, amount, sourceKey);
  if (offerId) {
    await onPlanOfferCompleted(ctx, db, userId, offerId);
    await refreshOfferStats(db, offerId);
  }
  await evaluateAchievements(ctx, db, userId);
  await recomputeTier(ctx, db, userId);

  // Fraud heuristics on the earning itself.
  const duration = p.durationSeconds as number | null | undefined;
  const est = p.estSeconds as number | null | undefined;
  if (
    kind === 'conversion' &&
    typeof duration === 'number' &&
    typeof est === 'number' &&
    duration < Math.max(20, est * 0.15)
  ) {
    await recordSignal(ctx, db, userId, 'too_fast', {
      offerId,
      durationSeconds: duration,
      expectedSeconds: est,
    });
  }
  if ((await earningsInLastHour(db, userId)) > 20_000_000) {
    await recordSignal(ctx, db, userId, 'earning_velocity', {
      lastHourMicros: await earningsInLastHour(db, userId),
    });
  }
  invalidateStatsCache();
}

/** Member reported "I finished" but no postback yet: ask the network; at the end, file a claim for them. */
async function clickCheck(ctx: AppContext, p: Record<string, unknown>): Promise<void> {
  const clickId = String(p.clickId);
  const rows = await ctx.db
    .select({ click: offerClicks, offer: offers, network: networks, user: users })
    .from(offerClicks)
    .innerJoin(offers, eq(offers.id, offerClicks.offerId))
    .innerJoin(networks, eq(networks.id, offers.networkId))
    .innerJoin(users, eq(users.id, offerClicks.userId))
    .where(eq(offerClicks.id, clickId));
  const row = rows[0];
  if (!row || row.click.status !== 'reported') return;
  await ctx.db
    .update(offerClicks)
    .set({ checkCount: row.click.checkCount + 1 })
    .where(eq(offerClicks.id, clickId));
  const adapter = getAdapter(row.network.adapter);
  const check = adapter?.checkConversion
    ? await adapter.checkConversion(ctx.db, row.network.id, clickId)
    : null;
  if (check?.converted && check.networkTxnId) {
    const res = await creditConversion(ctx, {
      networkId: row.network.id,
      networkTxnId: check.networkTxnId,
      userId: row.user.id,
      offer: row.offer,
      click: row.click,
      payoutMicros: check.payoutMicros ?? row.offer.payoutMicros,
      kind: check.kind ?? 'complete',
      source: 'network_api',
    });
    if (!res.duplicate) {
      await notify(ctx, ctx.db, row.user.id, {
        type: 'credited_after_check',
        title: `✅ ${row.network.name} confirmed “${row.offer.title}”`,
        body: `Their postback never reached us, so we checked with them directly. +${formatUsd(res.userAmountMicros)} credited.`,
        link: '/app/activity',
      });
    }
    return;
  }
  if (p.final) {
    await createClaim(
      ctx,
      row.user,
      {
        clickId,
        note: 'Filed automatically by Lucrum: no confirmation from the network 72 hours after you reported finishing.',
      },
      { autoFiled: true },
    );
    await notify(ctx, ctx.db, row.user.id, {
      type: 'claim_autofiled',
      title: 'We filed a Missing Credit claim for you',
      body: `“${row.offer.title}” still isn’t confirmed after 72 hours, so we opened a claim on your behalf. You don’t need to do anything.`,
      link: '/app/activity',
    });
  }
}

async function expireClicks(ctx: AppContext): Promise<void> {
  await ctx.db
    .update(offerClicks)
    .set({ status: 'expired' })
    .where(and(inArray(offerClicks.status, ['started']), lt(offerClicks.expiresAt, new Date())));
}

/** Gentle evening streak reminder in the member's own timezone (max once a day). */
async function streakReminders(ctx: AppContext): Promise<void> {
  const rows = await ctx.db
    .select({ user: users, streak: streaks })
    .from(streaks)
    .innerJoin(users, eq(users.id, streaks.userId))
    .where(and(sql`${streaks.current} >= 2`, eq(users.status, 'active')));
  for (const { user, streak } of rows) {
    const today = localDate(user.timezone);
    if (streak.lastClaimDate !== previousDate(today)) continue; // already claimed today, or already broken
    if (localHour(user.timezone) < 18) continue;
    await ctx.jobs.enqueue(
      ctx.db,
      'engagement.streak_reminder',
      { userId: user.id, streak: streak.current },
      { dedupeKey: `streak_reminder:${user.id}:${today}` },
    );
  }
}

export function registerJobHandlers(queue: JobQueue): void {
  queue.register('earning.after', earningAfter);
  queue.register('click.check', clickCheck);
  queue.register('claim.autoresolve', (ctx, p) => autoResolveClaim(ctx, String(p.claimId)));
  queue.register('payout.process', (ctx, p) => processPayout(ctx, String(p.payoutId)));
  queue.register('payout.poll', (ctx, p) => pollPayout(ctx, String(p.payoutId)));
  queue.register('engagement.achievements', async (ctx, p) => {
    await evaluateAchievements(ctx, ctx.db, String(p.userId));
    await recomputeTier(ctx, ctx.db, String(p.userId));
  });
  queue.register('engagement.streak_reminder', async (ctx, p) => {
    await notify(ctx, ctx.db, String(p.userId), {
      type: 'streak_reminder',
      title: `🔥 Keep your ${p.streak}-day streak alive`,
      body: 'Claim today’s bonus before midnight — it takes one tap.',
      link: '/app',
      email: { category: 'streaks' },
    });
  });
  queue.register('sandbox.deliver_postback', (ctx, p) =>
    deliverSandboxPostback(ctx, String(p.clickId), Boolean(p.corrupt)),
  );
  queue.register('sandbox.ssv_callback', (ctx, p) => deliverSsvCallback(ctx, String(p.sessionId)));
  queue.register('sandbox.kyc_review', (ctx, p) => sandboxKycReview(ctx, String(p.userId)));
  queue.register('ads.credit', async (ctx, p) => {
    await creditAdSession(ctx, String(p.sessionId));
  });
  // Periodic maintenance (enqueued by the scheduler below).
  queue.register('maintenance.minutely', async (ctx) => {
    await sweepClaimSla(ctx);
    await expireClicks(ctx);
    await expireStaleAdSessions(ctx);
  });
  queue.register('maintenance.hourly', async (ctx) => {
    await streakReminders(ctx);
    const pending = await ctx.db.select({ id: claims.id }).from(claims).where(eq(claims.status, 'checking'));
    for (const c of pending)
      await ctx.jobs.enqueue(
        ctx.db,
        'claim.autoresolve',
        { claimId: c.id },
        { dedupeKey: `claim.retry:${c.id}:${new Date().toISOString().slice(0, 13)}` },
      );
  });
}

/** Cron-like scheduler: enqueues periodic jobs with per-period dedupe keys (safe with many instances). */
export function startScheduler(ctx: AppContext): () => void {
  const tick = async () => {
    const now = new Date();
    try {
      await ctx.jobs.enqueue(
        ctx.db,
        'maintenance.minutely',
        {},
        { dedupeKey: `minutely:${now.toISOString().slice(0, 16)}`, maxAttempts: 1 },
      );
      await ctx.jobs.enqueue(
        ctx.db,
        'maintenance.hourly',
        {},
        { dedupeKey: `hourly:${now.toISOString().slice(0, 13)}`, maxAttempts: 1 },
      );
    } catch (err) {
      ctx.log.error({ err }, 'scheduler tick failed');
    }
  };
  void tick();
  const timer = setInterval(tick, 30_000);
  return () => clearInterval(timer);
}
