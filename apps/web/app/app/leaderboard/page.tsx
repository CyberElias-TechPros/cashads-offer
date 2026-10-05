'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Trophy } from 'lucide-react';
import { flagEmoji, formatMoney, TIER_BY_ID } from '@cashads/shared';
import { Card, CardBody, PageHeader } from '@/components/ui/card';
import { Alert, Badge, Skeleton } from '@/components/ui/feedback';
import { Segmented } from '@/components/ui/form';
import { useLeaderboard } from '@/lib/queries';
import { cn } from '@/lib/utils';

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const { data, isLoading } = useLeaderboard(period);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Leaderboard"
        description="Friendly competition, based on earnings from offers and videos. Bonuses don’t count."
        action={<Segmented value={period} onChange={setPeriod} options={[{ value: 'week', label: '7 days' }, { value: 'month', label: '30 days' }]} />}
      />
      {data && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card>
            <CardBody>
              <p className="text-xs uppercase tracking-wide text-muted">Your rank</p>
              <p className="mt-1 text-2xl font-bold">{data.me.rank ? `#${data.me.rank}` : '—'}</p>
              <p className="text-sm text-muted">{data.me.percentile ? `Top ${data.me.percentile}% of ${data.participants}` : 'Complete an offer to join'}</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-xs uppercase tracking-wide text-muted">You earned</p>
              <p className="tabular mt-1 text-2xl font-bold">{formatMoney(data.me.earnedMicros)}</p>
              <p className="text-sm text-muted">in the last {period === 'week' ? '7' : '30'} days</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-xs uppercase tracking-wide text-muted">Window</p>
              <p className="mt-1 text-2xl font-bold">{period === 'week' ? 'Last 7 days' : 'Last 30 days'}</p>
              <p className="text-sm text-muted">Rolling — updates live, no Monday resets</p>
            </CardBody>
          </Card>
        </div>
      )}
      {data && !data.me.optedIn && (
        <Alert tone="info">
          You’re shown as “Anonymous member”.{' '}
          <Link href="/app/settings" className="font-semibold underline">
            Change in settings
          </Link>
        </Alert>
      )}
      <Card className="overflow-hidden">
        {isLoading && (
          <div className="space-y-2 p-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        )}
        <ol className="divide-y divide-line">
          {data?.entries.map((e) => (
            <li key={e.rank} className={cn('flex items-center gap-4 px-5 py-3', e.isMe && 'bg-brand-50/60 dark:bg-brand-500/5')}>
              <span className={cn('tabular flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold', e.rank === 1 ? 'bg-amber-400 text-white' : e.rank === 2 ? 'bg-slate-300 text-slate-800' : e.rank === 3 ? 'bg-orange-300 text-orange-900' : 'bg-surface-3 text-muted')}>
                {e.rank <= 3 ? <Trophy className="h-4 w-4" /> : e.rank}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {e.name} {e.isMe && <Badge tone="brand">You</Badge>}
              </span>
              <span className="text-lg">{flagEmoji(e.country)}</span>
              <Badge>{TIER_BY_ID[e.tier].label}</Badge>
              <span className="tabular w-24 text-right text-sm font-bold">{formatMoney(e.earnedMicros)}</span>
            </li>
          ))}
        </ol>
        {data && data.entries.length === 0 && <p className="p-8 text-center text-sm text-muted">No earnings in this window yet. Be the first!</p>}
      </Card>
    </div>
  );
}
