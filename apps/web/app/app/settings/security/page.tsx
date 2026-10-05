'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, LogOut, MonitorSmartphone, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert, Badge } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { TimeAgo } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { qk, useDevices, useLoginHistory, useMe, useSessions } from '@/lib/queries';
import { toast } from '@/lib/store';

export default function SecurityPage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: sessions } = useSessions();
  const { data: devices } = useDevices();
  const { data: logins } = useLoginHistory();
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwLoading, setPwLoading] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [disableOpen, setDisableOpen] = useState(false);
  const [disable, setDisable] = useState({ password: '', code: '' });
  if (!me) return null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader icon={<ShieldCheck className="h-5 w-5" />} title="Two-factor authentication" description="Protect your balance with a code from an authenticator app (Google Authenticator, 1Password, Authy…)." action={me.user.twoFactorEnabled ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>} />
        <CardBody>
          {me.user.twoFactorEnabled ? (
            <Button variant="secondary" onClick={() => setDisableOpen(true)}>
              Turn off 2FA
            </Button>
          ) : setup ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-[auto_1fr] sm:items-start">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={setup.qrDataUrl} alt="2FA QR code" className="h-44 w-44 rounded-xl border border-line bg-white p-2" />
              <div className="space-y-3">
                <p className="text-sm">Scan the QR code, or enter this key manually:</p>
                <p className="break-all rounded-lg bg-surface-3 px-3 py-2 font-mono text-sm tracking-wider">{setup.secret}</p>
                <Field label="6-digit code from the app">
                  <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" className="tabular w-40 text-center tracking-[0.3em]" />
                </Field>
                <Button
                  disabled={code.length !== 6}
                  onClick={async () => {
                    try {
                      await api('/me/2fa/enable', { body: { code } });
                      await qc.invalidateQueries({ queryKey: qk.me });
                      setSetup(null);
                      setCode('');
                      toast({ title: 'Two-factor authentication is on 🔐', tone: 'success' });
                    } catch (err) {
                      toast({ title: errorMessage(err), tone: 'danger' });
                    }
                  }}
                >
                  Confirm & turn on
                </Button>
              </div>
            </div>
          ) : (
            <Button
              onClick={async () => {
                try {
                  setSetup(await api('/me/2fa/setup', { body: {} }));
                } catch (err) {
                  toast({ title: errorMessage(err), tone: 'danger' });
                }
              }}
            >
              Set up 2FA
            </Button>
          )}
        </CardBody>
      </Card>

      {me.user.hasPassword && (
        <Card>
          <CardHeader icon={<KeyRound className="h-5 w-5" />} title="Password" description="Changing it signs out all your other sessions." />
          <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Current password">
              <Input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" />
            </Field>
            <Field label="New password" hint="8+ characters, not a common password.">
              <Input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" />
            </Field>
            <div className="sm:col-span-2">
              <Button
                loading={pwLoading}
                disabled={!pw.current || pw.next.length < 8}
                onClick={async () => {
                  setPwLoading(true);
                  try {
                    await api('/me/password', { body: { currentPassword: pw.current, newPassword: pw.next } });
                    setPw({ current: '', next: '' });
                    await qc.invalidateQueries({ queryKey: qk.sessions });
                    toast({ title: 'Password changed', tone: 'success' });
                  } catch (err) {
                    toast({ title: errorMessage(err), tone: 'danger' });
                  } finally {
                    setPwLoading(false);
                  }
                }}
              >
                Change password
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          icon={<MonitorSmartphone className="h-5 w-5" />}
          title="Active sessions"
          description="You can be logged in on several devices. Rewarded videos run on one device at a time."
          action={
            (sessions?.length ?? 0) > 1 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  await api('/me/sessions/revoke-others', { body: {} });
                  await qc.invalidateQueries({ queryKey: qk.sessions });
                  toast({ title: 'Signed out everywhere else', tone: 'success' });
                }}
              >
                <LogOut className="h-4 w-4" /> Sign out others
              </Button>
            )
          }
        />
        <CardBody className="p-0 sm:p-0">
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {sessions?.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {s.deviceLabel} {s.current && <Badge tone="brand">This device</Badge>}
                  </p>
                  <p className="text-xs text-muted">
                    {s.ip ?? 'Unknown IP'} · active <TimeAgo iso={s.lastSeenAt} /> · since {new Date(s.createdAt).toLocaleDateString()}
                  </p>
                </div>
                {!s.current && (
                  <button
                    className="text-sm font-medium text-rose-600 hover:underline"
                    onClick={async () => {
                      await api(`/me/sessions/${s.id}`, { method: 'DELETE' });
                      await qc.invalidateQueries({ queryKey: qk.sessions });
                    }}
                  >
                    Sign out
                  </button>
                )}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Known devices" />
          <CardBody className="space-y-3">
            {devices?.map((d) => (
              <div key={d.id} className="text-sm">
                <p className="font-medium">{d.label}</p>
                <p className="text-xs text-muted">
                  First seen {new Date(d.firstSeenAt).toLocaleDateString()} · last <TimeAgo iso={d.lastSeenAt} />
                </p>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent sign-ins" />
          <CardBody className="space-y-3">
            {logins?.slice(0, 8).map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  {l.success ? '✅' : '⚠️'} {l.reason === 'signup' ? 'Account created' : l.success ? 'Signed in' : 'Failed attempt'} <span className="text-muted">· {l.ip ?? 'unknown IP'}</span>
                </span>
                <TimeAgo iso={l.at} className="shrink-0 text-xs text-muted" />
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      <Modal
        open={disableOpen}
        onClose={() => setDisableOpen(false)}
        title="Turn off two-factor authentication?"
        description="Your account will only be protected by your password."
        footer={
          <Button
            variant="danger"
            onClick={async () => {
              try {
                await api('/me/2fa/disable', { body: disable });
                await qc.invalidateQueries({ queryKey: qk.me });
                setDisableOpen(false);
                toast({ title: '2FA turned off', tone: 'warning' });
              } catch (err) {
                toast({ title: errorMessage(err), tone: 'danger' });
              }
            }}
          >
            Turn off
          </Button>
        }
      >
        <div className="space-y-4">
          <Alert tone="warning">We recommend keeping 2FA on — it’s the best protection for your balance.</Alert>
          <Field label="Password">
            <Input type="password" value={disable.password} onChange={(e) => setDisable({ ...disable, password: e.target.value })} />
          </Field>
          <Field label="Current 6-digit code">
            <Input value={disable.code} onChange={(e) => setDisable({ ...disable, code: e.target.value.replace(/\D/g, '').slice(0, 6) })} inputMode="numeric" />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
