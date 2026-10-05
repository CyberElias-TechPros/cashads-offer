import Link from 'next/link';
import { ArrowRight, BadgeDollarSign, Check, Gauge, HandCoins, LifeBuoy, ShieldCheck, Sparkles, Timer, Wallet, X } from 'lucide-react';
import { FAQ } from '@cashads/shared';
import { ButtonLink } from '@/components/ui/button';
import { HeroMockup } from '@/components/marketing/hero-mockup';
import { LiveFeedList, PayoutTicker, TrustStats } from '@/components/marketing/live';
import { SampleOffers } from '@/components/marketing/sample-offers';
import { Section } from '@/components/marketing/site-chrome';

const PAINS = [
  { icon: Timer, title: 'Paid in minutes, not weeks', body: 'Most cash outs are sent automatically within minutes. Our real median payout time is public.', vs: 'Others: 7–30 day waits' },
  { icon: HandCoins, title: 'No minimum. Ever.', body: 'Cash out $0.01 if you want. The only cost is the provider’s fee, shown before you confirm.', vs: 'Others: $25–$30 minimums' },
  { icon: BadgeDollarSign, title: 'Real money, not points', body: 'Every offer, balance and transaction is shown in dollars and cents, so you always know what your time is worth.', vs: 'Others: “5,000 points”' },
  { icon: LifeBuoy, title: 'Paid even when tracking fails', body: 'Tap “Missing credit” and we check the partner automatically. If we can verify you completed it, you get paid.', vs: 'Others: “clear your cookies”' },
  { icon: Gauge, title: 'Real hourly rate on every offer', body: 'Sort by $/hour using real completion times from members, not advertiser guesses.', vs: 'Others: surprise 30-minute surveys' },
  { icon: ShieldCheck, title: 'Transparent split', body: 'We show what the partner pays us next to what you get. 60% goes to you by default, and you can check it.', vs: 'Others: hidden margins' },
];

const COMPARE: Array<[string, string, string]> = [
  ['Minimum cash out', '$0.01', '$5–$30'],
  ['Typical payout speed', 'Minutes', '1–30 days'],
  ['Currency shown', 'Real money', 'Points / coins'],
  ['When tracking fails', 'Auto-check + we pay', 'Support ticket, maybe'],
  ['Revenue share disclosed', 'Yes, per offer', 'Rarely'],
  ['Account bans', 'Specific reason + 48h appeal', '“Terms violation”'],
  ['Local payout rails', 'M-Pesa, Paystack, GCash, UPI, Pix…', 'PayPal only'],
  ['Points expire', 'Never (no points!)', 'Often'],
];

const RAILS = ['🅿️ PayPal', '🟣 USDC', '🟢 USDT', '⚡ Lightning', '🎁 Amazon', '🇳🇬 Paystack', '📲 M-Pesa', '🟡 MTN MoMo', '🔵 GCash', '🇮🇳 UPI', '🇧🇷 Pix', '🌐 Wise', '🏛️ ACH', '💚 Charity'];

export default function LandingPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="decorative pointer-events-none absolute inset-0 bg-grid [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
        <div className="relative mx-auto grid grid-cols-1 max-w-6xl items-center gap-14 px-4 pb-16 pt-12 sm:px-6 sm:pt-20 lg:grid-cols-[1.1fr_0.9fr] lg:pb-24">
          <div className="animate-slide-up">
            <Link href="/transparency" className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-muted shadow-sm hover:text-fg">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" /> Every number on this site comes from real ledger data
              <ArrowRight className="h-3 w-3" />
            </Link>
            <h1 className="mt-6 font-display text-[2.6rem] font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
              Real cash for your <span className="bg-gradient-to-r from-brand-600 to-emerald-500 bg-clip-text text-transparent">spare minutes.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted">
              Surveys, app trials and 15-second sponsor videos that pay real money, not points. Cash out instantly from <strong className="text-fg">$0.01</strong>. And if a partner’s tracking fails, <strong className="text-fg">we pay you anyway</strong>.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <ButtonLink href="/signup" size="lg">
                Start earning — it’s free <ArrowRight className="h-4 w-4" />
              </ButtonLink>
              <ButtonLink href="/transparency" variant="secondary" size="lg">
                See live payouts
              </ButtonLink>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
              {['No credit card', 'Start with just an email', 'Cash out anytime'].map((t) => (
                <li key={t} className="inline-flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-brand-600" /> {t}
                </li>
              ))}
            </ul>
          </div>
          <HeroMockup />
        </div>
      </section>

      <PayoutTicker />

      <div className="mx-auto max-w-6xl px-4 pt-14 sm:px-6">
        <TrustStats />
      </div>

      {/* Pain points */}
      <Section eyebrow="Why members switch" title="We fixed everything that makes rewards apps feel like a scam." description="If an app makes you wait, hides its fees or bans you without a reason, it is wasting your time. Here is how we do it instead.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PAINS.map((p) => (
            <div key={p.title} className="group rounded-2xl border border-line bg-surface p-6 shadow-soft transition-shadow hover:shadow-lift">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                <p.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-lg font-bold">{p.title}</h3>
              <p className="mt-2 text-sm text-muted">{p.body}</p>
              <p className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-rose-600/80 dark:text-rose-400/80">
                <X className="h-3.5 w-3.5" /> {p.vs}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* How it works */}
      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">How it works</p>
              <h2 className="mt-2 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">Three steps. No tricks.</h2>
              <ol className="mt-8 space-y-6">
                {[
                  { icon: Sparkles, t: 'Pick a task that is worth it', d: 'Every offer shows its payout, real completion time and hourly rate. Your daily plan picks the best three for you.' },
                  { icon: Wallet, t: 'Get credited automatically', d: 'Partners confirm completions to us server-to-server. Your balance updates live, usually within seconds.' },
                  { icon: HandCoins, t: 'Cash out instantly', d: 'PayPal, crypto, gift cards, bank transfer or local mobile money. No minimum, and fees are shown upfront.' },
                ].map((s, i) => (
                  <li key={s.t} className="flex gap-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 font-bold text-white dark:bg-brand-500 dark:text-brand-950">{i + 1}</span>
                    <div>
                      <p className="font-semibold">{s.t}</p>
                      <p className="mt-1 text-sm text-muted">{s.d}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <ButtonLink href="/how-it-works" variant="link" className="mt-6">
                Read the full rules <ArrowRight className="h-4 w-4" />
              </ButtonLink>
            </div>
            <LiveFeedList limit={7} />
          </div>
        </div>
      </section>

      {/* Earning potential */}
      <Section eyebrow="Earning potential" title="Live offers, sorted by what your time is worth." description="These are real offers from the current catalogue. Payouts shown are your share in real money.">
        <SampleOffers />
        <div className="mt-8 text-center">
          <ButtonLink href="/offers" variant="secondary">
            Browse all offers <ArrowRight className="h-4 w-4" />
          </ButtonLink>
        </div>
      </Section>

      {/* Comparison */}
      <section className="mx-auto max-w-4xl px-4 pb-16 sm:px-6 sm:pb-24">
        <div className="overflow-hidden rounded-3xl border border-line bg-surface shadow-soft">
          <div className="grid grid-cols-[1.3fr_1fr_1fr] border-b border-line bg-surface-2 px-5 py-4 text-sm font-semibold">
            <span />
            <span className="text-brand-700 dark:text-brand-300">CashAds</span>
            <span className="text-muted">Typical rewards app</span>
          </div>
          {COMPARE.map(([k, us, them]) => (
            <div key={k} className="grid grid-cols-[1.3fr_1fr_1fr] items-center border-b border-line px-5 py-3.5 text-sm last:border-0">
              <span className="text-muted">{k}</span>
              <span className="flex items-center gap-1.5 font-semibold">
                <Check className="h-4 w-4 shrink-0 text-brand-600" /> {us}
              </span>
              <span className="text-muted">{them}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Rails */}
      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-14 text-center sm:px-6">
          <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">Works where you live.</h2>
          <p className="mx-auto mt-3 max-w-xl text-muted">We only show payout methods that actually work in your country, with real fees and real speeds. Local rails come first.</p>
          <div className="mx-auto mt-8 flex max-w-3xl flex-wrap justify-center gap-2">
            {RAILS.map((r) => (
              <span key={r} className="rounded-full border border-line bg-bg px-3.5 py-1.5 text-sm font-medium">
                {r}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <Section eyebrow="Questions" title="Straight answers." center>
        <div className="mx-auto max-w-3xl divide-y divide-line rounded-2xl border border-line bg-surface shadow-soft">
          {FAQ.filter((f) => ['what-is', 'minimum', 'missing-credit', 'revenue-share', 'pending', 'bans'].includes(f.id)).map((f) => (
            <details key={f.id} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                {f.q}
                <span className="text-xl text-muted transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-sm text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </Section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-emerald-700 to-emerald-900 px-6 py-14 text-center text-white sm:px-12">
          <div className="decorative absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
          <h2 className="relative font-display text-3xl font-extrabold tracking-tight sm:text-4xl">Your time is worth real money.</h2>
          <p className="relative mx-auto mt-3 max-w-xl text-white/80">Join in 30 seconds with just an email. Finish your first offer to unlock a welcome bonus.</p>
          <div className="relative mt-8 flex justify-center">
            <ButtonLink href="/signup" size="lg" className="bg-white text-brand-800 hover:bg-white/90 dark:bg-white dark:text-brand-800">
              Create your free account <ArrowRight className="h-4 w-4" />
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
