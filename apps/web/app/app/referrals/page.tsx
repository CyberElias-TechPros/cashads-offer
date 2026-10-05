'use client';

import { Gift, Share2, Users } from 'lucide-react';
import { formatMoney } from '@cashads/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, PageHeader, Stat } from '@/components/ui/card';
import { Badge, EmptyState, Skeleton } from '@/components/ui/feedback';
import { CopyButton, Money, QrCode, TimeAgo } from '@/components/ui/misc';
import { useReferrals } from '@/lib/queries';

export default function ReferralsPage() {
  const { data, isLoading } = useReferrals();
  if (isLoading || !data) return <Skeleton className="h-96 rounded-3xl" />;
  const share = async () => {
    const text = `I cash out real money from CashAds — no minimum, paid in minutes. Join with my link and we both get a bonus:`;
    if (navigator.share) await navigator.share({ title: 'CashAds', text, url: data.link }).catch(() => undefined);
    else window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${data.link}`)}`, '_blank');
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Invite friends" description="Real bonuses, paid by us — never taken from your friend’s earnings." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card className="overflow-hidden">
          <div className="bg-gradient-to-br from-brand-600 to-emerald-800 p-6 text-white sm:p-8">
            <Gift className="h-8 w-8" />
            <h2 className="mt-4 font-display text-2xl font-extrabold">
              You get {formatMoney(data.referrerBonusMicros)} + {data.commissionBps / 100}% of their earnings for {data.commissionMonths} months.
            </h2>
            <p className="mt-2 text-white/80">Your friend gets {formatMoney(data.refereeBonusMicros)} after their first completed offer. Bonuses are paid when they finish their first offer, so there’s nothing to game.</p>
          </div>
          <CardBody className="grid grid-cols-1 gap-6 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0 space-y-3">
              <p className="text-sm font-semibold">Your link</p>
              <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 py-1.5 pl-3 pr-1.5">
                <span className="min-w-0 flex-1 truncate font-mono text-sm">{data.link}</span>
                <CopyButton value={data.link} />
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted">Code:</span>
                <span className="rounded-lg bg-surface-3 px-2 py-0.5 font-mono font-bold tracking-wider">{data.code}</span>
                <CopyButton value={data.code} label="Copy code" />
              </div>
              <Button onClick={share} className="w-full sm:w-auto">
                <Share2 className="h-4 w-4" /> Share
              </Button>
            </div>
            <QrCode value={data.link} size={150} className="mx-auto" />
          </CardBody>
        </Card>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          <Stat label="Friends invited" value={data.totals.invited} icon={<Users className="h-4 w-4" />} />
          <Stat label="Earned from friends" value={<Money micros={data.totals.earnedMicros} />} hint={`${data.totals.qualified} qualified`} icon={<Gift className="h-4 w-4" />} tone="brand" />
        </div>
      </div>
      <Card>
        <CardHeader title="Your referrals" description="Commission is settled in tidy batches, so you won’t see hundreds of tiny transactions." />
        <CardBody className="p-0 sm:p-0">
          {data.referrals.length === 0 ? (
            <EmptyState className="m-5" icon="🤝" title="No friends yet" description="Share your link — WhatsApp, Telegram or a quick DM works best." />
          ) : (
            <ul className="mt-3 divide-y divide-line border-t border-line">
              {data.referrals.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{r.name}</p>
                    <p className="text-xs text-muted">
                      Joined <TimeAgo iso={r.joinedAt} />
                    </p>
                  </div>
                  <Money micros={r.earnedForYouMicros} className="text-sm font-semibold" />
                  <Badge tone={r.status === 'qualified' ? 'success' : r.status === 'rejected' ? 'danger' : 'neutral'}>
                    {r.status === 'qualified' ? 'Earning' : r.status === 'rejected' ? 'Not eligible' : 'Waiting for first offer'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <p className="text-center text-xs text-subtle">Referrals from the same device or network as you aren’t eligible. That protects the bonus budget for real friends.</p>
    </div>
  );
}
