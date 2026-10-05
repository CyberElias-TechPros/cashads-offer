'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { formatLocal, formatMoney, timeAgo, type Micros } from '@cashads/shared';
import { cn, initials } from '@/lib/utils';

/** Real money, honestly formatted (sub-cent amounts keep their digits). */
export function Money({ micros, className, signed, precise, local, animate }: { micros: Micros; className?: string; signed?: boolean; precise?: boolean; local?: { code: string; rate: number } | null; animate?: boolean }) {
  const shown = useAnimatedNumber(micros, animate ?? false);
  return (
    <span className={cn('tabular', className)} title={formatMoney(micros, { precise: true })}>
      {formatMoney(shown, { signed, precise })}
      {local && <span className="ml-1.5 text-[0.7em] font-medium text-muted">≈ {formatLocal(micros, local.rate, local.code)}</span>}
    </span>
  );
}

export function useAnimatedNumber(target: number, enabled: boolean, durationMs = 900): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (!enabled || from.current === target || (typeof document !== 'undefined' && document.documentElement.classList.contains('data-saver'))) {
      from.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(a + (target - a) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled, durationMs]);
  return value;
}

export function TimeAgo({ iso, className }: { iso: string; className?: string }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString()} className={className} suppressHydrationWarning>
      {timeAgo(iso)}
    </time>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span
      className={cn('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white', className)}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 65% 45%), hsl(${(hue + 40) % 360} 70% 38%))` }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function CopyButton({ value, label = 'Copy', className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = value;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-500/10', className)}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : label}
    </button>
  );
}

export function QrCode({ value, size = 168, className }: { value: string; size?: number; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(value, { margin: 1, width: size * 2, color: { dark: '#0b1611', light: '#ffffff' } })
      .then(setSrc)
      .catch(() => setSrc(null));
  }, [value, size]);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} width={size} height={size} alt="QR code" className={cn('rounded-xl border border-line bg-white p-2', className)} />
  ) : (
    <div className="skeleton" style={{ width: size, height: size }} />
  );
}

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-display text-lg font-extrabold tracking-tight', className)}>
      <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-brand-500 to-emerald-700 text-white shadow-glow">
        <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M16 7.5c-.8-1.2-2.3-2-4-2-2.5 0-4 1.3-4 3s1.5 2.6 4 3.2 4 1.5 4 3.3-1.6 3-4 3c-1.8 0-3.3-.8-4.1-2.1" />
          <path d="M12 3.5v2M12 18.5v2" />
        </svg>
      </span>
      {!compact && (
        <span>
          Cash<span className="text-brand-600 dark:text-brand-400">Ads</span>
        </span>
      )}
    </span>
  );
}

export function KeyValue({ items, className }: { items: Array<[ReactNode, ReactNode]>; className?: string }) {
  return (
    <dl className={cn('divide-y divide-line', className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-2.5 text-sm">
          <dt className="text-muted">{k}</dt>
          <dd className="text-right font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Timeline({ items }: { items: Array<{ label: ReactNode; at?: string; tone?: 'done' | 'current' | 'error' | 'todo'; detail?: ReactNode }> }) {
  return (
    <ol className="relative space-y-5">
      {items.map((it, i) => (
        <li key={i} className="relative flex gap-3">
          {i < items.length - 1 && <span className="absolute left-[11px] top-6 h-[calc(100%+4px)] w-px bg-line" aria-hidden />}
          <span
            className={cn(
              'relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-4 ring-surface',
              it.tone === 'error' ? 'bg-rose-500' : it.tone === 'current' ? 'bg-amber-400' : it.tone === 'todo' ? 'bg-line-strong' : 'bg-brand-500',
            )}
          >
            {it.tone === 'current' ? <span className="h-2 w-2 animate-ping-slow rounded-full bg-white" /> : <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
          </span>
          <div className="min-w-0 pb-0.5">
            <p className="text-sm font-medium">{it.label}</p>
            {it.detail && <p className="text-sm text-muted">{it.detail}</p>}
            {it.at && <p className="mt-0.5 text-xs text-subtle">{new Date(it.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
