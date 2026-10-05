'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { qk, useMe } from '@/lib/queries';
import { toast } from '@/lib/store';

export function PhoneVerifyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [phone, setPhone] = useState(me?.user.phone ?? '+');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Verify your phone"
      description="One-time check before your first cash out. It protects your balance and keeps payouts instant for honest members."
      footer={
        sent ? (
          <Button
            loading={loading}
            disabled={code.length !== 6}
            onClick={async () => {
              setLoading(true);
              setError(null);
              try {
                await api('/me/phone/verify', { body: { code } });
                await qc.invalidateQueries({ queryKey: qk.me });
                toast({ title: 'Phone verified ✅', tone: 'success' });
                onClose();
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setLoading(false);
              }
            }}
          >
            Verify
          </Button>
        ) : (
          <Button
            loading={loading}
            onClick={async () => {
              setLoading(true);
              setError(null);
              try {
                await api('/me/phone/start', { body: { phone: phone.replace(/[\s()-]/g, '') } });
                setSent(true);
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setLoading(false);
              }
            }}
          >
            Send code
          </Button>
        )
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {!sent ? (
          <Field label="Mobile number" hint="International format, e.g. +2348012345678 or +14155550123.">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="+14155550123" />
          </Field>
        ) : (
          <>
            <Field label="6-digit code" hint={`Sent to ${phone}. It expires in 10 minutes.`}>
              <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className="tabular text-center text-lg tracking-[0.4em]" />
            </Field>
            {me?.flags.demoMode && (
              <Alert tone="brand">
                Demo: SMS codes are delivered to the{' '}
                <Link href="/dev/mailbox" target="_blank" className="font-semibold underline">
                  dev mailbox
                </Link>
                .
              </Alert>
            )}
            <button className="text-sm text-muted hover:text-fg" onClick={() => setSent(false)}>
              Use a different number
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
