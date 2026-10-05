'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { flagEmoji, formatMoney, TIER_BY_ID, type TierId } from '@cashads/shared';
import { AdminHeader } from '@/components/admin/shell';
import { riskTone, statusTone } from '@/components/admin/tones';
import { DataTable } from '@/components/ui/data';
import { Badge } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/form';
import { TimeAgo } from '@/components/ui/misc';
import { useAdmin } from '@/lib/queries';

interface Row {
  id: string;
  email: string;
  displayName: string;
  country: string;
  status: string;
  role: string;
  tier: TierId;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  kycStatus: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  availableMicros: number;
  pendingMicros: number;
  lifetimeEarnedMicros: number;
  createdAt: string;
  lastSeenAt: string | null;
  isSeed: boolean;
}


export default function AdminUsersPage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [risk, setRisk] = useState('');
  const params = new URLSearchParams({ ...(q && { q }), ...(status && { status }), ...(risk && { risk }) }).toString();
  const { data, isLoading } = useAdmin<Row[]>(['users', q, status, risk], `/users${params ? `?${params}` : ''}`);
  return (
    <div>
      <AdminHeader title="Users" description="Search by email, name, referral code or user id." />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="sm:max-w-sm" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-40">
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="restricted">Restricted</option>
          <option value="banned">Banned</option>
          <option value="deleted">Deleted</option>
        </Select>
        <Select value={risk} onChange={(e) => setRisk(e.target.value)} className="sm:w-40">
          <option value="">Any risk</option>
          <option value="low">Low risk</option>
          <option value="medium">Medium risk</option>
          <option value="high">High risk</option>
        </Select>
      </div>
      <DataTable
        rows={data}
        loading={isLoading}
        rowKey={(r) => r.id}
        onRowClick={(r) => router.push(`/admin/users/${r.id}`)}
        columns={[
          {
            key: 'user',
            header: 'Member',
            cell: (r) => (
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {flagEmoji(r.country)} {r.displayName} {r.role !== 'user' && <Badge tone="info">{r.role}</Badge>}
                </p>
                <p className="truncate text-xs text-muted">{r.email}</p>
              </div>
            ),
          },
          { key: 'status', header: 'Status', cell: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
          { key: 'risk', header: 'Risk', cell: (r) => <Badge tone={riskTone(r.riskLevel)}>{`${r.riskLevel} · ${r.riskScore}`}</Badge> },
          { key: 'tier', header: 'Tier', cell: (r) => TIER_BY_ID[r.tier].label },
          { key: 'verif', header: 'Verified', cell: (r) => <span className="text-xs">{[r.emailVerified && 'email', r.phoneVerified && 'phone', r.kycStatus === 'verified' && 'KYC'].filter(Boolean).join(' · ') || '—'}</span> },
          { key: 'bal', header: 'Balance', align: 'right', cell: (r) => <span className="tabular">{formatMoney(r.availableMicros)}{r.pendingMicros > 0 && <span className="block text-xs text-amber-600">+{formatMoney(r.pendingMicros)}</span>}</span> },
          { key: 'life', header: 'Lifetime', align: 'right', cell: (r) => <span className="tabular">{formatMoney(r.lifetimeEarnedMicros)}</span> },
          { key: 'joined', header: 'Joined', cell: (r) => <TimeAgo iso={r.createdAt} className="text-xs text-muted" /> },
        ]}
      />
    </div>
  );
}
