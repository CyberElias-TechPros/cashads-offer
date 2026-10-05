'use client';

import { AdminHeader } from '@/components/admin/shell';
import { DataTable } from '@/components/ui/data';
import { Badge } from '@/components/ui/feedback';
import { TimeAgo } from '@/components/ui/misc';
import { useAdmin } from '@/lib/queries';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function AuditPage() {
  const { data, isLoading } = useAdmin<any[]>(['audit'], '/audit');
  return (
    <div>
      <AdminHeader title="Audit log" description="Every staff action and every automatic enforcement, immutable and attributed." />
      <DataTable
        rows={data}
        loading={isLoading}
        rowKey={(r) => r.id}
        columns={[
          { key: 'when', header: 'When', cell: (r) => <TimeAgo iso={r.createdAt} className="text-xs text-muted" /> },
          { key: 'actor', header: 'Actor', cell: (r) => <span className="text-sm">{r.actorName}<span className="block text-xs text-muted">{r.actorEmail ?? 'automated rule'}</span></span> },
          { key: 'action', header: 'Action', cell: (r) => <Badge tone={r.action.includes('ban') || r.action.includes('reject') ? 'danger' : r.action.includes('auto') ? 'warning' : 'neutral'}>{r.action}</Badge> },
          { key: 'target', header: 'Target', cell: (r) => <code className="text-xs">{r.targetType}{r.targetId ? `:${r.targetId.slice(0, 8)}` : ''}</code> },
          { key: 'details', header: 'Details', cell: (r) => <code className="block max-w-md truncate text-xs text-muted" title={JSON.stringify(r.details)}>{JSON.stringify(r.details)}</code> },
        ]}
      />
    </div>
  );
}
