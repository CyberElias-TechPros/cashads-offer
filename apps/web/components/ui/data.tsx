import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from './feedback';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
}

export function DataTable<T>({
  rows,
  columns,
  loading,
  empty,
  onRowClick,
  rowKey,
  className,
}: {
  rows: T[] | undefined;
  columns: Column<T>[];
  loading?: boolean;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  rowKey: (row: T) => string;
  className?: string;
}) {
  return (
    <div className={cn('overflow-x-auto rounded-2xl border border-line bg-surface shadow-soft', className)}>
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">
            {columns.map((c) => (
              <th key={c.key} className={cn('px-4 py-3 font-semibold', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {loading &&
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key} className="px-4 py-3.5">
                    <Skeleton className="h-4 w-full max-w-[140px]" />
                  </td>
                ))}
              </tr>
            ))}
          {!loading &&
            rows?.map((row) => (
              <tr key={rowKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined} className={cn('transition-colors', onRowClick && 'cursor-pointer hover:bg-surface-2')}>
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-4 py-3 align-middle', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
      {!loading && rows && rows.length === 0 && <div className="p-8 text-center text-sm text-muted">{empty ?? 'Nothing here yet.'}</div>}
    </div>
  );
}

/** Minimal dependency-free charts. */
export function BarChart({ data, height = 160, format, colors = ['#10b981', '#0ea5e9', '#f59e0b'], series }: { data: Array<{ label: string; values: number[] }>; height?: number; format?: (v: number) => string; colors?: string[]; series?: string[] }) {
  const max = Math.max(1, ...data.flatMap((d) => d.values));
  const n = data[0]?.values.length ?? 1;
  return (
    <div>
      <div className="flex items-end gap-[3px]" style={{ height }}>
        {data.map((d) => (
          <div key={d.label} className="group relative flex h-full flex-1 items-end gap-px" title={`${d.label}: ${d.values.map((v) => (format ? format(v) : v)).join(' / ')}`}>
            {d.values.map((v, i) => (
              <div key={i} className="flex-1 rounded-t-[3px] opacity-85 transition-opacity group-hover:opacity-100" style={{ height: `${Math.max(1.5, (v / max) * 100)}%`, background: colors[i % colors.length], minWidth: 2 / n }} />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-subtle">
        <span>{data[0]?.label}</span>
        <span>{data[Math.floor(data.length / 2)]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
      {series && (
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
          {series.map((s, i) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colors[i % colors.length] }} />
              {s}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function Sparkline({ values, className, color = '#10b981' }: { values: number[]; className?: string; color?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${100 - ((v - min) / (max - min || 1)) * 100}`).join(' ');
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={cn('h-10 w-full', className)} aria-hidden>
      <polyline points={`0,100 ${pts} 100,100`} fill={color} fillOpacity="0.12" stroke="none" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
