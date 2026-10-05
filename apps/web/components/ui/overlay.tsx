'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useUi } from '@/lib/store';

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && panel.current) {
        const focusable = panel.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    setTimeout(() => panel.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus(), 30);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open || !mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panel}
        className={cn(
          'relative max-h-[92vh] w-full animate-slide-up overflow-y-auto rounded-t-3xl border border-line bg-surface shadow-lift sm:rounded-3xl',
          size === 'sm' ? 'sm:max-w-md' : size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg',
        )}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div>
            {title && <h2 className="text-lg font-semibold">{title}</h2>}
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          <button onClick={onClose} className="-mr-2 -mt-1 rounded-lg p-2 text-muted hover:bg-surface-3 hover:text-fg" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="flex flex-col-reverse gap-2 border-t border-line px-6 py-4 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Dropdown({ trigger, children, align = 'right', className }: { trigger: ReactNode; children: ReactNode; align?: 'left' | 'right'; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen((v) => !v)}>{trigger}</div>
      {open && (
        <div
          className={cn('absolute z-50 mt-2 min-w-56 animate-slide-up rounded-2xl border border-line bg-surface p-1.5 shadow-lift', align === 'right' ? 'right-0' : 'left-0', className)}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ href, onClick, children, icon, danger }: { href?: string; onClick?: () => void; children: ReactNode; icon?: ReactNode; danger?: boolean }) {
  const cls = cn('flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-surface-3', danger ? 'text-rose-600' : 'text-fg');
  if (href)
    return (
      <Link href={href} className={cls}>
        {icon}
        {children}
      </Link>
    );
  return (
    <button onClick={onClick} className={cls}>
      {icon}
      {children}
    </button>
  );
}

export function Toaster() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[90] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end sm:pr-6" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex w-full max-w-sm animate-slide-up items-start gap-3 rounded-2xl border bg-surface p-4 shadow-lift',
            t.tone === 'danger' ? 'border-rose-300 dark:border-rose-500/40' : t.tone === 'success' || t.tone === 'brand' ? 'border-brand-300 dark:border-brand-500/40' : 'border-line',
          )}
        >
          <div className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', t.tone === 'danger' ? 'bg-rose-500' : t.tone === 'warning' ? 'bg-amber-500' : 'bg-brand-500')} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{t.title}</p>
            {t.description && <p className="mt-0.5 text-sm text-muted">{t.description}</p>}
            {t.action && (
              <Link href={t.action.href} className="mt-1.5 inline-block text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300" onClick={() => dismiss(t.id)}>
                {t.action.label} →
              </Link>
            )}
          </div>
          <button onClick={() => dismiss(t.id)} className="rounded-md p-1 text-subtle hover:text-fg" aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
