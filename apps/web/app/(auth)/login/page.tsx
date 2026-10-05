'use client';

import { AuthFallback } from '@/components/ui/auth-fallback';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { KeyRound, Sparkles } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { MeResponse } from '@cashads/shared';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { api, ApiError, errorMessage } from '@/lib/api';
import { qk } from '@/lib/queries';

const DEMO = [
  { label: 'Member (US, Gold)', email: 'demo@cashads.dev', password: 'Demo12345!' },
  { label: 'Member (Nigeria)', email: 'ada@cashads.dev', password: 'Demo12345!' },
  { label: 'Admin console', email: 'admin@cashads.dev', password: 'Admin12345!' },
];

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const next = params.get('next') || '/app';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(params.get('error') === 'google_failed' ? 'Google sign-in failed — please try again.' : null);
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<{ google: boolean; demoMode: boolean } | null>(null);

  useEffect(() => {
    api<{ google: boolean; demoMode: boolean }>('/auth/providers').then(setProviders).catch(() => setProviders(null));
  }, []);

  const done = (me: MeResponse) => {
    qc.setQueryData(qk.me, me);
    const dest = me.user.role !== 'user' && next === '/app' ? '/admin' : !me.user.onboardingCompleted && next === '/app' ? '/app/onboarding' : next;
    router.replace(dest);
  };

  async function submit(e?: React.FormEvent, creds?: { email: string; password: string }) {
    e?.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api<MeResponse | { twoFactorRequired: true; challengeId: string }>('/auth/login', { body: creds ?? { email, password } });
      if ('twoFactorRequired' in res) setChallenge(res.challengeId);
      else done(res);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function submit2fa(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      done(await api<MeResponse>('/auth/login/2fa', { body: { challengeId: challenge, code } }));
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && err.code === 'challenge_expired') setChallenge(null);
    } finally {
      setLoading(false);
    }
  }

  if (challenge) {
    return (
      <form onSubmit={submit2fa} className="space-y-5">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
          <KeyRound className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Two-factor check</h1>
          <p className="mt-1 text-sm text-muted">Enter the 6-digit code from your authenticator app.</p>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Authentication code">
          <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" className="tabular text-center text-lg tracking-[0.4em]" autoFocus />
        </Field>
        <Button type="submit" className="w-full" loading={loading} disabled={code.length !== 6}>
          Verify and sign in
        </Button>
        <button type="button" className="w-full text-sm text-muted hover:text-fg" onClick={() => setChallenge(null)}>
          Use a different account
        </button>
      </form>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Welcome back</h1>
        <p className="mt-1 text-sm text-muted">
          New here?{' '}
          <Link href="/signup" className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
            Create a free account
          </Link>
        </p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" />
        </Field>
        <Field
          label={
            <span className="flex w-full items-center justify-between">
              Password
              <Link href="/forgot-password" className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
                Forgot password?
              </Link>
            </span>
          }
          htmlFor="password"
        >
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Button type="submit" className="w-full" loading={loading}>
          Log in
        </Button>
      </form>
      {providers?.google && (
        <a href="/api/auth/google/start" className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface text-sm font-semibold shadow-sm hover:bg-surface-2">
          <span className="text-base font-bold text-[#4285F4]">G</span> Continue with Google
        </a>
      )}
      {providers?.demoMode && (
        <div className="rounded-2xl border border-dashed border-brand-300 bg-brand-50/50 p-4 dark:border-brand-500/30 dark:bg-brand-500/5">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-brand-800 dark:text-brand-300">
            <Sparkles className="h-4 w-4" /> Demo environment — try a seeded account
          </p>
          <div className="mt-3 grid gap-2">
            {DEMO.map((d) => (
              <button
                key={d.email}
                type="button"
                disabled={loading}
                onClick={() => {
                  setEmail(d.email);
                  setPassword(d.password);
                  void submit(undefined, d);
                }}
                className="flex items-center justify-between rounded-xl border border-line bg-surface px-3 py-2 text-left text-sm hover:border-brand-400"
              >
                <span className="font-medium">{d.label}</span>
                <span className="text-xs text-muted">{d.email}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthFallback />}>
      <LoginForm />
    </Suspense>
  );
}
