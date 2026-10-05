import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Check,
  CircleDollarSign,
  Clock,
  Gauge,
  HandCoins,
  Minus,
  ScanEye,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  COUNTRIES,
  FAQ,
  type OfferDTO,
  type PublicStatsDTO,
  formatLocal,
  formatUsd,
  getCountry,
  payoutMethodsForCountry,
} from '@lucrum/shared';
import { FeedTicker, OfferIcon, QualityBadge } from '../../components/earn';
import { ButtonLink, Chip } from '../../components/ui';
import { get } from '../../lib/api';
import { browserTimezone } from '../../lib/device';
import { useConfig, usePublicFeed } from '../../lib/queries';
import { cn, duration, minutesLabel, pct } from '../../lib/utils';
import { guessCountryFromTimezone } from '@lucrum/shared';

export function Landing() {
  const { data: stats } = useQuery({
    queryKey: ['public-stats'],
    queryFn: () => get<PublicStatsDTO>('/public/stats'),
  });
  const { data: feed = [] } = usePublicFeed(20);
  return (
    <div className="overflow-hidden">
      <Hero stats={stats} />
      <section className="border-y border-slate-200/70 bg-white/60 py-6 dark:border-slate-800/70 dark:bg-slate-900/40">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-brand-500" />
            </span>
            Real payouts, live from our database
          </p>
          <FeedTicker items={feed} />
        </div>
      </section>
      <Promises />
      <Comparison />
      <HowItWorksSteps />
      <LocalRails />
      <TransparencyBand stats={stats} />
      <FaqPreview />
      <FinalCta />
    </div>
  );
}

function Hero({ stats }: { stats?: PublicStatsDTO }) {
  const { data: config } = useConfig();
  return (
    <section className="relative">
      <div
        className="bg-grid absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]"
        aria-hidden
      />
      <div
        className="absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-gradient-to-br from-brand-300/40 via-teal-200/30 to-amber-100/30 blur-3xl dark:from-brand-700/20 dark:via-teal-800/10 dark:to-transparent"
        aria-hidden
      />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:pb-24 lg:pt-20">
        <div className="animate-slide-up">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-800 dark:border-brand-800 dark:bg-brand-950/60 dark:text-brand-300">
            <Sparkles className="size-3.5" /> Real cash · No points · No minimum
          </span>
          <h1 className="mt-5 text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl dark:text-white">
            Your spare minutes,{' '}
            <span className="bg-gradient-to-r from-brand-600 to-teal-500 bg-clip-text text-transparent dark:from-brand-400 dark:to-teal-300">
              paid in real money.
            </span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600 dark:text-slate-300">
            Short surveys, app trials and sign-ups from brands that want your attention. See exactly what each
            task pays <em>per hour</em> — then cash out from{' '}
            <strong className="text-slate-900 dark:text-white">$0.01</strong> to your bank, mobile money,
            airtime, PayPal or crypto.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <ButtonLink to="/signup" size="lg" className="group">
              Start earning — it’s free{' '}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </ButtonLink>
            <ButtonLink to="/transparency" size="lg" variant="outline">
              <ScanEye className="size-4" /> See the live numbers
            </ButtonLink>
          </div>
          <ul className="mt-8 grid max-w-xl grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <TrustChip
              icon={Clock}
              label="Median payout"
              value={stats?.medianPayoutSeconds ? duration(stats.medianPayoutSeconds) : '—'}
            />
            <TrustChip
              icon={BadgeCheck}
              label="Tasks tracked"
              value={stats?.postbackSuccessRate ? pct(stats.postbackSuccessRate, 1) : '—'}
            />
            <TrustChip
              icon={HandCoins}
              label="Revenue to you"
              value={config ? `${config.revenueSharePercent}%` : '60%'}
            />
          </ul>
          <p className="mt-6 text-xs text-slate-500">
            Free · 18+ · Available in {COUNTRIES.map((c) => c.flag).join(' ')}
          </p>
        </div>
        <PhoneMock />
      </div>
    </section>
  );
}

function TrustChip({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/70 px-3.5 py-2.5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/60">
      <Icon className="size-5 text-brand-600 dark:text-brand-400" />
      <div>
        <p className="tabular font-bold text-slate-900 dark:text-white">{value}</p>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
    </li>
  );
}

function PhoneMock() {
  const tasks = [
    { icon: '🛍️', title: 'Shopping habits 2026', pay: 750_000, mins: 6, color: '#0ea5e9' },
    { icon: '💸', title: 'Try SandboxPay: send ₦100', pay: 1_500_000, mins: 5, color: '#22c55e' },
    { icon: '👆', title: 'Tap test: pick a logo', pay: 150_000, mins: 0.75, color: '#a855f7' },
  ];
  return (
    <div
      className="relative mx-auto w-full max-w-[340px] animate-slide-up [animation-delay:120ms]"
      aria-hidden
    >
      <div className="absolute -left-12 top-[45%] z-10 hidden animate-float rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm shadow-xl sm:block dark:border-slate-700 dark:bg-slate-900">
        <p className="flex items-center gap-1.5 font-semibold text-brand-700 dark:text-brand-400">
          <Check className="size-4" /> Paid in 1m 52s
        </p>
        <p className="text-xs text-slate-500">₦3,060 to GTBank ••••6789</p>
      </div>
      <div className="absolute -right-8 bottom-24 z-10 hidden animate-float rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm shadow-xl [animation-delay:1.5s] sm:block dark:border-slate-700 dark:bg-slate-900">
        <p className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white">
          <ShieldCheck className="size-4 text-brand-600" /> Missing credit?
        </p>
        <p className="text-xs text-slate-500">We pay even when tracking fails</p>
      </div>
      <div className="rounded-[2.6rem] border border-slate-300 bg-slate-900 p-2.5 shadow-2xl shadow-slate-900/30 dark:border-slate-700">
        <div className="overflow-hidden rounded-[2.1rem] bg-slate-50 dark:bg-slate-950">
          <div className="flex justify-center pb-1 pt-2.5">
            <div className="h-5 w-24 rounded-full bg-slate-900" />
          </div>
          <div className="space-y-3 p-4">
            <div className="rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-4 text-white shadow-lg">
              <p className="text-xs text-brand-100">Available to cash out</p>
              <p className="tabular mt-1 text-3xl font-bold tracking-tight">$14.73</p>
              <p className="tabular text-xs text-brand-100">≈ ₦22,537 · no minimum</p>
              <div className="mt-3 flex gap-2">
                <span className="rounded-lg bg-white/20 px-2.5 py-1 text-xs font-semibold">Cash out</span>
                <span className="rounded-lg bg-white/10 px-2.5 py-1 text-xs">🔥 4-day streak</span>
              </div>
            </div>
            <div className="rounded-2xl bg-white p-3 shadow-sm dark:bg-slate-900">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-900 dark:text-white">Today’s plan · ~12 min</p>
                <p className="tabular text-xs font-semibold text-brand-700">$2.40</p>
              </div>
              <div className="space-y-2">
                {tasks.map((t) => (
                  <div key={t.title} className="flex items-center gap-2.5">
                    <span
                      className="flex size-8 items-center justify-center rounded-lg text-base"
                      style={{ background: `${t.color}22` }}
                    >
                      {t.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-slate-800 dark:text-slate-200">
                        {t.title}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {minutesLabel(t.mins)} ·{' '}
                        <span className="font-semibold text-brand-700">
                          {formatUsd(Math.round((t.pay * 60) / t.mins), { precision: 2 })}/hr
                        </span>
                      </p>
                    </div>
                    <span className="tabular text-xs font-bold text-slate-900 dark:text-white">
                      {formatUsd(t.pay)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2.5 rounded-2xl bg-slate-900 p-3 text-white shadow-lg dark:bg-white dark:text-slate-900">
              <span className="flex size-8 items-center justify-center rounded-full bg-brand-500 text-white">
                <Sparkles className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="tabular text-sm font-bold text-brand-400 dark:text-brand-600">
                  +$0.75 credited
                </p>
                <p className="truncate text-[11px] opacity-70">Shopping habits 2026 · confirmed in 3s</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const PROMISES = [
  {
    icon: CircleDollarSign,
    title: 'Real money, not points',
    body: 'Every task, bonus and balance is shown in dollars — plus your local currency. No exchange-rate puzzles.',
  },
  {
    icon: Banknote,
    title: 'No minimum cash-out',
    body: 'Withdraw $0.01 if you want. Provider fees are shown upfront and you decide.',
  },
  {
    icon: ShieldCheck,
    title: 'Paid even when tracking fails',
    body: 'Tap “Missing credit” — we check network logs automatically and pay trusted members on the spot.',
  },
  {
    icon: Gauge,
    title: 'The real hourly rate',
    body: 'Every task shows what it pays per hour — measured from real completions, not advertiser guesses.',
  },
  {
    icon: ScanEye,
    title: 'Public proof',
    body: 'Live payouts, postback success rate, payout times and the revenue share we actually paid.',
  },
];

function Promises() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-400">
          Five promises
        </p>
        <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          Built on the things other apps get wrong.
        </h2>
        <p className="mt-3 text-lg text-slate-600 dark:text-slate-400">
          Rewards apps lose people the same way: credits that never arrive, minimums you never reach, payouts
          that take weeks. We designed Lucrum the other way round.
        </p>
      </div>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PROMISES.map((p, i) => (
          <div
            key={p.title}
            className="group rounded-3xl border border-slate-200 bg-white p-6 transition hover:-translate-y-0.5 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex size-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 ring-1 ring-brand-100 dark:bg-brand-950 dark:text-brand-300 dark:ring-brand-900">
              <p.icon className="size-5" />
            </div>
            <p className="mt-4 text-xs font-semibold text-slate-400">0{i + 1}</p>
            <h3 className="mt-1 text-lg font-semibold">{p.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{p.body}</p>
          </div>
        ))}
        <div className="flex flex-col justify-between rounded-3xl bg-gradient-to-br from-slate-900 to-slate-800 p-6 text-white dark:from-brand-900 dark:to-slate-900">
          <div>
            <Zap className="size-6 text-amber-300" />
            <h3 className="mt-4 text-lg font-semibold">Try it in 60 seconds</h3>
            <p className="mt-2 text-sm text-slate-300">
              Answer a 20-second quick task, then cash out $0.05 to airtime or Lightning to see it land.
            </p>
          </div>
          <Link
            to="/signup"
            className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-amber-300 hover:text-amber-200"
          >
            Create a free account <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

const ROWS: [string, string, string][] = [
  ['Currency', 'Dollars + your local currency', 'Points / coins'],
  ['Minimum cash-out', '$0.01 (provider fees shown)', '$5 – $30'],
  ['Payout speed', 'Minutes — median shown live', '3 – 30 days'],
  ['Untracked task', 'Auto-checked; goodwill for trusted members', '“Clear your cookies”'],
  ['Revenue share', '60%, published & measured', 'Undisclosed'],
  ['Account restrictions', 'Specific reason + human appeal', '“Terms violation”'],
  ['Payout methods', 'Local rails: bank, MoMo, M-Pesa, UPI, Pix, airtime', 'PayPal & gift cards'],
];

function Comparison() {
  return (
    <section className="bg-white py-20 dark:bg-slate-900/40">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
          Lucrum vs. the typical rewards app
        </h2>
        <div className="mt-10 overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-800">
          <div className="grid grid-cols-[1fr_1.2fr_1fr] bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-900">
            <div className="p-4" />
            <div className="bg-brand-50 p-4 text-brand-800 dark:bg-brand-950/50 dark:text-brand-300">
              Lucrum
            </div>
            <div className="p-4">Typical app</div>
          </div>
          {ROWS.map(([label, ours, theirs]) => (
            <div
              key={label}
              className="grid grid-cols-[1fr_1.2fr_1fr] border-t border-slate-200 text-sm dark:border-slate-800"
            >
              <div className="p-4 font-medium text-slate-900 dark:text-white">{label}</div>
              <div className="flex items-start gap-2 bg-brand-50/50 p-4 text-slate-800 dark:bg-brand-950/20 dark:text-slate-200">
                <Check className="mt-0.5 size-4 shrink-0 text-brand-600" /> {ours}
              </div>
              <div className="flex items-start gap-2 p-4 text-slate-500">
                <X className="mt-0.5 size-4 shrink-0 text-rose-400" /> {theirs}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorksSteps() {
  const steps = [
    {
      n: '1',
      title: 'Pick a task that’s worth it',
      body: 'Every task shows payout, real duration, hourly rate, a quality grade and how much data it uses.',
    },
    {
      n: '2',
      title: 'Complete it — we verify server-to-server',
      body: 'The advertiser’s network confirms directly with us. Usually in seconds; you’ll see it land live.',
    },
    {
      n: '3',
      title: 'Cash out on rails that work where you live',
      body: 'Bank transfer, airtime, mobile money, UPI, Pix, PayPal, Lightning or USDT. From $0.01.',
    },
  ];
  return (
    <section id="how" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">How it works</h2>
      <div className="mt-10 grid gap-6 md:grid-cols-3">
        {steps.map((s) => (
          <div
            key={s.n}
            className="relative rounded-3xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white dark:bg-white dark:text-slate-900">
              {s.n}
            </span>
            <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function LocalRails() {
  const [country, setCountry] = useState(() => guessCountryFromTimezone(browserTimezone()));
  const { data: config } = useConfig();
  const c = getCountry(country);
  const methods = payoutMethodsForCountry(country);
  const { data: preview = [] } = useQuery({
    queryKey: ['offers-preview', country],
    queryFn: () => get<OfferDTO[]>(`/public/offers-preview?country=${country}`),
  });
  const rate = config?.fxRates[c.currency] ?? 1;
  return (
    <section id="preview" className="bg-slate-900 py-20 text-white dark:bg-black/40">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-brand-400">Region-first</p>
        <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          Offers and payouts that actually work in {c.name}.
        </h2>
        <div className="mt-6 flex gap-2 overflow-x-auto pb-2 scrollbar-none">
          {COUNTRIES.map((x) => (
            <button
              key={x.code}
              onClick={() => setCountry(x.code)}
              className={cn(
                'shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition',
                x.code === country
                  ? 'border-white bg-white text-slate-900'
                  : 'border-white/15 text-slate-300 hover:border-white/40',
              )}
            >
              {x.flag} {x.name}
            </button>
          ))}
        </div>
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <div>
            <h3 className="font-semibold text-slate-200">Cash out in {c.name}</h3>
            <div className="mt-3 grid gap-2.5">
              {methods.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3.5"
                >
                  <span className="text-2xl">{m.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {m.name} <span className="text-xs text-slate-400">· {m.provider}</span>
                    </p>
                    <p className="text-xs text-slate-400">{m.speed}</p>
                  </div>
                  <div className="text-right text-xs">
                    <p className="font-semibold text-brand-300">
                      {m.feeFixedMicros === 0 && m.feePercentBps === 0
                        ? 'No fee'
                        : m.feePercentBps
                          ? `${m.feePercentBps / 100}%${m.feeFixedMicros ? ` + ${formatUsd(m.feeFixedMicros)}` : ''}`
                          : formatUsd(m.feeFixedMicros)}
                    </p>
                    <p className="text-slate-500">from {formatUsd(m.minMicros)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="font-semibold text-slate-200">Best-paying tasks right now</h3>
            <div className="mt-3 grid gap-2.5">
              {preview.slice(0, 6).map((o) => (
                <div
                  key={o.id}
                  className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3.5"
                >
                  <OfferIcon icon={o.icon} color={o.color} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{o.title}</p>
                    <p className="text-xs text-slate-400">
                      {minutesLabel(o.effectiveMinutes)} ·{' '}
                      <span className="font-semibold text-brand-300">
                        {formatUsd(o.hourlyRateMicros, { precision: 2 })}/hr
                      </span>
                    </p>
                  </div>
                  <QualityBadge quality={o.quality} compact />
                  <div className="text-right">
                    <p className="tabular font-bold">{formatUsd(o.userPayoutMicros)}</p>
                    {c.currency !== 'USD' && (
                      <p className="tabular text-[11px] text-slate-400">
                        ≈ {formatLocal(o.userPayoutMicros, c.currency, rate)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
              {preview.length === 0 && <p className="text-sm text-slate-400">Loading offers…</p>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function TransparencyBand({ stats }: { stats?: PublicStatsDTO }) {
  const items = [
    { label: 'Paid to members', value: stats ? formatUsd(stats.totalPaidOutMicros, { precision: 0 }) : '—' },
    { label: 'Cash-outs completed', value: stats ? stats.payoutsCompleted.toLocaleString() : '—' },
    {
      label: 'Median payout time',
      value: stats?.medianPayoutSeconds ? duration(stats.medianPayoutSeconds) : '—',
    },
    {
      label: 'Revenue share paid (30d)',
      value: stats?.actualShareBps30d ? `${(stats.actualShareBps30d / 100).toFixed(1)}%` : '—',
    },
  ];
  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-8 sm:p-10 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Don’t trust us. Check.</h2>
            <p className="mt-2 max-w-xl text-slate-600 dark:text-slate-400">
              Computed live from our ledger — not a marketing page.{' '}
              {stats?.sandbox && <em>(Sandbox: figures come from demo data.)</em>}
            </p>
          </div>
          <ButtonLink to="/transparency" variant="outline">
            Full transparency report <ArrowRight className="size-4" />
          </ButtonLink>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-6 lg:grid-cols-4">
          {items.map((i) => (
            <div key={i.label}>
              <p className="tabular text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                {i.value}
              </p>
              <p className="mt-1 text-sm text-slate-500">{i.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FaqPreview() {
  const items = FAQ.filter((f) => ['legit', 'minimum', 'missing-how', 'share', 'points'].includes(f.id));
  return (
    <section className="mx-auto max-w-3xl px-4 pb-20 sm:px-6">
      <h2 className="text-center text-3xl font-bold tracking-tight">Questions, answered honestly</h2>
      <div className="mt-8 divide-y divide-slate-200 rounded-3xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {items.map((f) => (
          <details key={f.id} className="group p-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
              {f.q}
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition group-open:rotate-45 dark:bg-slate-800">
                <Minus className="hidden size-3.5 group-open:block" />
                <span className="text-base leading-none group-open:hidden">+</span>
              </span>
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{f.a}</p>
          </details>
        ))}
      </div>
      <p className="mt-4 text-center text-sm">
        <Link to="/faq" className="font-semibold text-brand-700 hover:underline dark:text-brand-400">
          All questions →
        </Link>
      </p>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="px-4 pb-20 sm:px-6">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-gradient-to-br from-brand-600 via-brand-700 to-teal-800 px-6 py-14 text-center text-white sm:px-12">
        <div className="bg-grid absolute inset-0 opacity-20" aria-hidden />
        <h2 className="relative text-3xl font-bold tracking-tight sm:text-4xl">
          Your time deserves respect — and real money.
        </h2>
        <p className="relative mx-auto mt-3 max-w-xl text-brand-100">
          Sign up with just an email. Earn in a minute. Cash out any amount, any time.
        </p>
        <div className="relative mt-8 flex justify-center">
          <ButtonLink to="/signup" size="lg" variant="white">
            Start earning <ArrowRight className="size-4" />
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
