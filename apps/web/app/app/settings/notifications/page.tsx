'use client';

import { useQueryClient } from '@tanstack/react-query';
import type { PreferencesInput } from '@cashads/shared';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Switch } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api';
import { qk, useMe } from '@/lib/queries';
import { toast } from '@/lib/store';

export default function NotificationSettingsPage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  if (!me) return null;
  const p = me.user.preferences;
  const save = async (patch: PreferencesInput) => {
    try {
      await api('/me', { method: 'PATCH', body: { preferences: patch } });
      await qc.invalidateQueries({ queryKey: qk.me });
    } catch (err) {
      toast({ title: errorMessage(err), tone: 'danger' });
    }
  };
  return (
    <Card>
      <CardHeader title="Email notifications" description="In-app notifications are always on. We respect your inbox: no daily spam, ever." />
      <CardBody className="space-y-5">
        <Switch checked={p.emailPayouts} onChange={(v) => void save({ emailPayouts: v })} label="Cash outs & claims" description="When money is sent, needs review or a claim is resolved. Recommended." />
        <Switch checked={p.emailCredits} onChange={(v) => void save({ emailCredits: v })} label="Every credit" description="An email for each reward. Most people keep this off." />
        <Switch checked={p.emailStreak} onChange={(v) => void save({ emailStreak: v })} label="Streak reminders" description="At most one gentle reminder a day, only if you’re about to lose a streak." />
        <Switch checked={p.emailProduct} onChange={(v) => void save({ emailProduct: v })} label="Product news" description="New payout methods, features and double-earnings weekends. Monthly at most." />
        <div className="rounded-xl bg-surface-2 p-4 text-sm text-muted">Security alerts (new sign-ins, password changes) and account decisions are always sent. They protect you.</div>
      </CardBody>
    </Card>
  );
}
