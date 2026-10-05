'use client';

import Link from 'next/link';
import { useEffect, useMemo } from 'react';
import { Clock, PartyPopper } from 'lucide-react';
import { formatMoney, timeUntil } from '@cashads/shared';
import { useUi } from '@/lib/store';

const COLORS = ['#10b981', '#34d399', '#fbbf24', '#38bdf8', '#f472b6', '#a78bfa'];

/**
 * The moment of reward. Instant, visual, and it immediately suggests the next
 * action — the habit loop described in the product brief.
 */
export function RewardCelebration() {
  const c = useUi((s) => s.celebration);
  const clear = useUi((s) => s.clearCelebration);
  useEffect(() => {
    if (!c) return;
    const t = setTimeout(clear, c.source === 'video' ? 2600 : 6000);
    return () => clearTimeout(t);
  }, [c, clear]);
  const pieces = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => ({
        dx: `${Math.cos((i / 26) * Math.PI * 2) * (120 + Math.random() * 90)}px`,
        dy: `${Math.sin((i / 26) * Math.PI * 2) * (120 + Math.random() * 90) - 40}px`,
        rot: `${Math.random() * 720 - 360}deg`,
        color: COLORS[i % COLORS.length],
        delay: `${Math.random() * 120}ms`,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c?.id],
  );
  if (!c) return null;
  const pending = c.status === 'pending';
  const isVideo = c.source === 'video';

  if (isVideo) {
    return (
      <div className="pointer-events-none fixed inset-x-0 top-20 z-[85] flex justify-center px-4">
        <div className="animate-pop rounded-full border border-brand-300 bg-surface px-5 py-2.5 shadow-lift dark:border-brand-500/40">
          <span className="tabular text-lg font-extrabold text-brand-600 dark:text-brand-400">+{formatMoney(c.amountMicros)}</span>
          <span className="ml-2 text-sm text-muted">added to your balance</span>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center p-4" role="dialog" aria-label="Reward">
      <div className="absolute inset-0 animate-fade-in bg-black/40 backdrop-blur-sm" onClick={clear} />
      <div className="relative w-full max-w-sm animate-pop rounded-3xl border border-line bg-surface p-8 text-center shadow-lift">
        <div className="decorative pointer-events-none absolute left-1/2 top-16">
          {pieces.map((p, i) => (
            <span
              key={i}
              className="absolute h-2.5 w-1.5 animate-confetti rounded-sm"
              style={{ background: p.color, ['--dx' as string]: p.dx, ['--dy' as string]: p.dy, ['--rot' as string]: p.rot, animationDelay: p.delay }}
            />
          ))}
        </div>
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
          {pending ? <Clock className="h-8 w-8" /> : <PartyPopper className="h-8 w-8" />}
        </div>
        <p className="tabular mt-5 font-display text-5xl font-extrabold tracking-tight text-brand-600 dark:text-brand-400">+{formatMoney(c.amountMicros)}</p>
        <p className="mt-2 font-semibold">{c.title}</p>
        <p className="mt-1 text-sm text-muted">
          {pending && c.availableAt ? `Safety hold — available ${timeUntil(c.availableAt)}. We’ll notify you.` : 'Available now. Cash out anytime — no minimum.'}
        </p>
        <div className="mt-6 grid gap-2">
          <Link href="/app/earn" onClick={clear} className="flex h-11 items-center justify-center rounded-xl bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 dark:bg-brand-500 dark:text-brand-950">
            Find my next offer
          </Link>
          <Link href="/app/cashout" onClick={clear} className="flex h-11 items-center justify-center rounded-xl border border-line text-sm font-semibold hover:bg-surface-2">
            Cash out
          </Link>
        </div>
      </div>
    </div>
  );
}
