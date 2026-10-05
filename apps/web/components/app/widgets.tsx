'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, Clock, Flame, Gauge, Gift, ShieldCheck, Signal, Star, Target, Undo2 } from 'lucide-react';
import {
  CATEGORY_META,
  DATA_USAGE_META,
  formatMinutes,
  formatMoney,
  hourlyRate,
  PAYOUT_STATUS_META,
  timeUntil,
  TIER_BY_ID,
  TIERS,
  TRANSACTION_TYPE_META,
  type DailyPlanDTO,
  type OfferDTO,
  type StreakDTO,
  type TierProgressDTO,
  type TransactionDTO,
  type UserDTO,
} from '@cashads/shared';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge, Progress } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { Money, TimeAgo } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { qk } from '@/lib/queries';
import { toast } from '@/lib/store';
import { cn, pct } from '@/lib/utils';

export function OfferCard({ offer, compact }: { offer: OfferDTO; compact?: boolean }) {
  const minutes = offer.medianMinutes ?? offer.estimatedMinutes;
  return (
    <Link
      href={`/app/earn/${offer.id}`}
      className="group relative flex flex-col rounded-2xl border border-line bg-surface p-4 shadow-soft transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lift dark:hover:border-brand-500/40"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl" style={{ background: `${offer.brandColor}1a` }}>
          {offer.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {offer.featured && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />}
            <p className="line-clamp-1 font-semibold leading-snug">{offer.title}</p>
          </div>
          <p className="truncate text-xs text-muted">
            {offer.advertiser} · {CATEGORY_META[offer.category].label}
          </p>
        </div>
        <div className="text-right">
          <p className="tabular text-lg font-extrabold leading-tight text-brand-700 dark:text-brand-400">{formatMoney(offer.userPayoutMicros)}</p>
          {offer.goals.length > 0 && <p className="text-[11px] text-muted">{offer.goals.length} milestones</p>}
        </div>
      </div>
      {!compact && <p className="mt-3 line-clamp-2 text-sm text-muted">{offer.shortDescription}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
        <Badge tone="brand">
          <Gauge className="h-3 w-3" /> {formatMoney(offer.hourlyRateMicros, { decimals: 2 })}/hr
        </Badge>
        <Badge>
          <Clock className="h-3 w-3" /> {formatMinutes(minutes)}
        </Badge>
        {offer.holdHours > 0 ? (
          <Badge tone="warning">
            <ShieldCheck className="h-3 w-3" /> {offer.holdHours}h hold
          </Badge>
        ) : (
          <Badge tone="success">Instant</Badge>
        )}
        {offer.dataUsage !== 'light' && (
          <Badge>
            <Signal className="h-3 w-3" /> {DATA_USAGE_META[offer.dataUsage].label}
          </Badge>
        )}
        {offer.myStatus === 'started' && <Badge tone="info">In progress</Badge>}
        {offer.myStatus === 'claimed' && <Badge tone="warning">Claim open</Badge>}
        {offer.isNew && !compact && <Badge tone="info">New</Badge>}
      </div>
      {!compact && offer.trackingReliability !== null && (
        <p className="mt-3 text-[11px] text-subtle">
          Tracks {pct(offer.trackingReliability)} of the time · quality {offer.qualityScore}/100
        </p>
      )}
    </Link>
  );
}

export function StreakCard({ streak }: { streak: StreakDTO }) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  return (
    <Card>
      <CardHeader
        icon={<Flame className="h-5 w-5" />}
        title={streak.current > 0 ? `${streak.current}-day streak` : 'Start a streak'}
        description={streak.checkedInToday ? `Come back tomorrow for ${formatMoney(streak.nextBonusMicros)}.` : `Check in today for ${formatMoney(streak.todayBonusMicros)}. Best: ${streak.best} days.`}
      />
      <CardBody className="pt-4">
        <div className="grid grid-cols-7 gap-1.5">
          {streak.last7.map((d) => (
            <div key={d.day} className="text-center">
              <div className={cn('mx-auto flex h-9 w-full items-center justify-center rounded-xl text-sm', d.checked ? 'bg-gradient-to-b from-amber-400 to-orange-500 text-white' : 'bg-surface-3 text-subtle')}>{d.checked ? '🔥' : '·'}</div>
              <p className="mt-1 text-[10px] text-subtle">{new Date(`${d.day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'narrow' })}</p>
            </div>
          ))}
        </div>
        <Button
          className="mt-4 w-full"
          variant={streak.checkedInToday ? 'secondary' : 'primary'}
          disabled={streak.checkedInToday}
          loading={loading}
          onClick={async () => {
            setLoading(true);
            try {
              await api('/engagement/checkin', { body: {} });
              await qc.invalidateQueries({ queryKey: qk.engagement });
            } catch (err) {
              toast({ title: errorMessage(err), tone: 'warning' });
            } finally {
              setLoading(false);
            }
          }}
        >
          {streak.checkedInToday ? 'Checked in today ✓' : `Check in · +${formatMoney(streak.todayBonusMicros)}`}
        </Button>
      </CardBody>
    </Card>
  );
}

export function PlanCard({ plan }: { plan: DailyPlanDTO }) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  const allDone = plan.items.length > 0 && plan.completed === plan.items.length;
  return (
    <Card>
      <CardHeader
        icon={<Target className="h-5 w-5" />}
        title="Today’s plan"
        description={plan.items.length ? `${formatMoney(plan.totalMicros)} in about ${plan.totalMinutes} min — picked for the best hourly rate.` : 'New offers are on their way.'}
        action={<Badge tone={allDone ? 'success' : 'neutral'}>{`${plan.completed}/${plan.items.length}`}</Badge>}
      />
      <CardBody className="space-y-2 pt-4">
        {plan.items.map((it) => (
          <Link key={it.offerId} href={`/app/earn/${it.offerId}`} className={cn('flex items-center gap-3 rounded-xl border border-line p-3 transition-colors hover:bg-surface-2', it.done && 'opacity-60')}>
            <span className="text-xl">{it.icon}</span>
            <div className="min-w-0 flex-1">
              <p className={cn('truncate text-sm font-medium', it.done && 'line-through')}>{it.title}</p>
              <p className="text-xs text-muted">
                {formatMinutes(it.estimatedMinutes)} · {formatMoney(hourlyRate(it.userPayoutMicros, it.estimatedMinutes), { decimals: 2 })}/hr
              </p>
            </div>
            {it.done ? <CheckCircle2 className="h-5 w-5 text-brand-600" /> : <span className="tabular text-sm font-bold text-brand-700 dark:text-brand-400">{formatMoney(it.userPayoutMicros)}</span>}
          </Link>
        ))}
        <Progress value={plan.items.length ? (plan.completed / plan.items.length) * 100 : 0} className="mt-3" />
        <Button
          variant={allDone && !plan.bonusClaimed ? 'primary' : 'secondary'}
          className="mt-2 w-full"
          disabled={!allDone || plan.bonusClaimed}
          loading={loading}
          onClick={async () => {
            setLoading(true);
            try {
              await api('/engagement/plan/claim', { body: {} });
              await qc.invalidateQueries({ queryKey: qk.engagement });
            } catch (err) {
              toast({ title: errorMessage(err), tone: 'warning' });
            } finally {
              setLoading(false);
            }
          }}
        >
          <Gift className="h-4 w-4" />
          {plan.bonusClaimed ? 'Plan bonus claimed ✓' : `Finish the plan · +${formatMoney(plan.bonusMicros)} bonus`}
        </Button>
      </CardBody>
    </Card>
  );
}

export function GoalCard({ user, availableMicros, nextOffer }: { user: UserDTO; availableMicros: number; nextOffer?: OfferDTO }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(user.goal?.label ?? 'Amazon gift card');
  const [target, setTarget] = useState(user.goal ? String(user.goal.targetMicros / 1e6) : '10');
  const [saving, setSaving] = useState(false);
  const goal = user.goal;
  const remaining = goal ? Math.max(0, goal.targetMicros - availableMicros) : 0;
  return (
    <Card>
      <CardHeader
        icon={<Target className="h-5 w-5" />}
        title={goal ? `Saving for: ${goal.label}` : 'Set a savings goal'}
        description={goal ? (remaining > 0 ? `${formatMoney(remaining)} to go` : 'Goal reached — cash it out!') : 'People who set a goal earn more consistently.'}
        action={
          <button className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300" onClick={() => setOpen(true)}>
            {goal ? 'Edit' : 'Set goal'}
          </button>
        }
      />
      <CardBody className="pt-4">
        {goal ? (
          <>
            <div className="flex items-end justify-between">
              <Money micros={Math.min(availableMicros, goal.targetMicros)} className="text-2xl font-bold" />
              <span className="tabular text-sm text-muted">of {formatMoney(goal.targetMicros)}</span>
            </div>
            <Progress value={(availableMicros / goal.targetMicros) * 100} className="mt-3" />
            {remaining > 0 && nextOffer && (
              <Link href={`/app/earn/${nextOffer.id}`} className="mt-4 flex items-center gap-3 rounded-xl bg-brand-50 p-3 text-sm dark:bg-brand-500/10">
                <span className="text-lg">{nextOffer.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">Close the gap: {nextOffer.title}</span>
                  <span className="text-xs text-muted">
                    +{formatMoney(nextOffer.userPayoutMicros)} in ~{formatMinutes(nextOffer.medianMinutes ?? nextOffer.estimatedMinutes)}
                  </span>
                </span>
              </Link>
            )}
            {remaining === 0 && (
              <ButtonLink href="/app/cashout" className="mt-4 w-full">
                Cash out {formatMoney(availableMicros)}
              </ButtonLink>
            )}
          </>
        ) : (
          <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>
            Pick a goal
          </Button>
        )}
      </CardBody>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Your savings goal"
        description="We’ll show your progress and suggest the fastest way to get there."
        footer={
          <>
            {goal && (
              <Button
                variant="ghost"
                onClick={async () => {
                  await api('/me/goal', { method: 'DELETE' });
                  await qc.invalidateQueries({ queryKey: qk.me });
                  setOpen(false);
                }}
              >
                Remove goal
              </Button>
            )}
            <Button
              loading={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await api('/me/goal', { method: 'PUT', body: { label, targetMicros: Math.round(Number(target) * 1e6) } });
                  await qc.invalidateQueries({ queryKey: qk.me });
                  setOpen(false);
                } catch (err) {
                  toast({ title: errorMessage(err), tone: 'danger' });
                } finally {
                  setSaving(false);
                }
              }}
            >
              Save goal
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="What are you saving for?">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
          </Field>
          <Field label="Target amount (USD)">
            <Input value={target} onChange={(e) => setTarget(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" />
          </Field>
          <div className="flex flex-wrap gap-2">
            {['5', '10', '25', '50'].map((v) => (
              <button key={v} type="button" onClick={() => setTarget(v)} className={cn('rounded-full border px-3 py-1 text-sm', target === v ? 'border-brand-500 bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-300' : 'border-line')}>
                ${v}
              </button>
            ))}
          </div>
        </div>
      </Modal>
    </Card>
  );
}

export function TierCard({ tier }: { tier: TierProgressDTO }) {
  const cur = TIER_BY_ID[tier.current];
  const next = tier.next ? TIER_BY_ID[tier.next] : null;
  const progress = next && tier.nextThresholdMicros ? (tier.lifetimeMicros / tier.nextThresholdMicros) * 100 : 100;
  return (
    <Card className="overflow-hidden">
      <div className="bg-gradient-to-br from-slate-900 to-emerald-950 p-5 text-white">
        <p className="text-xs uppercase tracking-wider text-white/60">Current tier</p>
        <p className="mt-1 text-2xl font-extrabold">{cur.label}</p>
        <p className="mt-1 text-sm text-white/70">{cur.perks.slice(0, 2).join(' · ')}</p>
        <div className="mt-4 flex gap-1">
          {TIERS.map((t) => (
            <span key={t.id} className={cn('h-1.5 flex-1 rounded-full', TIERS.findIndex((x) => x.id === t.id) <= TIERS.findIndex((x) => x.id === tier.current) ? 'bg-emerald-400' : 'bg-white/15')} />
          ))}
        </div>
      </div>
      <CardBody>
        {next ? (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Next: {next.label}</span>
              <span className="tabular text-muted">
                {formatMoney(tier.lifetimeMicros)} / {formatMoney(tier.nextThresholdMicros ?? 0)}
              </span>
            </div>
            <Progress value={progress} className="mt-2" />
            {tier.missing.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-muted">
                {tier.missing.map((m) => (
                  <li key={m}>• {m}</li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted">Unlocks: {next.perks.slice(0, 2).join(' · ')}</p>
          </>
        ) : (
          <p className="text-sm text-muted">You’re at the top tier. Thank you for being here. 💚</p>
        )}
      </CardBody>
    </Card>
  );
}

export function TxIcon({ tx }: { tx: TransactionDTO }) {
  const out = tx.amountMicros < 0;
  const Icon = tx.type === 'reversal' ? Undo2 : out ? ArrowUpRight : ArrowDownLeft;
  return (
    <span
      className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
        tx.status === 'pending' ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/10' : out ? 'bg-surface-3 text-muted' : 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400',
      )}
    >
      <Icon className="h-5 w-5" />
    </span>
  );
}

export function TransactionRow({ tx }: { tx: TransactionDTO }) {
  const meta = TRANSACTION_TYPE_META[tx.type];
  const inactive = tx.status === 'reversed' || tx.status === 'canceled';
  const href = tx.referenceType === 'payout' ? `/app/cashout/${tx.referenceId}` : undefined;
  const body = (
    <div className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
      <TxIcon tx={tx} />
      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-sm font-medium', inactive && 'text-muted line-through')}>{tx.description}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
          <span>{meta.label}</span>·<TimeAgo iso={tx.createdAt} />
          {tx.status === 'pending' && tx.availableAt && <span className="text-amber-600 dark:text-amber-400">· unlocks {timeUntil(tx.availableAt)}</span>}
          {tx.status === 'pending' && tx.type === 'payout' && <span className="text-sky-600">· sending</span>}
          {tx.status === 'reversed' && <span className="text-rose-600">· reversed{typeof tx.meta.reversalReason === 'string' ? '' : ''}</span>}
          {tx.status === 'canceled' && <span>· refunded</span>}
        </p>
      </div>
      <div className="text-right">
        <Money micros={tx.amountMicros} signed className={cn('text-sm font-bold', inactive ? 'text-muted line-through' : tx.amountMicros > 0 ? 'text-brand-700 dark:text-brand-400' : '')} />
        {tx.status === 'pending' && <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">Pending</p>}
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block hover:bg-surface-2">
      {body}
    </Link>
  ) : (
    body
  );
}

export function PayoutStatusBadge({ status }: { status: keyof typeof PAYOUT_STATUS_META }) {
  const m = PAYOUT_STATUS_META[status];
  return (
    <Badge tone={m.tone} dot>
      {m.label}
    </Badge>
  );
}
