'use client';

import Link from 'next/link';
import { CheckCircle2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/feedback';
import { useHealth } from '@/lib/queries';
import { cn } from '@/lib/utils';

export default function HealthPage() {
  const { data: h } = useHealth();
  if (!h) return <Skeleton className="h-60 rounded-2xl" />;
  const Icon = h.level === 'good' ? ShieldCheck : ShieldAlert;
  return (
    <div className="space-y-6">
      <Card className={cn('overflow-hidden', h.level === 'restricted' && 'border-rose-300 dark:border-rose-500/40')}>
        <CardBody className="flex gap-4 sm:p-8">
          <span className={cn('flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl', h.level === 'good' ? 'bg-brand-50 text-brand-600 dark:bg-brand-500/10' : h.level === 'attention' ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/10' : 'bg-rose-50 text-rose-600 dark:bg-rose-500/10')}>
            <Icon className="h-7 w-7" />
          </span>
          <div>
            <h2 className="text-xl font-bold">{h.title}</h2>
            <p className="mt-1 text-muted">{h.description}</p>
            {h.level === 'restricted' && (
              <ButtonLink href="/app/support/new?category=appeal" className="mt-4" variant="danger">
                Appeal this decision
              </ButtonLink>
            )}
          </div>
        </CardBody>
      </Card>
      {h.tips.length > 0 && (
        <Card>
          <CardBody className="space-y-3">
            <p className="font-semibold">Ways to improve</p>
            {h.tips.map((t) => (
              <p key={t} className="flex gap-2 text-sm text-muted">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> {t}
              </p>
            ))}
            <Link href="/app/settings/verification" className="inline-block text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">
              Go to verification →
            </Link>
          </CardBody>
        </Card>
      )}
      <p className="text-xs text-subtle">
        We look at signals like many accounts on one device, or the same payout account used by several people. These signals never ban anyone automatically. A human always decides, and you always get a reason and a way to appeal.
      </p>
    </div>
  );
}
