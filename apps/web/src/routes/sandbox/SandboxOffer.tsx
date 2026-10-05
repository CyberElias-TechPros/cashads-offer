import { useMutation, useQuery } from '@tanstack/react-query';
import { CircleCheck, Download, FlaskConical, Loader2, Settings2, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { formatUsd } from '@cashads/shared';
import { Button, Callout, Checkbox, Input } from '../../components/ui';
import { errorMessage, get, post } from '../../lib/api';
import { cn } from '../../lib/utils';

interface SandboxClick {
  clickId: string;
  status: string;
  networkName: string;
  alreadyConverted: boolean;
  offer: {
    id: string;
    title: string;
    advertiser: string;
    category: string;
    description: string;
    steps: string[];
    icon: string;
    color: string;
    estMinutes: number;
    userPayoutMicros: number;
  };
}

type Mode = 'deliver' | 'drop' | 'duplicate' | 'bad_signature' | 'screenout';

const MODES: { id: Mode; label: string; detail: string; surveyOnly?: boolean }[] = [
  {
    id: 'deliver',
    label: 'Deliver the postback normally',
    detail: 'Signed server-to-server postback → credited within seconds.',
  },
  {
    id: 'drop',
    label: 'Lose the postback (tracking failure)',
    detail: 'The network records it but never tells CashAds. Then use “I finished” or Missing Credit.',
  },
  {
    id: 'duplicate',
    label: 'Send it twice',
    detail: 'Networks retry. CashAds dedupes on the transaction id and credits once.',
  },
  {
    id: 'bad_signature',
    label: 'Corrupt the signature',
    detail: 'Rejected as untrusted and logged. A claim still resolves via the network’s API.',
  },
  {
    id: 'screenout',
    label: 'Survey screen-out',
    detail: 'You didn’t qualify — the network pays a small screen-out fee, passed on to you.',
    surveyOnly: true,
  },
];

/**
 * A simulated third-party advertiser page (SandboxNet). In production this is the
 * advertiser's real site; CashAds only sees the result through a signed postback.
 */
export function SandboxOffer() {
  const { clickId = '' } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ['sandbox-click', clickId],
    queryFn: () => get<SandboxClick>(`/sandbox/clicks/${clickId}`),
    retry: false,
  });
  const [mode, setMode] = useState<Mode>('deliver');
  const [ready, setReady] = useState(false);
  const complete = useMutation({
    mutationFn: () =>
      post<{ message: string; networkTxnId: string }>(`/sandbox/clicks/${clickId}/complete`, { mode }),
  });
  const reverse = useMutation({ mutationFn: () => post(`/sandbox/clicks/${clickId}/reverse`) });

  useEffect(() => {
    document.title = data ? `${data.offer.advertiser} — sandbox advertiser` : 'Sandbox advertiser';
  }, [data]);

  const back = () => {
    if (window.opener) window.close();
    else navigate('/app/activity');
  };

  if (isLoading)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-slate-400" />
      </div>
    );
  if (error || !data) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <p className="text-lg font-semibold">This tracking link isn’t valid for your session.</p>
        <p className="mt-2 text-sm text-slate-500">{errorMessage(error)}</p>
        <Button className="mt-4" onClick={() => navigate('/app/earn')}>
          Back to CashAds
        </Button>
      </div>
    );
  }
  const o = data.offer;
  const done = complete.isSuccess || data.alreadyConverted;
  return (
    <div className="min-h-screen bg-stone-100 font-serif text-stone-900">
      <div className="flex items-center justify-center gap-2 bg-amber-400 px-4 py-1.5 text-center font-sans text-xs font-semibold text-amber-950">
        <FlaskConical className="size-3.5" /> SANDBOX ADVERTISER SITE — simulated third party via{' '}
        {data.networkName} · click {clickId.slice(0, 8)}
      </div>
      <header className="text-white" style={{ background: o.color }}>
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-5">
          <span className="flex size-11 items-center justify-center rounded-full bg-white/20 text-2xl">
            {o.icon}
          </span>
          <div>
            <p className="text-xl font-bold">{o.advertiser.replace(' (sandbox)', '')}</p>
            <p className="font-sans text-xs opacity-80">{o.title}</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">
        {!done ? (
          <div className="rounded-2xl bg-white p-6 shadow-sm">
            <Experience category={o.category} onReady={setReady} color={o.color} />
          </div>
        ) : (
          <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
            <CircleCheck className="mx-auto size-12 text-emerald-600" />
            <h1 className="mt-3 text-2xl font-bold">Thank you!</h1>
            <p className="mt-2 font-sans text-stone-600">
              {complete.data?.message ?? 'The network already recorded this completion.'}
            </p>
            {complete.data && (
              <p className="mt-1 font-mono text-xs text-stone-400">
                network txn {complete.data.networkTxnId}
              </p>
            )}
            <div className="mt-6 flex flex-col justify-center gap-2 font-sans sm:flex-row">
              <Button onClick={back}>Return to CashAds</Button>
              {(mode === 'deliver' || mode === 'duplicate') && (
                <Button
                  variant="outline"
                  onClick={() => reverse.mutate()}
                  loading={reverse.isPending}
                  disabled={reverse.isSuccess}
                >
                  {reverse.isSuccess ? 'Chargeback sent' : 'Simulate advertiser chargeback'}
                </Button>
              )}
            </div>
            {reverse.isSuccess && (
              <p className="mt-3 font-sans text-sm text-stone-500">
                Check your CashAds notifications — under the default policy, CashAds absorbs reversals.
              </p>
            )}
          </div>
        )}

        {!done && (
          <div className="mt-6 rounded-2xl border-2 border-dashed border-amber-400 bg-amber-50 p-5 font-sans">
            <p className="flex items-center gap-2 text-sm font-bold text-amber-900">
              <Settings2 className="size-4" /> Developer controls — how should {data.networkName} report this?
            </p>
            <div className="mt-3 space-y-2">
              {MODES.filter((m) => !m.surveyOnly || o.category === 'survey').map((m) => (
                <label
                  key={m.id}
                  className={cn(
                    'flex cursor-pointer gap-3 rounded-xl border bg-white px-3.5 py-2.5 text-sm',
                    mode === m.id ? 'border-amber-500 ring-2 ring-amber-400/30' : 'border-amber-200',
                  )}
                >
                  <input
                    type="radio"
                    name="mode"
                    className="mt-0.5 accent-amber-600"
                    checked={mode === m.id}
                    onChange={() => setMode(m.id)}
                  />
                  <span>
                    <span className="font-semibold text-stone-900">{m.label}</span>
                    <span className="block text-xs text-stone-500">{m.detail}</span>
                  </span>
                </label>
              ))}
            </div>
            {complete.isError && (
              <Callout tone="danger" className="mt-3">
                {errorMessage(complete.error)}
              </Callout>
            )}
            <Button
              block
              size="lg"
              className="mt-4"
              disabled={!ready}
              loading={complete.isPending}
              onClick={() => complete.mutate()}
            >
              Finish task · you earn {formatUsd(o.userPayoutMicros)}
            </Button>
            {!ready && (
              <p className="mt-2 text-center text-xs text-amber-800">
                Complete the advertiser’s steps above first.
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function Experience({
  category,
  onReady,
  color,
}: {
  category: string;
  onReady: (v: boolean) => void;
  color: string;
}) {
  if (category === 'survey' || category === 'quick')
    return <Survey short={category === 'quick'} onReady={onReady} color={color} />;
  if (category === 'app') return <AppInstall onReady={onReady} color={color} />;
  if (category === 'financial') return <Financial onReady={onReady} />;
  return <Signup onReady={onReady} />;
}

function Survey({ short, onReady, color }: { short: boolean; onReady: (v: boolean) => void; color: string }) {
  const questions = short
    ? [{ q: 'Which of these do you prefer?', options: ['Option A', 'Option B', 'Option C', 'Option D'] }]
    : [
        { q: 'How old are you?', options: ['18–24', '25–34', '35–44', '45+'] },
        {
          q: 'How often do you buy this kind of product?',
          options: ['Weekly', 'Monthly', 'Rarely', 'Never'],
        },
        { q: 'Attention check: select “Blue”.', options: ['Red', 'Blue', 'Green', 'Yellow'] },
        {
          q: 'How satisfied are you with current brands?',
          options: ['Very', 'Somewhat', 'Not really', 'Not at all'],
        },
      ];
  const [answers, setAnswers] = useState<Record<number, number>>({});
  useEffect(
    () => onReady(Object.keys(answers).length === questions.length),
    [answers, questions.length, onReady],
  );
  return (
    <div>
      <h1 className="text-2xl font-bold">{short ? 'One quick question' : 'Consumer opinion survey'}</h1>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-stone-200">
        <div
          className="h-full transition-all"
          style={{ width: `${(Object.keys(answers).length / questions.length) * 100}%`, background: color }}
        />
      </div>
      <div className="mt-6 space-y-6">
        {questions.map((item, qi) => (
          <fieldset key={item.q}>
            <legend className="font-semibold">{item.q}</legend>
            <div className="mt-2 grid grid-cols-2 gap-2 font-sans">
              {item.options.map((opt, oi) => (
                <button
                  key={opt}
                  onClick={() => setAnswers({ ...answers, [qi]: oi })}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-sm',
                    answers[qi] === oi
                      ? 'border-stone-900 bg-stone-900 text-white'
                      : 'border-stone-300 hover:border-stone-500',
                  )}
                >
                  {opt}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </div>
  );
}

function AppInstall({ onReady, color }: { onReady: (v: boolean) => void; color: string }) {
  const [progress, setProgress] = useState(0);
  const [opened, setOpened] = useState(false);
  const [steps, setSteps] = useState<boolean[]>([false, false]);
  useEffect(() => {
    if (progress <= 0 || progress >= 100) return;
    const t = setTimeout(() => setProgress((p) => Math.min(100, p + 8)), 120);
    return () => clearTimeout(t);
  }, [progress]);
  useEffect(() => onReady(opened && steps.every(Boolean)), [opened, steps, onReady]);
  return (
    <div className="font-sans">
      <h1 className="font-serif text-2xl font-bold">Get the app</h1>
      <p className="mt-1 text-stone-600">Simulated app-store install.</p>
      {progress < 100 ? (
        <div className="mt-5">
          <Button onClick={() => setProgress(1)} disabled={progress > 0} style={{ background: color }}>
            <Download className="size-4" /> {progress > 0 ? `Installing… ${progress}%` : 'Install'}
          </Button>
          {progress > 0 && (
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-200">
              <div className="h-full transition-all" style={{ width: `${progress}%`, background: color }} />
            </div>
          )}
        </div>
      ) : !opened ? (
        <Button className="mt-5" onClick={() => setOpened(true)}>
          Open app
        </Button>
      ) : (
        <div className="mt-5 space-y-2">
          {['Create a profile', 'Complete the first action'].map((s, i) => (
            <Checkbox
              key={s}
              checked={steps[i]!}
              onChange={(v) => setSteps(steps.map((x, j) => (j === i ? v : x)))}
              label={s}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Signup({ onReady }: { onReady: (v: boolean) => void }) {
  const [form, setForm] = useState({ name: 'Ada Okafor', email: 'ada.sandbox@example.com', consent: false });
  useEffect(() => onReady(form.name.length > 1 && form.email.includes('@') && form.consent), [form, onReady]);
  return (
    <div className="space-y-4 font-sans">
      <h1 className="font-serif text-2xl font-bold">Create your free account</h1>
      <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <Input label="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <Checkbox
        checked={form.consent}
        onChange={(v) => setForm({ ...form, consent: v })}
        label="I agree to the advertiser’s terms (simulated)"
      />
    </div>
  );
}

function Financial({ onReady }: { onReady: (v: boolean) => void }) {
  const [step, setStep] = useState(0);
  const [amount, setAmount] = useState(10);
  useEffect(() => onReady(step >= 3), [step, onReady]);
  const steps = ['Your details', 'Verify identity', 'Fund your account'];
  return (
    <div className="font-sans">
      <h1 className="font-serif text-2xl font-bold">Open your account</h1>
      <ol className="mt-4 flex gap-2 text-xs">
        {steps.map((s, i) => (
          <li
            key={s}
            className={cn(
              'flex-1 rounded-full px-3 py-1.5 text-center',
              i < step
                ? 'bg-emerald-600 text-white'
                : i === step
                  ? 'bg-stone-900 text-white'
                  : 'bg-stone-200 text-stone-500',
            )}
          >
            {s}
          </li>
        ))}
      </ol>
      <div className="mt-6">
        {step === 0 && (
          <div className="space-y-3">
            <Input label="Full name" defaultValue="Ada Okafor" />
            <Input label="Date of birth" type="date" defaultValue="1995-06-01" />
            <Button onClick={() => setStep(1)}>Continue</Button>
          </div>
        )}
        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-stone-600">Upload an ID (simulated — nothing is sent).</p>
            <Button variant="outline" onClick={() => setStep(2)}>
              <Upload className="size-4" /> Upload ID & selfie
            </Button>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-3">
            <label className="text-sm font-medium">Initial deposit: ${amount}</label>
            <input
              type="range"
              min={10}
              max={100}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-full"
            />
            <Button onClick={() => setStep(3)}>Fund account (simulated)</Button>
          </div>
        )}
        {step === 3 && (
          <p className="flex items-center gap-2 font-semibold text-emerald-700">
            <CircleCheck className="size-5" /> Account opened and funded.
          </p>
        )}
      </div>
    </div>
  );
}
