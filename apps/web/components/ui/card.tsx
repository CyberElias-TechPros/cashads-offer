import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-2xl border border-line bg-surface shadow-soft', className)} {...props} />;
}

export function CardHeader({ title, description, action, className, icon }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-5 pt-5 sm:px-6 sm:pt-6', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">{icon}</div>}
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-tight">{title}</h3>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-5 sm:px-6', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center justify-between gap-3 border-t border-line px-5 py-4 sm:px-6', className)} {...props} />;
}

export function PageHeader({ title, description, action, back }: { title: ReactNode; description?: ReactNode; action?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && <div className="mb-2">{back}</div>}
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted sm:text-base">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, icon, className, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: ReactNode; className?: string; tone?: 'brand' | 'amber' | 'default' }) {
  return (
    <div className={cn('rounded-2xl border border-line bg-surface p-4 shadow-soft sm:p-5', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        {icon && <span className={cn('text-muted', tone === 'brand' && 'text-brand-600 dark:text-brand-400', tone === 'amber' && 'text-amber-600')}>{icon}</span>}
      </div>
      <p className="tabular mt-2 text-2xl font-bold tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}
