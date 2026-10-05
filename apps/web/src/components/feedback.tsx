import { CircleCheck, CircleX, Info, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { formatUsd } from '@lucrum/shared';
import { useMe } from '../lib/queries';
import { cn } from '../lib/utils';
import { useUI } from '../store/ui';

export function Toaster() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismiss);
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-3 z-[90] flex flex-col items-center gap-2 px-3 sm:bottom-6 sm:left-auto sm:right-6 sm:top-auto sm:items-end"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const Icon =
          t.tone === 'success'
            ? CircleCheck
            : t.tone === 'error'
              ? CircleX
              : t.tone === 'reward'
                ? Sparkles
                : Info;
        return (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex w-full max-w-sm animate-slide-up items-start gap-3 rounded-2xl border bg-white/95 p-4 shadow-xl shadow-slate-900/10 backdrop-blur dark:bg-slate-900/95',
              t.tone === 'error'
                ? 'border-rose-200 dark:border-rose-900'
                : 'border-slate-200 dark:border-slate-800',
            )}
          >
            <Icon
              className={cn(
                'mt-0.5 size-5 shrink-0',
                t.tone === 'success' || t.tone === 'reward'
                  ? 'text-brand-600'
                  : t.tone === 'error'
                    ? 'text-rose-600'
                    : 'text-sky-600',
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">{t.title}</p>
              {t.body && (
                <p className="mt-0.5 line-clamp-3 text-sm text-slate-500 dark:text-slate-400">{t.body}</p>
              )}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="text-slate-400 hover:text-slate-700"
              aria-label="Dismiss"
            >
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

const COLORS = ['#10b981', '#f59e0b', '#3b82f6', '#ec4899', '#8b5cf6', '#fde68a'];

/** "+$2.40" reward moment. Confetti only when motion and data allowances permit. */
export function Celebrations() {
  const celebrations = useUI((s) => s.celebrations);
  const { data: me } = useMe();
  const quiet = Boolean(me?.prefs.reduceMotion || me?.prefs.dataSaver);
  return (
    <>
      {celebrations.map((c) => (
        <Celebration key={c.id} amountMicros={c.amountMicros} title={c.title} confetti={!quiet} />
      ))}
    </>
  );
}

function Celebration({
  amountMicros,
  title,
  confetti,
}: {
  amountMicros: number;
  title: string;
  confetti: boolean;
}) {
  const pieces = useMemo(
    () =>
      Array.from({ length: confetti ? 36 : 0 }, (_, i) => ({
        left: `${Math.random() * 100}%`,
        color: COLORS[i % COLORS.length],
        delay: `${Math.random() * 0.3}s`,
        dx: `${(Math.random() - 0.5) * 160}px`,
        rot: `${Math.random() * 720 - 360}deg`,
      })),
    [confetti],
  );
  useEffect(() => {
    if ('vibrate' in navigator && amountMicros >= 100_000) navigator.vibrate?.(30);
  }, [amountMicros]);
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[95] flex items-start justify-center pt-24"
      aria-live="assertive"
    >
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            left: p.left,
            background: p.color,
            animationDelay: p.delay,
            ['--dx' as string]: p.dx,
            ['--rot' as string]: p.rot,
          }}
        />
      ))}
      <div className="animate-pop rounded-3xl bg-slate-900 px-6 py-4 text-center text-white shadow-2xl shadow-brand-900/30 dark:bg-white dark:text-slate-900">
        <p className="tabular text-3xl font-bold tracking-tight text-brand-400 dark:text-brand-600">
          +{formatUsd(amountMicros)}
        </p>
        <p className="mt-0.5 max-w-xs truncate text-sm opacity-80">{title}</p>
      </div>
    </div>
  );
}
