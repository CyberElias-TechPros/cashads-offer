'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { TICKET_CATEGORY_LABELS, type TicketDTO } from '@cashads/shared';
import { AdminHeader } from '@/components/admin/shell';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Badge, Skeleton } from '@/components/ui/feedback';
import { Select, Textarea } from '@/components/ui/form';
import { TimeAgo } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { useAdmin } from '@/lib/queries';
import { toast } from '@/lib/store';
import { cn } from '@/lib/utils';

const MACROS = [
  ['Missing credit — checking', 'Thanks for flagging this! I’ve asked the partner to confirm your completion. Most confirmations come back within 24 hours — I’ll update you here either way.'],
  ['Payout — provider delay', 'Your cash out was sent, but the provider is running slower than usual today. It should arrive within a few hours. If it hasn’t by tomorrow, reply here and I’ll chase it personally.'],
  ['Appeal — approved', 'Thank you for explaining. I reviewed your account and I’m lifting the restriction now. Sorry for the trouble!'],
  ['Appeal — upheld', 'Thanks for your patience. After a second review I’m keeping the decision in place, because several accounts are actively using the same payout destination. If you have documents showing otherwise, reply here and a senior reviewer will look again.'],
] as const;

export default function AdminTicketPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: t, isLoading } = useAdmin<TicketDTO>(['ticket', id], `/tickets/${id}`);
  const [msg, setMsg] = useState('');
  const [status, setStatus] = useState<'awaiting_user' | 'resolved' | 'open'>('awaiting_user');
  const [sending, setSending] = useState(false);
  if (isLoading || !t) return <Skeleton className="h-96 rounded-3xl" />;
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link href="/admin/tickets" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Tickets
      </Link>
      <AdminHeader title={t.subject} description={`${TICKET_CATEGORY_LABELS[t.category]} · opened ${new Date(t.createdAt).toLocaleString()}`} action={<Badge>{t.status.replace('_', ' ')}</Badge>} />
      <Card>
        <CardBody className="space-y-4">
          {t.messages?.map((m) => (
            <div key={m.id} className={cn('flex', m.author === 'staff' ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[85%] rounded-2xl px-4 py-3 text-sm', m.author === 'staff' ? 'bg-slate-900 text-white dark:bg-slate-700' : m.author === 'system' ? 'border border-dashed border-line text-muted' : 'bg-surface-3')}>
                <p className="mb-1 text-xs font-semibold opacity-70">{m.author === 'user' ? 'Member' : m.authorName}</p>
                <p className="whitespace-pre-wrap">{m.body}</p>
                <p className="mt-1 text-[11px] opacity-60">
                  <TimeAgo iso={m.createdAt} />
                </p>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>
      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {MACROS.map(([label, text]) => (
              <button key={label} onClick={() => setMsg(text)} className="rounded-full border border-line px-3 py-1 text-xs hover:border-brand-400">
                {label}
              </button>
            ))}
          </div>
          <Textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={5} placeholder="Reply to the member (they get an email + in-app notification)…" />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="h-10 w-52">
              <option value="awaiting_user">Then: awaiting member</option>
              <option value="resolved">Then: resolved</option>
              <option value="open">Then: keep open</option>
            </Select>
            <Button
              disabled={!msg.trim()}
              loading={sending}
              onClick={async () => {
                setSending(true);
                try {
                  await api(`/admin/tickets/${id}/reply`, { body: { message: msg, status } });
                  setMsg('');
                  await qc.invalidateQueries({ queryKey: ['admin'] });
                  toast({ title: 'Reply sent', tone: 'success' });
                } catch (err) {
                  toast({ title: errorMessage(err), tone: 'danger' });
                } finally {
                  setSending(false);
                }
              }}
            >
              Send reply
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
