'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Send } from 'lucide-react';
import { TICKET_CATEGORY_LABELS, timeUntil } from '@cashads/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Alert, Badge, Skeleton } from '@/components/ui/feedback';
import { Textarea } from '@/components/ui/form';
import { TimeAgo } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { qk, useTicket } from '@/lib/queries';
import { toast } from '@/lib/store';
import { cn } from '@/lib/utils';

export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: t, isLoading, error } = useTicket(id);
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);
  if (isLoading) return <Skeleton className="h-96 rounded-3xl" />;
  if (error || !t) return <Alert tone="danger">{errorMessage(error)}</Alert>;
  const closed = t.status === 'closed';
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/app/support" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Support
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t.subject}</h1>
          <p className="text-sm text-muted">
            {TICKET_CATEGORY_LABELS[t.category]} · opened <TimeAgo iso={t.createdAt} />
          </p>
        </div>
        <Badge tone={t.status === 'open' ? 'info' : t.status === 'awaiting_user' ? 'warning' : t.status === 'resolved' ? 'success' : 'neutral'}>
          {t.status === 'open' ? `We’ll reply ${timeUntil(t.slaDueAt)}` : t.status === 'awaiting_user' ? 'Waiting on you' : t.status === 'resolved' ? 'Resolved' : 'Closed'}
        </Badge>
      </div>
      <Card>
        <CardBody className="space-y-4">
          {t.messages?.map((m) => (
            <div key={m.id} className={cn('flex', m.author === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[85%] rounded-2xl px-4 py-3 text-sm', m.author === 'user' ? 'rounded-br-md bg-brand-600 text-white dark:bg-brand-500 dark:text-brand-950' : m.author === 'system' ? 'border border-dashed border-line bg-surface-2 text-muted' : 'rounded-bl-md bg-surface-3')}>
                <p className={cn('mb-1 text-xs font-semibold', m.author === 'user' ? 'text-white/80 dark:text-brand-950/70' : 'text-muted')}>{m.authorName}</p>
                <p className="whitespace-pre-wrap">{m.body}</p>
                <p className={cn('mt-1.5 text-[11px]', m.author === 'user' ? 'text-white/70 dark:text-brand-950/60' : 'text-subtle')}>
                  <TimeAgo iso={m.createdAt} />
                </p>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>
      {!closed ? (
        <Card>
          <CardBody className="space-y-3">
            <Textarea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t.status === 'resolved' ? 'Reply to reopen this ticket…' : 'Write a reply…'} rows={4} />
            <div className="flex items-center justify-between gap-3">
              <button
                className="text-sm text-muted hover:text-fg"
                onClick={async () => {
                  await api(`/support/tickets/${t.id}/close`, { body: {} });
                  await qc.invalidateQueries({ queryKey: qk.ticket(id) });
                }}
              >
                Close ticket
              </button>
              <Button
                disabled={!msg.trim()}
                loading={sending}
                onClick={async () => {
                  setSending(true);
                  try {
                    await api(`/support/tickets/${t.id}/messages`, { body: { message: msg } });
                    setMsg('');
                    await qc.invalidateQueries({ queryKey: qk.ticket(id) });
                  } catch (err) {
                    toast({ title: errorMessage(err), tone: 'danger' });
                  } finally {
                    setSending(false);
                  }
                }}
              >
                <Send className="h-4 w-4" /> Send
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : (
        <Alert tone="info">
          This ticket is closed.{' '}
          <Link href="/app/support/new" className="font-semibold underline">
            Open a new one
          </Link>{' '}
          if you need more help.
        </Alert>
      )}
    </div>
  );
}
