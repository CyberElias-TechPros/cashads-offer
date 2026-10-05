'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminHeader } from '@/components/admin/shell';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data';
import { Badge } from '@/components/ui/feedback';
import { Segmented } from '@/components/ui/form';
import { TimeAgo } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useAdmin } from '@/lib/queries';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function JobsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const { data, isLoading } = useAdmin<any[]>(['jobs', status], `/jobs${status ? `?status=${status}` : ''}`, { refetchInterval: 5000 });
  const { data: outbox } = useAdmin<any[]>(['outbox'], '/outbox', { refetchInterval: 10_000 });
  const { data: health } = useQuery({ queryKey: ['api-health'], queryFn: () => api<any>('/health'), refetchInterval: 10_000 });
  return (
    <div className="space-y-6">
      <AdminHeader title="Jobs & outbox" description="Postgres-backed job queue (FOR UPDATE SKIP LOCKED): retries with exponential backoff, dead-letter, safe on many instances." />
      {health && (
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge tone={health.status === 'ok' ? 'success' : 'danger'}>API {health.status}</Badge>
          <Badge>db: {health.driver}</Badge>
          <Badge>uptime {Math.round(health.uptimeSeconds / 60)} min</Badge>
          <Badge>{health.sseClients} live SSE listeners</Badge>
        </div>
      )}
      <Segmented value={status} onChange={setStatus} options={[{ value: '', label: 'Active' }, { value: 'queued', label: 'Queued' }, { value: 'dead', label: 'Dead' }, { value: 'done', label: 'Done' }]} />
      <DataTable
        rows={data}
        loading={isLoading}
        rowKey={(r) => r.id}
        empty="Queue is idle."
        columns={[
          { key: 'type', header: 'Type', cell: (r) => <code className="text-xs">{r.type}</code> },
          { key: 'status', header: 'Status', cell: (r) => <Badge tone={r.status === 'dead' ? 'danger' : r.status === 'running' ? 'info' : r.status === 'done' ? 'success' : 'neutral'}>{r.status}</Badge> },
          { key: 'att', header: 'Attempts', cell: (r) => `${r.attempts}/${r.maxAttempts}` },
          { key: 'run', header: 'Runs', cell: (r) => <TimeAgo iso={r.runAt} className="text-xs text-muted" /> },
          { key: 'err', header: 'Last error', cell: (r) => <span className="block max-w-xs truncate text-xs text-rose-600" title={r.lastError}>{r.lastError}</span> },
          { key: 'act', header: '', align: 'right', cell: (r) => (r.status === 'dead' ? <Button size="xs" onClick={async () => (await api(`/admin/jobs/${r.id}/retry`, { body: {} }), qc.invalidateQueries({ queryKey: ['admin', 'jobs'] }))}>Retry</Button> : null) },
        ]}
      />
      <Card>
        <CardHeader title="Message outbox" description="Emails & SMS written transactionally, delivered by the worker (Resend when configured)." />
        <CardBody className="divide-y divide-line py-2">
          {outbox?.slice(0, 30).map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 truncate">
                {m.channel === 'sms' ? '📱' : '✉️'} {m.subject ?? m.text.slice(0, 60)} <span className="text-xs text-muted">→ {m.to}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge tone={m.status === 'sent' ? 'success' : m.status === 'failed' ? 'danger' : 'neutral'}>{m.status}</Badge>
                <TimeAgo iso={m.createdAt} className="text-xs text-muted" />
              </span>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
