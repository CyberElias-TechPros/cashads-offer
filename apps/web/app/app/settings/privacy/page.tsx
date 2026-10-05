'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/queries';

export default function PrivacyPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  if (!me) return null;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader icon={<Download className="h-5 w-5" />} title="Download your data" description="Everything we hold about you: profile, transactions, cash outs, claims, tickets, devices and sign-ins, as JSON." />
        <CardBody>
          <a href="/api/me/export" className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-5 text-sm font-semibold shadow-sm hover:bg-surface-2">
            <Download className="h-4 w-4" /> Export my data
          </a>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="What we collect, and why" />
        <CardBody className="space-y-2 text-sm text-muted">
          <p>• Email: your login and payout receipts.</p>
          <p>• Phone (before your first cash out): one person, one account. This is what keeps payouts instant.</p>
          <p>• Device and IP signals: fraud prevention only, never sold or used for ads.</p>
          <p>• ID (only for large cash outs): required by payment regulations. We store the last 4 digits plus a hash.</p>
        </CardBody>
      </Card>
      <Card className="border-rose-200 dark:border-rose-500/30">
        <CardHeader icon={<Trash2 className="h-5 w-5" />} title="Delete account" description="Erases your personal data. Financial records are kept anonymised, as the law requires." />
        <CardBody>
          <Button variant="danger" onClick={() => setOpen(true)}>
            Delete my account
          </Button>
        </CardBody>
      </Card>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Delete your account?"
        description="This can’t be undone."
        footer={
          <Button
            variant="danger"
            loading={loading}
            disabled={confirm !== 'DELETE'}
            onClick={async () => {
              setLoading(true);
              setError(null);
              try {
                await api('/me/delete', { body: { password, confirm } });
                qc.clear();
                router.replace('/');
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setLoading(false);
              }
            }}
          >
            Permanently delete
          </Button>
        }
      >
        <div className="space-y-4">
          {me.wallet.availableMicros >= 10_000 && <Alert tone="warning">You still have money in your account. Cash it out first — there’s no minimum, and it’s yours.</Alert>}
          {error && <Alert tone="danger">{error}</Alert>}
          {me.user.hasPassword && (
            <Field label="Password">
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          )}
          <Field label="Type DELETE to confirm">
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
