'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const control =
  'w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-fg shadow-sm transition-colors placeholder:text-subtle hover:border-line-strong focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 disabled:opacity-60 aria-[invalid=true]:border-rose-500 aria-[invalid=true]:ring-rose-500/15';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...props }, ref) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cn(control, 'h-11', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ className, invalid, ...props }, ref) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={cn(control, 'min-h-28 py-3', className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select({ className, invalid, children, ...props }, ref) {
  return (
    <select ref={ref} aria-invalid={invalid || undefined} className={cn(control, 'h-11 appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-10', className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238a9891' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...props}>
      {children}
    </select>
  );
});

export function Field({ label, hint, error, children, className, htmlFor, optional }: { label?: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; htmlFor?: string; optional?: boolean }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="flex items-center justify-between text-sm font-medium">
          <span>{label}</span>
          {optional && <span className="text-xs font-normal text-subtle">Optional</span>}
        </label>
      )}
      {children}
      {error ? <p className="text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ label, checked, onChange, className, description }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; className?: string; description?: ReactNode }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn('flex cursor-pointer items-start gap-3 text-sm', className)}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-line-strong accent-emerald-600" />
      <span>
        <span>{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
      </span>
    </label>
  );
}

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; description?: ReactNode; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      {(label || description) && (
        <div className="min-w-0">
          {label && <p className="text-sm font-medium">{label}</p>}
          {description && <p className="text-xs text-muted">{description}</p>}
        </div>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50', checked ? 'bg-brand-600 dark:bg-brand-500' : 'bg-line-strong')}
      >
        <span className={cn('inline-block h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5.5' : 'translate-x-0.5')} />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className, size = 'md' }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: ReactNode }>; className?: string; size?: 'sm' | 'md' }) {
  return (
    <div className={cn('inline-flex rounded-xl border border-line bg-surface-2 p-1', className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-lg font-medium transition-all',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm',
            value === o.value ? 'bg-surface text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
