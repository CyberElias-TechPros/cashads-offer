'use client';

import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { EmptyState, Skeleton } from '@/components/ui/feedback';
import { TimeAgo } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { qk, useNotifications } from '@/lib/queries';
import { cn } from '@/lib/utils';

const ICONS: Record<string, string> = { credit: '💵', pending_released: '🔓', payout: '💸', claim: '🔎', referral: '🤝', achievement: '🏆', tier: '⭐', security: '🔐', support: '💬', reversal: '↩️', system: '📣' };

export default function NotificationsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useNotifications();
  const unread = data?.filter((n) => !n.readAt).length ?? 0;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="We only notify you about things that matter: money in, money out and account safety."
        action={
          unread > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                await api('/notifications/read', { body: { all: true } });
                await Promise.all([qc.invalidateQueries({ queryKey: qk.notifications }), qc.invalidateQueries({ queryKey: qk.me })]);
              }}
            >
              Mark all as read
            </Button>
          )
        }
      />
      <Card className="overflow-hidden">
        {isLoading && (
          <div className="space-y-2 p-5">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        )}
        {data?.length === 0 && <EmptyState className="m-5" icon={<Bell className="h-5 w-5" />} title="Nothing yet" />}
        <ul className="divide-y divide-line">
          {data?.map((n) => (
            <li key={n.id}>
              <Link href={n.link ?? '#'} className={cn('flex gap-3 px-5 py-4 hover:bg-surface-2', !n.readAt && 'bg-brand-50/40 dark:bg-brand-500/5')}>
                <span className="text-xl">{ICONS[n.type] ?? '📣'}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{n.title}</p>
                  <p className="text-sm text-muted">{n.body}</p>
                  <TimeAgo iso={n.createdAt} className="text-xs text-subtle" />
                </div>
                {!n.readAt && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
