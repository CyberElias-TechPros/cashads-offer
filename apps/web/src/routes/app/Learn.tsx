import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, Clock, GraduationCap } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { type LessonDTO, type LessonSummaryDTO, formatUsd } from '@lucrum/shared';
import { Badge, Button, ButtonLink, Callout, Card, PageHeader, Skeleton } from '../../components/ui';
import { errorMessage, get, post } from '../../lib/api';
import { qk } from '../../lib/queries';
import { cn } from '../../lib/utils';

export function Lessons() {
  const { data: lessons, isLoading } = useQuery({
    queryKey: ['lessons'],
    queryFn: () => get<LessonSummaryDTO[]>('/lessons'),
  });
  return (
    <div>
      <PageHeader
        title="Earn + learn"
        subtitle="Get paid to learn things that actually help — money skills, scam-spotting, safer crypto."
        back={{ to: '/app/earn', label: 'All tasks' }}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {isLoading && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-40" />)}
        {lessons?.map((l) => (
          <Link
            key={l.id}
            to={`/app/learn/${l.id}`}
            className={cn(
              'rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900',
              l.passed && 'opacity-70',
            )}
          >
            <div className="flex items-start justify-between">
              <span className="text-4xl">{l.icon}</span>
              {l.passed ? (
                <Badge tone="success">Passed</Badge>
              ) : (
                <span className="tabular rounded-full bg-brand-50 px-2.5 py-1 text-sm font-bold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                  +{formatUsd(l.rewardMicros)}
                </span>
              )}
            </div>
            <h2 className="mt-3 font-semibold">{l.title}</h2>
            <p className="mt-1 text-sm text-slate-500">{l.summary}</p>
            <p className="mt-3 flex items-center gap-1 text-xs text-slate-400">
              <Clock className="size-3.5" /> {l.minutes} min · sponsored by {l.sponsor}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}

interface SubmitResult {
  score: number;
  passed: boolean;
  rewardMicros: number;
  correct: boolean[];
  retryAt: string | null;
}

export function LessonPage() {
  const { lessonId = '' } = useParams();
  const qc = useQueryClient();
  const { data: lesson, isLoading } = useQuery({
    queryKey: ['lesson', lessonId],
    queryFn: () => get<LessonDTO>(`/lessons/${lessonId}`),
  });
  const [answers, setAnswers] = useState<(number | undefined)[]>([]);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const submit = useMutation({
    mutationFn: () =>
      post<SubmitResult>(`/lessons/${lessonId}/submit`, { answers: answers.map((a) => a ?? 0) }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ['lessons'] });
      qc.invalidateQueries({ queryKey: qk.wallet });
    },
  });
  if (isLoading || !lesson) return <Skeleton className="h-96" />;
  const complete = lesson.quiz.every((_, i) => answers[i] !== undefined);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span>{lesson.icon}</span> {lesson.title}
          </span>
        }
        subtitle={`${lesson.minutes} min · pass ${Math.round(lesson.passMark * 100)}% to earn ${formatUsd(lesson.rewardMicros)} · ${lesson.sponsor}`}
        back={{ to: '/app/learn', label: 'All lessons' }}
      />
      {lesson.passed && !result && (
        <Callout tone="success" className="mb-5">
          You passed this lesson already. Feel free to review it — rewards are paid once.
        </Callout>
      )}
      <div className="space-y-4">
        {lesson.sections.map((s) => (
          <Card key={s.heading}>
            <h2 className="font-semibold">{s.heading}</h2>
            <p className="mt-2 leading-relaxed text-slate-700 dark:text-slate-300">{s.body}</p>
          </Card>
        ))}
      </div>
      <Card className="mt-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <GraduationCap className="size-5 text-violet-500" /> Quick quiz
        </h2>
        <div className="mt-4 space-y-6">
          {lesson.quiz.map((q, qi) => (
            <fieldset key={q.question}>
              <legend className="font-medium">
                {qi + 1}. {q.question}
              </legend>
              <div className="mt-2 space-y-2">
                {q.options.map((opt, oi) => {
                  const chosen = answers[qi] === oi;
                  const graded = result && chosen;
                  return (
                    <label
                      key={opt}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm transition',
                        chosen
                          ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-950/30'
                          : 'border-slate-200 dark:border-slate-800',
                        graded &&
                          (result.correct[qi]
                            ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30'
                            : 'border-rose-400 bg-rose-50 dark:bg-rose-950/30'),
                      )}
                    >
                      <input
                        type="radio"
                        name={`q${qi}`}
                        className="accent-brand-600"
                        checked={chosen}
                        onChange={() => {
                          setResult(null);
                          setAnswers((a) => {
                            const n = [...a];
                            n[qi] = oi;
                            return n;
                          });
                        }}
                      />
                      <span className="flex-1">{opt}</span>
                      {graded &&
                        (result.correct[qi] ? (
                          <CircleCheck className="size-4 text-emerald-600" />
                        ) : (
                          <CircleX className="size-4 text-rose-500" />
                        ))}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
        {submit.isError && (
          <Callout tone="warning" className="mt-4">
            {errorMessage(submit.error)}
          </Callout>
        )}
        {result && (
          <Callout
            tone={result.passed ? 'success' : 'warning'}
            className="mt-5"
            title={
              result.passed
                ? `Passed — ${Math.round(result.score * 100)}%`
                : `Score ${Math.round(result.score * 100)}% — not quite`
            }
          >
            {result.passed
              ? result.rewardMicros > 0
                ? `+${formatUsd(result.rewardMicros)} added to your balance.`
                : 'Already rewarded earlier — thanks for reviewing!'
              : 'Have another read of the lesson. You can retry in a couple of minutes.'}
          </Callout>
        )}
        <div className="mt-5 flex gap-2">
          <Button onClick={() => submit.mutate()} disabled={!complete} loading={submit.isPending}>
            Submit answers
          </Button>
          {result?.passed && (
            <ButtonLink to="/app/learn" variant="outline">
              Next lesson
            </ButtonLink>
          )}
        </div>
      </Card>
    </div>
  );
}
