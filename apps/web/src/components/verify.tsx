import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { type MeDTO, getCountry } from '@lucrum/shared';
import { errorMessage, post } from '../lib/api';
import { qk, useConfig, useMe } from '../lib/queries';
import { toast } from '../store/ui';
import { Button, Callout, Input, Modal } from './ui';

/** Inline phone verification (asked only when a cash-out needs it). */
export function PhoneVerifyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: me } = useMe();
  const { data: config } = useConfig();
  const qc = useQueryClient();
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const start = useMutation({
    mutationFn: () => post<{ maskedPhone: string }>('/auth/phone/start', { phone }),
    onSuccess: (r) => setSentTo(r.maskedPhone),
  });
  const verify = useMutation({
    mutationFn: () => post<{ user: MeDTO }>('/auth/phone/verify', { code }),
    onSuccess: (r) => {
      qc.setQueryData(qk.me, r.user);
      toast.success('Phone verified', 'Larger cash-outs are unlocked.');
      onClose();
    },
  });
  const prefix = getCountry(me?.country).phonePrefix;
  return (
    <Modal open={open} onClose={onClose} title="Verify your phone">
      {!sentTo ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            We’ll text you a 6-digit code. One phone number per account keeps payouts safe for everyone.
          </p>
          {start.isError && <Callout tone="danger">{errorMessage(start.error)}</Callout>}
          <Input
            label="Phone number"
            type="tel"
            inputMode="tel"
            placeholder={`${prefix} …`}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            hint={`Local format works too, e.g. 0803… — we add ${prefix}.`}
          />
          <Button
            block
            loading={start.isPending}
            onClick={() => start.mutate()}
            disabled={phone.trim().length < 7}
          >
            Send code
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Code sent to <strong>{sentTo}</strong>.
            {config?.sandbox && (
              <>
                {' '}
                Sandbox:{' '}
                <Link to="/dev/inbox" target="_blank" className="font-semibold underline">
                  open the Dev inbox
                </Link>{' '}
                to read the SMS.
              </>
            )}
          </p>
          {verify.isError && <Callout tone="danger">{errorMessage(verify.error)}</Callout>}
          <Input
            label="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setSentTo(null)}>
              Change number
            </Button>
            <Button
              block
              loading={verify.isPending}
              onClick={() => verify.mutate()}
              disabled={code.length !== 6}
            >
              Verify
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
