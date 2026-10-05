import { and, eq, inArray, sql } from 'drizzle-orm';
import { formatMoney, type Micros } from '@cashads/shared';
import type { Uow } from '../../context';
import { transactions } from '../../db/schema';
import { checkAchievements, recomputeTier } from '../engagement/service';
import { notify } from '../notifications/service';
import { onRefereeEarning } from '../referrals/service';
import { acct } from '../wallet/ledger';
import { creditUser } from './service';

/**
 * Post-earning pipeline, run inside the same transaction as the credit:
 * welcome bonus → referral qualification/commission → achievements → tier.
 */
export async function onEarned(uow: Uow, userId: string, opts: { kind: 'offer' | 'video' | 'goodwill'; baseMicros: Micros }) {
  if (opts.kind !== 'video') {
    const [row] = await uow.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(transactions)
      .where(
        and(eq(transactions.userId, userId), inArray(transactions.type, ['offer', 'goodwill']), inArray(transactions.status, ['pending', 'completed'])),
      );
    const welcome = uow.ctx.settings.get().welcomeBonusMicros;
    if (Number(row?.n ?? 0) === 1 && welcome > 0) {
      const res = await creditUser(uow, {
        userId,
        type: 'welcome_bonus',
        description: 'Welcome bonus — first offer completed',
        idempotencyKey: `welcome:${userId}`,
        amountMicros: welcome,
        source: { account: acct.marketing },
        earning: false,
        celebrate: false,
      });
      if (!res.duplicate) {
        await notify(uow, userId, {
          type: 'credit',
          title: `Welcome bonus: ${formatMoney(welcome)} 🎁`,
          body: 'You completed your first offer. Cash out anytime — there’s no minimum.',
          link: '/app/wallet',
        });
      }
    }
  }
  await onRefereeEarning(uow, userId, opts.baseMicros, opts.kind);
  await checkAchievements(uow, userId);
  await recomputeTier(uow, userId);
}
