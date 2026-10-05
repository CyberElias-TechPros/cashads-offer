'use client';

import { Check, Lock } from 'lucide-react';
import { formatMoney, TIERS } from '@cashads/shared';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card';
import { Badge, Progress, Skeleton } from '@/components/ui/feedback';
import { StreakCard, TierCard } from '@/components/app/widgets';
import { useAchievements, useEngagement } from '@/lib/queries';
import { cn } from '@/lib/utils';

export default function RewardsPage() {
  const { data: eng } = useEngagement();
  const { data: achievements } = useAchievements();
  const current = eng ? TIERS.findIndex((t) => t.id === eng.tier.current) : 0;
  return (
    <div className="space-y-6">
      <PageHeader title="Rewards & tiers" description="Optional extras that make earning more fun. None of this is required to earn or cash out." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {eng ? <TierCard tier={eng.tier} /> : <Skeleton className="h-60 rounded-2xl" />}
        {eng ? <StreakCard streak={eng.streak} /> : <Skeleton className="h-60 rounded-2xl" />}
        <Card>
          <CardHeader title="Achievements" description={eng ? `${eng.achievementsUnlocked} of ${eng.achievementsTotal} unlocked` : ''} />
          <CardBody>
            <Progress value={eng ? (eng.achievementsUnlocked / eng.achievementsTotal) * 100 : 0} />
            <p className="mt-3 text-sm text-muted">Most achievements come with a small cash bonus, credited instantly.</p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Tier perks" description="Tiers go up automatically as you earn and verify, and they never go down." />
        <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-4">
          {TIERS.map((t, i) => (
            <div key={t.id} className={cn('rounded-2xl border p-4', i === current ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-500/5' : 'border-line')}>
              <div className="flex items-center justify-between">
                <p className="font-bold">{t.label}</p>
                {i === current ? <Badge tone="brand">You</Badge> : i < current ? <Check className="h-4 w-4 text-brand-600" /> : <Lock className="h-4 w-4 text-subtle" />}
              </div>
              <p className="mt-1 text-xs text-muted">
                {t.minLifetimeMicros ? `${formatMoney(t.minLifetimeMicros)} earned` : 'Everyone starts here'}
                {t.minAccountAgeDays ? ` · ${t.minAccountAgeDays}d` : ''}
                {t.requires.length ? ` · ${t.requires.join(', ')} verified` : ''}
              </p>
              <ul className="mt-3 space-y-1.5 text-sm">
                {t.perks.map((p) => (
                  <li key={p} className="flex gap-2">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="All achievements" />
        <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {achievements?.map((a) => {
            const done = !!a.unlockedAt;
            const isMoney = a.id.startsWith('earned_');
            return (
              <div key={a.id} className={cn('flex items-start gap-3 rounded-2xl border p-4', done ? 'border-brand-300 bg-brand-50/40 dark:border-brand-500/30 dark:bg-brand-500/5' : 'border-line')}>
                <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl', !done && 'opacity-40 grayscale')}>{a.emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">{a.title}</p>
                    {a.rewardMicros > 0 && <span className="tabular text-xs font-semibold text-brand-700 dark:text-brand-400">+{formatMoney(a.rewardMicros)}</span>}
                  </div>
                  <p className="text-xs text-muted">{a.description}</p>
                  {done ? (
                    <p className="mt-2 text-xs font-medium text-brand-700 dark:text-brand-400">Unlocked {new Date(a.unlockedAt!).toLocaleDateString()}</p>
                  ) : (
                    <div className="mt-2">
                      <Progress value={(a.progress / a.threshold) * 100} size="sm" />
                      <p className="tabular mt-1 text-[11px] text-subtle">{isMoney ? `${formatMoney(a.progress)} / ${formatMoney(a.threshold)}` : `${a.progress} / ${a.threshold}`}</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </CardBody>
      </Card>
    </div>
  );
}
