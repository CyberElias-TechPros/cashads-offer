import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Ban,
  Banknote,
  ClipboardList,
  Inbox,
  LogOut,
  Search,
  ShieldAlert,
  StickyNote,
  Undo2,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  type AdminOverviewDTO,
  type AdminSettingsDTO,
  BAN_REASONS,
  BAN_REASON_CODES,
  PAYOUT_METHODS,
  ROLES,
  type Settings,
  type TransactionDTO,
  type PayoutDTO,
  formatUsd,
  parseDollarInput,
} from '@cashads/shared';
import { PayoutStatusBadge } from '../../components/earn';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  Stat,
  Switch,
  Table,
  Td,
  Textarea,
  Th,
} from '../../components/ui';
import { errorMessage, get, patch, post } from '../../lib/api';
import { useMe } from '../../lib/queries';
import { cn, dateTime, duration, pct, timeAgo } from '../../lib/utils';
import { toast } from '../../store/ui';

/* ── charts (tiny, dependency-free SVG) ────────────────────────────────────── */

function BarChart({
  data,
  keys,
  colors,
  height = 160,
}: {
  data: Record<string, number | string>[];
  keys: string[];
  colors: string[];
  height?: number;
}) {
  const max = Math.max(1, ...data.flatMap((d) => keys.map((k) => Number(d[k]) || 0)));
  const w = 100 / data.length;
  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
      role="img"
    >
      {data.map((d, i) =>
        keys.map((k, ki) => {
          const v = Number(d[k]) || 0;
          const h = (v / max) * (height - 4);
          const bw = (w * 0.8) / keys.length;
          return (
            <rect
              key={`${i}-${k}`}
              x={i * w + w * 0.1 + ki * bw}
              y={height - h}
              width={bw * 0.92}
              height={h}
              rx={0.6}
              fill={colors[ki]}
            />
          );
        }),
      )}
    </svg>
  );
}

function QueueCard({
  to,
  icon: Icon,
  label,
  count,
  tone,
}: {
  to: string;
  icon: typeof Users;
  label: string;
  count: number;
  tone?: 'warn' | 'danger';
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900"
    >
      <span
        className={cn(
          'flex size-10 items-center justify-center rounded-xl',
          count && tone === 'danger'
            ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
            : count
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
              : 'bg-slate-100 text-slate-500 dark:bg-slate-800',
        )}
      >
        <Icon className="size-5" />
      </span>
      <div>
        <p className="tabular text-xl font-bold">{count}</p>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
    </Link>
  );
}

export function AdminOverview() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: () => get<AdminOverviewDTO>('/admin/overview'),
    refetchInterval: 30_000,
  });
  if (isLoading || !data) return <Skeleton className="h-[600px]" />;
  return (
    <div className="space-y-6">
      <PageHeader title="Operations overview" subtitle="Live state of members, money and queues." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <QueueCard
          to="/admin/payouts"
          icon={Banknote}
          label="Payouts in review"
          count={data.queues.payoutsReview}
        />
        <QueueCard
          to="/admin/claims"
          icon={ClipboardList}
          label="Claims need a human"
          count={data.queues.claimsReview}
        />
        <QueueCard
          to="/admin/fraud"
          icon={ShieldAlert}
          label="Open fraud flags"
          count={data.queues.fraudOpen}
          tone="danger"
        />
        <QueueCard to="/admin/support" icon={Inbox} label="Open tickets" count={data.queues.ticketsOpen} />
        <QueueCard to="/admin/kyc" icon={UserCog} label="ID checks pending" count={data.queues.kycPending} />
        <QueueCard
          to="/admin/offers"
          icon={AlertTriangle}
          label="Offer reports"
          count={data.queues.reportsOpen}
        />
        <QueueCard
          to="/admin/payouts"
          icon={Wallet}
          label="Payouts sending"
          count={data.queues.payoutsProcessing}
        />
        <QueueCard
          to="/admin/settings"
          icon={AlertTriangle}
          label="Failed jobs"
          count={data.queues.jobsFailed}
          tone="danger"
        />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Last 14 days" subtitle="Member earnings vs. completed payouts" />
          <BarChart
            data={data.series}
            keys={['earningsMicros', 'payoutsMicros']}
            colors={['#10b981', '#94a3b8']}
          />
          <div className="mt-2 flex justify-between text-[10px] text-slate-400">
            <span>{data.series[0]?.date}</span>
            <span>{data.series.at(-1)?.date}</span>
          </div>
          <div className="mt-3 flex gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded bg-emerald-500" /> Member earnings
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded bg-slate-400" /> Paid out
            </span>
          </div>
        </Card>
        <Card className="space-y-4">
          <CardHeader title="Postback health (24h)" />
          <Stat label="Received" value={data.postbacks.last24h} />
          <Stat label="Failed" value={data.postbacks.failed24h} />
          <Stat label="Success rate" value={pct(data.postbacks.successRate24h, 1)} />
          <Link to="/admin/postbacks" className="text-sm font-semibold text-brand-700 dark:text-brand-400">
            Postback logs →
          </Link>
        </Card>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="grid grid-cols-2 gap-5">
          <Stat
            label="Members"
            value={data.users.total.toLocaleString()}
            sub={`+${data.users.new24h} in 24h`}
          />
          <Stat label="Active (24h)" value={data.users.active24h.toLocaleString()} />
          <Stat label="Restricted" value={data.users.restricted} />
          <Stat label="Signups (14d)" value={data.series.reduce((s, d) => s + d.signups, 0)} />
        </Card>
        <Card className="grid grid-cols-2 gap-5">
          <Stat
            label="Owed to members"
            value={formatUsd(data.money.liabilitiesMicros)}
            sub="Balances + in-flight payouts"
          />
          <Stat label="Network revenue (24h)" value={formatUsd(data.money.networkRevenue24hMicros)} />
          <Stat label="Member earnings (24h)" value={formatUsd(data.money.userEarnings24hMicros)} />
          <Stat label="Platform revenue (30d)" value={formatUsd(data.money.platformRevenue30dMicros)} />
        </Card>
      </div>
    </div>
  );
}

interface Analytics {
  days: number;
  networkRevenueMicros: number;
  memberShareMicros: number;
  bonusesMicros: number;
  goodwillMicros: number;
  reversalLossMicros: number;
  contributionMicros: number;
  payoutRatio: number | null;
  activeEarners: number;
  signups: number;
  arpuMicros: number;
  fraudFlags: number;
  avgTimeToFirstPayoutSeconds: number;
  cohorts: { cohort: string; size: number; d1: number; d7: number; d30: number }[];
}

export function AdminAnalytics() {
  const [days, setDays] = useState(30);
  const { data } = useQuery({
    queryKey: ['admin', 'analytics', days],
    queryFn: () => get<Analytics>(`/admin/analytics?days=${days}`),
  });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        subtitle="Unit economics and retention — the numbers that decide whether this business works."
        actions={
          <Select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
            {[7, 30, 90].map((d) => (
              <option key={d} value={d}>
                Last {d} days
              </option>
            ))}
          </Select>
        }
      />
      {!data ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          <Card>
            <CardHeader
              title="Where every dollar went"
              subtitle="Network revenue → member share → bonuses/goodwill/reversals → contribution"
            />
            <div className="grid grid-cols-2 gap-5 lg:grid-cols-6">
              <Stat label="Network revenue" value={formatUsd(data.networkRevenueMicros)} />
              <Stat label="Member share" value={formatUsd(data.memberShareMicros)} />
              <Stat label="Bonuses" value={formatUsd(data.bonusesMicros)} />
              <Stat label="Goodwill" value={formatUsd(data.goodwillMicros)} />
              <Stat label="Reversals absorbed" value={formatUsd(data.reversalLossMicros)} />
              <Stat label="Contribution" value={formatUsd(data.contributionMicros)} />
            </div>
          </Card>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <Stat
                label="Payout ratio"
                value={pct(data.payoutRatio, 1)}
                sub="All value returned to members ÷ revenue"
              />
            </Card>
            <Card>
              <Stat label="Active earners" value={data.activeEarners} sub={`${data.signups} signups`} />
            </Card>
            <Card>
              <Stat label="Platform ARPU" value={formatUsd(data.arpuMicros)} sub="Per active earner" />
            </Card>
            <Card>
              <Stat
                label="Time to first payout"
                value={duration(data.avgTimeToFirstPayoutSeconds)}
                sub="Average, new members"
              />
            </Card>
          </div>
          <Card>
            <CardHeader
              title="Retention cohorts"
              subtitle="Share of each weekly signup cohort that earned again on day 1, ~7 and ~30"
            />
            <Table>
              <thead>
                <tr>
                  <Th>Cohort (week of)</Th>
                  <Th>Members</Th>
                  <Th>D1</Th>
                  <Th>D7</Th>
                  <Th>D30</Th>
                </tr>
              </thead>
              <tbody>
                {data.cohorts.map((c) => (
                  <tr key={c.cohort}>
                    <Td>{c.cohort}</Td>
                    <Td>{c.size}</Td>
                    {[c.d1, c.d7, c.d30].map((v, i) => (
                      <Td key={i}>
                        <span
                          className="tabular rounded-md px-2 py-0.5"
                          style={{ background: `rgba(16,185,129,${c.size ? (v / c.size) * 0.8 : 0})` }}
                        >
                          {c.size ? pct(v / c.size) : '—'}
                        </span>
                      </Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}

interface AdminUserRow {
  id: string;
  email: string;
  displayName: string | null;
  country: string;
  role: string;
  status: string;
  tier: string;
  fraudScore: number;
  kycStatus: string;
  emailVerified: boolean;
  balanceMicros: number;
  isDemo: boolean;
  createdAt: string;
  lastSeenAt: string | null;
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  active: 'success',
  restricted: 'warning',
  banned: 'danger',
  deleted: 'neutral',
};

export function AdminUsers() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', q, status],
    queryFn: () => get<AdminUserRow[]>(`/admin/users?q=${encodeURIComponent(q)}&status=${status}`),
  });
  return (
    <div>
      <PageHeader title="Members" subtitle="Search by email, display name or referral code." />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="flex-1">
          <Input
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            prefix={<Search className="size-4" />}
          />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {['active', 'restricted', 'banned'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
      </div>
      {isLoading ? (
        <Skeleton className="h-96" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Member</Th>
              <Th>Status</Th>
              <Th>Tier</Th>
              <Th>Risk</Th>
              <Th>Balance</Th>
              <Th>Joined</Th>
            </tr>
          </thead>
          <tbody>
            {data?.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <Td>
                  <Link
                    to={`/admin/users/${u.id}`}
                    className="font-medium text-slate-900 hover:underline dark:text-white"
                  >
                    {u.email}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {u.displayName ?? '—'} · {u.country}{' '}
                    {u.role !== 'user' && <Badge tone="violet">{u.role}</Badge>}{' '}
                    {u.isDemo && <Badge>demo</Badge>}
                  </p>
                </Td>
                <Td>
                  <Badge tone={STATUS_TONE[u.status]}>{u.status}</Badge>
                </Td>
                <Td className="capitalize">{u.tier}</Td>
                <Td>
                  <RiskBadge score={u.fraudScore} />
                </Td>
                <Td className="tabular">{formatUsd(u.balanceMicros)}</Td>
                <Td className="text-xs text-slate-500">{timeAgo(u.createdAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

export function RiskBadge({ score }: { score: number }) {
  return <Badge tone={score > 60 ? 'danger' : score > 30 ? 'warning' : 'success'}>{score}</Badge>;
}

interface UserDetail {
  user: AdminUserRow & {
    fullName: string | null;
    banReasonCode: string | null;
    banMessage: string | null;
    balanceFrozen: boolean;
    phoneVerified: boolean;
    phoneLast4: string | null;
    totpEnabled: boolean;
    referralCode: string;
    signupIp: string | null;
    timezone: string;
  };
  balanceMicros: number;
  lifetimeEarnedMicros: number;
  transactions: TransactionDTO[];
  payouts: PayoutDTO[];
  flags: {
    id: string;
    type: string;
    label: string;
    severity: number;
    status: string;
    occurrences: number;
    createdAt: string;
  }[];
  devices: { id: string; label: string; lastIp: string | null; firstSeenAt: string; lastSeenAt: string }[];
  linkedAccounts: { id: string; email: string; status: string }[];
  notes: { id: string; note: string; author: string | null; createdAt: string }[];
  logins: { success: boolean; ip: string | null; reason: string | null; at: string }[];
  claims: { id: string; status: string; amountMicros: number; createdAt: string }[];
}

export function AdminUserDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'user', id],
    queryFn: () => get<UserDetail>(`/admin/users/${id}`),
  });
  const [modal, setModal] = useState<'ban' | 'adjust' | null>(null);
  const [ban, setBan] = useState({ reasonCode: 'multi_account', message: '' });
  const [adjust, setAdjust] = useState({ amount: '', direction: 'credit', reason: '' });
  const [note, setNote] = useState('');
  const refresh = (d: UserDetail) => qc.setQueryData(['admin', 'user', id], d);
  const doBan = useMutation({
    mutationFn: () => post<UserDetail>(`/admin/users/${id}/ban`, ban),
    onSuccess: (d) => {
      refresh(d);
      setModal(null);
      toast.success('Member restricted');
    },
    onError: (e) => toast.error('Failed', errorMessage(e)),
  });
  const doUnban = useMutation({
    mutationFn: () => post<UserDetail>(`/admin/users/${id}/unban`),
    onSuccess: (d) => {
      refresh(d);
      toast.success('Restriction lifted');
    },
  });
  const doAdjust = useMutation({
    mutationFn: () => {
      const micros = parseDollarInput(adjust.amount) ?? 0;
      return post<UserDetail>(`/admin/users/${id}/adjust`, {
        amountMicros: adjust.direction === 'credit' ? micros : -micros,
        reason: adjust.reason,
      });
    },
    onSuccess: (d) => {
      refresh(d);
      setModal(null);
      toast.success('Balance adjusted');
    },
    onError: (e) => toast.error('Failed', errorMessage(e)),
  });
  const doNote = useMutation({
    mutationFn: () => post<UserDetail>(`/admin/users/${id}/notes`, { note }),
    onSuccess: (d) => {
      refresh(d);
      setNote('');
    },
  });
  const doRole = useMutation({
    mutationFn: (role: string) => post<UserDetail>(`/admin/users/${id}/role`, { role }),
    onSuccess: (d) => {
      refresh(d);
      toast.success('Role updated');
    },
    onError: (e) => toast.error('Failed', errorMessage(e)),
  });
  const doLogout = useMutation({
    mutationFn: () => post(`/admin/users/${id}/logout-all`),
    onSuccess: () => toast.success('Signed out everywhere'),
  });

  if (isLoading || !data) return <Skeleton className="h-[600px]" />;
  const u = data.user;
  return (
    <div className="space-y-5">
      <PageHeader
        title={u.email}
        subtitle={`${u.displayName ?? 'No display name'} · ${u.country} · joined ${dateTime(u.createdAt)}`}
        back={{ to: '/admin/users', label: 'Members' }}
        actions={
          <>
            {u.status === 'banned' || u.status === 'restricted' ? (
              <Button variant="outline" onClick={() => doUnban.mutate()} loading={doUnban.isPending}>
                <Undo2 className="size-4" /> Lift restriction
              </Button>
            ) : (
              <Button variant="danger" onClick={() => setModal('ban')}>
                <Ban className="size-4" /> Restrict
              </Button>
            )}
            <Button variant="outline" onClick={() => setModal('adjust')}>
              <Wallet className="size-4" /> Adjust balance
            </Button>
            <Button variant="ghost" onClick={() => doLogout.mutate()}>
              <LogOut className="size-4" /> Sign out everywhere
            </Button>
          </>
        }
      />
      {(u.status === 'banned' || u.status === 'restricted') && (
        <Callout
          tone="danger"
          title={
            u.banReasonCode
              ? BAN_REASONS[u.banReasonCode as keyof typeof BAN_REASONS]?.title
              : 'Automatic security pause'
          }
        >
          {u.banMessage ??
            'Paused automatically because the fraud score crossed the block line. Review the flags below.'}
        </Callout>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <Stat
            label="Balance"
            value={formatUsd(data.balanceMicros)}
            sub={u.balanceFrozen ? 'Frozen' : undefined}
          />
        </Card>
        <Card>
          <Stat label="Lifetime earned" value={formatUsd(data.lifetimeEarnedMicros)} />
        </Card>
        <Card>
          <Stat label="Risk score" value={<RiskBadge score={u.fraudScore} />} />
        </Card>
        <Card>
          <Stat label="Tier" value={<span className="capitalize">{u.tier}</span>} />
        </Card>
        <Card>
          <Stat
            label="Verification"
            value={
              <span className="text-sm">
                {u.emailVerified ? '✉️✓' : '✉️✗'} {u.phoneVerified ? `📞✓ ••${u.phoneLast4}` : '📞✗'}{' '}
                {u.kycStatus === 'verified' ? '🪪✓' : `🪪 ${u.kycStatus}`}
              </span>
            }
          />
        </Card>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Fraud flags" subtitle="Every point of the score is explained here." />
          {data.flags.length === 0 ? (
            <p className="text-sm text-slate-500">No flags.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.flags.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800"
                >
                  <span>
                    {f.label}{' '}
                    {f.occurrences > 1 && <span className="text-xs text-slate-400">×{f.occurrences}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge
                      tone={f.status === 'open' ? 'warning' : f.status === 'confirmed' ? 'danger' : 'neutral'}
                    >
                      {f.status}
                    </Badge>
                    <span className="tabular text-xs">+{f.severity}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link
            to="/admin/fraud"
            className="mt-3 inline-block text-sm font-semibold text-brand-700 dark:text-brand-400"
          >
            Resolve in fraud queue →
          </Link>
        </Card>
        <Card>
          <CardHeader title="Devices & linked accounts" />
          <ul className="space-y-1.5 text-sm">
            {data.devices.map((d) => (
              <li key={d.id} className="flex justify-between gap-3">
                <span>{d.label}</span>
                <span className="text-xs text-slate-500">
                  {d.lastIp} · {timeAgo(d.lastSeenAt)}
                </span>
              </li>
            ))}
          </ul>
          {data.linkedAccounts.length > 0 && (
            <div className="mt-4 rounded-xl bg-rose-50 p-3 text-sm dark:bg-rose-950/30">
              <p className="font-semibold text-rose-800 dark:text-rose-300">
                Shares a device with {data.linkedAccounts.length} other account(s)
              </p>
              {data.linkedAccounts.map((l) => (
                <Link
                  key={l.id}
                  to={`/admin/users/${l.id}`}
                  className="block text-rose-700 underline dark:text-rose-400"
                >
                  {l.email} ({l.status})
                </Link>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-slate-500">
            Signup IP {u.signupIp ?? '—'} · referral code {u.referralCode} ·{' '}
            {u.totpEnabled ? '2FA on' : '2FA off'}
          </p>
        </Card>
      </div>
      <Card>
        <CardHeader title="Cash-outs" />
        {data.payouts.length === 0 ? (
          <p className="text-sm text-slate-500">None.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {data.payouts.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  {p.methodIcon} {p.methodName} · {p.destinationMasked}
                </span>
                <span className="flex items-center gap-3">
                  <PayoutStatusBadge status={p.status} />
                  <span className="tabular w-16 text-right">{formatUsd(p.amountMicros)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recent ledger activity" />
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {data.transactions.map((t) => (
              <li key={t.id} className="flex justify-between gap-3 py-2">
                <span className="truncate">{t.description}</span>
                <span className={cn('tabular', t.amountMicros > 0 ? 'text-emerald-600' : '')}>
                  {formatUsd(t.amountMicros, { signed: true })}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Internal notes" icon={<StickyNote className="size-5 text-amber-500" />} />
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Visible to staff only"
          />
          <Button
            size="sm"
            className="mt-2"
            onClick={() => doNote.mutate()}
            disabled={!note.trim()}
            loading={doNote.isPending}
          >
            Add note
          </Button>
          <ul className="mt-4 space-y-2 text-sm">
            {data.notes.map((n) => (
              <li key={n.id} className="rounded-lg bg-amber-50 p-2.5 dark:bg-amber-950/20">
                <p>{n.note}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {n.author} · {timeAgo(n.createdAt)}
                </p>
              </li>
            ))}
          </ul>
          {me?.role === 'admin' && me.id !== u.id && (
            <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
              <Select label="Staff role" value={u.role} onChange={(e) => doRole.mutate(e.target.value)}>
                {ROLES.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </Select>
            </div>
          )}
        </Card>
      </div>
      <Modal
        open={modal === 'ban'}
        onClose={() => setModal(null)}
        title="Restrict member"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => doBan.mutate()} loading={doBan.isPending}>
              Restrict account
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Callout tone="warning">
            The member sees the reason category <em>and</em> your message, and can appeal. Be specific —
            “terms violation” is not allowed.
          </Callout>
          <Select
            label="Reason"
            value={ban.reasonCode}
            onChange={(e) => setBan({ ...ban, reasonCode: e.target.value })}
          >
            {BAN_REASON_CODES.map((c) => (
              <option key={c} value={c}>
                {BAN_REASONS[c].title}
              </option>
            ))}
          </Select>
          <p className="text-sm text-slate-500">
            {BAN_REASONS[ban.reasonCode as keyof typeof BAN_REASONS].explanation}
          </p>
          <Textarea
            label="Specific explanation shown to the member"
            value={ban.message}
            onChange={(e) => setBan({ ...ban, message: e.target.value })}
            rows={3}
            placeholder="e.g. Three accounts cashed out to the same bank account ending 6789."
          />
        </div>
      </Modal>
      <Modal
        open={modal === 'adjust'}
        onClose={() => setModal(null)}
        title="Adjust balance"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button onClick={() => doAdjust.mutate()} loading={doAdjust.isPending}>
              Post adjustment
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="Direction"
            value={adjust.direction}
            onChange={(e) => setAdjust({ ...adjust, direction: e.target.value })}
          >
            <option value="credit">Credit (add money)</option>
            <option value="debit">Debit (remove money)</option>
          </Select>
          <Input
            label="Amount"
            prefix="$"
            value={adjust.amount}
            onChange={(e) => setAdjust({ ...adjust, amount: e.target.value })}
          />
          <Input
            label="Reason (shown to the member and audited)"
            value={adjust.reason}
            onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })}
          />
          <p className="text-xs text-slate-500">
            Requires finance or admin role. Posted as a balanced double-entry transaction.
          </p>
        </div>
      </Modal>
    </div>
  );
}

/* ── settings ──────────────────────────────────────────────────────────────── */

type FieldDef = {
  key: keyof Settings;
  label: string;
  kind: 'usd' | 'bps' | 'int' | 'bool' | 'policy';
  help?: string;
};

const GROUPS: { title: string; fields: FieldDef[] }[] = [
  {
    title: 'Economics',
    fields: [
      {
        key: 'revenueShareBps',
        label: 'Member revenue share',
        kind: 'bps',
        help: 'Published promise. Changing it notifies members (30-day notice in the terms).',
      },
      { key: 'firstTaskBonusMicros', label: 'First-task bonus', kind: 'usd' },
      { key: 'streakBaseMicros', label: 'Streak day-1 reward', kind: 'usd' },
      { key: 'streakStepMicros', label: 'Streak daily step', kind: 'usd' },
      { key: 'streakMaxMicros', label: 'Streak max reward', kind: 'usd' },
      { key: 'planBonusMicros', label: 'Daily plan bonus', kind: 'usd' },
      { key: 'referralBonusMicros', label: 'Referral bonus (each side)', kind: 'usd' },
      { key: 'referralResidualBps', label: 'Referral residual', kind: 'bps' },
    ],
  },
  {
    title: 'Cash-out limits & verification',
    fields: [
      { key: 'payoutMaxPerDay', label: 'Max cash-outs per day', kind: 'int' },
      { key: 'phoneRequiredAboveMicros', label: 'Phone required above', kind: 'usd' },
      { key: 'kycThresholdMicros', label: 'ID required for a single cash-out above', kind: 'usd' },
    ],
  },
  {
    title: 'Risk',
    fields: [
      { key: 'autoApproveMaxFraudScore', label: 'Auto-approve up to score', kind: 'int' },
      { key: 'blockMinFraudScore', label: 'Pause earning from score', kind: 'int' },
      {
        key: 'fraudIpSignals',
        label: 'IP-based signals (VPN/data-centre, sign-up velocity)',
        kind: 'bool',
        help: 'Disable behind shared proxies.',
      },
      { key: 'offerAutoPauseReports', label: 'Auto-pause offer after N severe reports', kind: 'int' },
      { key: 'postbackMaxAgeHours', label: 'Click window (hours)', kind: 'int' },
      { key: 'reversalPolicy', label: 'Advertiser reversals', kind: 'policy' },
    ],
  },
  {
    title: 'Missing credit',
    fields: [
      { key: 'claimMinWaitMinutes', label: 'Wait before a claim (minutes)', kind: 'int' },
      { key: 'claimSlaHours', label: 'Human review SLA (hours)', kind: 'int' },
      {
        key: 'claimAutoGoodwillPerMonth',
        label: 'Instant goodwill claims per member / 30 days',
        kind: 'int',
      },
      { key: 'claimSlaAutoApproveMaxMicros', label: 'Auto-approve overdue claims up to', kind: 'usd' },
    ],
  },
  {
    title: 'Videos & platform',
    fields: [
      { key: 'adDailyCap', label: 'Rewarded videos per day', kind: 'int' },
      { key: 'adComboWindowMinutes', label: 'Combo window (minutes)', kind: 'int' },
      {
        key: 'maintenanceMode',
        label: 'Maintenance mode (pauses earning & cash-outs, keeps balances visible)',
        kind: 'bool',
      },
      { key: 'sandboxPostbackDelayMs', label: 'Sandbox postback delay (ms)', kind: 'int' },
    ],
  },
];

export function AdminSettings() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => get<AdminSettingsDTO>('/admin/settings'),
  });
  const [draft, setDraft] = useState<Partial<Settings>>({});
  const current = useMemo(() => (data ? { ...data.settings, ...draft } : null), [data, draft]);
  const save = useMutation({
    mutationFn: () => patch<AdminSettingsDTO>('/admin/settings', draft),
    onSuccess: (r) => {
      qc.setQueryData(['admin', 'settings'], r);
      setDraft({});
      toast.success('Settings saved', 'Changes are live and recorded in the audit log.');
    },
    onError: (e) => toast.error('Couldn’t save', errorMessage(e)),
  });
  if (!current || !data) return <Skeleton className="h-[600px]" />;
  const set = (k: keyof Settings, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));
  const field = (f: FieldDef): ReactNode => {
    const v = current[f.key];
    if (f.kind === 'bool')
      return (
        <Switch
          key={f.key}
          checked={Boolean(v)}
          onChange={(x) => set(f.key, x)}
          label={f.label}
          description={f.help}
        />
      );
    if (f.kind === 'policy')
      return (
        <Select
          key={f.key}
          label={f.label}
          value={String(v)}
          onChange={(e) => set(f.key, e.target.value)}
          hint="Absorb = CashAds eats legitimate reversals (recommended)."
        >
          <option value="absorb">Absorb (member keeps the money)</option>
          <option value="clawback">Claw back from member</option>
        </Select>
      );
    if (f.kind === 'usd')
      return (
        <Input
          key={f.key}
          label={f.label}
          prefix="$"
          type="number"
          step="0.001"
          value={(Number(v) / 1_000_000).toString()}
          onChange={(e) => set(f.key, Math.round(Number(e.target.value) * 1_000_000))}
          hint={f.help}
        />
      );
    if (f.kind === 'bps')
      return (
        <Input
          key={f.key}
          label={f.label}
          suffix="%"
          type="number"
          step="0.5"
          value={(Number(v) / 100).toString()}
          onChange={(e) => set(f.key, Math.round(Number(e.target.value) * 100))}
          hint={f.help}
        />
      );
    return (
      <Input
        key={f.key}
        label={f.label}
        type="number"
        value={String(v)}
        onChange={(e) => set(f.key, Number(e.target.value))}
        hint={f.help}
      />
    );
  };
  const dirty = Object.keys(draft).length > 0;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Platform settings"
        subtitle="Validated, versioned in the audit log, live immediately."
        actions={
          <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
            Save {dirty ? `(${Object.keys(draft).length})` : ''}
          </Button>
        }
      />
      {GROUPS.map((g) => (
        <Card key={g.title}>
          <CardHeader title={g.title} />
          <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">{g.fields.map(field)}</div>
        </Card>
      ))}
      <Card>
        <CardHeader
          title="Display FX rates"
          subtitle="Local currency per 1 USD — display only; the ledger is always USD."
        />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Object.entries(current.fxRates).map(([code, rate]) => (
            <Input
              key={code}
              label={code}
              type="number"
              step="0.01"
              value={String(rate)}
              onChange={(e) => set('fxRates', { ...current.fxRates, [code]: Number(e.target.value) })}
            />
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader
          title="Sandbox: simulate payout-provider outages"
          subtitle="Payouts to a provider marked down retry with backoff, then refund in full."
        />
        <div className="grid gap-x-6 md:grid-cols-2">
          {PAYOUT_METHODS.map((m) => (
            <Switch
              key={m.id}
              checked={Boolean(current.sandboxProviderOutages[m.id])}
              onChange={(x) =>
                set('sandboxProviderOutages', { ...current.sandboxProviderOutages, [m.id]: x })
              }
              label={`${m.icon} ${m.name} down`}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

interface AuditRow {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  actor: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
}

export function AdminAudit() {
  const [action, setAction] = useState('');
  const { data } = useQuery({
    queryKey: ['admin', 'audit', action],
    queryFn: () => get<AuditRow[]>(`/admin/audit?action=${encodeURIComponent(action)}`),
  });
  return (
    <div>
      <PageHeader
        title="Audit log"
        subtitle="Append-only record of every staff action that touches members or money."
      />
      <div className="mb-4 max-w-sm">
        <Input
          placeholder="Filter by action prefix (e.g. payout., user.ban)"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        />
      </div>
      {!data?.length ? (
        <EmptyState icon="📜" title="No entries" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Actor</Th>
              <Th>Action</Th>
              <Th>Target</Th>
              <Th>Change</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((a) => (
              <tr key={a.id}>
                <Td className="whitespace-nowrap text-xs">{dateTime(a.createdAt)}</Td>
                <Td className="text-xs">{a.actor ?? 'system'}</Td>
                <Td>
                  <Badge tone="violet">{a.action}</Badge>
                </Td>
                <Td className="text-xs">
                  {a.targetType} {a.targetId?.slice(0, 8)}
                </Td>
                <Td className="max-w-xs">
                  <code className="line-clamp-2 break-all text-[11px] text-slate-500">
                    {JSON.stringify(a.after ?? a.before ?? {})}
                  </code>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
