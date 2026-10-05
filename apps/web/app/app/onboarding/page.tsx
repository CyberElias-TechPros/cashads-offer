'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, BadgeDollarSign, HandCoins, LifeBuoy } from 'lucide-react';
import { CATEGORY_META, COUNTRIES, flagEmoji, OFFER_CATEGORIES, type OfferCategory } from '@cashads/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Select, Switch } from '@/components/ui/form';
import { LiveFeedList, TrustStats } from '@/components/marketing/live';
import { api, errorMessage } from '@/lib/api';
import { qk, useMe, usePayoutMethods } from '@/lib/queries';
import { toast, usePrefs } from '@/lib/store';
import { cn } from '@/lib/utils';

const SLIDES = [
  {
    icon: BadgeDollarSign,
    title: 'Every number here is real money.',
    body: 'No points, no coins, no conversion tables. When an offer says $1.20, that’s $1.20 in your balance. And we show what the partner pays us, so you can see your 60% share.',
  },
  {
    icon: HandCoins,
    title: 'Cash out anytime. No minimum.',
    body: 'Withdraw $0.01 if you want. Most cash outs are sent automatically within minutes, with the provider fee shown before you confirm.',
  },
  {
    icon: LifeBuoy,
    title: 'We pay even when tracking fails.',
    body: 'If a partner’s tracking breaks, tap “Missing credit”. We check their records automatically, and if we can verify it, you get paid.',
  },
];

export default function OnboardingPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: methods } = usePayoutMethods();
  const setDataSaver = usePrefs((s) => s.setDataSaver);
  const [step, setStep] = useState(0);
  const [country, setCountry] = useState<string | null>(null);
  const [interests, setInterests] = useState<OfferCategory[]>(['survey', 'poll', 'learn']);
  const [minutes, setMinutes] = useState(15);
  const [dataSaver, setDs] = useState(false);
  const [goal, setGoal] = useState<number | null>(10);
  const [saving, setSaving] = useState(false);
  const c = country ?? me?.user.country ?? 'US';
  const isSetup = step === SLIDES.length;

  async function finish() {
    setSaving(true);
    try {
      await api('/me/onboarding', { body: { country: c, interests, dailyMinutes: minutes, dataSaver, goal: goal ? { label: 'My first cash out', targetMicros: goal * 1_000_000 } : null } });
      setDataSaver(dataSaver);
      await qc.invalidateQueries({ queryKey: qk.me });
      router.replace('/app');
    } catch (err) {
      toast({ title: errorMessage(err), tone: 'danger' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-2">
        {[...SLIDES, null].map((_, i) => (
          <span key={i} className={cn('h-1.5 flex-1 rounded-full transition-colors', i <= step ? 'bg-brand-500' : 'bg-surface-3')} />
        ))}
      </div>
      {!isSetup ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[1.1fr_0.9fr] md:items-start">
          <Card className="p-8">
            {(() => {
              const S = SLIDES[step];
              return (
                <div key={step} className="animate-slide-up">
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                    <S.icon className="h-7 w-7" />
                  </span>
                  <h1 className="mt-6 font-display text-3xl font-extrabold tracking-tight">{S.title}</h1>
                  <p className="mt-3 text-muted">{S.body}</p>
                  {step === 1 && methods && (
                    <div className="mt-5 flex flex-wrap gap-2">
                      {methods.slice(0, 8).map((m) => (
                        <span key={m.id} className="rounded-full border border-line px-3 py-1 text-sm">
                          {m.logo} {m.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
            <div className="mt-8 flex items-center justify-between">
              <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <Button onClick={() => setStep((s) => s + 1)}>
                Next <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </Card>
          <div className="space-y-4">
            {step === 0 && <TrustStats className="grid-cols-2 sm:grid-cols-2" />}
            {step !== 0 && <LiveFeedList limit={5} />}
          </div>
        </div>
      ) : (
        <Card className="animate-slide-up p-8">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Make it yours</h1>
          <p className="mt-2 text-muted">We use this to pick your daily plan and show payout methods that work where you live. You can change it anytime.</p>
          <div className="mt-8 space-y-6">
            <Field label="Country">
              <Select value={c} onChange={(e) => setCountry(e.target.value)}>
                {COUNTRIES.map((x) => (
                  <option key={x.code} value={x.code}>
                    {flagEmoji(x.code)} {x.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div>
              <p className="text-sm font-medium">What do you enjoy?</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {OFFER_CATEGORIES.map((cat) => {
                  const on = interests.includes(cat);
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setInterests((xs) => (on ? xs.filter((x) => x !== cat) : [...xs, cat]))}
                      className={cn('rounded-full border px-3.5 py-1.5 text-sm transition-colors', on ? 'border-brand-500 bg-brand-50 font-medium text-brand-800 dark:bg-brand-500/10 dark:text-brand-300' : 'border-line hover:border-line-strong')}
                    >
                      {CATEGORY_META[cat].emoji} {CATEGORY_META[cat].plural}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <p className="text-sm font-medium">How much time do you usually have?</p>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {[5, 15, 30, 60].map((m) => (
                  <button key={m} type="button" onClick={() => setMinutes(m)} className={cn('rounded-xl border py-2.5 text-sm', minutes === m ? 'border-brand-500 bg-brand-50 font-semibold text-brand-800 dark:bg-brand-500/10 dark:text-brand-300' : 'border-line')}>
                    {m === 60 ? '1h+' : `${m} min`}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-medium">First goal</p>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {[null, 5, 10, 25].map((g) => (
                  <button key={String(g)} type="button" onClick={() => setGoal(g)} className={cn('rounded-xl border py-2.5 text-sm', goal === g ? 'border-brand-500 bg-brand-50 font-semibold text-brand-800 dark:bg-brand-500/10 dark:text-brand-300' : 'border-line')}>
                    {g ? `$${g}` : 'Skip'}
                  </button>
                ))}
              </div>
            </div>
            <Switch checked={dataSaver} onChange={setDs} label="Data saver" description="Lighter pages, no animations, light-data offers first. Great on 3G or limited bundles." />
          </div>
          <div className="mt-8 flex items-center justify-between">
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button onClick={finish} loading={saving}>
              Show me my first plan <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
