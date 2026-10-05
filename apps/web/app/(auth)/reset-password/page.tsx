'use client';

import { AuthFallback } from '@/components/ui/auth-fallback';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api';

function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  if (!token) return <Alert tone="danger" title="Invalid link">This reset link is missing its token. Request a new one from the login page.</Alert>;
  if (done)
    return (
      <div className="space-y-4">
        <Alert tone="success" title="Password updated">For your safety we signed you out everywhere. Log in with your new password.</Alert>
        <Button className="w-full" onClick={() => router.replace('/login')}>
          Go to log in
        </Button>
      </div>
    );
  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (password !== confirm) return setError('Passwords don’t match');
        setLoading(true);
        setError(null);
        try {
          await api('/auth/reset-password', { body: { token, password } });
          setDone(true);
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setLoading(false);
        }
      }}
    >
      <h1 className="text-2xl font-bold">Choose a new password</h1>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="New password" hint="At least 8 characters.">
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
      </Field>
      <Field label="Confirm password">
        <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
      </Field>
      <Button type="submit" className="w-full" loading={loading}>
        Update password
      </Button>
      <p className="text-center text-sm">
        <Link href="/forgot-password" className="text-muted hover:text-fg">
          Need a new link?
        </Link>
      </p>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthFallback />}>
      <ResetForm />
    </Suspense>
  );
}
