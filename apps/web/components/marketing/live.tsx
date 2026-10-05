'use client';

import { BadgeCheck, Clock, Zap } from 'lucide-react';
import { countryName, flagEmoji, formatDuration, formatMoney, formatMoneyCompact } from '@cashads/shared';
import { TimeAgo } from '@/components/ui/misc';
import { Skeleton } from '@/components/ui/feedback';
import { useLiveFeed } from '@/lib/live';
import { useFeed, usePublicStats } from '@/lib/queries';
import { cn, pct } from '@/lib/utils';

export function PayoutTicker() {
  const { data } = useFeed(16);
  const { items } = useLiveFeed(data, 16);
  if (!items.length) return <div className="h-12" />;
  const doubled = [...items, ...items];
  return (
    <div className="relative overflow-hidden border-y border-line bg-surface py-3" aria-label="Recent payouts">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-surface to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-surface to-transparent" />
      <div className="flex w-max animate-ticker gap-8 hover:[animation-play-state:paused]">
        {doubled.map((p, i) => (
          <div key={`${p.id}-${i}`} className="flex items-center gap-2 whitespace-nowrap text-sm">
            <span className="text-base">{p.methodLogo}</span>
            <span className="font-semibold">{p.name}</span>
            <span className="text-muted">{flagEmoji(p.country)}</span>
            <span className="text-muted">got</span>
            <span className="tabular font-bold text-brand-700 dark:text-brand-400">{formatMoney(p.amountMicros)}</span>
            <span className="text-muted">via {p.methodName}</span>
            {p.durationSeconds !== null && <span className="text-xs text-subtle">in {formatDuration(p.durationSeconds)}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function LiveFeedList({ limit = 10, className }: { limit?: number; className?: string }) {
  const { data, isLoading } = useFeed(limit);
  const { items, fresh } = useLiveFeed(data, limit);
  return (
    <div className={cn('rounded-2xl border border-line bg-surface shadow-soft', className)}>
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-500" />
          </span>
          <p className="text-sm font-semibold">Live payouts</p>
        </div>
        <p className="text-xs text-subtle">Real cash outs · anonymised</p>
      </div>
      <ul className="divide-y divide-line">
        {isLoading &&
          Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 px-5 py-3">
              <Skeleton className="h-9 w-9 rounded-full" />
              <Skeleton className="h-4 flex-1" />
            </li>
          ))}
        {items.map((p) => (
          <li key={p.id} className={cn('flex items-center gap-3 px-5 py-3 transition-colors', fresh === p.id && 'animate-slide-up bg-brand-50/60 dark:bg-brand-500/5')}>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-3 text-lg">{p.methodLogo}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                <span className="font-semibold">{p.name}</span> <span className="text-muted">{flagEmoji(p.country)} {countryName(p.country)}</span>
              </p>
              <p className="text-xs text-subtle">
                {p.methodName}
                {p.durationSeconds !== null && <> · paid in {formatDuration(p.durationSeconds)}</>}
              </p>
            </div>
            <div className="text-right">
              <p className="tabular text-sm font-bold text-brand-700 dark:text-brand-400">{formatMoney(p.amountMicros)}</p>
              <TimeAgo iso={p.at} className="text-xs text-subtle" />
            </div>
          </li>
        ))}
        {!isLoading && items.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted">The first payouts will appear here.</li>}
      </ul>
    </div>
  );
}

export function TrustStats({ className }: { className?: string }) {
  const { data: s } = usePublicStats();
  const items = [
    { icon: <Clock className="h-4 w-4" />, label: 'Median payout time', value: s ? formatDuration(s.medianPayoutSeconds) : '—' },
    { icon: <Zap className="h-4 w-4" />, label: 'Paid to members', value: s ? formatMoneyCompact(s.totalPaidMicros) : '—' },
    { icon: <BadgeCheck className="h-4 w-4" />, label: 'Partner signals credited', value: s ? pct(s.trackingSuccessRate, 1) : '—' },
    { icon: <span className="text-sm font-bold">%</span>, label: 'Your revenue share', value: s ? `${s.revenueShareBps / 100}%` : '60%' },
  ];
  return (
    <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-4', className)}>
      {items.map((it) => (
        <div key={it.label} className="rounded-2xl border border-line bg-surface/80 p-4 backdrop-blur">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
            <span className="text-brand-600 dark:text-brand-400">{it.icon}</span>
            {it.label}
          </div>
          <p className="tabular mt-1.5 text-xl font-bold tracking-tight sm:text-2xl">{it.value}</p>
        </div>
      ))}
    </div>
  );
}
