import { ArrowUpRight, Clock, Flame, ShieldCheck } from 'lucide-react';

/** Static product illustration (pure CSS) — no images, works in data-saver mode. */
export function HeroMockup() {
  const offers = [
    { icon: '📝', title: 'Share your streaming habits', meta: '5 min · Survey', pay: '$0.72', rate: '$8.64/h' },
    { icon: '🗣️', title: 'Finish 3 lessons on Lingoleap', meta: '14 min · App trial', pay: '$2.10', rate: '$9.00/h' },
    { icon: '💳', title: 'Open a NovaBank account', meta: '15 min · Finance', pay: '$24.00', rate: '$96.00/h' },
  ];
  return (
    <div className="relative mx-auto w-full max-w-[380px]">
      <div className="decorative absolute -inset-10 -z-10 rounded-full bg-gradient-to-tr from-brand-400/30 via-emerald-300/10 to-sky-400/20 blur-3xl" />
      <div className="rounded-[2.4rem] border border-line bg-surface p-3 shadow-lift">
        <div className="overflow-hidden rounded-[1.9rem] border border-line bg-bg">
          <div className="bg-gradient-to-br from-brand-600 to-emerald-800 px-5 pb-6 pt-5 text-white">
            <div className="flex items-center justify-between text-xs text-white/70">
              <span>Available balance</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5">
                <Flame className="h-3 w-3" /> 6-day streak
              </span>
            </div>
            <p className="tabular mt-1 text-4xl font-extrabold tracking-tight">$14.73</p>
            <p className="mt-1 text-xs text-white/70">+ $24.00 pending · unlocks in 18h</p>
            <div className="mt-4 flex gap-2">
              <span className="flex-1 rounded-xl bg-white py-2 text-center text-sm font-bold text-brand-800">Cash out now</span>
              <span className="rounded-xl bg-white/15 px-3 py-2 text-sm font-semibold">No minimum</span>
            </div>
          </div>
          <div className="space-y-2.5 p-3">
            <p className="px-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted">Best hourly rate for you</p>
            {offers.map((o) => (
              <div key={o.title} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-3 text-lg">{o.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{o.title}</p>
                  <p className="text-xs text-muted">{o.meta}</p>
                </div>
                <div className="text-right">
                  <p className="tabular text-sm font-bold text-brand-700 dark:text-brand-400">{o.pay}</p>
                  <p className="tabular text-[11px] text-subtle">{o.rate}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="decorative absolute -left-10 top-[118px] hidden animate-float rounded-2xl border border-line bg-surface px-4 py-3 shadow-lift sm:block lg:-left-16 xl:-left-24">
        <p className="text-xs text-muted">Survey completed</p>
        <p className="tabular text-lg font-extrabold text-brand-600">+$0.72</p>
      </div>
      <div className="decorative absolute -right-10 top-[58px] hidden animate-float rounded-2xl border border-line bg-surface px-4 py-3 shadow-lift [animation-delay:1.2s] sm:block lg:-right-14 xl:-right-24">
        <p className="flex items-center gap-1 text-xs text-muted">
          <Clock className="h-3 w-3" /> PayPal · paid in 1m 14s
        </p>
        <p className="tabular flex items-center gap-1 text-lg font-extrabold">
          $5.00 <ArrowUpRight className="h-4 w-4 text-brand-600" />
        </p>
      </div>
      <div className="decorative absolute -bottom-5 left-1/2 hidden -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium shadow-soft sm:flex">
        <ShieldCheck className="h-3.5 w-3.5 text-brand-600" /> Paid even if tracking fails
      </div>
    </div>
  );
}
