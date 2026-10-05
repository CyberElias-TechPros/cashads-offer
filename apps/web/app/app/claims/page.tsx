'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { LifeBuoy, Plus, Search, ShieldCheck, Zap } from 'lucide-react';
import { CLAIM_STATUS_META, formatMoney } from '@cashads/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody, PageHeader } from '@/components/ui/card';
import { Badge, EmptyState, Skeleton } from '@/components/ui/feedback';
import { TimeAgo } from '@/components/ui/misc';
import { ClaimModal } from '@/components/app/claim-modal';
import { useClaims, useClicks } from '@/lib/queries';

function Claims() {
  const params = useSearchParams();
  const preselect = params.get('click') ?? undefined;
  const { data: claims, isLoading } = useClaims();
  const { data: clicks } = useClicks();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (preselect) setOpen(true);
  }, [preselect]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Missing credit"
        description="Finished an offer but didn’t get paid? We check the partner automatically, and if we can verify it, you get paid even when their tracking failed."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> New claim
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { icon: Zap, t: 'Seconds, not weeks', d: 'Most claims are matched automatically against partner records within seconds.' },
          { icon: ShieldCheck, t: 'We eat the loss', d: 'If you completed it and we can verify it, you’re paid — we chase the partner ourselves.' },
          { icon: LifeBuoy, t: 'Humans within 24h', d: 'Anything we can’t match automatically goes to a real person within our published SLA.' },
        ].map((x) => (
          <Card key={x.t}>
            <CardBody>
              <x.icon className="h-5 w-5 text-brand-600" />
              <p className="mt-2 font-semibold">{x.t}</p>
              <p className="mt-1 text-sm text-muted">{x.d}</p>
            </CardBody>
          </Card>
        ))}
      </div>
      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : claims?.length === 0 ? (
          <EmptyState className="m-5" icon={<Search className="h-5 w-5" />} title="No claims — that’s a good sign" description="If an offer ever fails to track, file a claim here or from the offer page." />
        ) : (
          <ul className="divide-y divide-line">
            {claims?.map((c) => (
              <li key={c.id}>
                <Link href={`/app/claims/${c.id}`} className="flex items-center gap-3 px-5 py-4 hover:bg-surface-2">
                  <span className="text-2xl">{c.offerIcon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.offerTitle}</p>
                    <p className="text-xs text-muted">
                      Filed <TimeAgo iso={c.createdAt} />
                      {c.resolvedAt && (
                        <>
                          {' '}
                          · resolved <TimeAgo iso={c.resolvedAt} />
                        </>
                      )}
                    </p>
                  </div>
                  <span className="tabular text-sm font-semibold">{formatMoney(c.amountMicros)}</span>
                  <Badge tone={CLAIM_STATUS_META[c.status].tone} dot>
                    {CLAIM_STATUS_META[c.status].label}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {clicks && <ClaimModal open={open} onClose={() => setOpen(false)} clicks={clicks} defaultClickId={preselect} />}
    </div>
  );
}

export default function ClaimsPage() {
  return (
    <Suspense>
      <Claims />
    </Suspense>
  );
}
