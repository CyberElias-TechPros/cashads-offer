import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Banknote,
  CircleCheck,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import { type FormEvent, Suspense, useEffect, useRef, useState } from 'react';
import { Link, Navigate, Outlet, useNavigate, useSearchParams } from 'react-router';
import {
  COUNTRIES,
  type LoginResultDTO,
  type MeDTO,
  guessCountryFromTimezone,
  registerSchema,
} from '@cashads/shared';
import { Logo, LogoMark, SandboxBanner } from '../../components/brand';
import { PageSpinner } from '../../components/layouts';
import { Button, ButtonLink, Callout, Checkbox, Input, Select } from '../../components/ui';
import { ApiError, errorMessage, post } from '../../lib/api';
import { browserTimezone } from '../../lib/device';
import { qk, useConfig, useMe } from '../../lib/queries';

export function AuthLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <SandboxBanner />
      <div className="grid flex-1 lg:grid-cols-2">
        <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 via-brand-800 to-slate-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="bg-grid absolute inset-0 opacity-20" aria-hidden />
          <div className="relative">
            <Link to="/" className="flex items-center gap-2 text-lg font-bold">
              <LogoMark className="size-8 ring-1 ring-white/20 rounded-[10px]" /> CashAds
            </Link>
          </div>
          <div className="relative space-y-6">
            <h2 className="text-4xl font-bold leading-tight tracking-tight">
              Real cash for your spare minutes.
            </h2>
            <ul className="space-y-4 text-brand-50">
              {[
                [Banknote, 'Cash out from $0.01 — bank, airtime, MoMo, M-Pesa, UPI, Pix, PayPal or crypto'],
                [ShieldCheck, 'Paid even when tracking fails, with a 24-hour claim promise'],
                [Zap, 'See the real hourly rate of every task before you start'],
                [Sparkles, 'No points, ever. Every amount is real money'],
              ].map(([Icon, text], i) => {
                const I = Icon as typeof Banknote;
                return (
                  <li key={i} className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/10">
                      <I className="size-4" />
                    </span>
                    {text as string}
                  </li>
                );
              })}
            </ul>
          </div>
          <p className="relative text-sm text-brand-200">
            60% of what advertisers pay goes to members — measured and published live.
          </p>
        </div>
        <div className="flex items-center justify-center px-4 py-12 sm:px-8">
          <div className="w-full max-w-md">
            <div className="mb-8 lg:hidden">
              <Logo />
            </div>
            <Suspense fallback={<PageSpinner />}>
              <Outlet />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
}

function PasswordInput({
  value,
  onChange,
  label = 'Password',
  error,
  autoComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  error?: string | null;
  autoComplete: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <Input
      label={label}
      type={show ? 'text' : 'password'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete={autoComplete}
      error={error}
      suffix={
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="text-slate-400 hover:text-slate-700"
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      }
    />
  );
}

function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/app';
}

export function Login() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: config } = useConfig();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const next = safeNext(params.get('next'));

  if (me) return <Navigate to={next} replace />;

  const done = (user: MeDTO) => {
    qc.setQueryData(qk.me, user);
    qc.invalidateQueries();
    navigate(user.role !== 'user' && next === '/app' ? '/app' : next, { replace: true });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mfaToken) {
        const res = await post<LoginResultDTO>('/auth/login/mfa', { mfaToken, code });
        done(res.user!);
      } else {
        const res = await post<LoginResultDTO>('/auth/login', { email, password });
        if (res.mfaRequired) setMfaToken(res.mfaToken!);
        else done(res.user!);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="animate-slide-up">
      <h1 className="text-2xl font-bold tracking-tight">
        {mfaToken ? 'Two-step verification' : 'Welcome back'}
      </h1>
      <p className="mt-1 text-slate-500">
        {mfaToken
          ? 'Enter the 6-digit code from your authenticator app, or a recovery code.'
          : 'Sign in to keep earning.'}
      </p>
      {config?.sandbox && !mfaToken && (
        <Callout tone="info" className="mt-6" title="Sandbox demo accounts">
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEmail('demo@cashads.local');
                setPassword('Demo-earner-2026');
              }}
            >
              Use demo member
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEmail('admin@cashads.local');
                setPassword('Admin-demo-2026');
              }}
            >
              Use admin
            </Button>
          </div>
        </Callout>
      )}
      <form onSubmit={submit} className="mt-6 space-y-4">
        {error && <Callout tone="danger">{error}</Callout>}
        {mfaToken ? (
          <Input
            label="Authentication code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            prefix={<KeyRound className="size-4" />}
            autoFocus
          />
        ) : (
          <>
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" />
            <div className="flex justify-end">
              <Link
                to="/forgot-password"
                className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-400"
              >
                Forgot password?
              </Link>
            </div>
          </>
        )}
        <Button type="submit" block size="lg" loading={loading}>
          {mfaToken ? 'Verify' : 'Sign in'} <ArrowRight className="size-4" />
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        New here?{' '}
        <Link to="/signup" className="font-semibold text-brand-700 hover:underline dark:text-brand-400">
          Create a free account
        </Link>
      </p>
    </div>
  );
}

export function Signup() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const tz = browserTimezone();
  const [form, setForm] = useState(() => ({
    email: '',
    password: '',
    country: guessCountryFromTimezone(tz),
    referralCode:
      params.get('ref') ??
      (typeof localStorage !== 'undefined' ? (localStorage.getItem('cashads.ref') ?? '') : ''),
    acceptTerms: false,
    confirmAdult: false,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (me) return <Navigate to="/app" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = registerSchema.safeParse({
      ...form,
      timezone: tz,
      referralCode: form.referralCode || undefined,
    });
    if (!parsed.success) {
      const map: Record<string, string> = {};
      for (const i of parsed.error.issues) map[String(i.path[0])] ??= i.message;
      setErrors(map);
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      const res = await post<{ user: MeDTO }>('/auth/register', parsed.data);
      try {
        localStorage.removeItem('cashads.ref');
      } catch {
        /* ignore */
      }
      qc.setQueryData(qk.me, res.user);
      navigate('/app/onboarding', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const pw = form.password;
  const checks = [
    { ok: pw.length >= 10, label: '10+ characters' },
    { ok: /[A-Za-z]/.test(pw) && /\d/.test(pw), label: 'Letters and a number' },
  ];

  return (
    <div className="animate-slide-up">
      <h1 className="text-2xl font-bold tracking-tight">Create your free account</h1>
      <p className="mt-1 text-slate-500">
        Just an email to start. We only ask for more when you cash out larger amounts.
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
        {error && <Callout tone="danger">{error}</Callout>}
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          error={errors.email}
        />
        <div>
          <PasswordInput
            value={pw}
            onChange={(v) => setForm({ ...form, password: v })}
            autoComplete="new-password"
            error={errors.password}
          />
          {pw && (
            <div className="mt-2 flex gap-3 text-xs">
              {checks.map((c) => (
                <span key={c.label} className={c.ok ? 'text-emerald-600' : 'text-slate-400'}>
                  <CircleCheck className="mr-1 inline size-3.5" />
                  {c.label}
                </span>
              ))}
            </div>
          )}
        </div>
        <Select
          label="Country"
          value={form.country}
          onChange={(e) => setForm({ ...form, country: e.target.value })}
          hint="We show offers and payout methods that work where you live."
          error={errors.country}
        >
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.flag} {c.name}
            </option>
          ))}
        </Select>
        <Input
          label="Invite code (optional)"
          value={form.referralCode}
          onChange={(e) => setForm({ ...form, referralCode: e.target.value.toUpperCase() })}
          placeholder="e.g. K7M2QX9A"
        />
        <div className="space-y-2.5 pt-1">
          <Checkbox
            checked={form.acceptTerms}
            onChange={(v) => setForm({ ...form, acceptTerms: v })}
            label={
              <>
                I agree to the{' '}
                <Link to="/legal/terms" target="_blank" className="font-medium underline">
                  Terms
                </Link>{' '}
                and{' '}
                <Link to="/legal/privacy" target="_blank" className="font-medium underline">
                  Privacy Policy
                </Link>
              </>
            }
          />
          {errors.acceptTerms && <p className="text-sm text-rose-600">{errors.acceptTerms}</p>}
          <Checkbox
            checked={form.confirmAdult}
            onChange={(v) => setForm({ ...form, confirmAdult: v })}
            label="I’m 18 or older"
          />
          {errors.confirmAdult && <p className="text-sm text-rose-600">{errors.confirmAdult}</p>}
        </div>
        <Button type="submit" block size="lg" loading={loading}>
          Create account <ArrowRight className="size-4" />
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        Already a member?{' '}
        <Link to="/login" className="font-semibold text-brand-700 hover:underline dark:text-brand-400">
          Sign in
        </Link>
      </p>
    </div>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="animate-slide-up">
      <h1 className="text-2xl font-bold tracking-tight">Reset your password</h1>
      <p className="mt-1 text-slate-500">We’ll email you a link that’s valid for one hour.</p>
      {sent ? (
        <Callout tone="success" className="mt-6" title="Check your email">
          If an account exists for {email}, a reset link is on its way. (Sandbox: open the{' '}
          <Link to="/dev/inbox" className="underline">
            Dev inbox
          </Link>
          .)
        </Callout>
      ) : (
        <form
          className="mt-6 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setLoading(true);
            setError(null);
            try {
              await post('/auth/forgot-password', { email });
              setSent(true);
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setLoading(false);
            }
          }}
        >
          {error && <Callout tone="danger">{error}</Callout>}
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Button type="submit" block size="lg" loading={loading}>
            Send reset link
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <Link to="/login" className="font-semibold text-brand-700 hover:underline dark:text-brand-400">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="animate-slide-up">
      <h1 className="text-2xl font-bold tracking-tight">Choose a new password</h1>
      {done ? (
        <Callout tone="success" className="mt-6" title="Password updated">
          All devices were signed out for safety.{' '}
          <Link to="/login" className="font-semibold underline">
            Sign in
          </Link>
        </Callout>
      ) : (
        <form
          className="mt-6 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setLoading(true);
            setError(null);
            try {
              await post('/auth/reset-password', { token, password });
              setDone(true);
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setLoading(false);
            }
          }}
        >
          {error && <Callout tone="danger">{error}</Callout>}
          <PasswordInput
            value={password}
            onChange={setPassword}
            label="New password"
            autoComplete="new-password"
          />
          <Button type="submit" block size="lg" loading={loading} disabled={!token}>
            Update password
          </Button>
        </form>
      )}
    </div>
  );
}

export function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const qc = useQueryClient();
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [error, setError] = useState('');
  const sent = useRef(false);
  useEffect(() => {
    // Fire once (StrictMode runs effects twice in development); the API is idempotent too.
    if (sent.current) return;
    sent.current = true;
    post<{ user: MeDTO }>('/auth/verify-email', { token })
      .then((r) => {
        qc.setQueryData(qk.me, (prev: MeDTO | null | undefined) =>
          prev && prev.id === r.user.id ? r.user : prev,
        );
        setState('ok');
      })
      .catch((err) => {
        setError(errorMessage(err));
        setState('error');
      });
  }, [token, qc]);
  return (
    <div className="animate-slide-up text-center">
      {state === 'loading' && <PageSpinner />}
      {state === 'ok' && (
        <>
          <p className="text-5xl">✅</p>
          <h1 className="mt-4 text-2xl font-bold">Email confirmed</h1>
          <p className="mt-2 text-slate-500">
            Cash-outs are unlocked. You can withdraw any amount from $0.01.
          </p>
          <ButtonLink to="/app" className="mt-6">
            Go to my dashboard
          </ButtonLink>
        </>
      )}
      {state === 'error' && (
        <>
          <h1 className="text-2xl font-bold">That link didn’t work</h1>
          <Callout tone="danger" className="mt-4 text-left">
            {error}
          </Callout>
          <ButtonLink to="/app" variant="outline" className="mt-6">
            Open the app to resend
          </ButtonLink>
        </>
      )}
    </div>
  );
}
