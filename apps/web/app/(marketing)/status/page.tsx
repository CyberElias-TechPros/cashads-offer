'use client';

import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { formatDuration } from '@cashads/shared';
import { Skeleton } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { usePublicStats } from '@/lib/queries';
import { pct } from '@/lib/utils';

export default function StatusPage() {
  const { data: health, isError } = useQuery({ queryKey: ['health'], queryFn: () => api<{ status: string; db: string; uptimeSeconds: number }>('/health'), refetchInterval: 15_000 });
  const { data: stats } = usePublicStats();
  const ok = health?.status === 'ok' && !isError;
  const rows: Array<[string, boolean | null, string]> = [
    ['Website & app', !isError, 'Serving requests'],
    ['API', health ? health.status === 'ok' : null, health ? `Up for ${formatDuration(health.uptimeSeconds)}` : 'Checking…'],
    ['Database', health ? health.db === 'ok' : null, 'Ledger reads & writes'],
    ['Partner postbacks', stats ? (stats.trackingSuccessRate ?? 1) >= 0.95 : null, stats ? `${pct(stats.trackingSuccessRate, 1)} credited (30d)` : 'Checking…'],
    ['Cash outs', stats ? true : null, stats ? `Median ${formatDuration(stats.medianPayoutSeconds)}` : 'Checking…'],
  ];
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="font-display text-4xl font-extrabold tracking-tight">System status</h1>
      {!health && !isError ? (
        <Skeleton className="mt-8 h-20 rounded-2xl" />
      ) : (
        <div className={`mt-8 flex items-center gap-3 rounded-2xl p-5 ${ok ? 'bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-300' : 'bg-rose-50 text-rose-800 dark:bg-rose-500/10'}`}>
          {ok ? <CheckCircle2 className="h-6 w-6" /> : <XCircle className="h-6 w-6" />}
          <p className="text-lg font-semibold">{ok ? 'All systems operational' : 'We’re having issues — payouts are queued safely and will resume automatically'}</p>
        </div>
      )}
      <div className="mt-6 divide-y divide-line rounded-2xl border border-line bg-surface">
        {rows.map(([name, up, detail]) => (
          <div key={name} className="flex items-center justify-between px-5 py-4 text-sm">
            <span className="font-medium">{name}</span>
            <span className="flex items-center gap-2 text-muted">
              {detail}
              <span className={`h-2.5 w-2.5 rounded-full ${up === null ? 'bg-slate-300' : up ? 'bg-brand-500' : 'bg-rose-500'}`} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
