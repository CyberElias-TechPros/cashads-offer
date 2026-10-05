import crypto from 'node:crypto';
import { and, eq, gte, sql } from 'drizzle-orm';
import {
  applyBps,
  floorToCents,
  formatMoney,
  TIER_BY_ID,
  timeUntil,
  type Micros,
  type RiskLevel,
  type TierId,
  type TransactionType,
} from '@cashads/shared';
import type { Uow } from '../../context';
import { ledgerEntries, transactions, users, wallets } from '../../db/schema';
import { enqueue } from '../../jobs/queue';
import { clock, HOUR } from '../../lib/clock';
import { notify } from '../notifications/service';
import type { Settings } from '../settings/store';
import { acct, bumpLifetime, lockWallet, postEntry } from '../wallet/ledger';
import { addSignal } from '../fraud/service';

/* ---------------------------------------------------------------- pricing */

export function baseUserShare(partnerPayout: Micros, revenueShareBps: number): Micros {
  return applyBps(partnerPayout, revenueShareBps);
}

/** Tier bonus (paid by us), rounded down to whole cents so offer prices stay clean ($0.37, not $0.3744). */
export function tierBonus(base: Micros, tier: TierId): Micros {
  return floorToCents(applyBps(base, TIER_BY_ID[tier]?.bonusBps ?? 0));
}

/**
 * Safety hold, in hours, for a credit of `amount`.
 * Transparent rules (also shown in the UI):
 *  - offer-specific hold if the partner requires one (e.g. bank accounts: 72h)
 *  - ≥ high-value threshold → holdHoursHighValue; ≥ hold threshold → holdHoursDefault; else instant
 *  - multiplied by the tier's hold multiplier (Platinum = no holds)
 *  - medium-risk accounts wait at least 72h
 */
export function holdHoursFor(
  settings: Settings,
  opts: { offerHoldHours: number | null; amount: Micros; tier: TierId; riskLevel: RiskLevel },
): number {
  let base: number;
  if (opts.offerHoldHours !== null && opts.offerHoldHours !== undefined) base = opts.offerHoldHours;
  else if (opts.amount >= settings.highValueThresholdMicros) base = settings.holdHoursHighValue;
  else if (opts.amount >= settings.holdThresholdMicros) base = settings.holdHoursDefault;
  else base = 0;
  let hours = Math.ceil(base * (TIER_BY_ID[opts.tier]?.holdMultiplier ?? 1));
  if (opts.riskLevel === 'medium') hours = Math.max(hours, 72);
  return hours;
}

/* ---------------------------------------------------------------- credits */

export interface CreditInput {
  userId: string;
  type: TransactionType;
  description: string;
  idempotencyKey: string;
  /** Member's base amount, funded by `source.account`. */
  amountMicros: Micros;
  /** Extra on top (tier/combo bonus) — funded by platform:marketing. */
  bonusMicros?: Micros;
  source: { account: string; grossMicros?: Micros };
  holdUntil?: Date | null;
  referenceType?: string;
  referenceId?: string;
  meta?: Record<string, unknown>;
  /** Counts toward lifetime earnings (offers, videos, goodwill). Bonuses don't. */
  earning: boolean;
  /** Push a live "+$x" celebration to the member's open tabs. */
  celebrate?: boolean;
}

export interface CreditResult {
  transactionId: string;
  status: 'completed' | 'pending';
  duplicate: boolean;
  totalMicros: Micros;
}

export async function creditUser(uow: Uow, input: CreditInput): Promise<CreditResult> {
  const { tx } = uow;
  const bonus = input.bonusMicros ?? 0;
  const total = input.amountMicros + bonus;
  const now = clock.now();
  const pending = !!input.holdUntil && input.holdUntil.getTime() > now.getTime();
  const status = pending ? 'pending' : 'completed';
  const transactionId = crypto.randomUUID();

  const gross = input.source.grossMicros ?? input.amountMicros;
  const postings = [
    { account: input.source.account, amount: -gross },
    { account: pending ? acct.pending(input.userId) : acct.available(input.userId), amount: total },
  ];
  if (gross !== input.amountMicros) postings.push({ account: acct.revenue, amount: gross - input.amountMicros });
  if (bonus) postings.push({ account: acct.marketing, amount: -bonus });

  const entry = await postEntry(tx, {
    kind: `credit:${input.type}`,
    idempotencyKey: input.idempotencyKey,
    transactionId,
    memo: input.description,
    postings,
  });
  if (entry.duplicate) {
    const [existing] = await tx.select({ transactionId: ledgerEntries.transactionId }).from(ledgerEntries).where(eq(ledgerEntries.id, entry.entryId));
    const [t] = existing?.transactionId
      ? await tx.select().from(transactions).where(eq(transactions.id, existing.transactionId))
      : [];
    return {
      transactionId: existing?.transactionId ?? '',
      status: t?.status === 'pending' ? 'pending' : 'completed',
      duplicate: true,
      totalMicros: t?.amountMicros ?? total,
    };
  }

  await tx.insert(transactions).values({
    id: transactionId,
    userId: input.userId,
    type: input.type,
    status,
    amountMicros: total,
    description: input.description,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    availableAt: pending ? input.holdUntil! : null,
    meta: {
      ...input.meta,
      baseMicros: input.amountMicros,
      bonusMicros: bonus,
      grossMicros: gross,
      sourceAccount: input.source.account,
    },
    createdAt: now,
    settledAt: pending ? null : now,
  });

  if (input.earning) await bumpLifetime(tx, input.userId, { earned: total });
  if (pending) await enqueue(tx, 'hold.release', { transactionId }, { runAt: input.holdUntil!, dedupeKey: `hold:${transactionId}` });

  const ctx = uow.ctx;
  uow.afterCommit(async () => {
    if (input.celebrate !== false) {
      ctx.bus.publishToUser(input.userId, {
        type: 'credit',
        amountMicros: total,
        title: input.description,
        status,
        availableAt: pending ? input.holdUntil!.toISOString() : null,
        source: input.type,
      });
    }
    await publishWallet(uow, input.userId);
  });
  return { transactionId, status, duplicate: false, totalMicros: total };
}

export async function publishWallet(uow: Uow, userId: string) {
  const [w] = await uow.ctx.db.select().from(wallets).where(eq(wallets.userId, userId));
  if (!w) return;
  uow.ctx.bus.publishToUser(userId, {
    type: 'wallet',
    wallet: {
      availableMicros: w.availableMicros,
      pendingMicros: w.pendingMicros,
      lifetimeEarnedMicros: w.lifetimeEarnedMicros,
      lifetimeWithdrawnMicros: w.lifetimeWithdrawnMicros,
    },
  });
}

/* ----------------------------------------------------------- hold release */

export async function releaseHold(uow: Uow, transactionId: string): Promise<'released' | 'skipped' | 'postponed'> {
  const { tx } = uow;
  const [t] = await tx.select().from(transactions).where(eq(transactions.id, transactionId)).for('update');
  if (!t || t.status !== 'pending') return 'skipped';
  const [u] = await tx.select({ riskLevel: users.riskLevel, status: users.status }).from(users).where(eq(users.id, t.userId));
  const now = clock.now();
  if (t.availableAt && t.availableAt.getTime() > now.getTime() + 1000) {
    // Hold was extended (e.g. by review) — re-schedule.
    await enqueue(tx, 'hold.release', { transactionId }, { runAt: t.availableAt, dedupeKey: `hold:${transactionId}:${t.availableAt.getTime()}` });
    return 'postponed';
  }
  if (!u || u.riskLevel === 'high' || u.status === 'banned' || u.status === 'restricted') {
    const next = new Date(now.getTime() + 24 * HOUR);
    await tx.update(transactions).set({ availableAt: next }).where(eq(transactions.id, transactionId));
    await enqueue(tx, 'hold.release', { transactionId }, { runAt: next, dedupeKey: `hold:${transactionId}:${next.getTime()}` });
    return 'postponed';
  }
  await postEntry(tx, {
    kind: 'hold_release',
    idempotencyKey: `release:${transactionId}`,
    transactionId,
    postings: [
      { account: acct.pending(t.userId), amount: -t.amountMicros },
      { account: acct.available(t.userId), amount: t.amountMicros },
    ],
  });
  await tx.update(transactions).set({ status: 'completed', settledAt: now }).where(eq(transactions.id, transactionId));
  await notify(uow, t.userId, {
    type: 'pending_released',
    title: `${formatMoney(t.amountMicros)} is now available`,
    body: `${t.description} cleared its safety hold. Cash out anytime.`,
    link: '/app/wallet',
  });
  uow.afterCommit(() => publishWallet(uow, t.userId));
  return 'released';
}

/* -------------------------------------------------------------- reversals */

/**
 * Partner chargeback. Takes back from pending first, then available; anything
 * the member already withdrew is absorbed by platform:loss (we don't chase members).
 */
export async function reverseCredit(uow: Uow, transactionId: string, reason: string): Promise<{ reversed: boolean; recoveredMicros: Micros; lossMicros: Micros }> {
  const { tx } = uow;
  const [t] = await tx.select().from(transactions).where(eq(transactions.id, transactionId)).for('update');
  if (!t || t.status === 'reversed' || t.status === 'canceled') return { reversed: false, recoveredMicros: 0, lossMicros: 0 };
  const meta = t.meta as { baseMicros?: number; bonusMicros?: number; grossMicros?: number; sourceAccount?: string };
  const base = meta.baseMicros ?? t.amountMicros;
  const bonus = meta.bonusMicros ?? 0;
  const gross = meta.grossMicros ?? base;
  const source = meta.sourceAccount ?? acct.adjustments;
  const total = t.amountMicros;
  const now = clock.now();

  const counter = [{ account: source, amount: gross }];
  if (gross !== base) counter.push({ account: acct.revenue, amount: -(gross - base) });
  if (bonus) counter.push({ account: acct.marketing, amount: bonus });

  let recovered = 0;
  let loss = 0;
  if (t.status === 'pending') {
    recovered = total;
    await postEntry(tx, {
      kind: 'reversal',
      idempotencyKey: `reverse:${transactionId}`,
      transactionId,
      memo: reason,
      postings: [{ account: acct.pending(t.userId), amount: -total }, ...counter],
    });
  } else {
    const w = await lockWallet(tx, t.userId);
    recovered = Math.min(total, Math.max(0, w.availableMicros));
    loss = total - recovered;
    const userSide = [];
    if (recovered) userSide.push({ account: acct.available(t.userId), amount: -recovered });
    if (loss) userSide.push({ account: acct.loss, amount: -loss });
    await postEntry(tx, {
      kind: 'reversal',
      idempotencyKey: `reverse:${transactionId}`,
      transactionId,
      memo: reason,
      postings: [...userSide, ...counter],
    });
    if (recovered) {
      await tx.insert(transactions).values({
        userId: t.userId,
        type: 'reversal',
        status: 'completed',
        amountMicros: -recovered,
        description: `Reversed by partner: ${t.description}`,
        referenceType: 'transaction',
        referenceId: t.id,
        meta: { reason, lossMicros: loss },
        createdAt: now,
        settledAt: now,
      });
    }
  }
  await tx
    .update(transactions)
    .set({ status: 'reversed', meta: { ...t.meta, reversalReason: reason, reversedAt: now.toISOString() } })
    .where(eq(transactions.id, transactionId));
  await bumpLifetime(tx, t.userId, { earned: -total });
  await notify(uow, t.userId, {
    type: 'reversal',
    title: `${t.description} was reversed by the partner`,
    body: `${reason} ${loss > 0 ? `You had already cashed out ${formatMoney(loss)} of it — we're covering that, nothing is owed.` : ''} Think this is wrong? Contact support and we'll dispute it for you.`.trim(),
    link: '/app/wallet',
  });

  // Reversal-rate signal (≥3 reversals and ≥30% of credits in 60 days).
  const since = new Date(now.getTime() - 60 * 24 * HOUR);
  const [stats] = await tx
    .select({
      total: sql<number>`count(*) filter (where ${transactions.type} = 'offer')::int`,
      reversed: sql<number>`count(*) filter (where ${transactions.type} = 'offer' and ${transactions.status} = 'reversed')::int`,
    })
    .from(transactions)
    .where(and(eq(transactions.userId, t.userId), gte(transactions.createdAt, since)));
  if (Number(stats.reversed) >= 3 && Number(stats.reversed) / Math.max(1, Number(stats.total)) >= 0.3) {
    await addSignal(uow, t.userId, 'high_reversal_rate', { reversed: stats.reversed, total: stats.total });
  }
  uow.afterCommit(() => publishWallet(uow, t.userId));
  return { reversed: true, recoveredMicros: recovered, lossMicros: loss };
}

export function holdLabel(availableAt: Date | null): string {
  return availableAt ? `unlocks ${timeUntil(availableAt, clock.now())}` : '';
}
