'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { COUNTRIES, flagEmoji, type PreferencesInput } from '@cashads/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Segmented, Select, Switch } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api';
import { qk, useMe } from '@/lib/queries';
import { toast, usePrefs } from '@/lib/store';

export default function ProfileSettingsPage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const prefs = usePrefs();
  const [displayName, setDisplayName] = useState('');
  const [country, setCountry] = useState('US');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (me) {
      setDisplayName(me.user.displayName);
      setCountry(me.user.country);
    }
  }, [me]);
  if (!me) return null;

  const savePrefs = async (p: PreferencesInput) => {
    try {
      await api('/me', { method: 'PATCH', body: { preferences: p } });
      await qc.invalidateQueries({ queryKey: qk.me });
    } catch (err) {
      toast({ title: errorMessage(err), tone: 'danger' });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Profile" description={me.user.email} />
        <CardBody className="space-y-4">
          <Field label="Display name" hint="Shown as “First L.” on leaderboards and the live payout feed.">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} />
          </Field>
          <Field label="Country" hint="Controls which offers and payout methods you see. Locked after your first cash out.">
            <Select value={country} onChange={(e) => setCountry(e.target.value)}>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {flagEmoji(c.code)} {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            loading={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await api('/me', { method: 'PATCH', body: { displayName, country, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } });
                await Promise.all([qc.invalidateQueries({ queryKey: qk.me }), qc.invalidateQueries({ queryKey: qk.methods }), qc.invalidateQueries({ queryKey: ['offers'] })]);
                toast({ title: 'Profile saved', tone: 'success' });
              } catch (err) {
                toast({ title: errorMessage(err), tone: 'danger' });
              } finally {
                setSaving(false);
              }
            }}
          >
            Save profile
          </Button>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Preferences" />
        <CardBody className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Theme</p>
              <p className="text-xs text-muted">Follows your device by default.</p>
            </div>
            <Segmented size="sm" value={prefs.theme} onChange={(v) => prefs.setTheme(v)} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
          </div>
          <Switch
            checked={prefs.dataSaver}
            onChange={(v) => {
              prefs.setDataSaver(v);
              void savePrefs({ dataSaver: v });
            }}
            label="Data saver"
            description="No animations or decorative images; light-data offers first. Made for 3G and small data bundles."
          />
          <Switch checked={me.user.preferences.showLocalCurrency} onChange={(v) => void savePrefs({ showLocalCurrency: v })} label="Show local currency" description="Show approximate amounts in your local currency next to USD." />
          <Switch checked={me.user.preferences.leaderboardOptIn} onChange={(v) => void savePrefs({ leaderboardOptIn: v })} label="Show my name on leaderboards & payout feed" description="Off = you appear as “Anonymous member”." />
        </CardBody>
      </Card>
    </div>
  );
}
