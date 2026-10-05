import { and, eq } from 'drizzle-orm';
import { type OfferDTO, type PlanDTO, formatUsd } from '@lucrum/shared';
import type { AppContext } from '../../context';
import type { DbOrTx } from '../../db/client';
import { dailyPlans, users } from '../../db/schema';
import type { UserRow } from '../../http/auth';
import { localDate } from '../../lib/time';
import { notify } from '../platform/messaging';
import { SYS, postTransaction, userAccountCode } from '../wallet/ledger';
import { listOffersForUser } from './service';

/**
 * Personalised daily plan (spec pain point #8 — "I don't know what to do next"):
 * "Today: 3 tasks · $4.10 · ~12 min". Removes decision fatigue; finishing it pays a bonus.
 *
 * Selection: best hourly rate first, one task per category for variety, at least
 * one quick task, within a ~15-minute time budget. Frozen for the member's day.
 */
export function selectPlan(candidates: OfferDTO[], budgetMinutes = 15, maxItems = 3): OfferDTO[] {
  const pool = candidates
    .filter(
      (o) =>
        !o.completedByMe && o.myStatus !== 'started' && o.myStatus !== 'reported' && o.quality.grade !== 'F',
    )
    .sort((a, b) => b.hourlyRateMicros - a.hourlyRateMicros);
  const picked: OfferDTO[] = [];
  let minutes = 0;
  const quick = pool.find((o) => o.effectiveMinutes <= 3);
  if (quick) {
    picked.push(quick);
    minutes += quick.effectiveMinutes;
  }
  for (const o of pool) {
    if (picked.length >= maxItems) break;
    if (picked.some((p) => p.id === o.id || p.category === o.category)) continue;
    if (minutes + o.effectiveMinutes > budgetMinutes) continue;
    picked.push(o);
    minutes += o.effectiveMinutes;
  }
  return picked;
}

export async function getPlan(ctx: AppContext, user: UserRow): Promise<PlanDTO> {
  const today = localDate(user.timezone);
  const settings = ctx.settings.get();
  const offers = await listOffersForUser(ctx, user, { sort: 'hourly' });
  const existing = await ctx.db
    .select()
    .from(dailyPlans)
    .where(and(eq(dailyPlans.userId, user.id), eq(dailyPlans.planDate, today)));
  let row = existing[0];
  if (!row) {
    const picked = selectPlan(offers);
    const inserted = await ctx.db
      .insert(dailyPlans)
      .values({ userId: user.id, planDate: today, offerIds: picked.map((o) => o.id) })
      .onConflictDoNothing()
      .returning();
    row =
      inserted[0] ??
      (
        await ctx.db
          .select()
          .from(dailyPlans)
          .where(and(eq(dailyPlans.userId, user.id), eq(dailyPlans.planDate, today)))
      )[0]!;
  }
  // Credited plan offers disappear from the active list (completed), so look them up across all states.
  const allById = new Map(offers.map((o) => [o.id, o]));
  const items = row.offerIds
    .map((id) => allById.get(id))
    .filter((o): o is OfferDTO => Boolean(o))
    .map((offer) => ({ offer, done: offer.completedByMe || offer.myStatus === 'credited' }));
  return {
    date: today,
    items,
    totalMicros: items.reduce((s, i) => s + i.offer.userPayoutMicros, 0),
    totalMinutes: Math.round(items.reduce((s, i) => s + i.offer.effectiveMinutes, 0)),
    completed: items.length > 0 && items.every((i) => i.done),
    bonusMicros: settings.planBonusMicros,
    bonusPaid: row.bonusPaid,
  };
}

/** Called after a conversion: pays the plan bonus once every planned task is done. */
export async function onPlanOfferCompleted(
  ctx: AppContext,
  db: DbOrTx,
  userId: string,
  offerId: string,
): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return;
  const today = localDate(user.timezone);
  const rows = await db
    .select()
    .from(dailyPlans)
    .where(and(eq(dailyPlans.userId, userId), eq(dailyPlans.planDate, today)));
  const plan = rows[0];
  if (!plan || plan.bonusPaid || !plan.offerIds.includes(offerId)) return;
  const dto = await getPlan(ctx, user);
  if (!dto.completed) return;
  const bonus = ctx.settings.get().planBonusMicros;
  await db
    .update(dailyPlans)
    .set({ bonusPaid: true })
    .where(and(eq(dailyPlans.userId, userId), eq(dailyPlans.planDate, today)));
  if (bonus > 0) {
    await postTransaction(db, {
      type: 'bonus_plan',
      userId,
      idempotencyKey: `plan:${userId}:${today}`,
      description: 'Daily plan completed',
      referenceType: 'plan',
      referenceId: today,
      entries: [
        { account: SYS.bonusExpense, direction: 'debit', amount: bonus },
        { account: userAccountCode(userId), direction: 'credit', amount: bonus },
      ],
    });
  }
  await notify(ctx, db, userId, {
    type: 'plan_complete',
    title: '✅ Daily plan complete',
    body:
      bonus > 0
        ? `Nice work — ${formatUsd(bonus)} plan bonus added. See you tomorrow!`
        : 'Nice work — see you tomorrow!',
    link: '/app',
  });
  ctx.events.toUser(userId, 'balance', { reason: 'bonus_plan' });
}
