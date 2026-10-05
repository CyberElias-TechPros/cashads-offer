'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pause, Pencil, Play, Plus } from 'lucide-react';
import { CATEGORY_META, DATA_USAGE, OFFER_CATEGORIES, formatMoney, type AdminOfferInput } from '@cashads/shared';
import { AdminHeader } from '@/components/admin/shell';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data';
import { Alert, Badge } from '@/components/ui/feedback';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { useAdmin } from '@/lib/queries';
import { toast } from '@/lib/store';
import { pct } from '@/lib/utils';

/* eslint-disable @typescript-eslint/no-explicit-any */
const blank = {
  networkId: 'demo',
  title: '',
  advertiser: '',
  shortDescription: '',
  description: '',
  category: 'survey',
  icon: '🎯',
  brandColor: '#10b981',
  partner: '1.00',
  estimatedMinutes: '5',
  dataUsage: 'light',
  steps: '',
  requirements: '',
  countries: '',
  holdHours: '',
  featured: false,
  sandboxDropPostback: false,
};

export default function AdminOffersPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useAdmin<any[]>(['offers'], '/offers');
  const { data: networks } = useAdmin<any[]>(['networks'], '/networks');
  const [edit, setEdit] = useState<{ id: string | null; f: typeof blank } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'offers'] });

  const open = (o?: any) =>
    setEdit({
      id: o?.id ?? null,
      f: o
        ? {
            networkId: o.networkId,
            title: o.title,
            advertiser: o.advertiser,
            shortDescription: o.shortDescription,
            description: o.description,
            category: o.category,
            icon: o.icon,
            brandColor: o.brandColor,
            partner: (o.partnerPayoutMicros / 1e6).toFixed(2),
            estimatedMinutes: String(o.estimatedMinutes),
            dataUsage: o.dataUsage,
            steps: o.steps.join('\n'),
            requirements: o.requirements.join('\n'),
            countries: o.countries.join(', '),
            holdHours: o.holdHours === null ? '' : String(o.holdHours),
            featured: o.featured,
            sandboxDropPostback: o.sandboxDropPostback,
          }
        : { ...blank },
    });

  async function save() {
    if (!edit) return;
    setError(null);
    const f = edit.f;
    const body: Partial<AdminOfferInput> = {
      networkId: f.networkId,
      title: f.title,
      advertiser: f.advertiser,
      shortDescription: f.shortDescription,
      description: f.description,
      category: f.category as AdminOfferInput['category'],
      icon: f.icon,
      brandColor: f.brandColor,
      partnerPayoutMicros: Math.round(Number(f.partner) * 1e6),
      estimatedMinutes: Number(f.estimatedMinutes),
      dataUsage: f.dataUsage as AdminOfferInput['dataUsage'],
      steps: f.steps.split('\n').map((s) => s.trim()).filter(Boolean),
      requirements: f.requirements.split('\n').map((s) => s.trim()).filter(Boolean),
      countries: f.countries.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
      holdHours: f.holdHours === '' ? null : Number(f.holdHours),
      featured: f.featured,
      sandboxDropPostback: f.sandboxDropPostback,
    };
    try {
      if (edit.id) await api(`/admin/offers/${edit.id}`, { method: 'PATCH', body });
      else await api('/admin/offers', { body: { ...body, platforms: ['web'], goals: [], status: 'active' } });
      toast({ title: 'Offer saved', tone: 'success' });
      setEdit(null);
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const set = (k: keyof typeof blank, v: any) => setEdit((e) => (e ? { ...e, f: { ...e.f, [k]: v } } : e));

  return (
    <div>
      <AdminHeader
        title="Offers"
        description="Quality scores, tracking reliability and real completion times are recomputed from member data every 10 minutes."
        action={
          <>
            <Button size="sm" variant="secondary" onClick={async () => (await api('/admin/offers/recompute-stats', { body: {} }), refresh(), toast({ title: 'Stats recomputed', tone: 'success' }))}>
              Recompute stats
            </Button>
            <Button size="sm" onClick={() => open()}>
              <Plus className="h-4 w-4" /> New offer
            </Button>
          </>
        }
      />
      <DataTable
        rows={data}
        loading={isLoading}
        rowKey={(r) => r.id}
        columns={[
          { key: 'title', header: 'Offer', cell: (r) => <span><span className="font-medium">{r.icon} {r.title}</span><span className="block text-xs text-muted">{r.advertiser} · {CATEGORY_META[r.category as keyof typeof CATEGORY_META].label} · {r.networkId}</span></span> },
          { key: 'status', header: 'Status', cell: (r) => <span className="space-x-1">{<Badge tone={r.status === 'active' ? 'success' : r.status === 'paused' ? 'warning' : 'neutral'}>{r.status}</Badge>}{r.reportsOpen > 0 && <Badge tone="danger">{r.reportsOpen} reports</Badge>}{r.sandboxDropPostback && <Badge tone="info">drops postbacks</Badge>}</span> },
          { key: 'payout', header: 'Partner pays', align: 'right', cell: (r) => <span className="tabular">{formatMoney(r.partnerPayoutMicros)}</span> },
          { key: 'time', header: 'Time', align: 'right', cell: (r) => <span className="tabular text-xs">{r.medianMinutes ?? r.estimatedMinutes} min{r.medianMinutes ? ' (real)' : ''}</span> },
          { key: 'conv', header: 'Clicks → credited', align: 'right', cell: (r) => <span className="tabular text-xs">{r.clicks} → {r.creditedClicks}</span> },
          { key: 'q', header: 'Quality', align: 'right', cell: (r) => <span className="tabular text-xs">{r.qualityScore} · {pct(r.trackingReliability)}</span> },
          {
            key: 'actions',
            header: '',
            align: 'right',
            cell: (r) => (
              <div className="flex justify-end gap-1">
                <Button size="xs" variant="ghost" onClick={() => open(r)} aria-label="Edit">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="xs" variant="ghost" aria-label={r.status === 'active' ? 'Pause' : 'Activate'} onClick={async () => (await api(`/admin/offers/${r.id}`, { method: 'PATCH', body: { status: r.status === 'active' ? 'paused' : 'active' } }), refresh())}>
                  {r.status === 'active' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </Button>
              </div>
            ),
          },
        ]}
      />
      <Modal open={!!edit} onClose={() => setEdit(null)} size="lg" title={edit?.id ? 'Edit offer' : 'New offer'} footer={<Button onClick={save}>Save offer</Button>}>
        {edit && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {error && <Alert tone="danger" className="sm:col-span-2">{error}</Alert>}
            <Field label="Network">
              <Select value={edit.f.networkId} onChange={(e) => set('networkId', e.target.value)}>
                {networks?.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Category">
              <Select value={edit.f.category} onChange={(e) => set('category', e.target.value)}>
                {OFFER_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_META[c].label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Title" className="sm:col-span-2">
              <Input value={edit.f.title} onChange={(e) => set('title', e.target.value)} />
            </Field>
            <Field label="Advertiser">
              <Input value={edit.f.advertiser} onChange={(e) => set('advertiser', e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Icon">
                <Input value={edit.f.icon} onChange={(e) => set('icon', e.target.value)} />
              </Field>
              <Field label="Brand color">
                <Input type="color" value={edit.f.brandColor} onChange={(e) => set('brandColor', e.target.value)} className="h-11 p-1" />
              </Field>
            </div>
            <Field label="Short description" className="sm:col-span-2">
              <Input value={edit.f.shortDescription} onChange={(e) => set('shortDescription', e.target.value)} />
            </Field>
            <Field label="Partner payout (USD)" hint="What the partner pays us. Members see their share automatically.">
              <Input value={edit.f.partner} onChange={(e) => set('partner', e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Estimated minutes">
              <Input value={edit.f.estimatedMinutes} onChange={(e) => set('estimatedMinutes', e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Data usage">
              <Select value={edit.f.dataUsage} onChange={(e) => set('dataUsage', e.target.value)}>
                {DATA_USAGE.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Safety hold (hours)" hint="Blank = automatic rules by amount">
              <Input value={edit.f.holdHours} onChange={(e) => set('holdHours', e.target.value)} inputMode="numeric" />
            </Field>
            <Field label="Countries" hint="Comma-separated ISO codes, blank = everywhere" className="sm:col-span-2">
              <Input value={edit.f.countries} onChange={(e) => set('countries', e.target.value)} placeholder="US, GB, NG" />
            </Field>
            <Field label="Steps (one per line)">
              <Textarea value={edit.f.steps} onChange={(e) => set('steps', e.target.value)} rows={4} />
            </Field>
            <Field label="Requirements (one per line)">
              <Textarea value={edit.f.requirements} onChange={(e) => set('requirements', e.target.value)} rows={4} />
            </Field>
            <Field label="Full description" className="sm:col-span-2">
              <Textarea value={edit.f.description} onChange={(e) => set('description', e.target.value)} rows={3} />
            </Field>
            <Checkbox checked={edit.f.featured} onChange={(v) => set('featured', v)} label="Featured" />
            <Checkbox checked={edit.f.sandboxDropPostback} onChange={(v) => set('sandboxDropPostback', v)} label="Sandbox: drop postbacks" description="Simulates broken partner tracking (for testing claims)." />
          </div>
        )}
      </Modal>
    </div>
  );
}
