'use client';

import { AuthFallback } from '@/components/ui/auth-fallback';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { ButtonLink } from '@/components/ui/button';
import { Spinner } from '@/components/ui/feedback';
import { api, errorMessage } from '@/lib/api';
import { qk } from '@/lib/queries';

function Verify() {
  const token = useSearchParams().get('token') ?? '';
  const qc = useQueryClient();
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setState('error');
      setMessage('This link is missing its token.');
      return;
    }
    api('/auth/verify-email', { body: { token } })
      .then(() => {
        setState('ok');
        void qc.invalidateQueries({ queryKey: qk.me });
      })
      .catch((err) => {
        setState('error');
        setMessage(errorMessage(err));
      });
  }, [token, qc]);
  return (
    <div className="space-y-5 text-center">
      {state === 'loading' && <Spinner className="mx-auto h-8 w-8 text-brand-600" />}
      {state === 'ok' && (
        <>
          <CheckCircle2 className="mx-auto h-14 w-14 text-brand-600" />
          <h1 className="text-2xl font-bold">Email confirmed</h1>
          <p className="text-sm text-muted">Cash outs are unlocked. You also just moved one step closer to Silver.</p>
          <ButtonLink href="/app" className="w-full">
            Go to my dashboard
          </ButtonLink>
        </>
      )}
      {state === 'error' && (
        <>
          <XCircle className="mx-auto h-14 w-14 text-rose-500" />
          <h1 className="text-2xl font-bold">We couldn’t confirm that link</h1>
          <p className="text-sm text-muted">{message} You can request a fresh link from your dashboard.</p>
          <ButtonLink href="/app" variant="secondary" className="w-full">
            Go to dashboard
          </ButtonLink>
        </>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<AuthFallback />}>
      <Verify />
    </Suspense>
  );
}
