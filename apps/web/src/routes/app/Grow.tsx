import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Crown, Gift, Heart, Lock, MessageCircle, Send, Share2, Trophy, Users } from 'lucide-react';
import { useState } from 'react';
import {
  type AchievementDTO,
  type CharityDTO,
  type LeaderboardDTO,
  type MeDTO,
  type ReferralDTO,
  TIERS,
  type TierProgressDTO,
  formatUsd,
  parseDollarInput,
} from '@cashads/shared';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  CopyButton,
  EmptyState,
  Input,
  PageHeader,
  Progress,
  Skeleton,
  Stat,
  Switch,
} from '../../components/ui';
import { errorMessage, get, patch, post } from '../../lib/api';
import { qk, useMe } from '../../lib/queries';
import { cn, shortDate } from '../../lib/utils';
import { toast } from '../../store/ui';

export function Referrals() {
  const { data, isLoading } = useQuery({
    queryKey: ['referrals'],
    queryFn: () => get<ReferralDTO>('/referrals'),
  });
  if (isLoading || !data) return <Skeleton className="h-96" />;
  const message = `I’m earning real cash for short tasks on CashAds — no points, cash out from $0.01. Join with my link and we both get ${formatUsd(data.bonusMicros)}: ${data.link}`;
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'CashAds', text: message, url: data.link });
      } catch {
        /* cancelled */
      }
    }
  };
  return (
    <div className="space-y-5">
      <PageHeader
        title="Invite friends"
        subtitle={`You both get ${formatUsd(data.bonusMicros)} when they complete their first task — plus ${data.residualPercent}% of their task earnings, forever.`}
      />
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-6">
          <p className="text-sm font-medium text-slate-500">Your invite link</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <div className="flex-1 truncate rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 font-mono text-sm dark:border-slate-700 dark:bg-slate-800">
              {data.link}
            </div>
            <CopyButton value={data.link} label="Copy link" className="h-11" />
          </div>
          <p className="mt-2 text-sm text-slate-500">
            Code: <span className="font-mono font-semibold text-slate-900 dark:text-white">{data.code}</span>
          </p>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <a
              className="flex items-center justify-center gap-2 rounded-xl bg-[#25D366] px-3 py-2.5 text-sm font-semibold text-white hover:opacity-90"
              href={`https://wa.me/?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle className="size-4" /> WhatsApp
            </a>
            <a
              className="flex items-center justify-center gap-2 rounded-xl bg-[#229ED9] px-3 py-2.5 text-sm font-semibold text-white hover:opacity-90"
              href={`https://t.me/share/url?url=${encodeURIComponent(data.link)}&text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noreferrer"
            >
              <Send className="size-4" /> Telegram
            </a>
            <a
              className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white hover:opacity-90 dark:bg-white dark:text-slate-900"
              href={`https://x.com/intent/post?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noreferrer"
            >
              𝕏 Post
            </a>
            <Button variant="outline" onClick={share} className="h-auto py-2.5">
              <Share2 className="size-4" /> More
            </Button>
          </div>
          <Callout tone="info" className="mt-5">
            Bonuses are paid by CashAds — never taken from your friend. Self-referrals (same device or payout
            account) are detected and don’t pay.
          </Callout>
        </Card>
        <Card className="flex flex-col items-center justify-center p-6 text-center">
          <img
            src="/api/referrals/qr.svg"
            alt="QR code for your invite link"
            className="size-48 rounded-2xl border border-slate-200 bg-white p-2"
          />
          <p className="mt-3 text-sm text-slate-500">Let friends scan it in person</p>
        </Card>
      </div>
      <Card className="grid grid-cols-3 gap-4 p-6">
        <Stat label="Invited" value={data.stats.invited} icon={<Users className="size-3.5" />} />
        <Stat label="Qualified" value={data.stats.qualified} />
        <Stat label="Earned from invites" value={formatUsd(data.stats.earnedMicros)} />
      </Card>
      <Card>
        <CardHeader title="Your invites" />
        {data.referees.length === 0 ? (
          <EmptyState
            icon="🤝"
            title="No invites yet"
            body="Share your link on WhatsApp — most people join from a friend they trust."
          />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.referees.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <p className="font-medium">{r.label}</p>
                  <p className="text-xs text-slate-500">Joined {shortDate(r.joinedAt)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge
                    tone={
                      r.status === 'qualified' ? 'success' : r.status === 'rejected' ? 'danger' : 'warning'
                    }
                  >
                    {r.status === 'pending' ? 'Waiting for first task' : r.status}
                  </Badge>
                  <span className="tabular font-semibold">{formatUsd(r.earnedForYouMicros)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function Leaderboard() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data, isLoading } = useQuery({
    queryKey: ['leaderboard'],
    queryFn: () => get<LeaderboardDTO>('/leaderboard'),
  });
  const optIn = useMutation({
    mutationFn: (v: boolean) => patch<{ user: MeDTO }>('/me/prefs', { leaderboardOptIn: v }),
    onSuccess: (r) => {
      qc.setQueryData(qk.me, r.user);
      qc.invalidateQueries({ queryKey: ['leaderboard'] });
    },
  });
  if (isLoading || !data) return <Skeleton className="h-96" />;
  return (
    <div className="space-y-5">
      <PageHeader
        title="This week’s leaderboard"
        subtitle={`Task earnings since ${shortDate(data.startsAt)}. Just for fun — no prizes, so there’s nothing to game.`}
      />
      <Card className="flex flex-wrap items-center justify-between gap-4 bg-gradient-to-br from-violet-600 to-indigo-700 p-6 text-white">
        <div>
          <p className="text-sm text-violet-200">Your position</p>
          <p className="text-3xl font-bold">{data.me.rank ? `#${data.me.rank}` : 'Not ranked yet'}</p>
          {data.me.percentile && (
            <p className="text-sm text-violet-100">Top {data.me.percentile}% this week</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-sm text-violet-200">Earned this week</p>
          <p className="tabular text-2xl font-bold">{formatUsd(data.me.earnedMicros)}</p>
        </div>
      </Card>
      <Card>
        <Switch
          checked={Boolean(me?.prefs.leaderboardOptIn)}
          onChange={(v) => optIn.mutate(v)}
          label="Show my display name"
          description="Off by default (privacy-first). When off you appear as “Member #ABCD”."
        />
      </Card>
      <Card padded={false}>
        <ol className="divide-y divide-slate-100 dark:divide-slate-800">
          {data.entries.map((e) => (
            <li
              key={e.rank}
              className={cn(
                'flex items-center gap-4 px-5 py-3',
                e.isMe && 'bg-brand-50/70 dark:bg-brand-950/30',
              )}
            >
              <span
                className={cn(
                  'flex size-8 items-center justify-center rounded-full text-sm font-bold',
                  e.rank === 1
                    ? 'bg-amber-400 text-white'
                    : e.rank === 2
                      ? 'bg-slate-300 text-slate-800'
                      : e.rank === 3
                        ? 'bg-orange-300 text-orange-900'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
                )}
              >
                {e.rank === 1 ? <Crown className="size-4" /> : e.rank}
              </span>
              <span className="flex-1 truncate font-medium">{e.name}</span>
              <span className="text-xs capitalize text-slate-400">{e.tier}</span>
              <span className="tabular w-20 text-right font-semibold">{formatUsd(e.earnedMicros)}</span>
            </li>
          ))}
          {data.entries.length === 0 && (
            <li className="p-6 text-center text-sm text-slate-500">No earnings yet this week — be first!</li>
          )}
        </ol>
      </Card>
    </div>
  );
}

export function Achievements() {
  const { data: list } = useQuery({
    queryKey: ['achievements'],
    queryFn: () => get<AchievementDTO[]>('/achievements'),
  });
  const { data: tier } = useQuery({ queryKey: ['tier'], queryFn: () => get<TierProgressDTO>('/tier') });
  const unlocked = list?.filter((a) => a.unlockedAt).length ?? 0;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Tiers & achievements"
        subtitle="Tiers are about trust: the longer your good track record, the more we pay instantly when tracking fails."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {TIERS.map((t) => {
          const current = tier?.current.id === t.id;
          return (
            <Card key={t.id} className={cn('p-5', current && 'ring-2 ring-brand-500')}>
              <div className="flex items-center justify-between">
                <p className="text-lg font-bold" style={{ color: t.color }}>
                  {t.name}
                </p>
                {current && <Badge tone="brand">You</Badge>}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {t.minLifetimeMicros
                  ? `${formatUsd(t.minLifetimeMicros, { precision: 0 })}+ earned`
                  : 'Everyone starts here'}
                {t.minAccountAgeDays ? ` · ${t.minAccountAgeDays}+ days` : ''}
                {t.requiresKyc ? ' · ID verified' : ''}
              </p>
              <ul className="mt-3 space-y-1 text-sm text-slate-600 dark:text-slate-400">
                {t.perks.map((p) => (
                  <li key={p}>• {p}</li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
      <Card>
        <CardHeader
          title="Achievements"
          subtitle={`${unlocked} of ${list?.length ?? 0} unlocked`}
          icon={<Trophy className="size-5 text-amber-500" />}
        />
        <Progress value={list ? unlocked / list.length : 0} tone="amber" className="mb-5" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {list?.map((a) => (
            <div
              key={a.code}
              className={cn(
                'rounded-2xl border p-4 text-center',
                a.unlockedAt
                  ? 'border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20'
                  : 'border-slate-200 opacity-60 dark:border-slate-800',
              )}
            >
              <div className="text-3xl">
                {a.unlockedAt ? a.icon : <Lock className="mx-auto size-7 text-slate-400" />}
              </div>
              <p className="mt-2 text-sm font-semibold">{a.title}</p>
              <p className="mt-0.5 text-xs text-slate-500">{a.description}</p>
              {a.unlockedAt && (
                <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                  {shortDate(a.unlockedAt)}
                </p>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export function Charity() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: charities } = useQuery({
    queryKey: ['charities'],
    queryFn: () => get<CharityDTO[]>('/charity'),
  });
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [pct, setPct] = useState<number>(me?.prefs.charityPercent ?? 0);
  const prefs = useMutation({
    mutationFn: (v: { charityPercent: number; charityId: string | null }) =>
      patch<{ user: MeDTO }>('/me/prefs', v),
    onSuccess: (r) => {
      qc.setQueryData(qk.me, r.user);
      toast.success(
        'Saved',
        r.user.prefs.charityPercent
          ? `${r.user.prefs.charityPercent}% of every task now goes to your cause.`
          : 'Auto-donation turned off.',
      );
    },
  });
  const donate = useMutation({
    mutationFn: ({ charityId, amountMicros }: { charityId: string; amountMicros: number }) =>
      post<CharityDTO[]>('/charity/donate', { charityId, amountMicros }),
    onSuccess: (r) => {
      qc.setQueryData(['charities'], r);
      qc.invalidateQueries({ queryKey: qk.wallet });
    },
    onError: (err) => toast.error('Couldn’t donate', errorMessage(err)),
  });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Earn for a cause"
        subtitle="Give part of what you earn to verified causes — and see the impact."
      />
      <Card>
        <CardHeader
          title="Auto-donate"
          subtitle="A share of every task you complete goes to your chosen cause."
          icon={<Heart className="size-5 text-rose-500" />}
        />
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <label className="text-sm font-medium">Share of each task: {pct}%</label>
            <input
              type="range"
              min={0}
              max={50}
              step={5}
              value={pct}
              onChange={(e) => setPct(Number(e.target.value))}
              className="mt-2 w-full accent-rose-500"
            />
          </div>
          <Button
            onClick={() =>
              prefs.mutate({
                charityPercent: pct,
                charityId: pct ? (me?.prefs.charityId ?? charities?.[0]?.id ?? null) : null,
              })
            }
            loading={prefs.isPending}
          >
            Save
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Current cause:{' '}
          {charities?.find((c) => c.id === me?.prefs.charityId)?.name ?? 'none selected — pick one below'}
        </p>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {charities?.map((c) => {
          const units = Math.floor(c.myDonatedMicros / c.impactUnitMicros);
          return (
            <Card key={c.id} className="flex flex-col">
              <div className="flex items-start gap-3">
                <span className="text-3xl">{c.icon}</span>
                <div className="flex-1">
                  <p className="font-semibold">{c.name}</p>
                  <p className="text-sm text-slate-500">{c.description}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/50">
                <div>
                  <p className="text-xs text-slate-500">Your impact</p>
                  <p className="font-semibold">
                    {units} {c.impactUnit}
                    {units === 1 ? '' : 's'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">All members</p>
                  <p className="tabular font-semibold">{formatUsd(c.totalDonatedMicros)}</p>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <Input
                  aria-label="Amount"
                  prefix="$"
                  placeholder="1.00"
                  value={amounts[c.id] ?? ''}
                  onChange={(e) => setAmounts({ ...amounts, [c.id]: e.target.value })}
                />
                <Button
                  className="h-11"
                  loading={donate.isPending && donate.variables?.charityId === c.id}
                  onClick={() => {
                    const micros = parseDollarInput(amounts[c.id] ?? '');
                    if (!micros) return toast.error('Enter an amount like 1.00');
                    donate.mutate({ charityId: c.id, amountMicros: micros });
                  }}
                >
                  <Gift className="size-4" /> Donate
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 self-start"
                onClick={() => prefs.mutate({ charityPercent: Math.max(pct, 5), charityId: c.id })}
              >
                {me?.prefs.charityId === c.id ? '✓ Your auto-donate cause' : 'Make this my auto-donate cause'}
              </Button>
              <p className="mt-1 text-xs text-slate-400">
                {formatUsd(c.impactUnitMicros)} = 1 {c.impactUnit}
              </p>
            </Card>
          );
        })}
      </div>
      <Callout tone="info">
        Sandbox causes are illustrative. In production, donations are disbursed monthly to verified nonprofits
        and receipts are published on the transparency page.
      </Callout>
    </div>
  );
}
