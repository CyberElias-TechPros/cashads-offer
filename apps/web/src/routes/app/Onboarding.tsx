import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Banknote, CircleDollarSign, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { type MeDTO, formatUsd, getCountry, payoutMethodsForCountry } from '@cashads/shared';
import { Button } from '../../components/ui';
import { post } from '../../lib/api';
import { qk, useMe } from '../../lib/queries';
import { cn } from '../../lib/utils';

export function Onboarding() {
  const { data: me } = useMe();
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const finish = useMutation({
    mutationFn: () => post<{ user: MeDTO }>('/me/onboarding/complete'),
    onSuccess: (r) => qc.setQueryData(qk.me, r.user),
  });
  const country = getCountry(me?.country);
  const methods = payoutMethodsForCountry(country.code).slice(0, 4);

  const screens = [
    {
      icon: CircleDollarSign,
      color: 'from-brand-500 to-brand-700',
      title: 'Real money. Never points.',
      body: 'Every task shows what you earn in dollars and your local currency — plus how long it really takes and what that works out to per hour.',
      extra: (
        <div className="mx-auto mt-6 max-w-xs rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Shopping habits 2026</span>
            <span className="tabular font-bold">$0.75</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            6 min · <span className="font-semibold text-brand-700">$7.50/hr</span> · measured from 128
            completions
          </p>
        </div>
      ),
    },
    {
      icon: Banknote,
      color: 'from-amber-400 to-orange-600',
      title: 'No minimum. Cash out from $0.01.',
      body: `We only show methods that work in ${country.name}. Fees are shown before you confirm — and most cash-outs land in minutes.`,
      extra: (
        <div className="mx-auto mt-6 grid max-w-sm grid-cols-2 gap-2 text-left">
          {methods.map((m) => (
            <div
              key={m.id}
              className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
            >
              <p className="text-lg">{m.icon}</p>
              <p className="mt-1 text-sm font-medium">{m.name}</p>
              <p className="text-xs text-slate-500">from {formatUsd(m.minMicros)}</p>
            </div>
          ))}
        </div>
      ),
    },
    {
      icon: ShieldCheck,
      color: 'from-violet-500 to-indigo-700',
      title: 'If tracking fails, we still pay.',
      body: 'Did a task but it didn’t credit? Tap “Missing credit”. We check the network’s logs automatically, pay trusted members instantly, and give everyone else a human answer within 24 hours.',
      extra: (
        <ul className="mx-auto mt-6 max-w-sm space-y-2 text-left text-sm">
          {[
            'Postback logs checked automatically',
            'Network asked directly',
            'Goodwill credit for trusted members',
            'Human review in ≤ 24h — or auto-approved',
          ].map((t, i) => (
            <li
              key={t}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
            >
              <span className="flex size-5 items-center justify-center rounded-full bg-violet-100 text-xs font-bold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                {i + 1}
              </span>
              {t}
            </li>
          ))}
        </ul>
      ),
    },
  ];
  const s = screens[step]!;
  const last = step === screens.length - 1;

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center py-6 text-center">
      <div className="mb-8 flex justify-center gap-1.5">
        {screens.map((_, i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 rounded-full transition-all',
              i === step ? 'w-8 bg-brand-600' : 'w-1.5 bg-slate-300 dark:bg-slate-700',
            )}
          />
        ))}
      </div>
      <div key={step} className="animate-slide-up">
        <div
          className={cn(
            'mx-auto flex size-16 items-center justify-center rounded-3xl bg-gradient-to-br text-white shadow-lg',
            s.color,
          )}
        >
          <s.icon className="size-8" />
        </div>
        <h1 className="mt-6 text-3xl font-bold tracking-tight">{s.title}</h1>
        <p className="mx-auto mt-3 max-w-md text-slate-600 dark:text-slate-400">{s.body}</p>
        {s.extra}
      </div>
      <div className="mt-10 flex flex-col gap-2 sm:flex-row sm:justify-center">
        {last ? (
          <>
            <Button
              size="lg"
              loading={finish.isPending}
              onClick={async () => {
                await finish.mutateAsync();
                navigate('/app/earn/quick');
              }}
            >
              Earn my first cents (20 sec) <ArrowRight className="size-4" />
            </Button>
            <Button
              size="lg"
              variant="ghost"
              onClick={async () => {
                await finish.mutateAsync();
                navigate('/app');
              }}
            >
              Go to dashboard
            </Button>
          </>
        ) : (
          <>
            <Button size="lg" onClick={() => setStep(step + 1)}>
              Next <ArrowRight className="size-4" />
            </Button>
            <Button
              size="lg"
              variant="ghost"
              onClick={async () => {
                await finish.mutateAsync();
                navigate('/app');
              }}
            >
              Skip
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
