'use client';

import Link from 'next/link';
import { Clock, Gauge } from 'lucide-react';
import { CATEGORY_META, formatMinutes, formatMoney } from '@cashads/shared';
import { Badge, Skeleton } from '@/components/ui/feedback';
import { useOffers } from '@/lib/queries';

export function SampleOffers({ limit = 6, href = '/signup' }: { limit?: number; href?: string }) {
  const { data, isLoading } = useOffers({ sort: 'hourly', limit });
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {isLoading && Array.from({ length: limit }).map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
      {data?.map((o) => (
        <Link key={o.id} href={href} className="group rounded-2xl border border-line bg-surface p-4 shadow-soft transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lift dark:hover:border-brand-500/40">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl" style={{ background: `${o.brandColor}18` }}>
              {o.icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-1 font-semibold">{o.title}</p>
              <p className="text-xs text-muted">{o.advertiser}</p>
            </div>
            <p className="tabular text-lg font-extrabold text-brand-700 dark:text-brand-400">{formatMoney(o.userPayoutMicros)}</p>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <Badge tone="brand">
              <Gauge className="h-3 w-3" /> {formatMoney(o.hourlyRateMicros, { decimals: 2 })}/hr
            </Badge>
            <span className="inline-flex items-center gap-1 text-muted">
              <Clock className="h-3 w-3" /> {formatMinutes(o.medianMinutes ?? o.estimatedMinutes)}
            </span>
            <span className="text-muted">· {CATEGORY_META[o.category].label}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
