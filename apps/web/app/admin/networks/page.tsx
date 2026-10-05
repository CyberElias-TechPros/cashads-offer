'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { AdminHeader } from '@/components/admin/shell';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Alert, Badge, Skeleton } from '@/components/ui/feedback';
import { Switch } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { CopyButton, TimeAgo } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { useAdmin } from '@/lib/queries';
import { toast } from '@/lib/store';

/* eslint-disable @typescript-eslint/no-explicit-any */
const SCHEMES: Record<string, string> = {
  hmac_sha256_sorted: 'HMAC-SHA256 over sorted query (default)',
  md5_txid_secret: 'md5("{tx}-{secret}")',
  hmac_sha1_url: 'HMAC-SHA1 over full URL',
  sha256_secret_txid: 'sha256("{secret}:{tx}") — SSV',
  ip_only: 'IP allowlist only',
};

export default function AdminNetworksPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useAdmin<any[]>(['networks'], '/networks');
  const [secret, setSecret] = useState<{ id: string; value: string } | null>(null);
  return (
    <div>
      <AdminHeader title="Partner networks" description="Each network posts conversions server-to-server to its own URL. Signatures are verified in constant time, and forged requests can never claim a transaction id." />
      {isLoading && <Skeleton className="h-60 rounded-2xl" />}
      <div className="space-y-4">
        {data?.map((n) => (
          <Card key={n.id}>
            <CardBody className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="flex items-center gap-2 text-lg font-semibold">
                    {n.name} <Badge tone={n.status === 'active' ? 'success' : 'neutral'}>{n.status}</Badge> <Badge>{n.kind}</Badge>
                  </p>
                  <p className="mt-1 text-sm text-muted">{n.notes}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={n.status === 'active'}
                    onChange={async (v) => {
                      try {
                        await api(`/admin/networks/${n.id}`, { method: 'PATCH', body: { status: v ? 'active' : 'disabled' } });
                        await qc.invalidateQueries({ queryKey: ['admin', 'networks'] });
                      } catch (err) {
                        toast({ title: errorMessage(err), tone: 'danger' });
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      if (!confirm(`Rotate the secret for ${n.name}? The partner must be updated immediately.`)) return;
                      const r = await api<{ secret: string }>(`/admin/networks/${n.id}/rotate-secret`, { body: {} });
                      setSecret({ id: n.id, value: r.secret });
                    }}
                  >
                    <KeyRound className="h-4 w-4" /> Rotate secret
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-xs text-muted">Signature</p>
                  <p>{SCHEMES[n.signatureScheme]}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Postbacks (30d)</p>
                  <p className="tabular">
                    {n.stats30d.total} · {n.stats30d.credited} credited · {n.stats30d.errors} failed
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted">Last postback</p>
                  <p>{n.stats30d.last ? <TimeAgo iso={n.stats30d.last} /> : '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Revenue share override</p>
                  <p>{n.revenueShareBps ? `${n.revenueShareBps / 100}%` : 'Global default'}</p>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted">Postback URL to give the partner</p>
                <div className="mt-1 flex items-center gap-2 rounded-xl border border-line bg-surface-2 py-1.5 pl-3 pr-1.5">
                  <code className="min-w-0 flex-1 truncate text-xs">{n.postbackUrl}</code>
                  <CopyButton value={n.postbackUrl} />
                </div>
                {n.docsUrl && (
                  <a href={n.docsUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-brand-700 underline dark:text-brand-300">
                    Partner documentation
                  </a>
                )}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
      <Modal open={!!secret} onClose={() => setSecret(null)} title="New secret" description="Shown once. Store it in the partner dashboard now.">
        {secret && (
          <div className="space-y-3">
            <Alert tone="warning">Postbacks signed with the old secret will be rejected from now on.</Alert>
            <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 py-2 pl-3 pr-1.5">
              <code className="min-w-0 flex-1 break-all text-sm">{secret.value}</code>
              <CopyButton value={secret.value} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
