'use client';

import { BadgeCheck, Clock, Gauge, HandCoins, Percent, Scale, Trophy, Users } from 'lucide-react';
import { formatDuration, formatMoney } from '@cashads/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/feedback';
import { LiveFeedList } from '@/components/marketing/live';
import { usePublicStats } from '@/lib/queries';
import { pct } from '@/lib/utils';

export default function TransparencyPage() {
  const { data: s } = usePublicStats();
  const items = s
    ? [
        { icon: HandCoins, label: 'Total paid to members', value: formatMoney(s.totalPaidMicros), hint: `${s.payoutsCount.toLocaleString()} cash outs to ${s.usersPaid.toLocaleString()} people` },
        { icon: Clock, label: 'Median payout time (30d)', value: formatDuration(s.medianPayoutSeconds), hint: `90% arrive within ${formatDuration(s.p90PayoutSeconds)}` },
        { icon: BadgeCheck, label: 'Partner signals credited (30d)', value: pct(s.trackingSuccessRate, 1), hint: 'Share of valid partner postbacks that reached members' },
        { icon: Percent, label: 'Member revenue share', value: `${s.revenueShareBps / 100}%`, hint: 'Of every dollar partners pay us, before tier bonuses' },
        { icon: Scale, label: 'Missing-credit claims approved', value: pct(s.claimsApprovedRate), hint: s.medianClaimHours !== null ? `Median resolution ${s.medianClaimHours}h` : 'Resolved claims, last 90 days' },
        { icon: Gauge, label: 'Paid in the last 24h', value: formatMoney(s.paidLast24hMicros), hint: `${s.activeOffers} live offers right now` },
        { icon: Trophy, label: 'Largest single cash out', value: formatMoney(s.largestPayoutMicros), hint: 'No ceiling games' },
        { icon: Users, label: 'Minimum cash out', value: '$0.01', hint: 'Provider limits may apply (shown upfront)' },
      ]
    : [];
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">Transparency</p>
      <h1 className="mt-2 max-w-3xl font-display text-4xl font-extrabold tracking-tight sm:text-5xl">Proof, not promises.</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted">Every number on this page is computed live from our double-entry ledger. We don’t write testimonials. We show the money moving.</p>
      <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {!s && Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
        {items.map((it) => (
          <div key={it.label} className="rounded-2xl border border-line bg-surface p-5 shadow-soft">
            <it.icon className="h-5 w-5 text-brand-600" />
            <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted">{it.label}</p>
            <p className="tabular mt-1 text-2xl font-bold tracking-tight">{it.value}</p>
            <p className="mt-1 text-xs text-muted">{it.hint}</p>
          </div>
        ))}
      </div>
      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_1fr]">
        <LiveFeedList limit={14} />
        <div className="space-y-6">
          <Card>
            <CardHeader title="Where the money goes" />
            <CardBody className="space-y-3 text-sm text-muted">
              <p>
                For every <strong className="text-fg">$1.00</strong> a partner pays us:
              </p>
              <div className="flex h-4 overflow-hidden rounded-full">
                <div className="bg-brand-500" style={{ width: `${(s?.revenueShareBps ?? 6000) / 100}%` }} />
                <div className="flex-1 bg-slate-300 dark:bg-slate-600" />
              </div>
              <p>
                <strong className="text-brand-700 dark:text-brand-400">{formatMoney(((s?.revenueShareBps ?? 6000) / 10000) * 1_000_000)}</strong> goes to you, plus a tier bonus paid from our side.
              </p>
              <p>The rest pays for missing-credit payouts we absorb, fraud losses, payment fees, bonuses, support and keeping the lights on.</p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Payout methods used" />
            <CardBody className="space-y-2">
              {s?.methods.map((m) => (
                <div key={m.name} className="flex items-center justify-between text-sm">
                  <span>
                    {m.logo} {m.name}
                  </span>
                  <span className="tabular text-muted">{m.count.toLocaleString()}</span>
                </div>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Methodology" />
            <CardBody className="space-y-2 text-xs text-muted">
              <p>• Payout time = request → provider confirmation, completed cash outs in the last 30 days.</p>
              <p>• Partner signals credited = credited ÷ (credited + processing errors + out-of-window), last 30 days. Forged and duplicate postbacks are excluded.</p>
              <p>• Names are shown as “First L.” only for members who opted in; everyone else is anonymous.</p>
              {s && <p>• Last updated {new Date(s.updatedAt).toLocaleTimeString()} (refreshes every 30 seconds).</p>}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
