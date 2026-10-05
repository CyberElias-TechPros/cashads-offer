'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SettingsInput } from '@cashads/shared';
import { AdminHeader } from '@/components/admin/shell';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert, Skeleton } from '@/components/ui/feedback';
import { Field, Input, Switch } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api';
import { useAdmin, useMe } from '@/lib/queries';
import { toast } from '@/lib/store';

type Kind = 'usd' | 'bps' | 'int' | 'hours' | 'bool' | 'text' | 'rate';
const GROUPS: Array<{ title: string; description: string; fields: Array<[keyof SettingsInput, string, Kind, string?]> }> = [
  {
    title: 'Economics',
    description: 'The single number that decides your future: the member revenue share.',
    fields: [
      ['revenueShareBps', 'Member revenue share', 'bps', 'Shown publicly on every offer and the transparency page.'],
      ['welcomeBonusMicros', 'Welcome bonus (after first offer)', 'usd'],
      ['planBonusMicros', 'Daily plan completion bonus', 'usd'],
    ],
  },
  {
    title: 'Referrals',
    description: 'Paid by the platform, never deducted from the friend.',
    fields: [
      ['referralRefereeBonusMicros', 'New member bonus', 'usd'],
      ['referralReferrerBonusMicros', 'Referrer bonus', 'usd'],
      ['referralCommissionBps', 'Ongoing commission', 'bps'],
      ['referralCommissionMonths', 'Commission duration (months)', 'int'],
    ],
  },
  {
    title: 'Cash outs',
    description: 'Velocity limits and verification thresholds.',
    fields: [
      ['autoApprovePayoutMaxMicros', 'Auto-approve up to', 'usd', 'Larger amounts go to the review queue.'],
      ['kycSinglePayoutMicros', 'KYC required for a single cash out above', 'usd'],
      ['kycLifetimeMicros', 'KYC required above lifetime total', 'usd'],
      ['maxPayoutsPerDay', 'Max cash outs per day', 'int'],
      ['maxPayoutWeeklyMicros', 'Max cash out total per week', 'usd'],
      ['requirePhoneForPayout', 'Require phone verification before first cash out', 'bool'],
    ],
  },
  {
    title: 'Safety holds',
    description: 'Tier multipliers apply on top (Platinum: no holds).',
    fields: [
      ['holdThresholdMicros', 'Hold credits at or above', 'usd'],
      ['holdHoursDefault', 'Default hold', 'hours'],
      ['highValueThresholdMicros', 'High-value threshold', 'usd'],
      ['holdHoursHighValue', 'High-value hold', 'hours'],
    ],
  },
  {
    title: 'Service levels',
    description: 'Published promises to members.',
    fields: [
      ['claimSlaHours', 'Missing-credit review SLA', 'hours'],
      ['ticketSlaHours', 'Support first-reply SLA', 'hours'],
      ['videoCooldownSeconds', 'Cooldown between videos (seconds)', 'int'],
    ],
  },
  {
    title: 'Operations',
    description: '',
    fields: [
      ['maintenanceBanner', 'Banner shown to all members (empty = none)', 'text'],
      ['sandboxPayoutFailureRate', 'Sandbox: transient payout failure rate (0–1)', 'rate'],
    ],
  },
];

export default function AdminSettingsPage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data, isLoading } = useAdmin<SettingsInput>(['settings'], '/settings');
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!data) return;
    const f: Record<string, string | boolean> = {};
    for (const g of GROUPS)
      for (const [k, , kind] of g.fields) {
        const v = data[k];
        f[k] = kind === 'usd' ? String((v as number) / 1e6) : kind === 'bps' ? String((v as number) / 100) : kind === 'bool' ? (v as boolean) : String(v);
      }
    setForm(f);
  }, [data]);
  if (isLoading || !data) return <Skeleton className="h-[60vh] rounded-3xl" />;
  const isAdmin = me?.user.role === 'admin';

  async function save() {
    setSaving(true);
    const patch: Record<string, unknown> = {};
    for (const g of GROUPS)
      for (const [k, , kind] of g.fields) {
        const v = form[k];
        patch[k] = kind === 'usd' ? Math.round(Number(v) * 1e6) : kind === 'bps' ? Math.round(Number(v) * 100) : kind === 'bool' ? v : kind === 'text' ? v : Number(v);
      }
    try {
      await api('/admin/settings', { method: 'PUT', body: patch });
      await qc.invalidateQueries({ queryKey: ['admin', 'settings'] });
      toast({ title: 'Settings saved — changes are live and audited', tone: 'success' });
    } catch (err) {
      toast({ title: errorMessage(err), tone: 'danger' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <AdminHeader title="Settings" description="Business rules, editable at runtime. Every change is recorded in the audit log with before/after values." action={isAdmin && <Button onClick={save} loading={saving}>Save changes</Button>} />
      {!isAdmin && <Alert tone="info">Support staff can view settings; only admins can change them.</Alert>}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {GROUPS.map((g) => (
          <Card key={g.title}>
            <CardHeader title={g.title} description={g.description} />
            <CardBody className="space-y-4">
              {g.fields.map(([k, label, kind, hint]) =>
                kind === 'bool' ? (
                  <Switch key={k} checked={!!form[k]} onChange={(v) => setForm((f) => ({ ...f, [k]: v }))} label={label} description={hint} disabled={!isAdmin} />
                ) : (
                  <Field key={k} label={`${label}${kind === 'usd' ? ' (USD)' : kind === 'bps' ? ' (%)' : kind === 'hours' ? ' (hours)' : ''}`} hint={hint}>
                    <Input value={String(form[k] ?? '')} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} disabled={!isAdmin} inputMode={kind === 'text' ? 'text' : 'decimal'} />
                  </Field>
                ),
              )}
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
