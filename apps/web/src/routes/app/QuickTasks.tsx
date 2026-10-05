import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, Timer, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type PollDTO, formatUsd } from '@cashads/shared';
import { Button, ButtonLink, Callout, Card, EmptyState, PageHeader, Skeleton } from '../../components/ui';
import { ApiError, errorMessage, get, post } from '../../lib/api';
import { qk } from '../../lib/queries';
import { cn } from '../../lib/utils';

interface AnswerResult {
  rewardMicros: number;
  distribution: number[];
  next: PollDTO | null;
}

/** "While you wait" micro-task mode (spec pain points #11 and #6): text-only, ~20 seconds each. */
export function QuickTasks() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['polls', 'next'],
    queryFn: () => get<{ poll: PollDTO | null }>('/polls/next'),
  });
  const [poll, setPoll] = useState<PollDTO | null>(null);
  const [result, setResult] = useState<{ choice: number; res: AnswerResult } | null>(null);
  const [session, setSession] = useState({ count: 0, earned: 0, started: Date.now() });
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (data && !poll && !result) setPoll(data.poll);
  }, [data, poll, result]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const answer = useMutation({
    mutationFn: ({ id, optionIndex }: { id: string; optionIndex: number }) =>
      post<AnswerResult>(`/polls/${id}/answer`, { optionIndex }),
    onSuccess: (res, vars) => {
      setError(null);
      setResult({ choice: vars.optionIndex, res });
      setSession((s) => ({ ...s, count: s.count + 1, earned: s.earned + res.rewardMicros }));
      qc.invalidateQueries({ queryKey: qk.wallet });
      timer.current = setTimeout(() => {
        setResult(null);
        setPoll(res.next);
      }, 1600);
    },
    onError: (err) =>
      setError(
        err instanceof ApiError && err.code === 'RATE_LIMITED'
          ? 'Slow down a little — read each question before answering. 🙂'
          : errorMessage(err),
      ),
  });

  const elapsed = Math.max(1, Math.round((Date.now() - session.started) / 1000));

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title="Quick tasks"
        subtitle="One question at a time. Text only — uses almost no data."
        back={{ to: '/app/earn', label: 'All tasks' }}
      />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <SessionStat label="Answered" value={String(session.count)} />
        <SessionStat label="Earned now" value={formatUsd(session.earned)} />
        <SessionStat
          label="Time"
          value={`${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`}
        />
      </div>
      {error && (
        <Callout tone="warning" className="mb-4">
          {error}
        </Callout>
      )}
      {isLoading ? (
        <Skeleton className="h-80" />
      ) : poll ? (
        <Card key={poll.id} className="animate-slide-up p-6">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <Timer className="size-3.5" /> ~{poll.estSeconds}s · {poll.sponsor}
            </span>
            <span className="tabular rounded-full bg-brand-50 px-2.5 py-1 font-semibold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
              +{formatUsd(poll.rewardMicros)}
            </span>
          </div>
          <h2 className="mt-4 text-xl font-semibold leading-snug">{poll.question}</h2>
          <div className="mt-5 space-y-2.5">
            {poll.options.map((opt, i) => {
              const share = result?.res.distribution[i];
              const chosen = result?.choice === i;
              return (
                <button
                  key={opt}
                  disabled={Boolean(result) || answer.isPending}
                  onClick={() => answer.mutate({ id: poll.id, optionIndex: i })}
                  className={cn(
                    'relative w-full overflow-hidden rounded-2xl border px-4 py-3.5 text-left font-medium transition',
                    chosen
                      ? 'border-brand-500 ring-2 ring-brand-500/20'
                      : 'border-slate-200 hover:border-slate-400 dark:border-slate-700',
                    result && !chosen && 'opacity-70',
                  )}
                >
                  {share !== undefined && (
                    <span
                      className="absolute inset-y-0 left-0 bg-brand-100/70 transition-[width] duration-700 dark:bg-brand-900/40"
                      style={{ width: `${share}%` }}
                    />
                  )}
                  <span className="relative flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2">
                      {chosen && <Check className="size-4 text-brand-600" />}
                      {opt}
                    </span>
                    {share !== undefined && <span className="tabular text-sm text-slate-500">{share}%</span>}
                  </span>
                </button>
              );
            })}
          </div>
          {result && (
            <p className="mt-4 animate-fade-in text-center text-sm font-semibold text-brand-700 dark:text-brand-400">
              +{formatUsd(result.res.rewardMicros)} credited · here’s how other members answered
            </p>
          )}
          <p className="mt-4 text-center text-xs text-slate-400">{poll.remaining} quick tasks left today</p>
        </Card>
      ) : (
        <EmptyState
          icon="🎉"
          title="You’ve answered every quick task"
          body="New ones arrive daily. Meanwhile, these pay more per task:"
          action={
            <div className="flex gap-2">
              <ButtonLink to="/app/earn?category=quick">
                <Zap className="size-4" /> 1–2 minute tasks
              </ButtonLink>
              <ButtonLink to="/app/learn" variant="outline">
                Earn + learn <ArrowRight className="size-4" />
              </ButtonLink>
            </div>
          }
        />
      )}
      <p className="mt-6 text-center text-xs text-slate-500">
        Answers are anonymous and aggregated. Sponsors pay CashAds; you get 60%.
      </p>
      {session.count >= 3 && (
        <div className="mt-4 text-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSession({ count: 0, earned: 0, started: Date.now() })}
          >
            Reset session counter
          </Button>
        </div>
      )}
    </div>
  );
}

function SessionStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center dark:border-slate-800 dark:bg-slate-900">
      <p className="tabular text-lg font-bold">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
