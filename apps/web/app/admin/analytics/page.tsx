'use client';

import { CATEGORY_META, formatHoursSafe, formatMoney, type OfferCategory } from './helpers';
import { AdminHeader } from '@/components/admin/shell';
import { Card, CardBody, CardHeader, Stat } from '@/components/ui/card';
import { Progress, Skeleton } from '@/components/ui/feedback';
import { useAdmin } from '@/lib/queries';
import { pct } from '@/lib/utils';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function AnalyticsPage() {
  const { data: a, isLoading } = useAdmin<any>(['analytics'], '/analytics');
  if (isLoading || !a) return <Skeleton className="h-[60vh] rounded-3xl" />;
  const f = a.funnel;
  const steps: Array<[string, number]> = [
    ['Signed up (30d)', f.signedUp],
    ['Verified email', f.verified],
    ['First earning', f.firstEarning],
    ['First cash out', f.firstPayout],
  ];
  return (
    <div className="space-y-6">
      <AdminHeader title="Analytics" description="Business, product and technical metrics from the brief, all computed live from the database." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="ARPU (30d, member earnings)" value={formatMoney(a.arpu30dMicros)} />
        <Stat label="Time to first payout (median)" value={formatHoursSafe(a.medianHoursToFirstPayout)} />
        <Stat label="Offer completion rate" value={pct(a.offerCompletionRate, 1)} hint="Clicks that converted (30d)" />
        <Stat label="Postback success rate" value={pct(a.postbacks.successRate, 1)} hint="Target ≥ 99%" />
        <Stat label="Average cash out" value={formatMoney(a.avgPayoutMicros)} />
        <Stat label="Referral rate" value={pct(a.referralRate, 1)} hint="Members who joined via a friend" />
        <Stat label="Fraud rate" value={pct(a.fraudRate, 1)} hint="Accounts flagged medium/high" />
        <Stat label="Banned" value={a.bannedUsers} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Activation funnel" description="New members in the last 30 days" />
          <CardBody className="space-y-4">
            {steps.map(([label, n]) => (
              <div key={label}>
                <div className="flex justify-between text-sm">
                  <span>{label}</span>
                  <span className="tabular font-semibold">
                    {n} <span className="text-xs font-normal text-muted">({pct(f.signedUp ? n / f.signedUp : null)})</span>
                  </span>
                </div>
                <Progress value={f.signedUp ? (n / f.signedUp) * 100 : 0} className="mt-1.5" />
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Retention by weekly cohort" description="Share of each signup cohort active on day 1, in week 2, and in week 5" />
          <CardBody>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="pb-2">Cohort</th>
                  <th className="pb-2 text-right">Size</th>
                  <th className="pb-2 text-right">D1</th>
                  <th className="pb-2 text-right">D7</th>
                  <th className="pb-2 text-right">D30</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {a.cohorts.map((c: any) => (
                  <tr key={c.cohort}>
                    <td className="py-2">{c.cohort}</td>
                    <td className="tabular py-2 text-right">{c.size}</td>
                    {(['d1', 'd7', 'd30'] as const).map((k) => (
                      <td key={k} className="tabular py-2 text-right">
                        <span className="rounded px-1.5 py-0.5" style={{ background: `rgba(16,185,129,${c.size ? (c[k] / c.size) * 0.6 : 0})` }}>
                          {pct(c.size ? c[k] / c.size : null)}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Top offers by partner revenue (30d)" />
          <CardBody className="divide-y divide-line py-2">
            {a.topOffers.map((o: any) => (
              <div key={o.title} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="truncate">
                  {o.icon} {o.title} <span className="text-xs text-muted">× {o.conversions}</span>
                </span>
                <span className="tabular text-right">
                  {formatMoney(o.grossMicros)}
                  <span className="block text-xs text-muted">{formatMoney(o.paidToUsersMicros)} to members</span>
                </span>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Categories (30d)" />
          <CardBody className="space-y-3">
            {a.categories.map((c: any) => (
              <div key={c.category}>
                <div className="flex justify-between text-sm">
                  <span>
                    {CATEGORY_META[c.category as OfferCategory]?.emoji} {CATEGORY_META[c.category as OfferCategory]?.plural ?? c.category}
                  </span>
                  <span className="tabular">
                    {c.conversions} · {formatMoney(c.paidToUsersMicros)}
                  </span>
                </div>
                <Progress value={(c.conversions / Math.max(...a.categories.map((x: any) => x.conversions))) * 100} size="sm" className="mt-1" />
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
