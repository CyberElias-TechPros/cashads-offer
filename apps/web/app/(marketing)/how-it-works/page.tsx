import type { Metadata } from 'next';
import { ArrowRight, Clapperboard, Gamepad2, GraduationCap, Hourglass, LifeBuoy, ShieldCheck, Smartphone, SquarePen, Trophy, Wallet } from 'lucide-react';
import { TIERS, formatMoney } from '@cashads/shared';
import { ButtonLink } from '@/components/ui/button';
import { Section } from '@/components/marketing/site-chrome';

export const metadata: Metadata = { title: 'How it works', description: 'Exactly how CashAds pays you: earning, safety holds, missing-credit protection, cash outs and fair play.' };

const WAYS = [
  { icon: SquarePen, t: 'Surveys & quick polls', d: '$0.10–$3. Share opinions with brands; polls take under a minute.' },
  { icon: Smartphone, t: 'App trials & sign-ups', d: '$0.60–$4. Try something new: install, open, explore.' },
  { icon: Gamepad2, t: 'Games with milestones', d: 'Up to $15+. Get paid at every level you reach, not only at the end.' },
  { icon: Wallet, t: 'Finance offers', d: '$5–$24+. Open a free account at a bank or fintech: the highest payouts.' },
  { icon: GraduationCap, t: 'Earn + learn', d: 'Get paid to finish 5-minute lessons on budgeting, safety and money.' },
  { icon: Clapperboard, t: 'Rewarded videos', d: 'A few cents each, instantly. Watch in a row for up to +25% combo.' },
];

export default function HowItWorksPage() {
  return (
    <>
      <Section eyebrow="How it works" title="The whole system, explained plainly." description="No fine print and no points. Here is exactly how money moves from a brand, through us, to you.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            ['1', 'A brand pays us', 'Partners pay us when you complete their survey, trial or sign-up. Each offer page shows that amount.'],
            ['2', 'We pass most of it to you', 'By default you get 60% (plus your tier bonus, paid by us). The price is locked the moment you start.'],
            ['3', 'You cash out', 'From $0.01, to PayPal, crypto, gift cards, banks or local mobile money. Most cash outs arrive in minutes.'],
          ].map(([n, t, d]) => (
            <div key={n} className="rounded-2xl border border-line bg-surface p-6 shadow-soft">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 font-bold text-white dark:bg-brand-500 dark:text-brand-950">{n}</span>
              <h3 className="mt-4 text-lg font-bold">{t}</h3>
              <p className="mt-2 text-sm text-muted">{d}</p>
            </div>
          ))}
        </div>
      </Section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="font-display text-3xl font-extrabold tracking-tight">Ways to earn</h2>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {WAYS.map((w) => (
              <div key={w.t} className="flex gap-4 rounded-2xl border border-line p-5">
                <w.icon className="h-6 w-6 shrink-0 text-brand-600" />
                <div>
                  <p className="font-semibold">{w.t}</p>
                  <p className="mt-1 text-sm text-muted">{w.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Section title="The rules we hold ourselves to">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {[
            { icon: Hourglass, t: 'Safety holds, explained', d: `Credits under ${formatMoney(2_000_000)} are instant. Larger partner rewards wait 24h, and high-value ones (such as bank accounts) wait 72h, because partners can reverse fraudulent sign-ups. Every pending item shows its exact unlock time. Higher tiers wait less, and Platinum has no holds.` },
            { icon: LifeBuoy, t: 'Missing-credit protection', d: 'If a partner’s tracking fails, file a claim. We check their records automatically, and if we can verify your completion, we pay you first and chase the partner afterwards. Anything we can’t match gets a human review within 24 hours.' },
            { icon: ShieldCheck, t: 'Fair play, not suspicion', d: 'We look for things like many accounts on one device or a payout account shared by several people. Signals route cash outs to a quick human review; they never ban anyone automatically. If we act, you get the specific reason and a 48-hour appeal.' },
            { icon: Trophy, t: 'Rewards that respect you', d: 'Streaks, daily plans, tiers and achievements are optional extras with small real-money bonuses. Nothing is required to earn or cash out, and nothing ever expires.' },
          ].map((r) => (
            <div key={r.t} className="rounded-2xl border border-line bg-surface p-6 shadow-soft">
              <r.icon className="h-6 w-6 text-brand-600" />
              <h3 className="mt-3 text-lg font-bold">{r.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{r.d}</p>
            </div>
          ))}
        </div>
      </Section>

      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <h2 className="font-display text-3xl font-extrabold tracking-tight">Tiers</h2>
        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-4">
          {TIERS.map((t) => (
            <div key={t.id} className="rounded-2xl border border-line bg-surface p-5">
              <p className="text-lg font-bold">{t.label}</p>
              <p className="text-xs text-muted">{t.minLifetimeMicros ? `${formatMoney(t.minLifetimeMicros)} earned` : 'Everyone starts here'}</p>
              <ul className="mt-3 space-y-1 text-sm text-muted">
                {t.perks.map((p) => (
                  <li key={p}>• {p}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 text-center">
          <ButtonLink href="/signup" size="lg">
            Start earning <ArrowRight className="h-4 w-4" />
          </ButtonLink>
        </div>
      </section>
    </>
  );
}
