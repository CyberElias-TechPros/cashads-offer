'use client';

import { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { formatMoney } from '@cashads/shared';
import { AdminHeader } from '@/components/admin/shell';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, Stat } from '@/components/ui/card';
import { Alert, Skeleton } from '@/components/ui/feedback';
import { TimeAgo } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useAdmin } from '@/lib/queries';

/* eslint-disable @typescript-eslint/no-explicit-any */
const EXPLAIN: Record<string, string> = {
  'platform:revenue': 'Our margin after member shares',
  'platform:marketing': 'Bonuses we funded (negative = spent)',
  'platform:goodwill': 'Missing-credit payouts we absorbed',
  'platform:loss': 'Reversals we couldn’t recover',
  'platform:payouts_in_transit': 'Reserved for in-flight cash outs',
  'platform:paid_out': 'Money that left to members',
  'platform:fees': 'Payout fees collected',
  'platform:adjustments': 'Manual staff corrections',
};

export default function LedgerPage() {
  const { data: tb, isLoading } = useAdmin<any>(['ledger-tb'], '/ledger/trial-balance');
  const { data: entries } = useAdmin<any[]>(['ledger-entries'], '/ledger/entries');
  const [rec, setRec] = useState<any | null>(null);
  const [running, setRunning] = useState(false);
  if (isLoading || !tb) return <Skeleton className="h-[60vh] rounded-3xl" />;
  return (
    <div className="space-y-6">
      <AdminHeader
        title="Ledger"
        description="Double-entry and append-only. Every entry sums to zero, and member wallets are a cache you can verify at any time."
        action={
          <Button
            loading={running}
            onClick={async () => {
              setRunning(true);
              setRec(await api('/admin/ledger/reconcile'));
              setRunning(false);
            }}
          >
            Run reconciliation
          </Button>
        }
      />
      {tb.balanced ? <Alert tone="success" icon={<CheckCircle2 className="h-4 w-4" />} title="Trial balance: balanced">All {tb.entries.toLocaleString()} entries sum to exactly zero.</Alert> : <Alert tone="danger" icon={<XCircle className="h-4 w-4" />} title="Trial balance is off">Sum is {tb.sumMicros} micros — investigate immediately.</Alert>}
      {rec && (rec.ok ? <Alert tone="success" title="Reconciliation passed">{rec.checkedWallets} wallets match the ledger exactly.</Alert> : <Alert tone="danger" title={`${rec.mismatches.length} wallet(s) don’t match`}>{JSON.stringify(rec.mismatches.slice(0, 3))}</Alert>)}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Owed to members (available)" value={formatMoney(tb.userAvailableMicros)} />
        <Stat label="Owed to members (pending)" value={formatMoney(tb.userPendingMicros)} />
        <Stat label="Journal entries" value={tb.entries.toLocaleString()} />
        <Stat label="Sum of all postings" value={`${tb.sumMicros} µ$`} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Platform & partner accounts" />
          <CardBody className="divide-y divide-line py-2">
            {tb.accounts.map((a: any) => (
              <div key={a.account} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span>
                  <code className="text-xs">{a.account}</code>
                  <span className="block text-xs text-muted">{EXPLAIN[a.account] ?? (a.account.startsWith('network:') ? 'Owed to us by this partner (negative)' : '')}</span>
                </span>
                <span className="tabular font-semibold">{formatMoney(a.balanceMicros)}</span>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent journal entries" />
          <CardBody className="max-h-[560px] space-y-3 overflow-y-auto">
            {entries?.map((e) => (
              <div key={e.id} className="rounded-xl border border-line p-3">
                <div className="flex items-center justify-between text-xs">
                  <code className="font-semibold">{e.kind}</code>
                  <TimeAgo iso={e.createdAt} className="text-muted" />
                </div>
                {e.memo && <p className="mt-1 truncate text-xs text-muted">{e.memo}</p>}
                <div className="mt-2 space-y-0.5">
                  {e.postings.map((p: any, i: number) => (
                    <div key={i} className="flex justify-between font-mono text-[11px]">
                      <span className="truncate">{p.account.replace(/user:([0-9a-f]{8})[0-9a-f-]+/, 'user:$1…')}</span>
                      <span className={p.amountMicros < 0 ? 'text-rose-600' : 'text-brand-700 dark:text-brand-400'}>{formatMoney(p.amountMicros, { signed: true, precise: true })}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
