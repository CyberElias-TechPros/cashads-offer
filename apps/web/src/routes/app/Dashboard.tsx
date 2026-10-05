import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Banknote,
  CircleCheck,
  CirclePlay,
  Flame,
  ListChecks,
  Sparkles,
  Target,
  Timer,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { Link } from 'react-router';
import {
  type ActivityItemDTO,
  type AdNextDTO,
  type OfferDTO,
  type PlanDTO,
  type StreakDTO,
  type TierProgressDTO,
  formatUsd,
} from '@cashads/shared';
import { useAnimatedNumber } from '../../components/brand';
import { FeedRow, OfferCard, OfferCardSkeleton, OfferIcon } from '../../components/earn';
import { Button, ButtonLink, Card, CardHeader, Progress, Skeleton } from '../../components/ui';
import { errorMessage, get, post } from '../../lib/api';
import { qk, useMe, useMoney, usePublicFeed, useWallet } from '../../lib/queries';
import { cn, minutesLabel } from '../../lib/utils';
import { toast } from '../../store/ui';

export function Dashboard() {
  const { data: me } = useMe();
  const { data: wallet } = useWallet();
  const { data: offers } = useQuery({
    queryKey: ['offers', 'top'],
    queryFn: () => get<OfferDTO[]>('/offers?sort=hourly&hideCompleted=true'),
  });
  const { data: activity } = useQuery({
    queryKey: ['activity'],
    queryFn: () => get<ActivityItemDTO[]>('/activity'),
  });
  const waiting = activity?.filter((a) => a.status === 'reported' || a.status === 'claimed') ?? [];
  const claimable = activity?.filter((a) => a.canClaim && a.status !== 'expired') ?? [];

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <BalanceCard />
        <StreakCard />
      </div>

      {me && wallet && (
        <OnboardingChecklist
          emailVerified={me.emailVerified}
          earned={wallet.lifetimeEarnedMicros > 0}
          paid={wallet.lifetimePaidOutMicros > 0}
        />
      )}

      {(waiting.length > 0 || claimable.length > 0) && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/20">
          <div className="flex items-center gap-3">
            <Timer className="size-5 text-amber-600" />
            <p className="text-sm">
              <strong>{waiting.length}</strong> task{waiting.length === 1 ? '' : 's'} awaiting confirmation
              from the network
              {claimable.length > 0 && (
                <>
                  {' '}
                  · <strong>{claimable.length}</strong> eligible for a Missing Credit claim
                </>
              )}
            </p>
          </div>
          <ButtonLink to="/app/activity" size="sm" variant="outline">
            View activity
          </ButtonLink>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <PlanCard />
        <QuickStartCard />
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold">
            <TrendingUp className="size-4 text-brand-600" /> Best hourly rate for you
          </h2>
          <Link
            to="/app/earn"
            className="text-sm font-semibold text-brand-700 hover:underline dark:text-brand-400"
          >
            All tasks →
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {offers
            ? offers.slice(0, 4).map((o) => <OfferCard key={o.id} offer={o} />)
            : Array.from({ length: 4 }, (_, i) => <OfferCardSkeleton key={i} />)}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <TierCard />
        <LiveFeedCard />
      </div>
    </div>
  );
}

function BalanceCard() {
  const { data: wallet } = useWallet();
  const { data: me } = useMe();
  const m = useMoney();
  const available = useAnimatedNumber(wallet?.availableMicros ?? 0);
  const goal = me?.prefs.savingsGoalMicros ?? null;
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-700 to-teal-800 p-6 text-white shadow-lg shadow-brand-900/20">
      <div className="bg-grid absolute inset-0 opacity-20" aria-hidden />
      <div className="relative">
        <p className="text-sm font-medium text-brand-100">Available to cash out</p>
        {wallet ? (
          <>
            <p className="tabular mt-1 text-5xl font-bold tracking-tight">
              {m.usd(available, { floor: true })}
            </p>
            {m.local(available) && (
              <p className="tabular mt-1 text-sm text-brand-100">≈ {m.local(available)} · no minimum</p>
            )}
          </>
        ) : (
          <Skeleton className="mt-2 h-12 w-48 bg-white/20" />
        )}
        <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-brand-200">Awaiting</p>
            <p className="tabular font-semibold">{wallet ? formatUsd(wallet.pendingMicros) : '—'}</p>
          </div>
          <div>
            <p className="text-brand-200">Lifetime earned</p>
            <p className="tabular font-semibold">{wallet ? formatUsd(wallet.lifetimeEarnedMicros) : '—'}</p>
          </div>
          <div>
            <p className="text-brand-200">Cashed out</p>
            <p className="tabular font-semibold">{wallet ? formatUsd(wallet.lifetimePaidOutMicros) : '—'}</p>
          </div>
        </div>
        {goal && wallet && (
          <div className="mt-5 rounded-2xl bg-white/10 p-3">
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5">
                <Target className="size-4" /> {me?.prefs.savingsGoalLabel ?? 'Goal'}
              </span>
              <span className="tabular">
                {formatUsd(Math.min(wallet.availableMicros, goal))} / {formatUsd(goal)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-amber-300 transition-[width] duration-700"
                style={{ width: `${Math.min(100, (wallet.availableMicros / goal) * 100)}%` }}
              />
            </div>
            {wallet.availableMicros < goal && (
              <p className="mt-1.5 text-xs text-brand-100">
                {formatUsd(goal - wallet.availableMicros)} to go — today’s plan gets you closer.
              </p>
            )}
          </div>
        )}
        <div className="mt-5 flex gap-2">
          <ButtonLink to="/app/cashout" variant="white" className="text-brand-800">
            <Banknote className="size-4" /> Cash out
          </ButtonLink>
          <ButtonLink
            to="/app/earn"
            variant="ghost"
            className="text-white hover:bg-white/10 hover:text-white"
          >
            Earn more <ArrowRight className="size-4" />
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}

function StreakCard() {
  const qc = useQueryClient();
  const { data: streak } = useQuery({ queryKey: ['streak'], queryFn: () => get<StreakDTO>('/streak') });
  const claim = useMutation({
    mutationFn: () => post<{ rewardMicros: number; streak: StreakDTO }>('/streak/claim'),
    onSuccess: (r) => {
      qc.setQueryData(['streak'], r.streak);
      qc.invalidateQueries({ queryKey: qk.wallet });
      toast.success(
        `🔥 Day ${r.streak.current} — +${formatUsd(r.rewardMicros)}`,
        'Come back tomorrow to keep it going.',
      );
    },
    onError: (err) => toast.error('Couldn’t claim', errorMessage(err)),
  });
  return (
    <Card className="flex flex-col">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Flame className="size-5 text-amber-500" />{' '}
            {streak ? `${streak.current}-day streak` : 'Daily streak'}
          </span>
        }
        subtitle="One tap a day. Resets at your local midnight."
        action={streak && <span className="text-xs text-slate-400">best {streak.longest}</span>}
      />
      <div className="flex gap-1.5">
        {(streak?.upcoming ?? Array.from({ length: 7 }, (_, i) => ({ day: i + 1, rewardMicros: 0 }))).map(
          (u, i) => (
            <div
              key={u.day}
              className={cn(
                'flex flex-1 flex-col items-center rounded-xl border py-2 text-center',
                i === 0 && !streak?.claimedToday
                  ? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40'
                  : 'border-slate-200 dark:border-slate-800',
              )}
            >
              <span className="text-[10px] text-slate-500">Day {u.day}</span>
              <span className="tabular text-xs font-semibold">
                {u.rewardMicros ? formatUsd(u.rewardMicros) : '—'}
              </span>
            </div>
          ),
        )}
      </div>
      {streak && <StreakMilestone current={streak.current} />}
      <div className="mt-auto pt-4">
        {streak?.claimedToday ? (
          <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
            <CircleCheck className="size-4" /> Claimed today ({formatUsd(streak.todayRewardMicros)}). See you
            tomorrow!
          </p>
        ) : (
          <Button
            block
            loading={claim.isPending}
            onClick={() => claim.mutate()}
            className="bg-amber-500 hover:bg-amber-600"
          >
            Claim today’s {streak ? formatUsd(streak.todayRewardMicros) : ''}
          </Button>
        )}
      </div>
    </Card>
  );
}

const STREAK_BADGES = [
  { days: 3, title: 'Warming up' },
  { days: 7, title: 'One full week' },
  { days: 30, title: 'Habit formed' },
];

function StreakMilestone({ current }: { current: number }) {
  const next = STREAK_BADGES.find((b) => b.days > current);
  return (
    <div className="mt-4 rounded-xl bg-amber-50/80 p-3.5 dark:bg-amber-950/30">
      {next ? (
        <>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="font-medium text-amber-900 dark:text-amber-200">
              Next badge: “{next.title}” ({next.days} days)
            </span>
            <span className="tabular text-amber-800 dark:text-amber-300">
              {current}/{next.days}
            </span>
          </div>
          <Progress value={current / next.days} tone="amber" />
        </>
      ) : (
        <p className="text-xs font-medium text-amber-900 dark:text-amber-200">
          30+ days — every streak badge unlocked. Legendary.
        </p>
      )}
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        Streak bonuses are paid by CashAds — never taken from your task earnings.
      </p>
    </div>
  );
}

function OnboardingChecklist({
  emailVerified,
  earned,
  paid,
}: {
  emailVerified: boolean;
  earned: boolean;
  paid: boolean;
}) {
  const steps = [
    { done: true, label: 'Create your account', to: '/app/profile' },
    { done: earned, label: 'Complete a 20-second quick task', to: '/app/earn/quick' },
    { done: emailVerified, label: 'Confirm your email', to: '/app/profile' },
    { done: paid, label: 'Try a test cash-out (even $0.05)', to: '/app/cashout' },
  ];
  if (steps.every((s) => s.done)) return null;
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <Card>
      <CardHeader
        title="Prove it to yourself in 2 minutes"
        subtitle="Earn a few cents, then cash them out — see the money land before you invest more time."
        icon={<ListChecks className="size-5 text-brand-600" />}
        action={
          <span className="tabular text-sm text-slate-500">
            {doneCount}/{steps.length}
          </span>
        }
      />
      <Progress value={doneCount / steps.length} className="mb-4" />
      <div className="grid gap-2 sm:grid-cols-2">
        {steps.map((s) => (
          <Link
            key={s.label}
            to={s.to}
            className={cn(
              'flex items-center gap-3 rounded-xl border px-3.5 py-3 text-sm transition',
              s.done
                ? 'border-emerald-200 bg-emerald-50/60 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300'
                : 'border-slate-200 hover:border-slate-300 dark:border-slate-800',
            )}
          >
            <CircleCheck className={cn('size-5', s.done ? 'text-emerald-500' : 'text-slate-300')} />
            <span className={cn(s.done && 'line-through opacity-70')}>{s.label}</span>
            {!s.done && <ArrowRight className="ml-auto size-4 text-slate-400" />}
          </Link>
        ))}
      </div>
    </Card>
  );
}

function PlanCard() {
  const { data: plan, isLoading } = useQuery({ queryKey: ['plan'], queryFn: () => get<PlanDTO>('/plan') });
  const doneCount = plan?.items.filter((i) => i.done).length ?? 0;
  return (
    <Card>
      <CardHeader
        title="Today’s plan"
        subtitle={
          plan
            ? `${plan.items.length} tasks · ${formatUsd(plan.totalMicros)} · ~${plan.totalMinutes} min`
            : 'Personalised for you'
        }
        icon={<Sparkles className="size-5 text-violet-500" />}
        action={
          plan &&
          plan.items.length > 0 && (
            <span className="tabular text-sm text-slate-500">
              {doneCount}/{plan.items.length}
            </span>
          )
        }
      />
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : plan && plan.items.length > 0 ? (
        <>
          <ul className="space-y-2">
            {plan.items.map(({ offer, done }) => (
              <li key={offer.id}>
                <Link
                  to={`/app/earn/${offer.id}`}
                  className={cn(
                    'flex items-center gap-3 rounded-xl border border-slate-200 p-3 transition hover:border-slate-300 dark:border-slate-800',
                    done && 'opacity-60',
                  )}
                >
                  {done ? (
                    <CircleCheck className="size-9 text-emerald-500" />
                  ) : (
                    <OfferIcon icon={offer.icon} color={offer.color} size="sm" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate text-sm font-medium', done && 'line-through')}>
                      {offer.title}
                    </p>
                    <p className="text-xs text-slate-500">
                      {minutesLabel(offer.effectiveMinutes)} ·{' '}
                      {formatUsd(offer.hourlyRateMicros, { precision: 2 })}/hr
                    </p>
                  </div>
                  <span className="tabular text-sm font-semibold">{formatUsd(offer.userPayoutMicros)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            {plan.completed
              ? plan.bonusPaid
                ? `✅ Done — ${formatUsd(plan.bonusMicros)} plan bonus paid.`
                : 'All done!'
              : `Finish all ${plan.items.length} for a ${formatUsd(plan.bonusMicros)} bonus.`}
          </p>
        </>
      ) : (
        <p className="text-sm text-slate-500">
          You’ve done everything available today. New tasks arrive daily — try quick tasks meanwhile.
        </p>
      )}
    </Card>
  );
}

function QuickStartCard() {
  const { data: ad } = useQuery({ queryKey: ['ads', 'next'], queryFn: () => get<AdNextDTO>('/ads/next') });
  return (
    <Card className="flex flex-col">
      <CardHeader
        title="Got 30 seconds?"
        subtitle="Micro-earning for queues, buses and breaks."
        icon={<Zap className="size-5 text-amber-500" />}
      />
      <div className="space-y-2">
        <Link
          to="/app/earn/quick"
          className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 hover:border-slate-300 dark:border-slate-800"
        >
          <span className="flex size-9 items-center justify-center rounded-lg bg-amber-100 text-lg dark:bg-amber-900/40">
            ⚡
          </span>
          <div className="flex-1">
            <p className="text-sm font-medium">Quick tasks</p>
            <p className="text-xs text-slate-500">One question · ~20 sec · text only</p>
          </div>
          <ArrowRight className="size-4 text-slate-400" />
        </Link>
        <Link
          to="/app/watch"
          className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 hover:border-slate-300 dark:border-slate-800"
        >
          <span className="flex size-9 items-center justify-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
            <CirclePlay className="size-5" />
          </span>
          <div className="flex-1">
            <p className="text-sm font-medium">Rewarded videos</p>
            <p className="text-xs text-slate-500">
              {ad?.creative
                ? `${formatUsd(ad.rewardMicros)} for ${ad.creative.durationSeconds}s · ${ad.remainingToday} left today`
                : 'Honest pay — tiny amounts'}
            </p>
          </div>
          <ArrowRight className="size-4 text-slate-400" />
        </Link>
        <Link
          to="/app/learn"
          className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 hover:border-slate-300 dark:border-slate-800"
        >
          <span className="flex size-9 items-center justify-center rounded-lg bg-violet-100 text-lg dark:bg-violet-900/40">
            🎓
          </span>
          <div className="flex-1">
            <p className="text-sm font-medium">Earn + learn</p>
            <p className="text-xs text-slate-500">Get paid for 4-minute money lessons</p>
          </div>
          <ArrowRight className="size-4 text-slate-400" />
        </Link>
      </div>
    </Card>
  );
}

function TierCard() {
  const { data } = useQuery({ queryKey: ['tier'], queryFn: () => get<TierProgressDTO>('/tier') });
  if (!data) return <Skeleton className="h-48" />;
  const next = data.next;
  const progress = next ? Math.min(1, data.lifetimeMicros / Math.max(1, next.minLifetimeMicros)) : 1;
  return (
    <Card>
      <CardHeader
        title={
          <span>
            Trust tier: <span style={{ color: data.current.color }}>{data.current.name}</span>
          </span>
        }
        subtitle={data.current.perks[0]}
      />
      {next ? (
        <>
          <div className="mb-1.5 flex justify-between text-sm">
            <span className="text-slate-500">Next: {next.name}</span>
            <span className="tabular">
              {formatUsd(data.lifetimeMicros)} / {formatUsd(next.minLifetimeMicros)}
            </span>
          </div>
          <Progress value={progress} tone="violet" />
          <p className="mt-2 text-xs text-slate-500">
            Also needs {next.minAccountAgeDays}+ days ({data.accountAgeDays} so far)
            {next.requiresKyc ? ' and ID verification' : ''}. Unlocks: {next.perks[0]}.
          </p>
        </>
      ) : (
        <p className="text-sm text-slate-500">Top tier — thank you for being here.</p>
      )}
      <Link
        to="/app/achievements"
        className="mt-4 inline-block text-sm font-semibold text-brand-700 hover:underline dark:text-brand-400"
      >
        Tiers & achievements →
      </Link>
    </Card>
  );
}

function LiveFeedCard() {
  const { data: feed = [] } = usePublicFeed(20);
  return (
    <Card>
      <CardHeader
        title="Money moving right now"
        subtitle="Real cash-outs by members (anonymised)"
        action={
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand-400 opacity-75" />
            <span className="relative inline-flex size-2.5 rounded-full bg-brand-500" />
          </span>
        }
      />
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {feed.slice(0, 5).map((f) => (
          <FeedRow key={f.id} item={f} />
        ))}
      </ul>
    </Card>
  );
}
