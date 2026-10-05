import { and, eq, gt, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { withUow, type AppContext } from '../context';
import { claims, jobs, offerClicks, offers, supportTickets, verificationTokens } from '../db/schema';
import { clock, DAY, HOUR, MINUTE } from '../lib/clock';
import { autoReviewKyc } from '../modules/account/service';
import { autoCheckClaim } from '../modules/claims/service';
import { deliverMessage, notify } from '../modules/notifications/service';
import { recomputeOfferStats } from '../modules/offers/service';
import { checkPayout, processPayout } from '../modules/payouts/service';
import { settleCommissions } from '../modules/referrals/service';
import { releaseHold } from '../modules/rewards/service';
import { firePostback } from '../modules/sandbox/service';
import { expireStaleSessions } from '../modules/video/service';
import { enqueue, type JobHandler } from './queue';

export function jobHandlers(): Record<string, JobHandler> {
  return {
    'message.deliver': (ctx, p) => deliverMessage(ctx, String(p.messageId)),
    'hold.release': async (ctx, p) => {
      await withUow(ctx, (uow) => releaseHold(uow, String(p.transactionId)));
    },
    'payout.process': (ctx, p) => processPayout(ctx, String(p.payoutId)),
    'payout.check': (ctx, p) => checkPayout(ctx, String(p.payoutId)),
    'claims.auto_check': (ctx, p) => autoCheckClaim(ctx, String(p.claimId)),
    'sandbox.fire_postback': (ctx, p) => firePostback(ctx, String(p.conversionId), p.kind === 'reversal' ? 'reversal' : 'credit'),
    'kyc.auto_review': (ctx, p) => autoReviewKyc(ctx, String(p.submissionId)),
    'referrals.settle': async (ctx) => {
      await settleCommissions(ctx);
    },
    'offers.recompute_stats': (ctx) => recomputeOfferStats(ctx),
    'maintenance.minutely': async (ctx) => {
      await expireStaleSessions(ctx);
      const now = clock.now();
      // Escalate claims that breached their SLA so they float to the top of the queue.
      await ctx.db
        .update(claims)
        .set({ timeline: sql`${claims.timeline} || ${JSON.stringify([{ label: 'SLA reached — escalated to a senior reviewer', at: now.toISOString() }])}::jsonb`, slaDueAt: new Date(now.getTime() + 4 * HOUR) })
        .where(and(eq(claims.status, 'in_review'), lt(claims.slaDueAt, now)));
    },
    /**
     * Missing-postback watchdog: members who came back from a partner 2h+ ago and
     * still have nothing credited get a proactive heads-up with a one-tap claim —
     * they shouldn't have to notice the problem themselves.
     */
    'clicks.nudge_missing': async (ctx) => {
      const now = clock.ms();
      const stale = await ctx.db
        .select({ click: offerClicks, title: offers.title })
        .from(offerClicks)
        .innerJoin(offers, eq(offers.id, offerClicks.offerId))
        .where(
          and(
            eq(offerClicks.status, 'started'),
            isNotNull(offerClicks.returnedAt),
            isNull(offerClicks.nudgedAt),
            lt(offerClicks.returnedAt, new Date(now - 2 * HOUR)),
            gt(offerClicks.returnedAt, new Date(now - 7 * DAY)),
          ),
        )
        .limit(200);
      for (const { click, title } of stale) {
        const [claim] = await ctx.db.select({ id: claims.id }).from(claims).where(eq(claims.clickId, click.id));
        await withUow(ctx, async (uow) => {
          await uow.tx.update(offerClicks).set({ nudgedAt: clock.now() }).where(eq(offerClicks.id, click.id));
          if (claim) return;
          await notify(uow, click.userId, {
            type: 'claim',
            title: `Still waiting on “${title}”?`,
            body: 'The partner hasn’t confirmed your completion yet. Tap to file a missing-credit claim — we’ll check with them automatically and pay you if we can verify it.',
            link: `/app/claims?click=${click.id}`,
          });
        });
      }
    },
    'maintenance.daily': async (ctx) => {
      const now = clock.ms();
      await ctx.db.delete(jobs).where(and(eq(jobs.status, 'done'), lt(jobs.updatedAt, new Date(now - 7 * DAY))));
      await ctx.db.delete(verificationTokens).where(lt(verificationTokens.expiresAt, new Date(now - 7 * DAY)));
      // Auto-close tickets that were resolved/awaiting the member for a week.
      await ctx.db
        .update(supportTickets)
        .set({ status: 'closed', updatedAt: clock.now() })
        .where(and(inArray(supportTickets.status, ['resolved', 'awaiting_user']), lt(supportTickets.updatedAt, new Date(now - 7 * DAY))));
    },
  };
}

/** Recurring tasks, deduplicated by time bucket so many API instances can run this safely. */
export function startScheduler(ctx: AppContext): () => void {
  const tick = async () => {
    const now = clock.ms();
    const minute = Math.floor(now / MINUTE);
    try {
      await enqueue(ctx.db, 'maintenance.minutely', {}, { dedupeKey: `minutely:${minute}`, maxAttempts: 1 });
      await enqueue(ctx.db, 'referrals.settle', {}, { dedupeKey: `referrals:${Math.floor(now / (15 * MINUTE))}`, maxAttempts: 3 });
      await enqueue(ctx.db, 'offers.recompute_stats', {}, { dedupeKey: `offer-stats:${Math.floor(now / (10 * MINUTE))}`, maxAttempts: 2 });
      await enqueue(ctx.db, 'clicks.nudge_missing', {}, { dedupeKey: `nudge:${Math.floor(now / (15 * MINUTE))}`, maxAttempts: 2 });
      await enqueue(ctx.db, 'maintenance.daily', {}, { dedupeKey: `daily:${Math.floor(now / DAY)}`, maxAttempts: 2 });
    } catch (err) {
      ctx.log.warn({ err }, 'scheduler tick failed');
    }
  };
  void tick();
  const timer = setInterval(tick, 60_000);
  return () => clearInterval(timer);
}
