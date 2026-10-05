'use client';

import { useState } from 'react';
import { ArrowDownToLine, Clock, Hourglass, PiggyBank, TrendingUp, Wallet } from 'lucide-react';
import { formatMoney, timeUntil } from '@cashads/shared';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardHeader, PageHeader, Stat } from '@/components/ui/card';
import { EmptyState, Skeleton } from '@/components/ui/feedback';
import { Segmented } from '@/components/ui/form';
import { Money } from '@/components/ui/misc';
import { TransactionRow } from '@/components/app/widgets';
import { useMe, useTransactions } from '@/lib/queries';

const GROUPS = [
  { value: 'all', label: 'All' },
  { value: 'earning', label: 'Earnings' },
  { value: 'bonus', label: 'Bonuses' },
  { value: 'payout', label: 'Cash outs' },
  { value: 'adjustment', label: 'Adjustments' },
] as const;

export default function WalletPage() {
  const { data: me } = useMe();
  const [group, setGroup] = useState<(typeof GROUPS)[number]['value']>('all');
  const pending = useTransactions({ status: 'pending' });
  const txs = useTransactions({ group: group === 'all' ? undefined : group });
  if (!me) return null;
  const w = me.wallet;
  const pendingItems = (pending.data?.pages.flatMap((p) => p.items) ?? []).filter((t) => t.amountMicros > 0);
  const items = txs.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Wallet"
        description="Every amount is real money. Points don’t exist here — and nothing ever expires."
        action={
          <>
            <a href="/api/wallet/transactions.csv" className="inline-flex h-9 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold shadow-sm hover:bg-surface-2">
              <ArrowDownToLine className="h-4 w-4" /> Export CSV
            </a>
            <ButtonLink href="/app/cashout" size="sm">
              <Wallet className="h-4 w-4" /> Cash out
            </ButtonLink>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Available" value={<Money micros={w.availableMicros} animate />} hint="Cash out anytime" icon={<Wallet className="h-4 w-4" />} tone="brand" />
        <Stat label="Pending" value={<Money micros={w.pendingMicros} />} hint={w.nextRelease ? `Next unlocks ${timeUntil(w.nextRelease.at)}` : 'Nothing on hold'} icon={<Hourglass className="h-4 w-4" />} tone="amber" />
        <Stat label="Lifetime earned" value={<Money micros={w.lifetimeEarnedMicros} />} icon={<TrendingUp className="h-4 w-4" />} />
        <Stat label="Cashed out" value={<Money micros={w.lifetimeWithdrawnMicros} />} icon={<PiggyBank className="h-4 w-4" />} />
      </div>

      {pendingItems.length > 0 && (
        <Card>
          <CardHeader icon={<Clock className="h-5 w-5" />} title="On safety hold" description="High-value partner rewards wait briefly in case the partner reverses a fraudulent sign-up. Each one unlocks automatically." />
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {pendingItems.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3 sm:px-6">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{t.description}</p>
                  <p className="text-xs text-amber-600 dark:text-amber-400">{t.availableAt ? `Unlocks ${timeUntil(t.availableAt)} · ${new Date(t.availableAt).toLocaleString()}` : 'Under review'}</p>
                </div>
                <Money micros={t.amountMicros} className="text-sm font-bold" />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <h2 className="font-semibold">History</h2>
          <Segmented size="sm" value={group} onChange={setGroup} options={GROUPS.map((g) => ({ value: g.value, label: g.label }))} className="overflow-x-auto" />
        </div>
        {txs.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState className="m-5" icon="🧾" title="No transactions yet" description="Your earnings, bonuses and cash outs will show up here." />
        ) : (
          <div className="divide-y divide-line">
            {items.map((t) => (
              <TransactionRow key={t.id} tx={t} />
            ))}
          </div>
        )}
        {txs.hasNextPage && (
          <div className="border-t border-line p-4 text-center">
            <Button variant="secondary" size="sm" onClick={() => void txs.fetchNextPage()} loading={txs.isFetchingNextPage}>
              Load more
            </Button>
          </div>
        )}
      </Card>
      <p className="text-center text-xs text-subtle">
        Balances come from a double-entry ledger that is reconciled continuously. Partner reversals are explained line by line. Amounts under $1 keep their sub-cent digits ({formatMoney(18_000)} is not rounded away).
      </p>
    </div>
  );
}
