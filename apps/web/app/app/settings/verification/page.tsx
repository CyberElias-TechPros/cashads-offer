'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, IdCard, Mail, Smartphone } from 'lucide-react';
import { COUNTRIES, formatMoney } from '@cashads/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert, Badge } from '@/components/ui/feedback';
import { Field, Input, Select } from '@/components/ui/form';
import { PhoneVerifyModal } from '@/components/app/phone-verify';
import { api, errorMessage, uploadImage } from '@/lib/api';
import { qk, useKyc, useMe } from '@/lib/queries';
import { toast } from '@/lib/store';

function Row({ icon, title, description, done, action }: { icon: React.ReactNode; title: string; description: string; done: boolean; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 py-4">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-3 text-muted">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted">{description}</p>
      </div>
      {done ? (
        <Badge tone="success">
          <CheckCircle2 className="h-3 w-3" /> Verified
        </Badge>
      ) : (
        action
      )}
    </div>
  );
}

export default function VerificationPage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: kyc } = useKyc();
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [doc, setDoc] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [form, setForm] = useState({ documentType: 'passport', documentCountry: me?.user.country ?? 'US', documentNumber: '', legalName: '', dateOfBirth: '' });
  const [submitting, setSubmitting] = useState(false);
  const docRef = useRef<HTMLInputElement>(null);
  const selfieRef = useRef<HTMLInputElement>(null);
  if (!me) return null;
  const u = me.user;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Verification" description="We only ask for what we need, when we need it. Start with just an email; we ask for a phone before your first cash out, and ID only for large ones." />
        <CardBody className="divide-y divide-line py-2">
          <Row
            icon={<Mail className="h-5 w-5" />}
            title="Email"
            description={u.email}
            done={u.emailVerified}
            action={
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  try {
                    await api('/auth/resend-verification', { body: {} });
                    toast({ title: 'Link sent', description: me.flags.demoMode ? 'Demo: check the dev mailbox.' : 'Check your inbox.', tone: 'success', action: me.flags.demoMode ? { label: 'Open mailbox', href: '/dev/mailbox' } : undefined });
                  } catch (err) {
                    toast({ title: errorMessage(err), tone: 'danger' });
                  }
                }}
              >
                Resend link
              </Button>
            }
          />
          <Row icon={<Smartphone className="h-5 w-5" />} title="Phone" description={u.phone ?? 'Needed before your first cash out'} done={u.phoneVerified} action={<Button size="sm" onClick={() => setPhoneOpen(true)}>Verify</Button>} />
          <Row icon={<IdCard className="h-5 w-5" />} title="Identity" description={`Only for single cash outs over ${formatMoney(100_000_000)} or large lifetime totals`} done={u.kycStatus === 'verified'} action={<Badge tone={u.kycStatus === 'pending' ? 'warning' : u.kycStatus === 'rejected' ? 'danger' : 'neutral'}>{u.kycStatus === 'pending' ? 'In review' : u.kycStatus === 'rejected' ? 'Try again' : 'Optional'}</Badge>} />
        </CardBody>
      </Card>

      {u.kycStatus !== 'verified' && u.kycStatus !== 'pending' && (
        <Card>
          <CardHeader title="Verify your identity" description="Your documents are encrypted and used only for verification. Most checks finish in minutes." />
          <CardBody className="space-y-4">
            {kyc?.latest?.status === 'rejected' && <Alert tone="danger">Last attempt wasn’t approved: {kyc.latest.reason}</Alert>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Document type">
                <Select value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value })}>
                  <option value="passport">Passport</option>
                  <option value="national_id">National ID</option>
                  <option value="drivers_license">Driver’s license</option>
                </Select>
              </Field>
              <Field label="Issuing country">
                <Select value={form.documentCountry} onChange={(e) => setForm({ ...form, documentCountry: e.target.value })}>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Legal name (as on document)">
                <Input value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} />
              </Field>
              <Field label="Date of birth">
                <Input type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />
              </Field>
              <Field label="Document number" className="sm:col-span-2" hint="We store only the last 4 digits plus a one-way hash.">
                <Input value={form.documentNumber} onChange={(e) => setForm({ ...form, documentNumber: e.target.value })} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input ref={docRef} type="file" accept="image/*" className="hidden" onChange={(e) => setDoc(e.target.files?.[0] ?? null)} />
              <input ref={selfieRef} type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => setSelfie(e.target.files?.[0] ?? null)} />
              <button onClick={() => docRef.current?.click()} className="rounded-xl border border-dashed border-line-strong p-4 text-sm text-muted hover:border-brand-400">
                {doc ? `📄 ${doc.name}` : '📄 Photo of your document'}
              </button>
              <button onClick={() => selfieRef.current?.click()} className="rounded-xl border border-dashed border-line-strong p-4 text-sm text-muted hover:border-brand-400">
                {selfie ? `🤳 ${selfie.name}` : '🤳 Take a selfie'}
              </button>
            </div>
            <Button
              loading={submitting}
              disabled={!doc || !selfie || !form.legalName || !form.dateOfBirth || form.documentNumber.length < 4}
              onClick={async () => {
                setSubmitting(true);
                try {
                  const [d, s] = await Promise.all([uploadImage(doc!, 'kyc_document'), uploadImage(selfie!, 'kyc_selfie')]);
                  await api('/me/kyc', { body: { ...form, documentUploadId: d.id, selfieUploadId: s.id } });
                  await Promise.all([qc.invalidateQueries({ queryKey: qk.me }), qc.invalidateQueries({ queryKey: qk.kyc })]);
                  toast({ title: 'Submitted for verification', description: me.flags.demoMode ? 'Demo: auto-review finishes in a few seconds.' : 'We’ll notify you when it’s done.', tone: 'success' });
                } catch (err) {
                  toast({ title: errorMessage(err), tone: 'danger' });
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              Submit for verification
            </Button>
          </CardBody>
        </Card>
      )}
      {u.kycStatus === 'pending' && <Alert tone="warning" title="Identity check in progress">We’ll notify you as soon as it’s done — usually within minutes.</Alert>}
      <p className="text-xs text-subtle">
        Why verify? It keeps cash outs instant for honest members and blocks fraudsters who would otherwise drain the payout budget. See our{' '}
        <Link href="/privacy" className="underline">
          privacy policy
        </Link>
        .
      </p>
      <PhoneVerifyModal open={phoneOpen} onClose={() => setPhoneOpen(false)} />
    </div>
  );
}
