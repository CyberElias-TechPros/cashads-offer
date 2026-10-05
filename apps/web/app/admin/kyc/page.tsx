'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { countryName } from '@cashads/shared';
import { AdminHeader, ReasonDialog } from '@/components/admin/shell';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState, Skeleton } from '@/components/ui/feedback';
import { KeyValue, TimeAgo } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useAdmin } from '@/lib/queries';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function AdminKycPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useAdmin<any[]>(['kyc'], '/kyc');
  const [reject, setReject] = useState<any | null>(null);
  const decide = async (id: string, decision: 'verified' | 'rejected', reason?: string) => {
    await api(`/admin/kyc/${id}/decide`, { body: { decision, reason } });
    await qc.invalidateQueries({ queryKey: ['admin'] });
  };
  return (
    <div>
      <AdminHeader title="Identity verification" description="Only needed for large cash outs. In production, a KYC provider (Persona, Onfido, Smile ID) pre-screens these." />
      {isLoading && <Skeleton className="h-40 rounded-2xl" />}
      {data?.length === 0 && <EmptyState icon="🪪" title="No pending submissions" />}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {data?.map((k) => (
          <Card key={k.id}>
            <CardBody className="space-y-4">
              <div className="flex items-center justify-between">
                <Link href={`/admin/users/${k.userId}`} className="font-semibold hover:underline">
                  {k.userName}
                </Link>
                <span className="text-xs text-muted">
                  <TimeAgo iso={k.createdAt} />
                </span>
              </div>
              <KeyValue items={[['Legal name', k.legalName], ['Date of birth', k.dateOfBirth], ['Document', `${k.documentType.replace('_', ' ')} · ${countryName(k.documentCountry)}`], ['Number', `•••• ${k.documentNumberLast4}`]]} />
              <div className="grid grid-cols-2 gap-3">
                {[k.documentUploadId, k.selfieUploadId].map((u: string, i: number) => (
                  <a key={u} href={`/api/uploads/${u}`} target="_blank" className="flex h-28 items-center justify-center rounded-xl border border-line bg-surface-2 text-sm text-muted hover:border-brand-400">
                    {i === 0 ? '📄 Document' : '🤳 Selfie'}
                  </a>
                ))}
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => decide(k.id, 'verified')}>
                  Approve
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setReject(k)}>
                  Reject
                </Button>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
      <ReasonDialog open={!!reject} onClose={() => setReject(null)} title="Reject verification" confirmLabel="Reject" danger defaultReason="The document photo was blurry — please upload a clearer image." onConfirm={(reason) => decide(reject.id, 'rejected', reason)} />
    </div>
  );
}
