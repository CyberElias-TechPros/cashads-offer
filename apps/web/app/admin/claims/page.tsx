'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CLAIM_STATUS_META, formatMoney, TIER_BY_ID, timeUntil, type ClaimStatus, type TierId } from '@cashads/shared';
import { AdminHeader, ReasonDialog } from '@/components/admin/shell';
import { riskTone } from '@/components/admin/tones';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Badge, EmptyState, Skeleton } from '@/components/ui/feedback';
import { Segmented } from '@/components/ui/form';
import { TimeAgo } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useAdmin } from '@/lib/queries';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function AdminClaimsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>('in_review');
  const { data, isLoading } = useAdmin<any[]>(['claims', status], `/claims${status === 'all' ? '' : `?status=${status}`}`, { refetchInterval: 15_000 });
  const [decide, setDecide] = useState<{ c: any; d: 'approve' | 'reject' } | null>(null);
  return (
    <div>
      <AdminHeader title="Missing-credit claims" description="Automatic partner checks already ran on these and found no match. Approving pays from goodwill; if the partner pays later, the books recover automatically." />
      <Segmented className="mb-4" value={status} onChange={setStatus} options={[{ value: 'in_review', label: 'Needs review' }, { value: 'submitted', label: 'Checking' }, { value: 'approved', label: 'Approved' }, { value: 'auto_approved', label: 'Auto-approved' }, { value: 'rejected', label: 'Rejected' }, { value: 'all', label: 'All' }]} />
      {isLoading && <Skeleton className="h-40 rounded-2xl" />}
      {data?.length === 0 && <EmptyState icon="🔎" title="Nothing to review" />}
      <div className="space-y-3">
        {data?.map((c) => {
          const breached = new Date(c.slaDueAt).getTime() < Date.now() && (c.status === 'in_review' || c.status === 'submitted');
          return (
            <Card key={c.id}>
              <CardBody className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{c.offerIcon}</span>
                    <div>
                      <p className="font-semibold">
                        {c.offerTitle} · <span className="tabular">{formatMoney(c.amountMicros)}</span>
                      </p>
                      <p className="text-sm text-muted">
                        <Link href={`/admin/users/${c.userId}`} className="hover:underline">
                          {c.userName}
                        </Link>{' '}
                        · {TIER_BY_ID[c.userTier as TierId].label} · <Badge tone={riskTone(c.userRisk)}>{c.userRisk} risk</Badge>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={CLAIM_STATUS_META[c.status as ClaimStatus].tone}>{CLAIM_STATUS_META[c.status as ClaimStatus].label}</Badge>
                    {(c.status === 'in_review' || c.status === 'submitted') && <Badge tone={breached ? 'danger' : 'neutral'}>{breached ? 'SLA breached' : `SLA ${timeUntil(c.slaDueAt)}`}</Badge>}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 rounded-xl bg-surface-2 p-3 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-muted">Started offer</p>
                    <p>{c.click ? new Date(c.click.startedAt).toLocaleString() : '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">Claims finished at</p>
                    <p>{new Date(c.completedAtClaimed).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">Partner signals for this click</p>
                    <p>{c.postbacks.length ? c.postbacks.map((p: any) => `${p.status}${p.reason ? ` (${p.reason})` : ''}`).join(', ') : 'None received'}</p>
                  </div>
                </div>
                {c.note && <p className="text-sm">“{c.note}”</p>}
                {c.uploadId && (
                  <a href={`/api/uploads/${c.uploadId}`} target="_blank" className="inline-block text-sm font-semibold text-brand-700 underline dark:text-brand-300">
                    View screenshot
                  </a>
                )}
                {c.resolution && <p className="text-sm text-muted">Resolution: {c.resolution}</p>}
                <p className="text-xs text-subtle">
                  Filed <TimeAgo iso={c.createdAt} />
                </p>
                {(c.status === 'in_review' || c.status === 'submitted') && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => setDecide({ c, d: 'approve' })}>
                      Approve & pay {formatMoney(c.amountMicros)}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setDecide({ c, d: 'reject' })}>
                      Reject
                    </Button>
                  </div>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>
      <ReasonDialog
        open={!!decide}
        onClose={() => setDecide(null)}
        title={decide?.d === 'approve' ? 'Approve claim' : 'Reject claim'}
        confirmLabel={decide?.d === 'approve' ? 'Approve & pay' : 'Reject'}
        danger={decide?.d === 'reject'}
        defaultReason={decide?.d === 'approve' ? 'Thanks for your patience. We verified your completion and paid you; we’ll follow up with the partner ourselves.' : ''}
        onConfirm={async (reason) => {
          await api(`/admin/claims/${decide!.c.id}/decide`, { body: { decision: decide!.d, reason } });
          await qc.invalidateQueries({ queryKey: ['admin'] });
        }}
      />
    </div>
  );
}
