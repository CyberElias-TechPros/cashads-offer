'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { formatMoney, formatMoneyCompact } from '@cashads/shared';
import { AdminHeader } from '@/components/admin/shell';
import { Card, CardBody, CardHeader, Stat } from '@/components/ui/card';
import { BarChart, Sparkline } from '@/components/ui/data';
import { Badge, Skeleton } from '@/components/ui/feedback';
import { KeyValue } from '@/components/ui/misc';
import { useAdmin } from '@/lib/queries';
import { pct } from '@/lib/utils';

interface PbStats {
  total: number;
  credited: number;
  errors: number;
  rejected: number;
  invalidSignature: number;
  duplicates: number;
  needsReview: number;
  successRate: number | null;
}
interface Overview {
  users: { total: number; new24h: number; new7d: number; verified: number; flagged: number; dau: number; mau: number };
  money: Record<string, number>;
  queues: Record<string, number>;
  postbacks: { last24h: PbStats; last30d: PbStats };
  series: Array<{ day: string; gross: number; earned: number; paid: number; signups: number }>;
}

export default function AdminOverviewPage() {
  const { data, isLoading } = useAdmin<Overview>(['overview'], '/overview', { refetchInterval: 15_000 });
  if (isLoading || !data) return <Skeleton className="h-[60vh] rounded-3xl" />;
  const { users: u, money: m, queues: q, postbacks: pb } = data;
  const queueItems: Array<[string, number, string, boolean]> = [
    ['Payouts awaiting review', q.payoutsReview, '/admin/payouts?status=review', q.payoutsReview > 0],
    ['Missing-credit claims', q.claimsOpen, '/admin/claims', q.claimsBreached > 0],
    ['Open fraud cases', q.fraudOpen, '/admin/fraud', q.fraudOpen > 0],
    ['Support tickets', q.ticketsOpen, '/admin/tickets', q.ticketsBreached > 0],
    ['KYC submissions', q.kycPending, '/admin/kyc', false],
    ['Offers auto-paused by reports', q.offersFlagged, '/admin/offers', q.offersFlagged > 0],
    ['Dead jobs', q.jobsDead, '/admin/jobs', q.jobsDead > 0],
  ];
  return (
    <div className="space-y-6">
      <AdminHeader title="Overview" description="Live health of the money machine. Refreshes every 15 seconds." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Members" value={u.total.toLocaleString()} hint={`+${u.new24h} today · +${u.new7d} this week`} />
        <Stat label="DAU / MAU" value={`${u.dau} / ${u.mau}`} hint={`Stickiness ${pct(u.mau ? u.dau / u.mau : null)}`} />
        <Stat label="Partner gross (30d)" value={formatMoneyCompact(m.gross30d)} hint={<Sparkline values={data.series.map((s) => s.gross)} className="mt-1 h-8" />} />
        <Stat label="Paid to members (30d)" value={formatMoneyCompact(m.paidOut30d)} hint={<Sparkline values={data.series.map((s) => s.paid)} className="mt-1 h-8" color="#0ea5e9" />} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Last 30 days" description="Partner gross vs. member earnings vs. cash outs" />
          <CardBody>
            <BarChart data={data.series.map((s) => ({ label: s.day.slice(5), values: [s.gross, s.earned, s.paid] }))} format={(v) => formatMoney(v)} series={['Partner gross', 'Credited to members', 'Paid out']} height={200} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Work queues" />
          <CardBody className="space-y-1 py-3">
            {queueItems.map(([label, n, href, alert]) => (
              <Link key={label} href={href} className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm hover:bg-surface-2">
                <span className="flex items-center gap-2">
                  {alert && <AlertTriangle className="h-4 w-4 text-amber-500" />}
                  {label}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="tabular font-bold">{n}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-subtle" />
                </span>
              </Link>
            ))}
            {(q.claimsBreached > 0 || q.ticketsBreached > 0) && <p className="px-3 pt-2 text-xs font-medium text-rose-600">{q.claimsBreached + q.ticketsBreached} item(s) past SLA</p>}
          </CardBody>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Unit economics (30d)" />
          <CardBody className="py-2">
            <KeyValue
              items={[
                ['Partner gross', formatMoney(m.gross30d)],
                ['Platform revenue (after member share)', formatMoney(m.revenue30d)],
                ['Bonuses funded', formatMoney(-m.marketing30d)],
                ['Goodwill (missing credit)', formatMoney(-m.goodwill30d)],
                ['Reversal losses absorbed', formatMoney(-m.loss30d)],
                ['Payout fees collected', formatMoney(m.fees30d, { signed: true })],
                [<strong key="n">Net margin</strong>, <strong key="v">{formatMoney(m.netMargin30d)}</strong>],
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Member balances (liabilities)" />
          <CardBody className="py-2">
            <KeyValue
              items={[
                ['Available', formatMoney(m.liabilitiesAvailable)],
                ['Pending (holds)', formatMoney(m.liabilitiesPending)],
                ['Total owed to members', formatMoney(m.liabilitiesAvailable + m.liabilitiesPending)],
                ['Verified emails', `${u.verified} / ${u.total}`],
                ['Accounts flagged', u.flagged],
              ]}
            />
            <Link href="/admin/ledger" className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">
              Reconcile ledger →
            </Link>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Postback health" description="The one metric that decides trust." />
          <CardBody className="space-y-4">
            {(['last24h', 'last30d'] as const).map((k) => (
              <div key={k}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">{k === 'last24h' ? 'Last 24h' : 'Last 30 days'}</span>
                  <Badge tone={pb[k].successRate === null ? 'neutral' : pb[k].successRate! >= 0.99 ? 'success' : pb[k].successRate! >= 0.95 ? 'warning' : 'danger'}>{pct(pb[k].successRate, 1)} credited</Badge>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {pb[k].total} valid · {pb[k].errors} errors · {pb[k].needsReview} review · {pb[k].invalidSignature} forged · {pb[k].duplicates} retries ignored
                </p>
              </div>
            ))}
            <Link href="/admin/postbacks" className="inline-block text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">
              Postback logs →
            </Link>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
