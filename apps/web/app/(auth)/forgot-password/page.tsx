'use client';

import Link from 'next/link';
import { useState } from 'react';
import { MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  if (sent) {
    return (
      <div className="space-y-5 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
          <MailCheck className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold">Check your inbox</h1>
        <p className="text-sm text-muted">If an account exists for {email}, a reset link is on its way. It expires in 1 hour.</p>
        <Link href="/login" className="inline-block text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">
          Back to log in
        </Link>
      </div>
    );
  }
  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
          await api('/auth/forgot-password', { body: { email } });
          setSent(true);
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setLoading(false);
        }
      }}
    >
      <div>
        <h1 className="text-2xl font-bold">Reset your password</h1>
        <p className="mt-1 text-sm text-muted">We’ll email you a secure link.</p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="Email">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      </Field>
      <Button type="submit" className="w-full" loading={loading}>
        Send reset link
      </Button>
      <p className="text-center text-sm">
        <Link href="/login" className="text-muted hover:text-fg">
          Back to log in
        </Link>
      </p>
    </form>
  );
}
