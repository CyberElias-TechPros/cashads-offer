'use client';

import { useState } from 'react';
import { ArrowDownToLine, FileText } from 'lucide-react';
import { formatMoney, TRANSACTION_TYPE_META } from '@cashads/shared';
import { Card, CardBody, CardHeader, PageHeader, Stat } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/feedback';
import { Select } from '@/components/ui/form';
import { BarChart } from '@/components/ui/data';
import { useTax } from '@/lib/queries';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function TaxPage() {
  const [year, setYear] = useState(new Date().getUTCFullYear());
  const { data } = useTax(year);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Tax center"
        description="A clean yearly summary, so tax season is a non-event."
        action={
          <>
            <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28">
              {(data?.years ?? [year]).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
            <a href={`/api/wallet/transactions.csv?year=${year}`} className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-semibold shadow-sm hover:bg-surface-2">
              <ArrowDownToLine className="h-4 w-4" /> CSV
            </a>
          </>
        }
      />
      {!data ? (
        <Skeleton className="h-80 rounded-2xl" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Earnings" value={formatMoney(data.totals.earnedMicros)} hint="Offers, videos, goodwill" />
            <Stat label="Bonuses" value={formatMoney(data.totals.bonusesMicros)} hint="Streaks, referrals, achievements" />
            <Stat label="Cashed out" value={formatMoney(data.totals.withdrawnMicros)} />
            <Stat label="Provider fees" value={formatMoney(data.totals.feesMicros)} />
          </div>
          <Card>
            <CardHeader title={`${year} by month`} />
            <CardBody>
              <BarChart data={data.byMonth.map((m) => ({ label: MONTHS[m.month - 1], values: [m.earnedMicros, m.withdrawnMicros] }))} format={(v) => formatMoney(v)} series={['Earned', 'Cashed out']} />
            </CardBody>
          </Card>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="By type" />
              <CardBody className="divide-y divide-line py-2">
                {data.byType.map((t) => (
                  <div key={t.type} className="flex items-center justify-between py-2.5 text-sm">
                    <span>
                      {TRANSACTION_TYPE_META[t.type].label} <span className="text-muted">× {t.count}</span>
                    </span>
                    <span className="tabular font-semibold">{formatMoney(t.amountMicros)}</span>
                  </div>
                ))}
                {data.byType.length === 0 && <p className="py-6 text-center text-sm text-muted">No activity in {year}.</p>}
              </CardBody>
            </Card>
            <Card>
              <CardHeader icon={<FileText className="h-5 w-5" />} title="Guidance for your country" />
              <CardBody className="space-y-2 text-sm text-muted">
                {data.guidance.map((g) => (
                  <p key={g}>• {g}</p>
                ))}
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
