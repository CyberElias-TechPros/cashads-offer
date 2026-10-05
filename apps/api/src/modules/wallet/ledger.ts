import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { TransactionDTO, TxnType } from '@lucrum/shared';
import type { DbOrTx } from '../../db/client';
import { ledgerAccounts, ledgerEntries, ledgerTransactions } from '../../db/schema';
import { AppError, isCheckViolation } from '../../lib/errors';

/**
 * Double-entry ledger.
 *
 *  • Every money movement is a transaction of ≥2 entries whose debits == credits.
 *  • Every transaction has a globally-unique idempotency key → retries are free.
 *  • Accounts are locked (SELECT … FOR UPDATE, in id order) and their cached
 *    balance is updated in the same DB transaction as the entries.
 *  • Member accounts carry a CHECK (balance >= 0) — overdrafts are impossible
 *    even if application logic had a bug.
 */

export const SYS = {
  platformRevenue: 'sys:platform_revenue',
  bonusExpense: 'sys:bonus_expense',
  goodwillExpense: 'sys:goodwill_expense',
  reversalLoss: 'sys:reversal_loss',
  payoutClearing: 'sys:payout_clearing',
  cash: 'sys:cash',
  adjustments: 'sys:adjustments',
  fraudRecovery: 'sys:fraud_recovery',
  networkReceivable: (networkId: string) => `sys:network_receivable:${networkId}`,
  charityPayable: (charityId: string) => `sys:charity_payable:${charityId}`,
} as const;

type Side = 'debit' | 'credit';

function systemAccountSpec(code: string): { normalSide: Side; allowNegative: boolean } {
  if (code.startsWith('sys:network_receivable:')) return { normalSide: 'debit', allowNegative: true };
  if (code.startsWith('sys:charity_payable:')) return { normalSide: 'credit', allowNegative: false };
  switch (code) {
    case SYS.platformRevenue:
    case SYS.fraudRecovery:
      return { normalSide: 'credit', allowNegative: true };
    case SYS.payoutClearing:
      // Money reserved for in-flight payouts can never go negative: double-completing
      // or double-refunding a payout would violate this constraint and roll back.
      return { normalSide: 'credit', allowNegative: false };
    case SYS.bonusExpense:
    case SYS.goodwillExpense:
    case SYS.reversalLoss:
    case SYS.cash:
    case SYS.adjustments:
      return { normalSide: 'debit', allowNegative: true };
    default:
      throw new Error(`Unknown system account ${code}`);
  }
}

export const userAccountCode = (userId: string) => `user:${userId}:available`;

export async function ensureUserAccount(db: DbOrTx, userId: string): Promise<void> {
  await db
    .insert(ledgerAccounts)
    .values({
      code: userAccountCode(userId),
      userId,
      kind: 'user_available',
      normalSide: 'credit',
      allowNegative: false,
    })
    .onConflictDoNothing();
}

export interface EntryInput {
  account: string;
  direction: Side;
  amount: number;
}

export interface PostInput {
  type: TxnType;
  userId: string | null;
  idempotencyKey: string;
  description: string;
  referenceType?: string;
  referenceId?: string;
  metadata?: Record<string, unknown>;
  entries: EntryInput[];
  at?: Date;
}

export interface PostResult {
  id: string;
  duplicate: boolean;
}

export async function postTransaction(db: DbOrTx, input: PostInput): Promise<PostResult> {
  const entries = input.entries.filter((e) => e.amount !== 0);
  if (entries.length < 2) throw new Error('A ledger transaction needs at least two non-zero entries');
  for (const e of entries) {
    if (!Number.isSafeInteger(e.amount) || e.amount <= 0) throw new Error(`Invalid entry amount ${e.amount}`);
  }
  const debits = entries.filter((e) => e.direction === 'debit').reduce((s, e) => s + e.amount, 0);
  const credits = entries.filter((e) => e.direction === 'credit').reduce((s, e) => s + e.amount, 0);
  if (debits !== credits) throw new Error(`Unbalanced transaction: debits ${debits} != credits ${credits}`);

  const at = input.at ?? new Date();
  const inserted = await db
    .insert(ledgerTransactions)
    .values({
      type: input.type,
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      description: input.description,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      metadata: input.metadata ?? null,
      createdAt: at,
    })
    .onConflictDoNothing({ target: ledgerTransactions.idempotencyKey })
    .returning({ id: ledgerTransactions.id });

  if (inserted.length === 0) {
    const existing = await db
      .select({ id: ledgerTransactions.id })
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.idempotencyKey, input.idempotencyKey));
    return { id: existing[0]!.id, duplicate: true };
  }
  const txnId = inserted[0]!.id;

  const codes = [...new Set(entries.map((e) => e.account))];
  let accounts = await lockAccounts(db, codes);
  const missing = codes.filter((c) => !accounts.some((a) => a.code === c));
  if (missing.length > 0) {
    for (const code of missing) {
      if (code.startsWith('user:')) {
        const userId = code.split(':')[1]!;
        await ensureUserAccount(db, userId);
      } else {
        const spec = systemAccountSpec(code);
        await db
          .insert(ledgerAccounts)
          .values({ code, kind: 'system', normalSide: spec.normalSide, allowNegative: spec.allowNegative })
          .onConflictDoNothing();
      }
    }
    accounts = await lockAccounts(db, codes);
  }
  const byCode = new Map(accounts.map((a) => [a.code, a]));

  await db.insert(ledgerEntries).values(
    entries.map((e) => ({
      transactionId: txnId,
      accountId: byCode.get(e.account)!.id,
      direction: e.direction,
      amountMicros: e.amount,
      createdAt: at,
    })),
  );

  const deltas = new Map<string, number>();
  for (const e of entries) {
    const acct = byCode.get(e.account)!;
    const signed = e.direction === acct.normalSide ? e.amount : -e.amount;
    deltas.set(acct.id, (deltas.get(acct.id) ?? 0) + signed);
  }

  try {
    for (const [accountId, delta] of [...deltas.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (delta === 0) continue;
      await db
        .update(ledgerAccounts)
        .set({ balanceMicros: sql`${ledgerAccounts.balanceMicros} + ${delta}` })
        .where(eq(ledgerAccounts.id, accountId));
    }
  } catch (err) {
    if (isCheckViolation(err))
      throw new AppError(409, 'INSUFFICIENT_FUNDS', 'Insufficient balance for this operation');
    throw err;
  }

  return { id: txnId, duplicate: false };
}

async function lockAccounts(db: DbOrTx, codes: string[]) {
  return db
    .select({
      id: ledgerAccounts.id,
      code: ledgerAccounts.code,
      normalSide: ledgerAccounts.normalSide,
      balance: ledgerAccounts.balanceMicros,
    })
    .from(ledgerAccounts)
    .where(inArray(ledgerAccounts.code, codes))
    .orderBy(ledgerAccounts.id)
    .for('update');
}

/* ── reads ─────────────────────────────────────────────────────────────────── */

export async function getAvailableMicros(db: DbOrTx, userId: string): Promise<number> {
  const rows = await db
    .select({ balance: ledgerAccounts.balanceMicros })
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.code, userAccountCode(userId)));
  return rows[0]?.balance ?? 0;
}

export async function getAccountBalance(db: DbOrTx, code: string): Promise<number> {
  const rows = await db
    .select({ balance: ledgerAccounts.balanceMicros })
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.code, code));
  return rows[0]?.balance ?? 0;
}

export const EARNING_TXN_TYPES: TxnType[] = [
  'conversion',
  'ad_reward',
  'poll_reward',
  'lesson_reward',
  'goodwill',
];
export const BONUS_TXN_TYPES: TxnType[] = [
  'bonus_streak',
  'bonus_first_task',
  'bonus_plan',
  'bonus_combo',
  'bonus_referral',
  'referral_residual',
];

/** Total ever credited to the member from earnings + bonuses (net of fraud clawbacks). */
export async function lifetimeEarnedMicros(db: DbOrTx, userId: string): Promise<number> {
  const res = await db.execute<{ total: number | string | null }>(sql`
    select coalesce(sum(case when e.direction = 'credit' then e.amount_micros else -e.amount_micros end), 0) as total
    from ledger_entries e
    join ledger_accounts a on a.id = e.account_id
    join ledger_transactions t on t.id = e.transaction_id
    where a.code = ${userAccountCode(userId)}
      and t.type in (${sql.join(
        [...EARNING_TXN_TYPES, ...BONUS_TXN_TYPES, 'clawback'].map((t) => sql`${t}`),
        sql`, `,
      )})`);
  return Number(res.rows[0]?.total ?? 0);
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}
function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [ts, id] = Buffer.from(cursor, 'base64url').toString().split('|');
    if (!ts || !id) return null;
    return { createdAt: new Date(ts), id };
  } catch {
    return null;
  }
}

export async function listUserTransactions(
  db: DbOrTx,
  userId: string,
  opts: { limit: number; cursor?: string | undefined; types?: TxnType[] | undefined },
): Promise<{ items: TransactionDTO[]; nextCursor: string | null }> {
  const acct = await db
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.code, userAccountCode(userId)));
  if (!acct[0]) return { items: [], nextCursor: null };
  const cur = opts.cursor ? decodeCursor(opts.cursor) : null;
  const conds = [eq(ledgerEntries.accountId, acct[0].id)];
  if (cur) {
    conds.push(
      or(
        lt(ledgerTransactions.createdAt, cur.createdAt),
        and(eq(ledgerTransactions.createdAt, cur.createdAt), lt(ledgerTransactions.id, cur.id)),
      )!,
    );
  }
  if (opts.types?.length) conds.push(inArray(ledgerTransactions.type, opts.types));
  const rows = await db
    .select({
      id: ledgerTransactions.id,
      type: ledgerTransactions.type,
      description: ledgerTransactions.description,
      createdAt: ledgerTransactions.createdAt,
      referenceType: ledgerTransactions.referenceType,
      referenceId: ledgerTransactions.referenceId,
      amount: sql<string>`sum(case when ${ledgerEntries.direction} = 'credit' then ${ledgerEntries.amountMicros} else -${ledgerEntries.amountMicros} end)`,
    })
    .from(ledgerEntries)
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
    .where(and(...conds))
    .groupBy(ledgerTransactions.id)
    .orderBy(desc(ledgerTransactions.createdAt), desc(ledgerTransactions.id))
    .limit(opts.limit + 1);

  const items = rows.slice(0, opts.limit).map((r) => ({
    id: r.id,
    type: r.type as TxnType,
    description: r.description,
    amountMicros: Number(r.amount),
    createdAt: r.createdAt.toISOString(),
    referenceType: r.referenceType,
    referenceId: r.referenceId,
  }));
  const last = rows.length > opts.limit ? rows[opts.limit - 1] : undefined;
  return { items, nextCursor: last ? encodeCursor(last.createdAt, last.id) : null };
}

/** Invariant check used by tests and the admin health panel: Σ debits == Σ credits. */
export async function ledgerIsBalanced(
  db: DbOrTx,
): Promise<{ ok: boolean; debits: number; credits: number }> {
  const res = await db.execute<{ debits: string | number; credits: string | number }>(sql`
    select coalesce(sum(case when direction = 'debit' then amount_micros end), 0) as debits,
           coalesce(sum(case when direction = 'credit' then amount_micros end), 0) as credits
    from ledger_entries`);
  const debits = Number(res.rows[0]?.debits ?? 0);
  const credits = Number(res.rows[0]?.credits ?? 0);
  return { ok: debits === credits, debits, credits };
}

/** Cached balances must equal the sum of entries for every account. */
export async function balancesMatchEntries(db: DbOrTx): Promise<boolean> {
  const res = await db.execute<{ mismatches: number | string }>(sql`
    select count(*) as mismatches from (
      select a.id, a.balance_micros,
        coalesce(sum(case when e.direction = a.normal_side then e.amount_micros else -e.amount_micros end), 0) as computed
      from ledger_accounts a left join ledger_entries e on e.account_id = a.id
      group by a.id
    ) x where x.balance_micros <> x.computed`);
  return Number(res.rows[0]?.mismatches ?? 0) === 0;
}
