'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, LifeBuoy } from 'lucide-react';
import { formatDuration, formatMoney, PAYOUT_STATUS_META } from '@cashads/shared';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert, Skeleton } from '@/components/ui/feedback';
import { KeyValue, Timeline } from '@/components/ui/misc';
import { PayoutStatusBadge } from '@/components/app/widgets';
import { api, errorMessage } from '@/lib/api';
import { qk, usePayout } from '@/lib/queries';
import { toast } from '@/lib/store';

export default function PayoutStatusPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: p, isLoading, error } = usePayout(id);
  const [canceling, setCanceling] = useState(false);
  if (isLoading) return <Skeleton className="h-96 rounded-3xl" />;
  if (error || !p) return <Alert tone="danger">{errorMessage(error)}</Alert>;
  const meta = PAYOUT_STATUS_META[p.status];
  const inFlight = !meta.final;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/app/cashout" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Cash outs
      </Link>
      <Card className="overflow-hidden">
        <div className={p.status === 'completed' ? 'bg-gradient-to-br from-brand-600 to-emerald-800 p-8 text-white' : 'border-b border-line bg-surface-2 p-8'}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-3xl">{p.methodLogo}</span>
            <PayoutStatusBadge status={p.status} />
          </div>
          <p className="tabular mt-5 font-display text-5xl font-extrabold tracking-tight">{formatMoney(p.netMicros)}</p>
          <p className={p.status === 'completed' ? 'mt-1 text-white/80' : 'mt-1 text-muted'}>
            {p.status === 'completed' ? `Sent to ${p.methodName} in ${formatDuration(p.durationSeconds)} 🎉` : p.status === 'review' ? 'Getting a quick safety review — usually under 24 hours.' : inFlight ? `On its way to ${p.methodName}…` : meta.label}
          </p>
          {p.localCurrency && p.localAmount !== null && (
            <p className={p.status === 'completed' ? 'mt-1 text-sm text-white/70' : 'mt-1 text-sm text-muted'}>≈ {new Intl.NumberFormat('en-US', { style: 'currency', currency: p.localCurrency }).format(p.localAmount)} at the locked rate</p>
          )}
        </div>
        <CardBody className="grid grid-cols-1 gap-8 sm:grid-cols-2">
          <div>
            <p className="mb-4 text-sm font-semibold">Status</p>
            <Timeline
              items={[
                ...p.timeline.map((t) => ({
                  label: t.message,
                  at: t.at,
                  tone: (t.status === 'failed' || t.status === 'rejected' ? 'error' : t.status === 'retrying' || t.status === 'review' ? 'current' : 'done') as 'error' | 'current' | 'done',
                })),
                ...(inFlight ? [{ label: p.status === 'review' ? 'Then: sent to your account' : 'Arriving in your account', tone: 'todo' as const }] : []),
              ]}
            />
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold">Details</p>
            <KeyValue
              items={[
                ['Amount', formatMoney(p.amountMicros)],
                ['Provider fee', p.feeMicros ? formatMoney(p.feeMicros) : 'None'],
                ['You receive', formatMoney(p.netMicros)],
                ['To', p.destinationMasked],
                ['Method', p.methodName],
                ['Reference', p.providerReference ?? '—'],
                ['Requested', new Date(p.createdAt).toLocaleString()],
              ]}
            />
            {p.statusReason && p.status !== 'completed' && (
              <Alert tone={meta.final ? 'danger' : 'warning'} className="mt-4">
                {p.statusReason}
              </Alert>
            )}
          </div>
        </CardBody>
      </Card>
      <div className="flex flex-col gap-3 sm:flex-row">
        {p.canCancel && (
          <Button
            variant="secondary"
            loading={canceling}
            onClick={async () => {
              setCanceling(true);
              try {
                await api(`/payouts/${p.id}/cancel`, { body: {} });
                await Promise.all([qc.invalidateQueries({ queryKey: qk.payout(p.id) }), qc.invalidateQueries({ queryKey: qk.me })]);
                toast({ title: 'Canceled — the full amount is back in your balance', tone: 'success' });
              } catch (err) {
                toast({ title: errorMessage(err), tone: 'danger' });
              } finally {
                setCanceling(false);
              }
            }}
          >
            Cancel & refund
          </Button>
        )}
        <ButtonLink href={`/app/support/new?category=payout&relatedType=payout&relatedId=${p.id}`} variant="ghost">
          <LifeBuoy className="h-4 w-4" /> Something wrong? Contact support
        </ButtonLink>
      </div>
      <Card>
        <CardHeader title="What happens if a payout fails?" />
        <CardBody className="text-sm text-muted">
          If the provider rejects a payout, the full amount (fee included) goes straight back to your balance and we tell you why. If a provider is temporarily down, we retry automatically and keep you updated. Your money is never in limbo.
        </CardBody>
      </Card>
    </div>
  );
}
