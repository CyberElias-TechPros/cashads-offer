import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, Clock, Gauge, HandCoins, Scale, ShieldX, Users } from 'lucide-react';
import {
  type NetworkReliabilityDTO,
  type PublicStatsDTO,
  type WallOfShameDTO,
  formatUsd,
} from '@lucrum/shared';
import { FeedRow } from '../../components/earn';
import { Badge, Callout, Card, CardHeader, Progress, Skeleton } from '../../components/ui';
import { get } from '../../lib/api';
import { usePublicFeed } from '../../lib/queries';
import { duration, pct, shortDate, timeAgo } from '../../lib/utils';

export function Transparency() {
  const { data: stats } = useQuery({
    queryKey: ['public-stats'],
    queryFn: () => get<PublicStatsDTO>('/public/stats'),
    refetchInterval: 60_000,
  });
  const { data: networks = [] } = useQuery({
    queryKey: ['public-networks'],
    queryFn: () => get<NetworkReliabilityDTO[]>('/public/networks'),
  });
  const { data: wall = [] } = useQuery({
    queryKey: ['wall'],
    queryFn: () => get<WallOfShameDTO[]>('/public/wall-of-shame'),
  });
  const { data: feed = [] } = usePublicFeed(15);

  const big = [
    {
      icon: HandCoins,
      label: 'Paid to members (after fees)',
      value: stats ? formatUsd(stats.totalPaidOutMicros) : null,
    },
    { icon: BadgeCheck, label: 'Cash-outs completed', value: stats?.payoutsCompleted.toLocaleString() },
    {
      icon: Clock,
      label: 'Median request → paid (30d)',
      value: stats ? duration(stats.medianPayoutSeconds) : null,
    },
    {
      icon: Gauge,
      label: 'Postback success rate (30d)',
      value: stats ? pct(stats.postbackSuccessRate, 1) : null,
    },
    {
      icon: Scale,
      label: 'Revenue share actually paid (30d)',
      value: stats?.actualShareBps30d ? `${(stats.actualShareBps30d / 100).toFixed(1)}%` : '—',
    },
    { icon: Users, label: 'Members', value: stats?.usersCount.toLocaleString() },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <p className="text-sm font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-400">
        Transparency report
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-5xl">
        Every number, live from our ledger.
      </h1>
      <p className="mt-3 max-w-2xl text-lg text-slate-600 dark:text-slate-400">
        Trust is the whole product, so we publish the metrics that matter — computed in real time from the
        same database that pays you. Updated {timeAgo(stats?.updatedAt)}.
      </p>
      {stats?.sandbox && (
        <Callout tone="warning" className="mt-6" title="Sandbox environment">
          You’re looking at a demo deployment. These figures are computed exactly as in production, but from
          simulated members and payouts.
        </Callout>
      )}

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {big.map((b) => (
          <Card key={b.label} className="p-6">
            <b.icon className="size-5 text-brand-600 dark:text-brand-400" />
            {b.value === undefined || b.value === null ? (
              <Skeleton className="mt-4 h-9 w-32" />
            ) : (
              <p className="tabular mt-3 text-3xl font-bold tracking-tight">{b.value}</p>
            )}
            <p className="mt-1 text-sm text-slate-500">{b.label}</p>
          </Card>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader
            title="Revenue share: promise vs. reality"
            subtitle="What networks paid us for your completions, and what we passed on."
          />
          <div className="space-y-4">
            <div>
              <div className="mb-1.5 flex justify-between text-sm">
                <span>Promised to members</span>
                <span className="tabular font-semibold">
                  {stats ? `${stats.revenueShareBps / 100}%` : '—'}
                </span>
              </div>
              <Progress value={(stats?.revenueShareBps ?? 0) / 10_000} />
            </div>
            <div>
              <div className="mb-1.5 flex justify-between text-sm">
                <span>Actually paid (last 30 days)</span>
                <span className="tabular font-semibold">
                  {stats?.actualShareBps30d ? `${(stats.actualShareBps30d / 100).toFixed(2)}%` : '—'}
                </span>
              </div>
              <Progress value={(stats?.actualShareBps30d ?? 0) / 10_000} tone="violet" />
            </div>
            <p className="text-sm text-slate-500">
              Networks paid {stats ? formatUsd(stats.networkRevenue30dMicros) : '—'} for member completions in
              the last 30 days; members earned {stats ? formatUsd(stats.userEarnings30dMicros) : '—'} from
              them. Streak, referral and plan bonuses and goodwill credits come from our share, on top.
            </p>
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Missing-credit claims (30 days)"
            subtitle="Our promise: a decision within 24 hours."
          />
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-sm text-slate-500">Claims filed</dt>
              <dd className="tabular text-2xl font-semibold">{stats?.claimsTotal30d ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-sm text-slate-500">Resolved within 24h</dt>
              <dd className="tabular text-2xl font-semibold">{pct(stats?.claimsResolvedWithin24hRate)}</dd>
            </div>
            <div>
              <dt className="text-sm text-slate-500">Approved</dt>
              <dd className="tabular text-2xl font-semibold">{pct(stats?.claimsApprovedRate)}</dd>
            </div>
            <div>
              <dt className="text-sm text-slate-500">Bad offers removed</dt>
              <dd className="tabular text-2xl font-semibold">{stats?.offersRemovedAfterReports ?? '—'}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Live payouts"
            subtitle="Real completed cash-outs. Names are hidden unless members opt in."
          />
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {feed.map((f) => (
              <FeedRow key={f.id} item={f} />
            ))}
          </ul>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Network reliability"
              subtitle="Share of each network’s postbacks we processed successfully (30 days)."
            />
            <div className="space-y-4">
              {networks.map((n) => (
                <div key={n.id}>
                  <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium">
                      {n.name} {n.status !== 'active' && <Badge>{n.status}</Badge>}
                    </span>
                    <span className="tabular text-slate-500">
                      {pct(n.postbackSuccessRate, 1)} · {n.postbacks30d} postbacks
                    </span>
                  </div>
                  <Progress value={n.postbackSuccessRate ?? 0} />
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader
              title="Wall of Shame"
              subtitle="Offers removed after member reports were confirmed."
              icon={<ShieldX className="size-5 text-rose-500" />}
            />
            {wall.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing here right now — good.</p>
            ) : (
              <ul className="space-y-3">
                {wall.map((w) => (
                  <li
                    key={w.id}
                    className="rounded-xl border border-rose-200 bg-rose-50/60 p-3.5 dark:border-rose-900/60 dark:bg-rose-950/30"
                  >
                    <p className="font-medium text-rose-900 dark:text-rose-200">{w.title}</p>
                    <p className="text-xs text-rose-800/80 dark:text-rose-300/80">
                      {w.advertiser} via {w.networkName} · removed {shortDate(w.removedAt)}
                    </p>
                    <p className="mt-1 text-sm text-rose-900/90 dark:text-rose-200/90">{w.reason}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader title="How these numbers are calculated" />
        <div className="grid gap-6 text-sm leading-relaxed text-slate-600 md:grid-cols-3 dark:text-slate-400">
          <p>
            <strong className="text-slate-900 dark:text-white">Postback success rate</strong> — of all
            conversion notifications networks sent us in 30 days, the share processed successfully. Retries we
            correctly ignored count as success; invalid signatures and unknown clicks count as failures.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-white">Median payout time</strong> — the middle value
            of request → paid over the last 30 days, across all methods (including slow bank rails). The
            median isn’t skewed by a few very fast or very slow payouts.
          </p>
          <p>
            <strong className="text-slate-900 dark:text-white">Revenue share paid</strong> — member earnings
            from tasks ÷ what networks paid us for those tasks. Bonuses and goodwill are excluded, so this
            number can’t be inflated by promotions.
          </p>
        </div>
      </Card>
    </div>
  );
}
