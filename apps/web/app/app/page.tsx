'use client';

import Link from 'next/link';
import { ArrowRight, Clapperboard, LifeBuoy, TrendingUp, Wallet } from 'lucide-react';
import { formatMoney, timeUntil } from '@cashads/shared';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/feedback';
import { Money } from '@/components/ui/misc';
import { GoalCard, OfferCard, PlanCard, StreakCard, TierCard } from '@/components/app/widgets';
import { LiveFeedList } from '@/components/marketing/live';
import { useEngagement, useMe, useOffers, useVideoStatus } from '@/lib/queries';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function DashboardPage() {
  const { data: me } = useMe();
  const { data: eng } = useEngagement();
  const { data: quick } = useOffers({ sort: 'hourly', limit: 6 });
  const { data: video } = useVideoStatus();
  if (!me) return null;
  const w = me.wallet;
  const goalGap = me.user.goal ? me.user.goal.targetMicros - w.availableMicros : 0;
  const closer = goalGap > 0 ? quick?.filter((o) => o.userPayoutMicros >= goalGap).sort((a, b) => (a.medianMinutes ?? a.estimatedMinutes) - (b.medianMinutes ?? b.estimatedMinutes))[0] ?? quick?.[0] : undefined;

  return (
    <div className="space-y-6">
      {/* Balance hero */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-emerald-700 to-emerald-900 p-6 text-white shadow-glow sm:p-8">
        <div className="decorative absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm text-white/75">
              {greeting()}, {me.user.displayName.split(' ')[0]} 👋
            </p>
            <p className="mt-4 text-sm text-white/70">Available to cash out</p>
            <Money micros={w.availableMicros} animate className="block font-display text-5xl font-extrabold tracking-tight" />
            {me.localCurrency && me.user.preferences.showLocalCurrency && (
              <p className="tabular mt-1 text-sm text-white/70">
                ≈ {new Intl.NumberFormat('en-US', { style: 'currency', currency: me.localCurrency.code, maximumFractionDigits: 0 }).format((w.availableMicros / 1e6) * me.localCurrency.rate)}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-white/80">
              {w.pendingMicros > 0 && (
                <span>
                  + <strong className="tabular">{formatMoney(w.pendingMicros)}</strong> pending
                  {w.nextRelease && <> · next unlocks {timeUntil(w.nextRelease.at)}</>}
                </span>
              )}
              <span>
                Lifetime earned <strong className="tabular">{formatMoney(w.lifetimeEarnedMicros)}</strong>
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <ButtonLink href="/app/cashout" size="lg" className="bg-white text-brand-800 hover:bg-white/90 dark:bg-white dark:text-brand-800 dark:hover:bg-white/90">
              <Wallet className="h-4 w-4" /> Cash out now
            </ButtonLink>
            <p className="text-xs text-white/70">No minimum · fees shown upfront</p>
          </div>
        </div>
        {eng && (
          <div className="relative mt-6 grid grid-cols-3 gap-3 border-t border-white/15 pt-5 text-sm">
            <div>
              <p className="text-white/60">Today</p>
              <p className="tabular text-lg font-bold">{formatMoney(eng.earnedTodayMicros)}</p>
            </div>
            <div>
              <p className="text-white/60">Last 7 days</p>
              <p className="tabular text-lg font-bold">{formatMoney(eng.earnedWeekMicros)}</p>
            </div>
            <div>
              <p className="text-white/60">Leaderboard</p>
              <p className="text-lg font-bold">{eng.weekRankPercentile ? `Top ${eng.weekRankPercentile}%` : '—'}</p>
            </div>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {eng ? <PlanCard plan={eng.plan} /> : <Skeleton className="h-72 rounded-2xl" />}

          <Card>
            <CardHeader
              icon={<TrendingUp className="h-5 w-5" />}
              title="Best hourly rate right now"
              description="Real completion times from members, not advertiser guesses."
              action={
                <Link href="/app/earn" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">
                  All offers <ArrowRight className="h-4 w-4" />
                </Link>
              }
            />
            <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {quick ? quick.slice(0, 4).map((o) => <OfferCard key={o.id} offer={o} compact />) : Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-2xl" />)}
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Link href="/app/watch" className="group rounded-2xl border border-line bg-surface p-5 shadow-soft transition-shadow hover:shadow-lift">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-500/10">
                  <Clapperboard className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-semibold">Watch & earn</p>
                  <p className="text-sm text-muted">{video ? `${video.remainingToday} of ${video.dailyCap} videos left today` : '15-second sponsor videos'}</p>
                </div>
              </div>
              <p className="mt-3 text-sm">
                Next video ≈ <strong className="tabular text-brand-700 dark:text-brand-400">{video ? formatMoney(video.nextRewardMicros) : '—'}</strong>
                {video && video.comboIndex > 0 && <span className="text-muted"> · combo +{video.comboBonusBps / 100}%</span>}
              </p>
            </Link>
            <Link href="/app/claims" className="group rounded-2xl border border-line bg-surface p-5 shadow-soft transition-shadow hover:shadow-lift">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-500/10">
                  <LifeBuoy className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-semibold">Didn’t get credited?</p>
                  <p className="text-sm text-muted">One-tap missing-credit claim</p>
                </div>
              </div>
              <p className="mt-3 text-sm text-muted">We check the partner automatically, and if we can verify it, we pay you even when their tracking failed.</p>
            </Link>
          </div>
        </div>

        <div className="space-y-6">
          {eng ? <StreakCard streak={eng.streak} /> : <Skeleton className="h-56 rounded-2xl" />}
          <GoalCard user={me.user} availableMicros={w.availableMicros} nextOffer={closer} />
          {eng ? <TierCard tier={eng.tier} /> : <Skeleton className="h-56 rounded-2xl" />}
          <LiveFeedList limit={6} />
        </div>
      </div>
    </div>
  );
}
