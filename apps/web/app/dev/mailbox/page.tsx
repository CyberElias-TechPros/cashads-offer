'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Inbox, MessageSquareText, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { Logo, TimeAgo } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Msg {
  id: string;
  channel: 'email' | 'sms';
  to: string;
  subject: string | null;
  text: string;
  html: string | null;
  template: string;
  status: string;
  createdAt: string;
}

/** Demo-only inbox: every email & SMS the platform "sends" lands here (no real delivery provider configured). */
export default function DevMailboxPage() {
  const { data, error, refetch, isFetching } = useQuery({ queryKey: ['dev-outbox'], queryFn: () => api<Msg[]>('/dev/outbox'), refetchInterval: 3000 });
  const [selected, setSelected] = useState<string | null>(null);
  const msg = data?.find((m) => m.id === selected) ?? data?.[0];
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/app">
            <Logo />
          </Link>
          <div className="flex items-center gap-3">
            <Badge tone="warning">Dev mailbox · demo only</Badge>
            <Button size="sm" variant="secondary" onClick={() => void refetch()} loading={isFetching}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-6">
        {error ? (
          <Alert tone="danger">{errorMessage(error)}</Alert>
        ) : data?.length === 0 ? (
          <EmptyState icon={<Inbox className="h-5 w-5" />} title="No messages yet" description="Sign up, request a password reset or verify a phone number — messages appear here within a second." />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
            <ul className="max-h-[80vh] divide-y divide-line overflow-y-auto rounded-2xl border border-line bg-surface">
              {data?.map((m) => (
                <li key={m.id}>
                  <button onClick={() => setSelected(m.id)} className={cn('block w-full px-4 py-3 text-left hover:bg-surface-2', msg?.id === m.id && 'bg-brand-50/60 dark:bg-brand-500/5')}>
                    <div className="flex items-center gap-2">
                      {m.channel === 'sms' ? <MessageSquareText className="h-4 w-4 text-sky-600" /> : <Inbox className="h-4 w-4 text-brand-600" />}
                      <span className="truncate text-sm font-medium">{m.channel === 'sms' ? `SMS to ${m.to}` : m.subject}</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {m.to} · <TimeAgo iso={m.createdAt} />
                    </p>
                  </button>
                </li>
              ))}
            </ul>
            {msg && (
              <div className="overflow-hidden rounded-2xl border border-line bg-surface">
                <div className="border-b border-line px-5 py-4">
                  <p className="font-semibold">{msg.subject ?? 'SMS message'}</p>
                  <p className="text-xs text-muted">
                    To {msg.to} · template <code>{msg.template}</code>
                  </p>
                </div>
                {msg.html ? (
                  <iframe title="Email preview" srcDoc={msg.html} sandbox="allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation" className="h-[70vh] w-full bg-white" />
                ) : (
                  <div className="p-6">
                    <p className="rounded-2xl bg-sky-50 p-4 font-mono text-lg dark:bg-sky-500/10">{msg.text}</p>
                  </div>
                )}
                {msg.html && (
                  <div className="border-t border-line px-5 py-3 text-xs text-muted">
                    Links:{' '}
                    {[...msg.text.matchAll(/https?:\/\/\S+/g)].map((m) => (
                      <a key={m[0]} href={m[0].replace(/^https?:\/\/[^/]+/, '')} className="mr-3 font-semibold text-brand-700 underline dark:text-brand-300">
                        {m[0].replace(/^https?:\/\/[^/]+/, '').slice(0, 48)}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
