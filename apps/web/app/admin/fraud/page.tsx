'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { flagEmoji } from '@cashads/shared';
import { AdminHeader, ReasonDialog } from '@/components/admin/shell';
import { riskTone, statusTone } from '@/components/admin/tones';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Badge, EmptyState, Skeleton } from '@/components/ui/feedback';
import { Segmented } from '@/components/ui/form';
import { TimeAgo } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useAdmin } from '@/lib/queries';

interface Case {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  userStatus: string;
  country: string;
  score: number;
  level: string;
  summary: string;
  status: string;
  resolution: string | null;
  openedAt: string;
}

export default function AdminFraudPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'open' | 'cleared' | 'actioned'>('open');
  const { data, isLoading } = useAdmin<Case[]>(['fraud', status], `/fraud?status=${status}`);
  const [action, setAction] = useState<{ c: Case; a: 'clear' | 'restrict' | 'ban' } | null>(null);
  return (
    <div>
      <AdminHeader title="Fraud review" description="Risk scoring is explainable and never bans automatically. You decide, and the member always sees your reason and can appeal." />
      <Segmented className="mb-4" value={status} onChange={setStatus} options={[{ value: 'open', label: 'Open' }, { value: 'cleared', label: 'Cleared' }, { value: 'actioned', label: 'Actioned' }]} />
      {isLoading && <Skeleton className="h-40 rounded-2xl" />}
      {data?.length === 0 && <EmptyState icon="🛡️" title="No cases" description="Nothing needs a human look right now." />}
      <div className="space-y-3">
        {data?.map((c) => (
          <Card key={c.id}>
            <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-surface-3">
                <span className="tabular text-lg font-bold">{c.score}</span>
                <span className="text-[10px] uppercase text-muted">score</span>
              </div>
              <div className="min-w-0 flex-1">
                <Link href={`/admin/users/${c.userId}`} className="font-semibold hover:underline">
                  {flagEmoji(c.country)} {c.userName} <span className="text-sm font-normal text-muted">· {c.userEmail}</span>
                </Link>
                <p className="mt-1 text-sm">{c.summary}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Badge tone={riskTone(c.level)}>{c.level} risk</Badge>
                  <Badge tone={statusTone(c.userStatus)}>{c.userStatus}</Badge>
                  <span>
                    opened <TimeAgo iso={c.openedAt} />
                  </span>
                  {c.resolution && <span>· {c.resolution}</span>}
                </div>
              </div>
              {c.status === 'open' && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setAction({ c, a: 'clear' })}>
                    Clear
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setAction({ c, a: 'restrict' })}>
                    Restrict
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setAction({ c, a: 'ban' })}>
                    Ban
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>
        ))}
      </div>
      <ReasonDialog
        open={!!action}
        onClose={() => setAction(null)}
        title={action?.a === 'clear' ? 'Clear this case' : action?.a === 'ban' ? 'Ban member' : 'Restrict member'}
        description={action?.a === 'clear' ? 'Signals are marked reviewed, the risk score drops and any held cash outs are sent automatically.' : 'The member is notified with your reason and can appeal.'}
        confirmLabel={action?.a === 'clear' ? 'Clear case' : action?.a === 'ban' ? 'Ban' : 'Restrict'}
        danger={action?.a === 'ban'}
        defaultReason={action?.a === 'clear' ? 'Reviewed manually — legitimate activity.' : ''}
        onConfirm={async (note) => {
          await api(`/admin/fraud/${action!.c.id}/resolve`, { body: { action: action!.a, note } });
          await qc.invalidateQueries({ queryKey: ['admin'] });
        }}
      />
    </div>
  );
}
