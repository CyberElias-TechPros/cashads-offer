import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, Banknote, Clock, Receipt, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  PAYOUT_STATUS,
  type Page,
  type PayoutDTO,
  TXN_TYPES,
  type TransactionDTO,
  formatLocal,
  formatUsd,
} from '@lucrum/shared';
import { Money as MoneyText } from '../../components/brand';
import { PayoutStatusBadge } from '../../components/earn';
import {
  Button,
  ButtonLink,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Segmented,
  Skeleton,
  Stat,
  Timeline,
} from '../../components/ui';
import { errorMessage, get, post } from '../../lib/api';
import { qk, useMoney, useWallet } from '../../lib/queries';
import { cn, dateTime, downloadUrl, duration, timeAgo } from '../../lib/utils';
import { toast } from '../../store/ui';

type Group = 'all' | 'earning' | 'bonus' | 'payout' | 'donation';

export function WalletPage() {
  const { data: wallet } = useWallet();
  const m = useMoney();
  const [group, setGroup] = useState<Group>('all');
  const { data: payouts } = useQuery({ queryKey: ['payouts'], queryFn: () => get<PayoutDTO[]>('/payouts') });
  const txns = useInfiniteQuery({
    queryKey: ['transactions', group],
    queryFn: ({ pageParam }) =>
      get<Page<TransactionDTO>>(
        `/wallet/transactions?limit=25${group !== 'all' ? `&group=${group}` : ''}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = txns.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Wallet"
        subtitle="Real money, full history. Balances never expire."
        actions={
          <>
            <Button variant="outline" onClick={() => downloadUrl('/wallet/transactions.csv')}>
              <ArrowDownToLine className="size-4" /> Export CSV
            </Button>
            <ButtonLink to="/app/cashout">
              <Banknote className="size-4" /> Cash out
            </ButtonLink>
          </>
        }
      />
      <Card className="grid grid-cols-2 gap-6 p-6 lg:grid-cols-5">
        <div className="col-span-2 lg:col-span-1">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Available</p>
          {wallet ? (
            <MoneyText micros={wallet.availableMicros} size="lg" floor animate />
          ) : (
            <Skeleton className="mt-2 h-8 w-28" />
          )}
        </div>
        <Stat
          label="Awaiting"
          value={wallet ? formatUsd(wallet.pendingMicros) : '—'}
          sub="Tasks you reported as done"
        />
        <Stat label="Lifetime earned" value={wallet ? formatUsd(wallet.lifetimeEarnedMicros) : '—'} />
        <Stat label="Cashed out" value={wallet ? formatUsd(wallet.lifetimePaidOutMicros) : '—'} />
        <Stat
          label="Donated"
          value={wallet ? formatUsd(wallet.donatedMicros) : '—'}
          sub={
            <Link to="/app/charity" className="underline">
              Earn for a cause
            </Link>
          }
        />
      </Card>

      {payouts && payouts.length > 0 && (
        <Card>
          <CardHeader
            title="Cash-outs"
            action={
              <Link to="/app/tax" className="text-sm font-semibold text-brand-700 dark:text-brand-400">
                Tax centre →
              </Link>
            }
          />
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {payouts.slice(0, 6).map((p) => (
              <li key={p.id}>
                <Link
                  to={`/app/payouts/${p.id}`}
                  className="flex items-center gap-3 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                >
                  <span className="flex size-9 items-center justify-center rounded-full bg-slate-100 text-lg dark:bg-slate-800">
                    {p.methodIcon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {p.methodName} · {p.destinationMasked}
                    </p>
                    <p className="text-xs text-slate-500">
                      {timeAgo(p.requestedAt)}
                      {p.durationSeconds !== null && <> · paid in {duration(p.durationSeconds)}</>}
                    </p>
                  </div>
                  <PayoutStatusBadge status={p.status} />
                  <span className="tabular w-20 text-right text-sm font-semibold">
                    {formatUsd(p.amountMicros)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="History" />
        <Segmented<Group>
          value={group}
          onChange={setGroup}
          options={[
            { value: 'all', label: 'All' },
            { value: 'earning', label: 'Earnings' },
            { value: 'bonus', label: 'Bonuses' },
            { value: 'payout', label: 'Cash-outs' },
            { value: 'donation', label: 'Donations' },
          ]}
          className="mb-3 max-w-full overflow-x-auto"
        />
        {txns.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="🧾"
            title="No transactions yet"
            body="Complete a task and it shows up here instantly."
          />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {items.map((t) => {
              const meta = TXN_TYPES[t.type];
              return (
                <li key={t.id} className="flex items-center gap-3 py-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-base dark:bg-slate-800">
                    {meta?.icon ?? '•'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.description}</p>
                    <p className="text-xs text-slate-500">
                      {meta?.label ?? t.type} · {dateTime(t.createdAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={cn(
                        'tabular text-sm font-semibold',
                        t.amountMicros > 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-900 dark:text-white',
                      )}
                    >
                      {formatUsd(t.amountMicros, { signed: true })}
                    </p>
                    {m.local(Math.abs(t.amountMicros)) && (
                      <p className="tabular text-[11px] text-slate-400">
                        {m.local(Math.abs(t.amountMicros))}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {txns.hasNextPage && (
          <Button
            variant="secondary"
            block
            className="mt-3"
            loading={txns.isFetchingNextPage}
            onClick={() => txns.fetchNextPage()}
          >
            Load more
          </Button>
        )}
      </Card>
    </div>
  );
}

export function PayoutDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const { data: p, isLoading } = useQuery({
    queryKey: ['payout', id],
    queryFn: () => get<PayoutDTO>(`/payouts/${id}`),
    refetchInterval: (q) =>
      q.state.data && ['pending', 'processing', 'review'].includes(q.state.data.status) ? 2500 : false,
  });
  const cancel = useMutation({
    mutationFn: () => post<PayoutDTO>(`/payouts/${id}/cancel`),
    onSuccess: (r) => {
      qc.setQueryData(['payout', id], r);
      qc.invalidateQueries({ queryKey: qk.wallet });
      toast.success('Cash-out cancelled', 'The full amount is back in your balance.');
    },
    onError: (err) => toast.error('Couldn’t cancel', errorMessage(err)),
  });
  if (isLoading || !p) return <Skeleton className="h-96" />;
  const s = PAYOUT_STATUS[p.status];
  const final = ['completed', 'failed', 'reversed', 'cancelled'].includes(p.status);
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="Cash-out" back={{ to: '/app/wallet', label: 'Wallet' }} />
      <Card className="p-6 text-center">
        <span className="text-4xl">{p.methodIcon}</span>
        <p className="tabular mt-3 text-4xl font-bold tracking-tight">{formatUsd(p.netMicros)}</p>
        {p.localCurrency !== 'USD' && (
          <p className="tabular text-slate-500">
            ≈{' '}
            {formatLocal(
              p.netMicros,
              p.localCurrency,
              p.localAmount / Math.max(0.000001, p.netMicros / 1_000_000),
            )}
          </p>
        )}
        <p className="mt-2 text-sm text-slate-500">
          to {p.methodName} · {p.destinationMasked}
        </p>
        <div className="mt-4 flex justify-center">
          <PayoutStatusBadge status={p.status} />
        </div>
        <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">{s.description}</p>
        {p.status === 'completed' && p.durationSeconds !== null && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <Clock className="size-4" /> Paid in {duration(p.durationSeconds)}
          </p>
        )}
      </Card>
      {p.nextAttemptAt && p.status === 'processing' && (
        <Callout tone="warning" title="The provider is having trouble — we’re retrying automatically">
          Next attempt {timeAgo(p.nextAttemptAt)} ({p.attempts} so far). If it can’t go through, the full{' '}
          {formatUsd(p.amountMicros)} returns to your balance.
        </Callout>
      )}
      <Card>
        <CardHeader title="Breakdown" icon={<Receipt className="size-5 text-slate-400" />} />
        <dl className="space-y-2 text-sm">
          <Row label="Amount from balance" value={formatUsd(p.amountMicros)} />
          <Row label="Provider fee" value={p.feeMicros ? `− ${formatUsd(p.feeMicros)}` : 'Free'} />
          <Row label="You receive" value={formatUsd(p.netMicros)} bold />
          {p.localCurrency !== 'USD' && (
            <Row
              label={`In ${p.localCurrency}`}
              value={p.localAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            />
          )}
          {p.providerReference && (
            <Row label="Reference" value={<span className="font-mono text-xs">{p.providerReference}</span>} />
          )}
          <Row label="Requested" value={dateTime(p.requestedAt)} />
          {p.completedAt && <Row label="Completed" value={dateTime(p.completedAt)} />}
        </dl>
      </Card>
      <Card>
        <CardHeader title="Status timeline" subtitle={final ? undefined : 'Updates live'} />
        <Timeline
          items={p.events.map((e, i) => ({
            title: PAYOUT_STATUS[e.status as keyof typeof PAYOUT_STATUS]?.label ?? e.status,
            body: e.message,
            at: dateTime(e.at),
            tone:
              e.status === 'completed'
                ? 'success'
                : e.status === 'failed' || e.status === 'reversed'
                  ? 'danger'
                  : e.status === 'review'
                    ? 'warning'
                    : 'info',
            active: !final && i === p.events.length - 1,
          }))}
        />
      </Card>
      {p.canCancel && (
        <Button variant="outline" block onClick={() => cancel.mutate()} loading={cancel.isPending}>
          <RotateCcw className="size-4" /> Cancel this cash-out
        </Button>
      )}
      <p className="text-center text-xs text-slate-500">
        Something wrong?{' '}
        <Link
          to={`/app/support?subject=${encodeURIComponent(`Cash-out ${p.id.slice(0, 8)}`)}&category=payout`}
          className="underline"
        >
          Contact support
        </Link>
      </p>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: React.ReactNode; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className={cn('tabular text-right', bold && 'font-semibold')}>{value}</dd>
    </div>
  );
}
