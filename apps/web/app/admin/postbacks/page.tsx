'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatMoney } from '@cashads/shared';
import { AdminHeader } from '@/components/admin/shell';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data';
import { Badge } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { TimeAgo } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { useAdmin } from '@/lib/queries';
import { toast } from '@/lib/store';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  credited: 'success',
  held: 'warning',
  duplicate: 'neutral',
  rejected: 'danger',
  reversed: 'info',
  error: 'danger',
  needs_review: 'warning',
  received: 'neutral',
};

export default function AdminPostbacksPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const params = new URLSearchParams({ ...(status && { status }), ...(q && { q }) }).toString();
  const { data, isLoading } = useAdmin<any[]>(['postbacks', status, q], `/postbacks${params ? `?${params}` : ''}`, { refetchInterval: 10_000 });
  const [raw, setRaw] = useState<any | null>(null);
  const replay = async (id: string, force: boolean) => {
    try {
      const r = await api<{ status: string; reason?: string }>(`/admin/postbacks/${id}/replay`, { body: { force } });
      toast({ title: `Replayed → ${r.status}`, description: r.reason, tone: r.status === 'credited' ? 'success' : 'warning' });
      await qc.invalidateQueries({ queryKey: ['admin'] });
    } catch (err) {
      toast({ title: errorMessage(err), tone: 'danger' });
    }
  };
  return (
    <div>
      <AdminHeader title="Postback logs" description="Every partner callback, authentic or not, with its outcome. Failed or out-of-window postbacks can be replayed safely: idempotency guarantees no double credit." />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tx id, click id or user id" className="sm:max-w-sm" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-48">
          <option value="">All outcomes</option>
          {Object.keys(TONE).map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </Select>
      </div>
      <DataTable
        rows={data}
        loading={isLoading}
        rowKey={(r) => r.id}
        columns={[
          { key: 'when', header: 'Received', cell: (r) => <span className="text-xs"><TimeAgo iso={r.createdAt} /><span className="block text-muted">{r.networkId} · {r.method}</span></span> },
          { key: 'tx', header: 'Partner tx', cell: (r) => <code className="text-xs">{r.externalTxId ?? '—'}</code> },
          { key: 'kind', header: 'Kind', cell: (r) => <Badge tone={r.kind === 'reversal' ? 'info' : 'neutral'}>{r.kind}</Badge> },
          { key: 'who', header: 'Member / offer', cell: (r) => (r.userId ? <Link href={`/admin/users/${r.userId}`} className="text-xs hover:underline">{r.userEmail}<span className="block text-muted">{r.offerTitle ?? ''}{r.goalId ? ` · ${r.goalId}` : ''}</span></Link> : <span className="text-xs text-muted">—</span>) },
          { key: 'amt', header: 'Partner → member', align: 'right', cell: (r) => <span className="tabular text-xs">{r.payoutMicros !== null ? formatMoney(r.payoutMicros) : '—'}{r.userAmountMicros !== null && <span className="block text-brand-700 dark:text-brand-400">{formatMoney(r.userAmountMicros)}</span>}</span> },
          { key: 'status', header: 'Outcome', cell: (r) => <span><Badge tone={TONE[r.status] ?? 'neutral'}>{r.status.replace('_', ' ')}</Badge>{r.statusReason && <span className="block max-w-52 truncate text-xs text-muted" title={r.statusReason}>{r.statusReason}</span>}{!r.signatureValid && <span className="block text-xs text-rose-600">signature invalid</span>}</span> },
          {
            key: 'act',
            header: '',
            align: 'right',
            cell: (r) => (
              <div className="flex justify-end gap-1">
                <Button size="xs" variant="ghost" onClick={() => setRaw(r)}>
                  Raw
                </Button>
                {r.signatureValid && ['error', 'rejected'].includes(r.status) && (
                  <Button size="xs" variant="secondary" onClick={() => replay(r.id, false)}>
                    Replay
                  </Button>
                )}
                {r.status === 'needs_review' && (
                  <Button size="xs" onClick={() => replay(r.id, true)}>
                    Force credit
                  </Button>
                )}
                {r.networkId === 'demo' && r.status === 'credited' && r.kind === 'credit' && (
                  <Button size="xs" variant="ghost" title="Make the sandbox partner send a chargeback" onClick={async () => (await api(`/admin/postbacks/${r.id}/simulate-reversal`, { body: {} }).catch((e) => toast({ title: errorMessage(e), tone: 'danger' })), qc.invalidateQueries({ queryKey: ['admin'] }))}>
                    Simulate reversal
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />
      <Modal open={!!raw} onClose={() => setRaw(null)} title="Raw postback" size="lg">
        <pre className="max-h-[60vh] overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-emerald-200">{raw && JSON.stringify(raw.raw, null, 2)}</pre>
      </Modal>
    </div>
  );
}
