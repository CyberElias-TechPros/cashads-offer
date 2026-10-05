'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, CheckCircle2, FlaskConical, Loader2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, Spinner } from '@/components/ui/feedback';
import { Input } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

interface PartnerView {
  offer: {
    id: string;
    title: string;
    advertiser: string;
    category: string;
    icon: string;
    brandColor: string;
    steps: string[];
    estimatedMinutes: number;
    goals: Array<{ id: string; label: string }>;
    content: {
      questions?: Array<{ id: string; text: string; options: string[] }>;
      lesson?: { title: string; paragraphs: string[]; quiz: Array<{ q: string; options: string[] }> };
      appSteps?: string[];
      formFields?: string[];
    };
    tracking: 'ok' | 'broken';
  };
  click: { id: string; startedAt: string };
  completedGoals: string[];
  completed: boolean;
}

function PartnerSite() {
  const { offerId } = useParams<{ offerId: string }>();
  const click = useSearchParams().get('click') ?? '';
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['partner', offerId, click], queryFn: () => api<PartnerView>(`/sandbox/offers/${offerId}?click=${click}`), enabled: !!click });
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [stepIdx, setStepIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ dropped: boolean; delay: number } | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (data?.completed && !done) setDone({ dropped: data.offer.tracking === 'broken', delay: 0 });
  }, [data, done]);

  if (!click) return <Alert tone="danger">This partner link is missing its click id. Start the offer from CashAds.</Alert>;
  if (isLoading) return <Spinner className="mx-auto mt-24 h-8 w-8" />;
  if (error || !data) return <Alert tone="danger">{errorMessage(error)}</Alert>;
  const o = data.offer;

  async function complete(goalId?: string, quizAnswers?: number[]) {
    setBusy(true);
    setErr(null);
    try {
      const res = await api<{ dropped: boolean; delaySeconds: number }>(`/sandbox/offers/${offerId}/complete`, { body: { clickId: click, goalId, answers: quizAnswers } });
      if (goalId) {
        await qc.invalidateQueries({ queryKey: ['partner', offerId, click] });
        const remaining = o.goals.filter((g) => g.id !== goalId && !data!.completedGoals.includes(g.id));
        if (remaining.length === 0) setDone({ dropped: res.dropped, delay: res.delaySeconds });
      } else setDone({ dropped: res.dropped, delay: res.delaySeconds });
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const back = `/app/earn/${offerId}?returned=1`;
  const accent = { background: o.brandColor };

  if (done) {
    return (
      <div className="mx-auto max-w-md rounded-3xl border border-line bg-surface p-8 text-center shadow-lift">
        <CheckCircle2 className="mx-auto h-14 w-14" style={{ color: o.brandColor }} />
        <h1 className="mt-4 text-2xl font-bold">You’re all done!</h1>
        <p className="mt-2 text-sm text-muted">{o.advertiser} is notifying CashAds now. Your reward usually lands within seconds.</p>
        {done.dropped && (
          <Alert tone="warning" className="mt-5 text-left" icon={<FlaskConical className="h-4 w-4" />} title="Sandbox: this partner will lose the postback">
            Back on CashAds, nothing will arrive. File a <strong>Missing credit</strong> claim: CashAds asks this partner’s API, finds your completion and pays you automatically.
          </Alert>
        )}
        <Link href={back} className="mt-6 flex h-12 items-center justify-center rounded-xl text-sm font-bold text-white" style={accent}>
          Return to CashAds
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="overflow-hidden rounded-3xl border border-line bg-surface shadow-lift">
        <div className="flex items-center gap-3 px-6 py-5 text-white" style={accent}>
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/20 text-2xl">{o.icon}</span>
          <div>
            <p className="text-lg font-bold leading-tight">{o.advertiser}</p>
            <p className="text-sm text-white/80">{o.title}</p>
          </div>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-xs">
            <Lock className="h-3 w-3" /> Secure
          </span>
        </div>
        <div className="p-6 sm:p-8">
          {err && (
            <Alert tone="danger" className="mb-5">
              {err}
            </Alert>
          )}

          {/* Surveys & polls */}
          {o.content.questions && (
            <div className="space-y-6">
              {o.content.questions.map((q, qi) => (
                <fieldset key={q.id}>
                  <legend className="text-sm font-semibold">
                    {qi + 1}. {q.text}
                  </legend>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {q.options.map((opt, oi) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setAnswers((a) => ({ ...a, [q.id]: oi }))}
                        className={cn('rounded-xl border px-4 py-2.5 text-left text-sm transition-colors', answers[q.id] === oi ? 'border-transparent font-semibold text-white' : 'border-line hover:border-line-strong')}
                        style={answers[q.id] === oi ? accent : undefined}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </fieldset>
              ))}
              <Button className="w-full" size="lg" loading={busy} disabled={Object.keys(answers).length < o.content.questions.length} onClick={() => complete()} style={accent}>
                Submit answers
              </Button>
            </div>
          )}

          {/* Learn: lesson + quiz */}
          {o.content.lesson && (
            <div>
              <h2 className="text-xl font-bold">{o.content.lesson.title}</h2>
              <div className="mt-4 space-y-3 text-sm leading-relaxed text-muted">
                {o.content.lesson.paragraphs.map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </div>
              <div className="mt-8 space-y-5 rounded-2xl bg-surface-2 p-5">
                <p className="text-sm font-semibold">Quick quiz — get all 3 right</p>
                {o.content.lesson.quiz.map((q, qi) => (
                  <fieldset key={q.q}>
                    <legend className="text-sm font-medium">{q.q}</legend>
                    <div className="mt-2 space-y-1.5">
                      {q.options.map((opt, oi) => (
                        <label key={opt} className="flex cursor-pointer items-center gap-2 text-sm">
                          <input type="radio" name={`q${qi}`} checked={answers[`q${qi}`] === oi} onChange={() => setAnswers((a) => ({ ...a, [`q${qi}`]: oi }))} className="accent-emerald-600" />
                          {opt}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
                <Button className="w-full" loading={busy} disabled={Object.keys(answers).length < o.content.lesson.quiz.length} onClick={() => complete(undefined, o.content.lesson!.quiz.map((_, i) => answers[`q${i}`]))} style={accent}>
                  Check my answers
                </Button>
              </div>
            </div>
          )}

          {/* Sign-up forms */}
          {o.content.formFields && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void complete();
              }}
            >
              {o.content.formFields.map((f) => (
                <label key={f} className="block text-sm font-medium">
                  {f}
                  <Input className="mt-1.5" required value={form[f] ?? ''} onChange={(e) => setForm((x) => ({ ...x, [f]: e.target.value }))} placeholder={f.includes('Card') ? '4242 4242 4242 4242 (sandbox)' : ''} />
                </label>
              ))}
              <Button type="submit" className="w-full" size="lg" loading={busy} style={accent}>
                Create my account
              </Button>
              <p className="text-center text-xs text-muted">Sandbox form — nothing is stored or charged.</p>
            </form>
          )}

          {/* App / finance / shopping step flows */}
          {o.content.appSteps && (
            <div>
              <ol className="space-y-3">
                {o.content.appSteps.map((s, i) => (
                  <li key={s} className={cn('flex items-center gap-3 rounded-2xl border p-4', i < stepIdx ? 'border-transparent bg-surface-2' : 'border-line')}>
                    <span className={cn('flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold', i < stepIdx ? 'text-white' : 'bg-surface-3 text-muted')} style={i < stepIdx ? accent : undefined}>
                      {i < stepIdx ? <Check className="h-4 w-4" /> : i + 1}
                    </span>
                    <span className={cn('flex-1 text-sm font-medium', i < stepIdx && 'text-muted line-through')}>{s}</span>
                    {i === stepIdx && (
                      <Button
                        size="sm"
                        loading={busy}
                        style={accent}
                        onClick={async () => {
                          setBusy(true);
                          await new Promise((r) => setTimeout(r, 700));
                          setBusy(false);
                          if (i === o.content.appSteps!.length - 1) await complete();
                          else setStepIdx(i + 1);
                        }}
                      >
                        {i === o.content.appSteps!.length - 1 ? 'Finish' : 'Do it'}
                      </Button>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Games with milestones */}
          {o.goals.length > 0 && !o.content.appSteps && (
            <div className="space-y-3">
              <p className="text-sm text-muted">Simulated progress: tap to “reach” each milestone in order. Each one sends its own postback.</p>
              {o.goals.map((g, i) => {
                const reached = data.completedGoals.includes(g.id);
                const next = !reached && o.goals.slice(0, i).every((p) => data.completedGoals.includes(p.id));
                return (
                  <div key={g.id} className={cn('flex items-center gap-3 rounded-2xl border p-4', reached ? 'border-transparent bg-surface-2' : 'border-line')}>
                    <span className="text-2xl">{reached ? '🏆' : next ? '🎯' : '🔒'}</span>
                    <span className="flex-1 text-sm font-medium">{g.label}</span>
                    {reached ? (
                      <span className="text-xs font-semibold text-brand-600">Reached ✓</span>
                    ) : (
                      <Button size="sm" disabled={!next} loading={busy && next} onClick={() => complete(g.id)} style={next ? accent : undefined}>
                        {busy && next ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Reach it'}
                      </Button>
                    )}
                  </div>
                );
              })}
              {data.completedGoals.length > 0 && (
                <Link href={back} className="block pt-2 text-center text-sm font-semibold underline">
                  Back to CashAds (milestones keep paying as you progress)
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
      <Link href={`/app/earn/${offerId}`} className="mt-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Leave without finishing
      </Link>
    </div>
  );
}

export default function PartnerPage() {
  return (
    <div className="min-h-screen bg-surface-2">
      <div className="border-b border-amber-300/50 bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
        <FlaskConical className="mr-1 inline h-3.5 w-3.5" /> Simulated partner website (sandbox). In production, members land on the advertiser’s real site, and that site notifies CashAds the same way.
      </div>
      <div className="px-4 py-10">
        <Suspense>
          <PartnerSite />
        </Suspense>
      </div>
    </div>
  );
}
