import { eq, sql } from 'drizzle-orm';
import type { Micros } from '@cashads/shared';
import type { Q, Tx } from '../../db/client';
import { ledgerEntries, ledgerPostings, wallets } from '../../db/schema';
import { clock } from '../../lib/clock';

/**
 * Double-entry ledger.
 *
 * Every money movement is an entry with ≥2 postings whose amounts sum to ZERO.
 * Model: money flows FROM an account (negative posting) TO an account (positive).
 *  - user:<id>:available / user:<id>:pending  → what we owe the member (positive)
 *  - network:<id>                              → what a partner owes us (negative)
 *  - platform:revenue                          → our margin (positive)
 *  - platform:marketing                        → bonuses we funded (negative)
 *  - platform:goodwill                         → missing-credit payouts we absorbed (negative)
 *  - platform:loss                             → reversals we couldn't recover (negative)
 *  - platform:payouts_in_transit               → reserved for in-flight cash outs
 *  - platform:paid_out                         → money that left to members (positive)
 *  - platform:fees                             → payout fees collected (positive)
 *  - platform:adjustments                      → manual admin corrections
 *
 * Entries are idempotent (unique idempotency key) and append-only. The `wallets`
 * table is a cache of user account balances, updated in the same transaction and
 * verifiable at any time via reconciliation (admin → Ledger).
 */
export const acct = {
  available: (userId: string) => `user:${userId}:available`,
  pending: (userId: string) => `user:${userId}:pending`,
  network: (networkId: string) => `network:${networkId}`,
  revenue: 'platform:revenue',
  marketing: 'platform:marketing',
  goodwill: 'platform:goodwill',
  loss: 'platform:loss',
  inTransit: 'platform:payouts_in_transit',
  paidOut: 'platform:paid_out',
  fees: 'platform:fees',
  adjustments: 'platform:adjustments',
} as const;

export interface Posting {
  account: string;
  amount: Micros;
}

export interface EntryInput {
  kind: string;
  idempotencyKey: string;
  transactionId?: string | null;
  memo?: string;
  postings: Posting[];
}

export class LedgerError extends Error {}

const USER_ACCOUNT = /^user:([0-9a-f-]{36}):(available|pending)$/;

export async function postEntry(tx: Tx, input: EntryInput): Promise<{ entryId: string; duplicate: boolean }> {
  const postings = input.postings.filter((p) => p.amount !== 0);
  if (postings.length < 2) throw new LedgerError(`Entry ${input.kind} needs at least two non-zero postings`);
  for (const p of postings) {
    if (!Number.isSafeInteger(p.amount)) throw new LedgerError(`Non-integer amount in ${input.kind}: ${p.amount}`);
  }
  const sum = postings.reduce((s, p) => s + p.amount, 0);
  if (sum !== 0) throw new LedgerError(`Unbalanced entry ${input.kind}: postings sum to ${sum}`);

  const now = clock.now();
  const inserted = await tx
    .insert(ledgerEntries)
    .values({ kind: input.kind, idempotencyKey: input.idempotencyKey, transactionId: input.transactionId ?? null, memo: input.memo, createdAt: now })
    .onConflictDoNothing({ target: ledgerEntries.idempotencyKey })
    .returning({ id: ledgerEntries.id });

  if (inserted.length === 0) {
    const [existing] = await tx.select({ id: ledgerEntries.id }).from(ledgerEntries).where(eq(ledgerEntries.idempotencyKey, input.idempotencyKey));
    return { entryId: existing.id, duplicate: true };
  }
  const entryId = inserted[0].id;
  await tx.insert(ledgerPostings).values(postings.map((p) => ({ entryId, account: p.account, amountMicros: p.amount, createdAt: now })));

  // Update cached wallet balances for any user accounts touched.
  const deltas = new Map<string, { available: number; pending: number }>();
  for (const p of postings) {
    const m = USER_ACCOUNT.exec(p.account);
    if (!m) continue;
    const d = deltas.get(m[1]) ?? { available: 0, pending: 0 };
    d[m[2] as 'available' | 'pending'] += p.amount;
    deltas.set(m[1], d);
  }
  for (const [userId, d] of deltas) {
    await tx
      .update(wallets)
      .set({
        availableMicros: sql`${wallets.availableMicros} + ${d.available}`,
        pendingMicros: sql`${wallets.pendingMicros} + ${d.pending}`,
        updatedAt: now,
      })
      .where(eq(wallets.userId, userId));
  }
  return { entryId, duplicate: false };
}

/** Lock a wallet row for the rest of the transaction (prevents concurrent overdraws). */
export async function lockWallet(tx: Tx, userId: string) {
  const [w] = await tx.select().from(wallets).where(eq(wallets.userId, userId)).for('update');
  if (!w) throw new LedgerError(`Wallet missing for user ${userId}`);
  return w;
}

export async function bumpLifetime(q: Q, userId: string, delta: { earned?: Micros; withdrawn?: Micros }) {
  await q
    .update(wallets)
    .set({
      lifetimeEarnedMicros: sql`${wallets.lifetimeEarnedMicros} + ${delta.earned ?? 0}`,
      lifetimeWithdrawnMicros: sql`${wallets.lifetimeWithdrawnMicros} + ${delta.withdrawn ?? 0}`,
    })
    .where(eq(wallets.userId, userId));
}

export async function accountBalance(q: Q, account: string): Promise<Micros> {
  const [row] = await q
    .select({ total: sql<string>`coalesce(sum(${ledgerPostings.amountMicros}), 0)` })
    .from(ledgerPostings)
    .where(eq(ledgerPostings.account, account));
  return Number(row?.total ?? 0);
}
