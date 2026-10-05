import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { FlaskConical } from 'lucide-react';
import { useConfig, useMoney } from '../lib/queries';
import { cn } from '../lib/utils';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('size-8', className)} aria-hidden>
      <defs>
        <linearGradient id="ca-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#10b981" />
          <stop offset="1" stopColor="#047857" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#ca-g)" />
      <path
        d="M44.5 22.5A15 15 0 1 0 44.5 41.5"
        fill="none"
        stroke="#fff"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <circle cx="45" cy="32" r="4.5" fill="#fde68a" />
    </svg>
  );
}

export function Logo({ to = '/', className }: { to?: string; className?: string }) {
  return (
    <Link
      to={to}
      className={cn(
        'flex items-center gap-2 font-bold tracking-tight text-slate-900 dark:text-white',
        className,
      )}
      aria-label="Lucrum home"
    >
      <LogoMark />
      <span className="text-lg">
        Cash<span className="text-brand-600 dark:text-brand-400">Ads</span>
      </span>
    </Link>
  );
}

/** Counts up smoothly when the value changes (skipped for reduced motion). */
export function useAnimatedNumber(target: number, durationMs = 700): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const reduce =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.documentElement.classList.contains('reduce-motion');
    if (reduce || from.current === target) {
      from.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    const initial = from.current;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(initial + (target - initial) * eased));
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

/** Real money with the member's local currency underneath — never points. */
export function Money({
  micros,
  size = 'md',
  showLocal = true,
  floor = false,
  animate = false,
  className,
  signed = false,
}: {
  micros: number;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showLocal?: boolean;
  floor?: boolean;
  animate?: boolean;
  className?: string;
  signed?: boolean;
}) {
  const m = useMoney();
  const animated = useAnimatedNumber(micros);
  const shown = animate ? animated : micros;
  const sizes = { sm: 'text-sm', md: 'text-base', lg: 'text-2xl', xl: 'text-4xl sm:text-5xl' };
  const local = showLocal ? m.local(shown) : '';
  return (
    <span className={cn('inline-flex flex-col', className)}>
      <span className={cn('tabular font-semibold tracking-tight', sizes[size])}>
        {m.usd(shown, { floor, signed })}
      </span>
      {local && (
        <span className="tabular text-xs font-normal text-slate-500 dark:text-slate-400">≈ {local}</span>
      )}
    </span>
  );
}

export function SandboxBanner() {
  const { data } = useConfig();
  if (!data?.sandbox) return null;
  return (
    <div className="relative z-40 flex items-center justify-center gap-2 bg-slate-900 px-4 py-1.5 text-center text-xs font-medium text-slate-200 dark:bg-black">
      <FlaskConical className="size-3.5 text-amber-300" />
      <span>
        <strong className="text-amber-300">Sandbox mode</strong> — offers, networks and payouts are simulated.
        No real money moves.{' '}
        <Link to="/dev/inbox" className="underline decoration-dotted underline-offset-2 hover:text-white">
          Dev inbox
        </Link>
      </span>
    </div>
  );
}
