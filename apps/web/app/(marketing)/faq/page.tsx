'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { FAQ, FAQ_CATEGORIES, type FaqItem } from '@cashads/shared';
import { ButtonLink } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { cn } from '@/lib/utils';

export default function FaqPage() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<FaqItem['category'] | 'all'>('all');
  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    return FAQ.filter((f) => (cat === 'all' || f.category === cat) && (!s || `${f.q} ${f.a}`.toLowerCase().includes(s)));
  }, [q, cat]);
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="font-display text-4xl font-extrabold tracking-tight">Frequently asked questions</h1>
      <p className="mt-3 text-muted">Straight answers. If something isn’t here, a human will answer within 24 hours.</p>
      <div className="relative mt-8">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search questions…" className="pl-10" />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {(['all', ...Object.keys(FAQ_CATEGORIES)] as Array<FaqItem['category'] | 'all'>).map((c) => (
          <button key={c} onClick={() => setCat(c)} className={cn('rounded-full border px-3 py-1 text-sm', cat === c ? 'border-brand-600 bg-brand-600 text-white dark:bg-brand-500 dark:text-brand-950' : 'border-line')}>
            {c === 'all' ? 'All' : FAQ_CATEGORIES[c]}
          </button>
        ))}
      </div>
      <div className="mt-8 divide-y divide-line rounded-2xl border border-line bg-surface shadow-soft">
        {items.map((f) => (
          <details key={f.id} id={f.id} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
              {f.q}
              <span className="text-xl text-muted transition-transform group-open:rotate-45">+</span>
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-muted">{f.a}</p>
          </details>
        ))}
        {items.length === 0 && <p className="p-8 text-center text-sm text-muted">No results.</p>}
      </div>
      <div className="mt-10 text-center">
        <ButtonLink href="/contact" variant="secondary">
          Still have a question? Contact us
        </ButtonLink>
      </div>
    </div>
  );
}
