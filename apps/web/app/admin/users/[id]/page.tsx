'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, CheckCircle2, Flag, KeyRound, ShieldOff, StickyNote, Wallet } from 'lucide-react';
import { countryName, flagEmoji, formatMoney, PAYOUT_STATUS_META, TIER_BY_ID, TRANSACTION_TYPE_META, type PayoutStatus, type TierId, type TransactionType } from '@cashads/shared';
import { AdminHeader, ReasonDialog } from '@/components/admin/shell';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, Stat } from '@/components/ui/card';
import { Alert, Badge, Skeleton } from '@/components/ui/feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { KeyValue, TimeAgo } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { useAdmin, useMe } from '@/lib/queries';
import { toast } from '@/lib/store';
import { riskTone, statusTone } from '@/components/admin/tones';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Detail = any;

export default function AdminUserPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: d, isLoading } = useAdmin<Detail>(['user', id], `/users/${id}`);
  const [dialog, setDialog] = useState<null | 'ban' | 'restrict' | 'activate' | 'flag'>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjust, setAdjust] = useState({ amount: '', reason: '' });
  const [note, setNote] = useState('');
  if (isLoading || !d) return <Skeleton className="h-[70vh] rounded-3xl" />;
  const u = d.user;
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'user', id] });
  const isAdmin = me?.user.role === 'admin';

  const act = async (path: string, body: unknown, ok: string) => {
    await api(`/admin/users/${id}/${path}`, { body });
    toast({ title: ok, tone: 'success' });
    await refresh();
  };

  return (
    <div className="space-y-6">
      <Link href="/admin/users" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Users
      </Link>
      <AdminHeader
        title={`${flagEmoji(u.country)} ${u.displayName}`}
        description={`${u.email} · ${countryName(u.country)} · joined ${new Date(u.createdAt).toLocaleDateString()}${u.isSeed ? ' · demo seed' : ''}`}
        action={
          <>
            {u.status !== 'active' ? (
              <Button size="sm" onClick={() => setDialog('activate')}>
                <CheckCircle2 className="h-4 w-4" /> Reactivate
              </Button>
            ) : (
              <>
                <Button size="sm" variant="secondary" onClick={() => setDialog('restrict')}>
                  <ShieldOff className="h-4 w-4" /> Restrict
                </Button>
                <Button size="sm" variant="danger" onClick={() => setDialog('ban')}>
                  <Ban className="h-4 w-4" /> Ban
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={() => setDialog('flag')}>
              <Flag className="h-4 w-4" /> Flag
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap gap-2">
        <Badge tone={statusTone(u.status)}>{u.status}</Badge>
        <Badge tone={riskTone(u.riskLevel)}>{`risk ${u.riskLevel} · ${u.riskScore}`}</Badge>
        <Badge tone="brand">{TIER_BY_ID[u.tier as TierId].label}</Badge>
        <Badge>{u.role}</Badge>
        <Badge tone={u.emailVerifiedAt ? 'success' : 'neutral'}>email {u.emailVerifiedAt ? '✓' : '✗'}</Badge>
        <Badge tone={u.phoneVerifiedAt ? 'success' : 'neutral'}>phone {u.phoneVerifiedAt ? '✓' : '✗'}</Badge>
        <Badge tone={u.kycStatus === 'verified' ? 'success' : u.kycStatus === 'pending' ? 'warning' : 'neutral'}>KYC {u.kycStatus}</Badge>
        {u.twoFactorEnabled && <Badge tone="success">2FA</Badge>}
      </div>
      {u.statusReason && <Alert tone="warning" title="Reason shown to member">{u.statusReason}</Alert>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Available" value={formatMoney(d.wallet?.availableMicros ?? 0)} icon={<Wallet className="h-4 w-4" />} />
        <Stat label="Pending" value={formatMoney(d.wallet?.pendingMicros ?? 0)} />
        <Stat label="Lifetime earned" value={formatMoney(d.wallet?.lifetimeEarnedMicros ?? 0)} />
        <Stat label="Withdrawn" value={formatMoney(d.wallet?.lifetimeWithdrawnMicros ?? 0)} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Transactions" action={isAdmin && <Button size="xs" variant="secondary" onClick={() => setAdjustOpen(true)}>Adjust balance</Button>} />
            <CardBody className="max-h-96 overflow-y-auto p-0 sm:p-0">
              <table className="mt-3 w-full text-sm">
                <tbody className="divide-y divide-line border-t border-line">
                  {d.transactions.map((t: any) => (
                    <tr key={t.id}>
                      <td className="px-5 py-2.5">
                        <p className="font-medium">{t.description}</p>
                        <p className="text-xs text-muted">
                          {TRANSACTION_TYPE_META[t.type as TransactionType]?.label} · {t.status} · <TimeAgo iso={t.createdAt} />
                        </p>
                      </td>
                      <td className="tabular px-5 py-2.5 text-right font-semibold">{formatMoney(t.amountMicros, { signed: true })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Cash outs" />
            <CardBody className="space-y-2">
              {d.payouts.length === 0 && <p className="text-sm text-muted">None.</p>}
              {d.payouts.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">
                    {p.methodId} → {p.destinationMasked} <span className="text-xs text-muted">· <TimeAgo iso={p.createdAt} /></span>
                  </span>
                  <span className="tabular font-semibold">{formatMoney(p.amountMicros)}</span>
                  <Badge tone={PAYOUT_STATUS_META[p.status as PayoutStatus].tone}>{p.status}</Badge>
                </div>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Missing-credit claims" />
            <CardBody className="space-y-2 text-sm">
              {d.claims.length === 0 && <p className="text-muted">None.</p>}
              {d.claims.map((c: any) => (
                <div key={c.id} className="flex justify-between gap-3">
                  <span>{c.offerTitle}</span>
                  <span className="flex items-center gap-2">
                    <span className="tabular">{formatMoney(c.amountMicros)}</span>
                    <Badge>{c.status}</Badge>
                  </span>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Risk signals" description="Explainable — every point comes from a named signal." />
            <CardBody className="space-y-2">
              {d.signals.length === 0 && <p className="text-sm text-muted">No signals.</p>}
              {d.signals.map((s: any) => (
                <div key={s.id} className="flex items-start justify-between gap-3 text-sm">
                  <span className={s.clearedAt ? 'text-muted line-through' : ''}>
                    {s.label}
                    <span className="block text-xs text-subtle">
                      <TimeAgo iso={s.createdAt} />
                    </span>
                  </span>
                  <Badge tone={s.weight < 0 ? 'success' : s.weight >= 30 ? 'danger' : 'warning'}>{s.weight > 0 ? `+${s.weight}` : s.weight}</Badge>
                </div>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Linked accounts" description="Share a device key or fingerprint." />
            <CardBody className="space-y-2 text-sm">
              {d.linked.length === 0 && <p className="text-muted">None found.</p>}
              {d.linked.map((l: any) => (
                <Link key={l.id} href={`/admin/users/${l.id}`} className="flex items-center justify-between hover:underline">
                  <span>{l.displayName} · {l.email}</span>
                  <Badge tone={riskTone(l.riskLevel)}>{l.status}</Badge>
                </Link>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Devices & sessions" action={<Button size="xs" variant="ghost" onClick={async () => act('revoke-sessions', {}, 'All sessions revoked')}><KeyRound className="h-3.5 w-3.5" /> Revoke all</Button>} />
            <CardBody className="space-y-2 text-sm">
              {d.devices.map((dv: any) => (
                <p key={dv.id}>
                  {dv.label} <span className="text-xs text-muted">· {dv.lastIp} · <TimeAgo iso={dv.lastSeenAt} /></span>
                </p>
              ))}
              <p className="pt-2 text-xs text-muted">{d.sessions.length} active session(s) · signup IP {u.signupIp ?? '—'}</p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Profile" />
            <CardBody className="py-2">
              <KeyValue
                items={[
                  ['User id', <code key="id" className="text-xs">{u.id}</code>],
                  ['Referral code', u.referralCode],
                  ['Referred by', d.referrer ? <Link key="r" href={`/admin/users/${d.referrer.id}`} className="underline">{d.referrer.displayName}</Link> : '—'],
                  ['Referrals', d.referrals.length],
                  ['Streak', `${u.streakCurrent} (best ${u.streakBest})`],
                  ['Phone', u.phone ?? '—'],
                  ['Last seen', u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString() : '—'],
                ]}
              />
              {isAdmin && u.id !== me?.user.id && (
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-xs text-muted">Role</span>
                  <Select
                    value={u.role}
                    className="h-9 w-36"
                    onChange={async (e) => {
                      try {
                        await act('role', { role: e.target.value }, 'Role updated');
                      } catch (err) {
                        toast({ title: errorMessage(err), tone: 'danger' });
                      }
                    }}
                  >
                    <option value="user">user</option>
                    <option value="support">support</option>
                    <option value="admin">admin</option>
                  </Select>
                </div>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader icon={<StickyNote className="h-5 w-5" />} title="Internal notes" description="Never shown to the member." />
            <CardBody className="space-y-3">
              {d.notes.map((n: any) => (
                <div key={n.id} className="rounded-xl bg-surface-2 p-3 text-sm">
                  <p>{n.note}</p>
                  <p className="mt-1 text-xs text-muted">
                    {n.authorName} · <TimeAgo iso={n.createdAt} />
                  </p>
                </div>
              ))}
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Add a note…" className="min-h-0" />
              <Button
                size="sm"
                variant="secondary"
                disabled={note.trim().length < 2}
                onClick={async () => {
                  await act('notes', { note }, 'Note added');
                  setNote('');
                }}
              >
                Add note
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>

      <ReasonDialog
        open={dialog === 'ban' || dialog === 'restrict' || dialog === 'activate'}
        onClose={() => setDialog(null)}
        title={dialog === 'ban' ? 'Ban this member' : dialog === 'restrict' ? 'Restrict earning & cash outs' : 'Reactivate account'}
        description={dialog === 'ban' ? 'Unsent cash outs are refunded to their (frozen) balance. They can still log in to read the reason and appeal.' : undefined}
        confirmLabel={dialog === 'ban' ? 'Ban' : dialog === 'restrict' ? 'Restrict' : 'Reactivate'}
        danger={dialog === 'ban'}
        defaultReason={dialog === 'activate' ? 'Reviewed — everything checks out. Thanks for your patience.' : ''}
        onConfirm={async (reason) => act('status', { status: dialog === 'ban' ? 'banned' : dialog === 'restrict' ? 'restricted' : 'active', reason }, 'Status updated')}
      />
      <ReasonDialog open={dialog === 'flag'} onClose={() => setDialog(null)} title="Flag for review" description="Adds a manual risk signal (+35) and opens a fraud case." confirmLabel="Flag" onConfirm={async (reason) => act('flag', { note: reason }, 'Flagged')} />
      <Modal
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        title="Adjust balance"
        description="Creates a balanced ledger entry against platform:adjustments. Logged in the audit trail."
        footer={
          <Button
            onClick={async () => {
              try {
                await act('adjust', { amountMicros: Math.round(Number(adjust.amount) * 1e6), reason: adjust.reason }, 'Balance adjusted');
                setAdjustOpen(false);
                setAdjust({ amount: '', reason: '' });
              } catch (err) {
                toast({ title: errorMessage(err), tone: 'danger' });
              }
            }}
          >
            Apply adjustment
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="Amount (USD, negative to deduct)">
            <Input value={adjust.amount} onChange={(e) => setAdjust({ ...adjust, amount: e.target.value })} placeholder="1.50 or -0.75" />
          </Field>
          <Field label="Reason (shown to member)">
            <Input value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
