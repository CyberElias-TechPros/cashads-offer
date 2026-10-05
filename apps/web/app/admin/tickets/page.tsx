'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { TICKET_CATEGORY_LABELS, TIER_BY_ID, timeUntil, type TicketCategory, type TierId } from '@cashads/shared';
import { AdminHeader } from '@/components/admin/shell';
import { DataTable } from '@/components/ui/data';
import { Badge } from '@/components/ui/feedback';
import { Segmented } from '@/components/ui/form';
import { TimeAgo } from '@/components/ui/misc';
import { useAdmin } from '@/lib/queries';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function AdminTicketsPage() {
  const router = useRouter();
  const [status, setStatus] = useState('open');
  const { data, isLoading } = useAdmin<any[]>(['tickets', status], `/tickets${status === 'all' ? '' : `?status=${status}`}`, { refetchInterval: 15_000 });
  return (
    <div>
      <AdminHeader title="Support tickets" description="Sorted by SLA deadline. Appeals have a 48h SLA, and Gold and Platinum members get faster ones." />
      <Segmented className="mb-4" value={status} onChange={setStatus} options={[{ value: 'open', label: 'Open' }, { value: 'awaiting_user', label: 'Awaiting member' }, { value: 'resolved', label: 'Resolved' }, { value: 'closed', label: 'Closed' }, { value: 'all', label: 'All' }]} />
      <DataTable
        rows={data}
        loading={isLoading}
        rowKey={(r) => r.id}
        onRowClick={(r) => router.push(`/admin/tickets/${r.id}`)}
        columns={[
          { key: 'subject', header: 'Subject', cell: (r) => <span><span className="font-medium">{r.subject}</span><span className="block text-xs text-muted">{r.userName} · {TIER_BY_ID[r.userTier as TierId].label}</span></span> },
          { key: 'cat', header: 'Topic', cell: (r) => <Badge tone={r.category === 'appeal' ? 'warning' : 'neutral'}>{TICKET_CATEGORY_LABELS[r.category as TicketCategory]}</Badge> },
          { key: 'prio', header: 'Priority', cell: (r) => (r.priority === 'high' ? <Badge tone="danger">High</Badge> : 'Normal') },
          { key: 'sla', header: 'SLA', cell: (r) => (r.status === 'open' ? <Badge tone={r.breached ? 'danger' : 'info'}>{r.breached ? 'Breached' : timeUntil(r.slaDueAt)}</Badge> : <span className="text-xs text-muted">{r.status.replace('_', ' ')}</span>) },
          { key: 'updated', header: 'Last message', cell: (r) => <TimeAgo iso={r.lastMessageAt} className="text-xs text-muted" /> },
        ]}
      />
    </div>
  );
}
