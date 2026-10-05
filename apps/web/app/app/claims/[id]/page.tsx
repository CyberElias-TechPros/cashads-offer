'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { CLAIM_STATUS_META, formatMoney, timeUntil } from '@cashads/shared';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Alert, Badge, Skeleton } from '@/components/ui/feedback';
import { Timeline } from '@/components/ui/misc';
import { errorMessage } from '@/lib/api';
import { useClaim } from '@/lib/queries';

export default function ClaimDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: c, isLoading, error } = useClaim(id);
  if (isLoading) return <Skeleton className="h-80 rounded-3xl" />;
  if (error || !c) return <Alert tone="danger">{errorMessage(error)}</Alert>;
  const meta = CLAIM_STATUS_META[c.status];
  const open = c.status === 'submitted' || c.status === 'in_review';
  const approved = c.status === 'approved' || c.status === 'auto_approved';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/app/claims" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Missing credit
      </Link>
      <Card>
        <CardBody className="sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl">{c.offerIcon}</span>
              <div>
                <p className="font-semibold">{c.offerTitle}</p>
                <p className="tabular text-sm text-muted">{formatMoney(c.amountMicros)}</p>
              </div>
            </div>
            <Badge tone={meta.tone} dot>
              {meta.label}
            </Badge>
          </div>
          {c.status === 'submitted' && (
            <Alert tone="info" className="mt-6" icon={<Loader2 className="h-4 w-4 animate-spin" />} title="Checking with the partner…">
              This usually takes a few seconds. You can leave this page; we’ll notify you.
            </Alert>
          )}
          {c.status === 'in_review' && (
            <Alert tone="warning" className="mt-6" title={`A person will review this ${timeUntil(c.slaDueAt)}`}>
              We couldn’t match it automatically. Adding a screenshot or more detail via support speeds things up.
            </Alert>
          )}
          {approved && (
            <Alert tone="success" className="mt-6" title={`${formatMoney(c.amountMicros)} credited`}>
              {c.resolution}
            </Alert>
          )}
          {c.status === 'rejected' && (
            <Alert tone="danger" className="mt-6" title="Not approved">
              {c.resolution} If you have more evidence, reply via support and a different reviewer will take a look.
            </Alert>
          )}
          <div className="mt-8">
            <Timeline items={[...c.timeline.map((t) => ({ label: t.label, at: t.at, tone: 'done' as const })), ...(open ? [{ label: c.status === 'submitted' ? 'Automatic partner check' : 'Human review', tone: 'current' as const }] : [])]} />
          </div>
          {c.note && (
            <div className="mt-6 rounded-xl bg-surface-2 p-4 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Your note</p>
              <p className="mt-1">{c.note}</p>
            </div>
          )}
        </CardBody>
      </Card>
      {(open || c.status === 'rejected') && (
        <ButtonLink href={`/app/support/new?category=missing_credit&relatedType=claim&relatedId=${c.id}`} variant="secondary">
          Add details via support
        </ButtonLink>
      )}
    </div>
  );
}
