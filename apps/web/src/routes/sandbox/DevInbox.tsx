import { useQuery } from '@tanstack/react-query';
import { Inbox, Mail, MessageSquare, RefreshCw } from 'lucide-react';
import { Link } from 'react-router';
import { Logo } from '../../components/brand';
import { Badge, Button, Callout, Card, EmptyState } from '../../components/ui';
import { get } from '../../lib/api';
import { timeAgo } from '../../lib/utils';

interface OutboundMessage {
  id: string;
  channel: 'email' | 'sms';
  to: string;
  subject: string | null;
  body: string;
  meta: { link?: string } | null;
  createdAt: string;
}

/** Sandbox-only: every email and SMS the platform "sends", so verification flows are testable. */
export function DevInbox() {
  const { data, refetch, isFetching, error } = useQuery({
    queryKey: ['dev-inbox'],
    queryFn: () => get<OutboundMessage[]>('/dev/inbox'),
    refetchInterval: 4000,
  });
  const linkify = (text: string) =>
    text.split(/(https?:\/\/\S+)/g).map((part, i) =>
      /^https?:\/\//.test(part) ? (
        <a key={i} href={part} className="break-all font-medium text-brand-700 underline dark:text-brand-400">
          {part}
        </a>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <Logo />
          <Link to="/app" className="text-sm font-semibold text-brand-700 dark:text-brand-400">
            Back to app →
          </Link>
        </div>
        <div className="mb-4 flex items-center justify-between">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Inbox className="size-6" /> Developer inbox
          </h1>
          <Button variant="outline" size="sm" onClick={() => refetch()} loading={isFetching}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        </div>
        <Callout tone="warning" className="mb-5">
          Sandbox only. Emails (verification, password reset, payout receipts) and SMS codes appear here
          instead of being delivered. Never enable sandbox mode with real users.
        </Callout>
        {error && <Callout tone="danger">The inbox is only available in sandbox mode.</Callout>}
        {data?.length === 0 && (
          <EmptyState
            icon="📭"
            title="No messages yet"
            body="Sign up or request a code and it will show up here within seconds."
          />
        )}
        <div className="space-y-3">
          {data?.map((m) => (
            <Card key={m.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  {m.channel === 'email' ? (
                    <Mail className="size-4 text-sky-600" />
                  ) : (
                    <MessageSquare className="size-4 text-emerald-600" />
                  )}
                  {m.subject ?? 'SMS'}
                </p>
                <span className="text-xs text-slate-500">
                  <Badge>{m.channel}</Badge> to {m.to} · {timeAgo(m.createdAt)}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
                {linkify(m.body)}
              </p>
              {m.meta?.link && (
                <a
                  href={m.meta.link}
                  className="mt-3 inline-block rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
                >
                  Open link
                </a>
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
