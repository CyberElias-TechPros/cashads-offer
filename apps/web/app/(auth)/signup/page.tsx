'use client';

import { AuthFallback } from '@/components/ui/auth-fallback';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { Gift } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { COUNTRIES, flagEmoji, guessCountryFromTimezone, signupSchema, type MeResponse } from '@cashads/shared';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { api, ApiError, errorMessage } from '@/lib/api';
import { qk } from '@/lib/queries';
import { cn } from '@/lib/utils';

function strength(pw: string): { score: number; label: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return { score: Math.min(4, score), label: ['Too short', 'Weak', 'Okay', 'Strong', 'Excellent'][Math.min(4, score)] };
}

function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [form, setForm] = useState({ email: '', password: '', displayName: '', country: 'US', referralCode: params.get('ref') ?? '', acceptTerms: false, confirmAge: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const tz = useMemo(() => (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC'), []);

  useEffect(() => {
    const guess = guessCountryFromTimezone(tz);
    if (guess && COUNTRIES.some((c) => c.code === guess)) setForm((f) => ({ ...f, country: guess }));
    if (!params.get('ref')) {
      const m = /(?:^|; )ca_ref=([^;]+)/.exec(document.cookie);
      if (m) setForm((f) => ({ ...f, referralCode: decodeURIComponent(m[1]) }));
    }
  }, [tz, params]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const pw = strength(form.password);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = signupSchema.safeParse({ ...form, timezone: tz });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      const me = await api<MeResponse>('/auth/signup', { body: parsed.data });
      qc.setQueryData(qk.me, me);
      router.replace('/app/onboarding');
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors());
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Create your free account</h1>
        <p className="mt-1 text-sm text-muted">
          Already a member?{' '}
          <Link href="/login" className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
            Log in
          </Link>
        </p>
      </div>
      {form.referralCode && (
        <Alert tone="brand" icon={<Gift className="h-4 w-4" />}>
          You were invited by a friend — you’ll both get a bonus after your first completed offer.
        </Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email" error={errors.email} htmlFor="email">
          <Input id="email" type="email" autoComplete="email" value={form.email} onChange={(e) => set('email', e.target.value)} invalid={!!errors.email} placeholder="you@example.com" />
        </Field>
        <Field label="Display name" hint="Shown as “First L.” on leaderboards (you can opt out)." error={errors.displayName} htmlFor="name">
          <Input id="name" autoComplete="name" value={form.displayName} onChange={(e) => set('displayName', e.target.value)} invalid={!!errors.displayName} placeholder="Sarah Johnson" />
        </Field>
        <Field label="Password" error={errors.password} htmlFor="password">
          <Input id="password" type="password" autoComplete="new-password" value={form.password} onChange={(e) => set('password', e.target.value)} invalid={!!errors.password} />
          {form.password && (
            <div className="flex items-center gap-2 pt-1">
              <div className="flex flex-1 gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className={cn('h-1.5 flex-1 rounded-full', i < pw.score ? (pw.score >= 3 ? 'bg-brand-500' : pw.score === 2 ? 'bg-amber-400' : 'bg-rose-400') : 'bg-surface-3')} />
                ))}
              </div>
              <span className="text-xs text-muted">{pw.label}</span>
            </div>
          )}
        </Field>
        <div className="grid grid-cols-[1.4fr_1fr] gap-3">
          <Field label="Country" hint="Shows offers & payout methods that work for you." error={errors.country}>
            <Select value={form.country} onChange={(e) => set('country', e.target.value)}>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {flagEmoji(c.code)} {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Invite code" optional error={errors.referralCode}>
            <Input value={form.referralCode} onChange={(e) => set('referralCode', e.target.value.toUpperCase())} placeholder="ABCD2345" />
          </Field>
        </div>
        <div className="space-y-2.5 pt-1">
          <Checkbox
            checked={form.acceptTerms}
            onChange={(v) => set('acceptTerms', v)}
            label={
              <>
                I agree to the{' '}
                <Link href="/terms" target="_blank" className="font-medium text-brand-700 underline dark:text-brand-300">
                  Terms
                </Link>{' '}
                and{' '}
                <Link href="/privacy" target="_blank" className="font-medium text-brand-700 underline dark:text-brand-300">
                  Privacy Policy
                </Link>
              </>
            }
          />
          <Checkbox checked={form.confirmAge} onChange={(v) => set('confirmAge', v)} label="I’m 18 or older" />
          {(errors.acceptTerms || errors.confirmAge) && <p className="text-xs font-medium text-rose-600">{errors.acceptTerms ?? errors.confirmAge}</p>}
        </div>
        <Button type="submit" className="w-full" loading={loading}>
          Create account
        </Button>
        <p className="text-center text-xs text-subtle">We only ask for what we need, when we need it. No phone or ID until you cash out.</p>
      </form>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<AuthFallback />}>
      <SignupForm />
    </Suspense>
  );
}
