'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import { CATEGORY_META, OFFER_CATEGORIES, formatMoney, type DataUsage, type OfferCategory, type OfferSort } from '@cashads/shared';
import { PageHeader } from '@/components/ui/card';
import { Badge, EmptyState, Skeleton } from '@/components/ui/feedback';
import { Input, Segmented, Select } from '@/components/ui/form';
import { TimeAgo } from '@/components/ui/misc';
import { OfferCard } from '@/components/app/widgets';
import { useClicks, useOffers } from '@/lib/queries';
import { usePrefs } from '@/lib/store';
import { cn } from '@/lib/utils';

export default function EarnPage() {
  const dataSaver = usePrefs((s) => s.dataSaver);
  const [tab, setTab] = useState<'browse' | 'mine'>('browse');
  const [category, setCategory] = useState<OfferCategory | 'all'>('all');
  const [sort, setSort] = useState<OfferSort>('hourly');
  const [q, setQ] = useState('');
  const [maxMinutes, setMaxMinutes] = useState<number | undefined>();
  const [minHourly, setMinHourly] = useState<number | undefined>();
  const [dataUsage, setDataUsage] = useState<DataUsage | undefined>(dataSaver ? 'light' : undefined);
  const [showFilters, setShowFilters] = useState(false);
  const { data, isLoading } = useOffers({ category, sort, q: q || undefined, maxMinutes, minHourlyMicros: minHourly, dataUsage });
  const { data: clicks } = useClicks();

  return (
    <div>
      <PageHeader
        title="Offers"
        description="Every payout is real money. Sorted by what your time is worth."
        action={<Segmented value={tab} onChange={setTab} options={[{ value: 'browse', label: 'Browse' }, { value: 'mine', label: `My offers${clicks?.length ? ` (${clicks.length})` : ''}` }]} />}
      />
      {tab === 'browse' ? (
        <>
          <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {(['all', ...OFFER_CATEGORIES] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={cn(
                  'shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
                  category === c ? 'border-brand-600 bg-brand-600 text-white dark:border-brand-500 dark:bg-brand-500 dark:text-brand-950' : 'border-line bg-surface hover:border-line-strong',
                )}
              >
                {c === 'all' ? '✨ All' : `${CATEGORY_META[c].emoji} ${CATEGORY_META[c].plural}`}
              </button>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search offers or brands" className="pl-10" />
            </div>
            <div className="flex gap-2">
              <Select value={sort} onChange={(e) => setSort(e.target.value as OfferSort)} className="w-44">
                <option value="hourly">Best $/hour</option>
                <option value="payout">Highest payout</option>
                <option value="quickest">Quickest</option>
                <option value="quality">Most reliable</option>
                <option value="newest">Newest</option>
              </Select>
              <button onClick={() => setShowFilters((v) => !v)} className={cn('flex h-11 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium', showFilters || maxMinutes || minHourly || dataUsage ? 'border-brand-500 text-brand-700 dark:text-brand-300' : 'border-line')}>
                <SlidersHorizontal className="h-4 w-4" /> Filters
              </button>
            </div>
          </div>
          {showFilters && (
            <div className="mt-3 grid grid-cols-1 animate-slide-up gap-4 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-3">
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Time I have</p>
                <Segmented size="sm" value={String(maxMinutes ?? 'any')} onChange={(v) => setMaxMinutes(v === 'any' ? undefined : Number(v))} options={[{ value: 'any', label: 'Any' }, { value: '2', label: '< 2 min' }, { value: '10', label: '< 10' }, { value: '30', label: '< 30' }]} />
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Minimum hourly rate</p>
                <Segmented size="sm" value={String(minHourly ?? 'any')} onChange={(v) => setMinHourly(v === 'any' ? undefined : Number(v))} options={[{ value: 'any', label: 'Any' }, { value: '5000000', label: '$5+' }, { value: '10000000', label: '$10+' }, { value: '20000000', label: '$20+' }]} />
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Data usage</p>
                <Segmented size="sm" value={dataUsage ?? 'any'} onChange={(v) => setDataUsage(v === 'any' ? undefined : (v as DataUsage))} options={[{ value: 'any', label: 'Any' }, { value: 'light', label: 'Light' }, { value: 'medium', label: '≤ Medium' }]} />
              </div>
            </div>
          )}
          {maxMinutes === 2 && <p className="mt-3 text-sm text-muted">⚡ Micro-task mode: quick wins for the moments in between.</p>}
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {isLoading && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}
            {data?.map((o) => <OfferCard key={o.id} offer={o} />)}
          </div>
          {data && data.length === 0 && <EmptyState className="mt-5" icon="🔎" title="No offers match those filters" description="Try widening the time or hourly-rate filter. New offers arrive every day." />}
        </>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-soft">
          {clicks?.length === 0 && <EmptyState className="m-4" icon="🧭" title="No offers started yet" description="Offers you start show up here so you can track them or file a missing-credit claim." />}
          <ul className="divide-y divide-line">
            {clicks?.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
                <span className="text-2xl">{c.offerIcon}</span>
                <div className="min-w-0 flex-1">
                  <Link href={`/app/earn/${c.offerId}`} className="block truncate text-sm font-medium hover:underline">
                    {c.offerTitle}
                  </Link>
                  <p className="text-xs text-muted">
                    Started <TimeAgo iso={c.startedAt} />
                    {c.creditedAt && (
                      <>
                        {' '}
                        · credited <TimeAgo iso={c.creditedAt} />
                      </>
                    )}
                  </p>
                </div>
                <span className="tabular text-sm font-semibold">{formatMoney(c.userPayoutMicros)}</span>
                {c.status === 'credited' ? (
                  <Badge tone="success">Credited</Badge>
                ) : c.status === 'reversed' ? (
                  <Badge tone="danger">Reversed</Badge>
                ) : c.claimId ? (
                  <Link href={`/app/claims/${c.claimId}`}>
                    <Badge tone="warning">Claim open</Badge>
                  </Link>
                ) : c.claimable ? (
                  <Link href={`/app/claims?click=${c.id}`} className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
                    Missing credit?
                  </Link>
                ) : (
                  <Badge>In progress</Badge>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
