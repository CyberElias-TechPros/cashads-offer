'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { MessageSquarePlus, Search } from 'lucide-react';
import { FAQ, FAQ_CATEGORIES, TICKET_CATEGORY_LABELS } from '@cashads/shared';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { Input } from '@/components/ui/form';
import { TimeAgo } from '@/components/ui/misc';
import { useTickets } from '@/lib/queries';

const STATUS: Record<string, { label: string; tone: 'info' | 'warning' | 'success' | 'neutral' }> = {
  open: { label: 'Waiting on us', tone: 'info' },
  awaiting_user: { label: 'Waiting on you', tone: 'warning' },
  resolved: { label: 'Resolved', tone: 'success' },
  closed: { label: 'Closed', tone: 'neutral' },
};

export default function SupportPage() {
  const { data: tickets } = useTickets();
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? FAQ.filter((f) => `${f.q} ${f.a}`.toLowerCase().includes(s)) : FAQ.slice(0, 8);
  }, [q]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Help & support"
        description="Real people, published response times, and every decision explained."
        action={
          <ButtonLink href="/app/support/new">
            <MessageSquarePlus className="h-4 w-4" /> New ticket
          </ButtonLink>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader title="Search answers" description="Most questions are answered here in seconds." />
          <CardBody>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. pending, minimum, missing credit" className="pl-10" />
            </div>
            <div className="mt-4 divide-y divide-line">
              {results.map((f) => (
                <details key={f.id} className="group py-3 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-3 text-sm font-medium">
                    <span>
                      {f.q} <span className="ml-1 text-xs font-normal text-subtle">· {FAQ_CATEGORIES[f.category]}</span>
                    </span>
                    <span className="text-lg leading-none text-muted transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-2 text-sm text-muted">{f.a}</p>
                </details>
              ))}
              {results.length === 0 && <p className="py-6 text-center text-sm text-muted">No matches — open a ticket and a human will help.</p>}
            </div>
          </CardBody>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Your tickets" />
            <CardBody className="p-0 sm:p-0">
              {tickets?.length === 0 ? (
                <EmptyState className="m-5" icon="💬" title="No tickets" description="Need help? Open one and we’ll reply within 24 hours (faster on Gold & Platinum)." />
              ) : (
                <ul className="mt-3 divide-y divide-line border-t border-line">
                  {tickets?.map((t) => (
                    <li key={t.id}>
                      <Link href={`/app/support/${t.id}`} className="block px-5 py-3.5 hover:bg-surface-2 sm:px-6">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium">{t.subject}</p>
                          <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted">
                          {TICKET_CATEGORY_LABELS[t.category]} · <TimeAgo iso={t.updatedAt} /> · {t.lastMessagePreview}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardBody className="space-y-2 text-sm">
              <p className="font-semibold">Our promises</p>
              <p className="text-muted">• First reply within 24h (Gold: 12h, Platinum: 4h)</p>
              <p className="text-muted">• Appeals reviewed by a human within 48h</p>
              <p className="text-muted">• Missing-credit claims have their own fast lane</p>
              <Link href="/app/claims" className="inline-block pt-1 font-semibold text-brand-700 hover:underline dark:text-brand-300">
                File a missing-credit claim →
              </Link>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
