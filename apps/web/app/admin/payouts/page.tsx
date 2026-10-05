'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { flagEmoji, formatDuration, formatMoney, PAYOUT_STATUS_META, type PayoutStatus } from '@cashads/shared';
import { AdminHeader, ReasonDialog } from '@/components/admin/shell';
import { riskTone } from '@/components/admin/tones';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data';
import { Badge } from '@/components/ui/feedback';
import { Segmented } from '@/components/ui/form';
import { TimeAgo } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { useAdmin } from '@/lib/queries';
import { toast } from '@/lib/store';

interface Row {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  country: string;
  methodName: string;
  methodLogo: string;
  destinationMasked: string;
  amountMicros: number;
  netMicros: number;
  status: PayoutStatus;
  statusReason: string | null;
  riskLevel: string;
  riskScore: number;
  createdAt: string;
  completedAt: string | null;
  attempts: number;
}

function Payouts() {
  const qc = useQueryClient();
  const initial = useSearchParams().get('status') ?? 'review';
  const [status, setStatus] = useState(initial);
  const { data, isLoading } = useAdmin<Row[]>(['payouts', status], `/payouts${status === 'all' ? '' : `?status=${status}`}`, { refetchInterval: 10_000 });
  const [reject, setReject] = useState<Row | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin'] });

  return (
    <div>
      <AdminHeader
        title="Payout queue"
        description="Most cash outs are sent automatically. This queue holds the ones that need a human: large amounts, risky accounts or shared destinations."
        action={
          status === 'review' &&
          selected.size > 0 && (
            <Button
              size="sm"
              onClick={async () => {
                const r = await api<{ results: Array<{ ok: boolean }> }>('/admin/payouts/bulk-approve', { body: { ids: [...selected] } });
                toast({ title: `${r.results.filter((x) => x.ok).length} approved`, tone: 'success' });
                setSelected(new Set());
                await refresh();
              }}
            >
              Approve {selected.size} selected
            </Button>
          )
        }
      />
      <Segmented
        className="mb-4"
        value={status}
        onChange={(v) => {
          setStatus(v);
          setSelected(new Set());
        }}
        options={['review', 'pending', 'processing', 'completed', 'failed', 'all'].map((s) => ({ value: s, label: s === 'all' ? 'All' : PAYOUT_STATUS_META[s as PayoutStatus].label }))}
      />
      <DataTable
        rows={data}
        loading={isLoading}
        rowKey={(r) => r.id}
        empty={status === 'review' ? 'Queue is empty — nothing waiting for review. 🎉' : 'Nothing here.'}
        columns={[
          ...(status === 'review'
            ? [
                {
                  key: 'sel',
                  header: '',
                  cell: (r: Row) => (
                    <input
                      type="checkbox"
                      className="accent-emerald-600"
                      checked={selected.has(r.id)}
                      onChange={(e) =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(r.id);
                          else n.delete(r.id);
                          return n;
                        })
                      }
                    />
                  ),
                },
              ]
            : []),
          {
            key: 'member',
            header: 'Member',
            cell: (r) => (
              <Link href={`/admin/users/${r.userId}`} className="block hover:underline">
                <span className="font-medium">
                  {flagEmoji(r.country)} {r.userName}
                </span>
                <span className="block text-xs text-muted">{r.userEmail}</span>
              </Link>
            ),
          },
          { key: 'amount', header: 'Amount', align: 'right', cell: (r) => <span className="tabular font-semibold">{formatMoney(r.amountMicros)}</span> },
          { key: 'method', header: 'To', cell: (r) => <span className="text-sm">{r.methodLogo} {r.methodName}<span className="block text-xs text-muted">{r.destinationMasked}</span></span> },
          { key: 'risk', header: 'Risk', cell: (r) => <Badge tone={riskTone(r.riskLevel)}>{`${r.riskLevel} · ${r.riskScore}`}</Badge> },
          { key: 'status', header: 'Status', cell: (r) => <span><Badge tone={PAYOUT_STATUS_META[r.status].tone}>{PAYOUT_STATUS_META[r.status].label}</Badge>{r.statusReason && <span className="block max-w-56 truncate text-xs text-muted" title={r.statusReason}>{r.statusReason}</span>}</span> },
          { key: 'age', header: 'Requested', cell: (r) => <span className="text-xs text-muted"><TimeAgo iso={r.createdAt} />{r.completedAt && <span className="block">took {formatDuration((new Date(r.completedAt).getTime() - new Date(r.createdAt).getTime()) / 1000)}</span>}</span> },
          {
            key: 'actions',
            header: '',
            align: 'right',
            cell: (r) =>
              r.status === 'review' || r.status === 'pending' ? (
                <div className="flex justify-end gap-1.5">
                  {r.status === 'review' && (
                    <Button
                      size="xs"
                      onClick={async () => {
                        try {
                          await api(`/admin/payouts/${r.id}/approve`, { body: {} });
                          toast({ title: 'Approved — sending now', tone: 'success' });
                          await refresh();
                        } catch (err) {
                          toast({ title: errorMessage(err), tone: 'danger' });
                        }
                      }}
                    >
                      Approve
                    </Button>
                  )}
                  <Button size="xs" variant="secondary" onClick={() => setReject(r)}>
                    Reject
                  </Button>
                </div>
              ) : r.status === 'processing' ? (
                <Button size="xs" variant="ghost" onClick={async () => (await api(`/admin/payouts/${r.id}/retry`, { body: {} }), refresh())}>
                  Re-check
                </Button>
              ) : null,
          },
        ]}
      />
      <ReasonDialog
        open={!!reject}
        onClose={() => setReject(null)}
        title={`Reject ${reject ? formatMoney(reject.amountMicros) : ''} cash out`}
        description="The full amount is refunded to the member’s balance and they’re notified with your reason."
        confirmLabel="Reject & refund"
        danger
        onConfirm={async (reason) => {
          await api(`/admin/payouts/${reject!.id}/reject`, { body: { reason } });
          await refresh();
        }}
      />
    </div>
  );
}

export default function AdminPayoutsPage() {
  return (
    <Suspense>
      <Payouts />
    </Suspense>
  );
}
