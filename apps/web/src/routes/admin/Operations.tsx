import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react';
import { Fragment, useState } from 'react';
import { Link } from 'react-router';
import {
  BAN_REASONS,
  BAN_REASON_CODES,
  type FeatureRequestDTO,
  type PayoutDTO,
  type TicketDTO,
  formatUsd,
} from '@lucrum/shared';
import { PayoutStatusBadge } from '../../components/earn';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Segmented,
  Select,
  Skeleton,
  Table,
  Td,
  Textarea,
  Th,
} from '../../components/ui';
import { errorMessage, get, patch, post } from '../../lib/api';
import { cn, dateTime, downloadUrl, duration, pct, timeAgo } from '../../lib/utils';
import { toast } from '../../store/ui';
import { RiskBadge } from './Admin';

/* ── payouts ───────────────────────────────────────────────────────────────── */

type AdminPayout = PayoutDTO & {
  userId: string;
  email: string;
  fraudScore: number;
  country: string;
  reviewReasons: string[];
};

export function AdminPayouts() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('review');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState<AdminPayout | null>(null);
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState(true);
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'payouts', status],
    queryFn: () => get<AdminPayout[]>(`/admin/payouts?status=${status}`),
    refetchInterval: 10_000,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'payouts'] });
  const approve = useMutation({
    mutationFn: (id: string) => post(`/admin/payouts/${id}/approve`),
    onSuccess: () => {
      invalidate();
      toast.success('Approved — sending now');
    },
    onError: (e) => toast.error('Failed', errorMessage(e)),
  });
  const batch = useMutation({
    mutationFn: () =>
      post<{ results: { ok: boolean }[] }>('/admin/payouts/batch-approve', { ids: [...selected] }),
    onSuccess: (r) => {
      invalidate();
      setSelected(new Set());
      toast.success(`${r.results.filter((x) => x.ok).length} approved`);
    },
  });
  const retry = useMutation({
    mutationFn: (id: string) => post(`/admin/payouts/${id}/retry`),
    onSuccess: () => {
      invalidate();
      toast.success('Retry queued');
    },
    onError: (e) => toast.error('Failed', errorMessage(e)),
  });
  const reject = useMutation({
    mutationFn: () => post(`/admin/payouts/${rejecting!.id}/reject`, { reason, refund }),
    onSuccess: () => {
      invalidate();
      setRejecting(null);
      setReason('');
      toast.success('Payout declined');
    },
    onError: (e) => toast.error('Failed', errorMessage(e)),
  });
  return (
    <div>
      <PageHeader
        title="Payout queue"
        subtitle="Held payouts show the exact reasons the member also sees."
        actions={
          <>
            {selected.size > 0 && (
              <Button onClick={() => batch.mutate()} loading={batch.isPending}>
                <Check className="size-4" /> Approve {selected.size}
              </Button>
            )}
            <Button variant="outline" onClick={() => downloadUrl(`/admin/payouts.csv?status=${status}`)}>
              <ArrowDownToLine className="size-4" /> CSV
            </Button>
          </>
        }
      />
      <Segmented
        value={status}
        onChange={(s) => {
          setStatus(s);
          setSelected(new Set());
        }}
        options={['review', 'pending', 'processing', 'completed', 'failed', 'reversed'].map((s) => ({
          value: s,
          label: s,
        }))}
        className="mb-4 max-w-full overflow-x-auto"
      />
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : !data?.length ? (
        <EmptyState icon="✅" title={`No ${status} payouts`} />
      ) : (
        <Table>
          <thead>
            <tr>
              {status === 'review' && <Th />}
              <Th>Member</Th>
              <Th>Method</Th>
              <Th>Amount</Th>
              <Th>Status</Th>
              <Th>Requested</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.id}>
                {status === 'review' && (
                  <Td>
                    <input
                      type="checkbox"
                      className="accent-brand-600"
                      checked={selected.has(p.id)}
                      onChange={(e) => {
                        const n = new Set(selected);
                        if (e.target.checked) n.add(p.id);
                        else n.delete(p.id);
                        setSelected(n);
                      }}
                    />
                  </Td>
                )}
                <Td>
                  <Link to={`/admin/users/${p.userId}`} className="font-medium hover:underline">
                    {p.email}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {p.country} · risk <RiskBadge score={p.fraudScore} />
                  </p>
                  {p.reviewReasons.length > 0 && (
                    <ul className="mt-1 list-disc pl-4 text-xs text-amber-700 dark:text-amber-400">
                      {p.reviewReasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  )}
                </Td>
                <Td>
                  {p.methodIcon} {p.methodName}
                  <p className="text-xs text-slate-500">{p.destinationMasked}</p>
                </Td>
                <Td className="tabular">
                  {formatUsd(p.amountMicros)}
                  <p className="text-xs text-slate-500">net {formatUsd(p.netMicros)}</p>
                </Td>
                <Td>
                  <PayoutStatusBadge status={p.status} />
                  {p.attempts > 1 && <p className="mt-1 text-xs text-slate-500">{p.attempts} attempts</p>}
                </Td>
                <Td className="text-xs text-slate-500">
                  {timeAgo(p.requestedAt)}
                  {p.durationSeconds !== null && (
                    <>
                      <br />
                      paid in {duration(p.durationSeconds)}
                    </>
                  )}
                </Td>
                <Td>
                  <div className="flex justify-end gap-1.5">
                    {p.status === 'review' && (
                      <Button size="sm" onClick={() => approve.mutate(p.id)}>
                        Approve
                      </Button>
                    )}
                    {(p.status === 'review' || p.status === 'pending') && (
                      <Button size="sm" variant="outline" onClick={() => setRejecting(p)}>
                        Decline
                      </Button>
                    )}
                    {p.status === 'processing' && (
                      <Button size="sm" variant="outline" onClick={() => retry.mutate(p.id)}>
                        <RefreshCw className="size-3.5" /> Retry now
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Modal
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        title="Decline payout"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={reason.trim().length < 5}
              loading={reject.isPending}
              onClick={() => reject.mutate()}
            >
              Decline
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Textarea
            label="Reason (shown to the member)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
          <Checkbox
            checked={refund}
            onChange={setRefund}
            label="Refund the amount to the member’s balance"
            description="Untick only for confirmed fraud — funds then move to fraud recovery."
          />
        </div>
      </Modal>
    </div>
  );
}

/* ── claims ────────────────────────────────────────────────────────────────── */

interface AdminClaim {
  id: string;
  userId: string;
  email: string;
  tier: string;
  fraudScore: number;
  offerTitle: string;
  networkName: string;
  amountMicros: number;
  note: string;
  status: string;
  autoFiled: boolean;
  hasScreenshot: boolean;
  slaDueAt: string;
  createdAt: string;
  overdue: boolean;
}

export function AdminClaims() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('needs_review');
  const [rejecting, setRejecting] = useState<AdminClaim | null>(null);
  const [reason, setReason] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'claims', status],
    queryFn: () => get<AdminClaim[]>(`/admin/claims?status=${status}`),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'claims'] });
  const approve = useMutation({
    mutationFn: (id: string) => post(`/admin/claims/${id}/approve`, {}),
    onSuccess: () => {
      invalidate();
      toast.success('Approved and paid as goodwill');
    },
  });
  const reject = useMutation({
    mutationFn: () => post(`/admin/claims/${rejecting!.id}/reject`, { reason }),
    onSuccess: () => {
      invalidate();
      setRejecting(null);
      setReason('');
    },
  });
  return (
    <div>
      <PageHeader
        title="Missing-credit claims"
        subtitle="Everything the automation couldn’t confirm. SLA: 24h — overdue small claims auto-approve."
      />
      <Segmented
        value={status}
        onChange={setStatus}
        options={['needs_review', 'checking', 'approved', 'rejected'].map((s) => ({
          value: s,
          label: s.replace('_', ' '),
        }))}
        className="mb-4"
      />
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : !data?.length ? (
        <EmptyState icon="🎉" title="Queue empty" />
      ) : (
        <div className="space-y-3">
          {data.map((c) => (
            <Card key={c.id} className={cn('p-4', c.overdue && 'border-rose-300 dark:border-rose-800')}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {c.offerTitle}{' '}
                    <span className="text-sm font-normal text-slate-500">via {c.networkName}</span>
                  </p>
                  <p className="text-sm text-slate-500">
                    <Link to={`/admin/users/${c.userId}`} className="hover:underline">
                      {c.email}
                    </Link>{' '}
                    · {c.tier} · risk <RiskBadge score={c.fraudScore} />{' '}
                    {c.autoFiled && <Badge tone="info">auto-filed</Badge>}
                  </p>
                  <p className="mt-2 text-sm">“{c.note}”</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Filed {timeAgo(c.createdAt)} · due {dateTime(c.slaDueAt)}{' '}
                    {c.overdue && <Badge tone="danger">overdue</Badge>}
                    {c.hasScreenshot && (
                      <>
                        {' '}
                        ·{' '}
                        <a
                          className="underline"
                          href={`/api/admin/files?kind=claim&id=${c.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          screenshot
                        </a>
                      </>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <p className="tabular text-lg font-bold">{formatUsd(c.amountMicros)}</p>
                  {c.status === 'needs_review' && (
                    <div className="mt-2 flex gap-1.5">
                      <Button size="sm" onClick={() => approve.mutate(c.id)}>
                        Approve
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRejecting(c)}>
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        title="Reject claim"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={reason.trim().length < 5}
              loading={reject.isPending}
              onClick={() => reject.mutate()}
            >
              Reject
            </Button>
          </>
        }
      >
        <Textarea
          label="Reason (shown to the member — be specific and kind)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
        />
      </Modal>
    </div>
  );
}

/* ── fraud ─────────────────────────────────────────────────────────────────── */

interface Flag {
  id: string;
  userId: string;
  email: string;
  type: string;
  label: string;
  severity: number;
  occurrences: number;
  details: Record<string, unknown>;
  status: string;
  fraudScore: number;
  userStatus: string;
  createdAt: string;
}

export function AdminFraud() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'open' | 'cleared' | 'confirmed'>('open');
  const [acting, setActing] = useState<{
    flag: Flag;
    action: 'clear' | 'confirm' | 'require_kyc' | 'ban';
  } | null>(null);
  const [note, setNote] = useState('');
  const [reasonCode, setReasonCode] = useState<string>('multi_account');
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'fraud', status],
    queryFn: () => get<Flag[]>(`/admin/fraud?status=${status}`),
  });
  const resolve = useMutation({
    mutationFn: () =>
      post(`/admin/fraud/${acting!.flag.id}/resolve`, {
        action: acting!.action,
        note,
        ...(acting!.action === 'ban' ? { reasonCode } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'fraud'] });
      setActing(null);
      setNote('');
      toast.success('Resolved');
    },
    onError: (e) => toast.error('Failed', errorMessage(e)),
  });
  return (
    <div>
      <PageHeader
        title="Fraud review"
        subtitle="Explainable signals. Clearing a flag lowers the score and can restore auto-paused accounts."
      />
      <Segmented
        value={status}
        onChange={setStatus}
        options={[
          { value: 'open', label: 'Open' },
          { value: 'confirmed', label: 'Confirmed' },
          { value: 'cleared', label: 'Cleared' },
        ]}
        className="mb-4"
      />
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : !data?.length ? (
        <EmptyState icon="🛡️" title="No flags" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Member</Th>
              <Th>Signal</Th>
              <Th>Severity</Th>
              <Th>Details</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.map((f) => (
              <tr key={f.id}>
                <Td>
                  <Link to={`/admin/users/${f.userId}`} className="font-medium hover:underline">
                    {f.email}
                  </Link>
                  <p className="text-xs text-slate-500">
                    score <RiskBadge score={f.fraudScore} /> · {f.userStatus}
                  </p>
                </Td>
                <Td>
                  {f.label}
                  {f.occurrences > 1 && <span className="text-xs text-slate-400"> ×{f.occurrences}</span>}
                  <p className="text-xs text-slate-500">{timeAgo(f.createdAt)}</p>
                </Td>
                <Td className="tabular">+{f.severity}</Td>
                <Td className="max-w-xs">
                  <code className="line-clamp-3 break-all text-[11px] text-slate-500">
                    {JSON.stringify(f.details)}
                  </code>
                </Td>
                <Td>
                  {f.status === 'open' && (
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setActing({ flag: f, action: 'clear' })}
                      >
                        Clear
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setActing({ flag: f, action: 'require_kyc' })}
                      >
                        Require ID
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setActing({ flag: f, action: 'confirm' })}
                      >
                        Confirm
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => setActing({ flag: f, action: 'ban' })}
                      >
                        Ban
                      </Button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Modal
        open={Boolean(acting)}
        onClose={() => setActing(null)}
        title={acting ? `${acting.action.replace('_', ' ')} · ${acting.flag.label}` : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setActing(null)}>
              Cancel
            </Button>
            <Button
              variant={acting?.action === 'ban' ? 'danger' : 'primary'}
              disabled={note.trim().length < 3}
              loading={resolve.isPending}
              onClick={() => resolve.mutate()}
            >
              Confirm
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {acting?.action === 'ban' && (
            <Select
              label="Reason shown to member"
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
            >
              {BAN_REASON_CODES.map((c) => (
                <option key={c} value={c}>
                  {BAN_REASONS[c].title}
                </option>
              ))}
            </Select>
          )}
          <Textarea
            label={acting?.action === 'ban' ? 'Specific explanation (shown to member)' : 'Internal note'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
          />
        </div>
      </Modal>
    </div>
  );
}

/* ── kyc ───────────────────────────────────────────────────────────────────── */

interface KycRow {
  id: string;
  userId: string;
  email: string;
  idType: string;
  idNumberMasked: string;
  fullName: string;
  dateOfBirth: string;
  hasDocument: boolean;
  hasSelfie: boolean;
  status: string;
  createdAt: string;
}

export function AdminKyc() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'pending' | 'verified' | 'rejected'>('pending');
  const { data } = useQuery({
    queryKey: ['admin', 'kyc', status],
    queryFn: () => get<KycRow[]>(`/admin/kyc?status=${status}`),
  });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'verified' | 'rejected' }) =>
      post(`/admin/kyc/${id}/decide`, {
        decision,
        note:
          decision === 'rejected'
            ? 'The document photo was unclear — please retake it in good light.'
            : undefined,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'kyc'] }),
  });
  return (
    <div>
      <PageHeader title="Identity checks" subtitle="Documents are private; every view is audited." />
      <Segmented
        value={status}
        onChange={setStatus}
        options={[
          { value: 'pending', label: 'Pending' },
          { value: 'verified', label: 'Verified' },
          { value: 'rejected', label: 'Rejected' },
        ]}
        className="mb-4"
      />
      {!data?.length ? (
        <EmptyState icon="🪪" title="Nothing here" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Member</Th>
              <Th>Document</Th>
              <Th>Name / DOB</Th>
              <Th>Files</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.map((k) => (
              <tr key={k.id}>
                <Td>
                  <Link to={`/admin/users/${k.userId}`} className="hover:underline">
                    {k.email}
                  </Link>
                  <p className="text-xs text-slate-500">{timeAgo(k.createdAt)}</p>
                </Td>
                <Td className="uppercase">
                  {k.idType.replace('_', ' ')}{' '}
                  <span className="font-mono normal-case">{k.idNumberMasked}</span>
                </Td>
                <Td>
                  {k.fullName}
                  <p className="text-xs text-slate-500">{k.dateOfBirth}</p>
                </Td>
                <Td className="text-xs">
                  {k.hasDocument ? (
                    <a
                      className="underline"
                      href={`/api/admin/files?kind=kyc_document&id=${k.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Eye className="mr-1 inline size-3.5" />
                      ID
                    </a>
                  ) : (
                    'no document'
                  )}
                  {k.hasSelfie && (
                    <>
                      {' '}
                      ·{' '}
                      <a
                        className="underline"
                        href={`/api/admin/files?kind=kyc_selfie&id=${k.id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        selfie
                      </a>
                    </>
                  )}
                </Td>
                <Td>
                  {k.status === 'pending' && (
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" onClick={() => decide.mutate({ id: k.id, decision: 'verified' })}>
                        Verify
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => decide.mutate({ id: k.id, decision: 'rejected' })}
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

/* ── offers & reports ──────────────────────────────────────────────────────── */

interface AdminOffer {
  id: string;
  title: string;
  advertiser: string;
  networkName: string;
  category: string;
  payoutMicros: number;
  status: string;
  statusReason: string | null;
  statClicks: number;
  statConversions: number;
  statMissingClaims: number;
  statReportsOpen: number;
  statThumbsUp: number;
  statThumbsDown: number;
  countries: string[];
}
interface Report {
  id: string;
  offerId: string;
  offerTitle: string;
  offerStatus: string;
  email: string;
  reason: string;
  details: string | null;
  createdAt: string;
}

export function AdminOffers() {
  const qc = useQueryClient();
  const { data: offers } = useQuery({
    queryKey: ['admin', 'offers'],
    queryFn: () => get<AdminOffer[]>('/admin/offers'),
  });
  const { data: reports } = useQuery({
    queryKey: ['admin', 'reports'],
    queryFn: () => get<Report[]>('/admin/reports'),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      post(`/admin/offers/${id}/status`, {
        status,
        reason: status === 'scam' ? 'Confirmed by member reports and staff review' : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'offers'] });
      qc.invalidateQueries({ queryKey: ['admin', 'reports'] });
      toast.success('Offer updated');
    },
  });
  const resolve = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      post(`/admin/reports/${id}/resolve`, { action }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'reports'] }),
  });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Offers & reports"
        subtitle="Quality control: member reports, credit reliability and conversion rates per offer."
      />
      {reports && reports.length > 0 && (
        <Card>
          <CardHeader title={`Open reports (${reports.length})`} />
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {reports.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-medium">
                    {r.offerTitle} <Badge tone="danger">{r.reason.replace('_', ' ')}</Badge>{' '}
                    <Badge>{r.offerStatus}</Badge>
                  </p>
                  <p className="text-xs text-slate-500">
                    {r.email} · {timeAgo(r.createdAt)}
                    {r.details && <> · “{r.details}”</>}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => setStatus.mutate({ id: r.offerId, status: 'scam' })}
                  >
                    Mark scam
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => resolve.mutate({ id: r.id, action: 'dismissed' })}
                  >
                    Dismiss
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Table>
        <thead>
          <tr>
            <Th>Offer</Th>
            <Th>Payout</Th>
            <Th>Clicks → conv.</Th>
            <Th>Claims</Th>
            <Th>Rating</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {offers?.map((o) => (
            <tr key={o.id}>
              <Td>
                <p className="font-medium">{o.title}</p>
                <p className="text-xs text-slate-500">
                  {o.advertiser} · {o.networkName} · {o.category} ·{' '}
                  {o.countries.length ? o.countries.join(', ') : 'global'}
                </p>
              </Td>
              <Td className="tabular">{formatUsd(o.payoutMicros)}</Td>
              <Td className="tabular">
                {o.statClicks} → {o.statConversions}
                <p className="text-xs text-slate-500">
                  {o.statClicks ? pct(o.statConversions / o.statClicks) : '—'}
                </p>
              </Td>
              <Td className="tabular">
                {o.statMissingClaims}
                {o.statReportsOpen > 0 && (
                  <p className="text-xs text-rose-600">{o.statReportsOpen} reports</p>
                )}
              </Td>
              <Td className="text-xs">
                👍 {o.statThumbsUp} · 👎 {o.statThumbsDown}
              </Td>
              <Td>
                <select
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
                  value={o.status}
                  onChange={(e) => setStatus.mutate({ id: o.id, status: e.target.value })}
                >
                  {['active', 'paused', 'removed', 'scam'].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                {o.statusReason && (
                  <p className="mt-1 max-w-[180px] text-[11px] text-slate-500">{o.statusReason}</p>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

/* ── postbacks ─────────────────────────────────────────────────────────────── */

interface PostbackRow {
  id: string;
  networkId: string;
  method: string;
  url: string;
  query: Record<string, unknown>;
  ip: string | null;
  signatureValid: boolean | null;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  networkTxnId: string | null;
  clickId: string | null;
  processingMs: number | null;
  replayOf: string | null;
  createdAt: string;
}

const PB_TONE: Record<string, 'success' | 'neutral' | 'danger' | 'warning' | 'info'> = {
  processed: 'success',
  duplicate: 'neutral',
  rejected: 'danger',
  error: 'warning',
  received: 'info',
};

export function AdminPostbacks() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ['admin', 'postbacks', status],
    queryFn: () => get<PostbackRow[]>(`/admin/postbacks?status=${status}`),
    refetchInterval: 10_000,
  });
  const replay = useMutation({
    mutationFn: (id: string) =>
      post<{ outcome: string; errorCode?: string }>(`/admin/postbacks/${id}/replay`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['admin', 'postbacks'] });
      toast.info(
        `Replay: ${r.outcome}`,
        r.errorCode ? `Error: ${r.errorCode}` : 'Idempotent — duplicates never double-credit.',
      );
    },
  });
  return (
    <div>
      <PageHeader
        title="Postback logs"
        subtitle="Every server-to-server request, stored before processing — the evidence behind Missing Credit."
      />
      <Segmented
        value={status}
        onChange={setStatus}
        options={[
          { value: '', label: 'All' },
          ...['processed', 'duplicate', 'rejected', 'error'].map((s) => ({ value: s, label: s })),
        ]}
        className="mb-4"
      />
      <Table>
        <thead>
          <tr>
            <Th />
            <Th>When</Th>
            <Th>Network</Th>
            <Th>Status</Th>
            <Th>Txn / click</Th>
            <Th>Sig</Th>
            <Th>ms</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {data?.map((p) => (
            <Fragment key={p.id}>
              <tr
                className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40"
                onClick={() => setOpen(open === p.id ? null : p.id)}
              >
                <Td>
                  {open === p.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                </Td>
                <Td className="whitespace-nowrap text-xs">{dateTime(p.createdAt)}</Td>
                <Td>{p.networkId}</Td>
                <Td>
                  <Badge tone={PB_TONE[p.status]}>{p.status}</Badge>
                  {p.errorCode && <p className="mt-1 text-xs text-rose-600">{p.errorCode}</p>}
                  {p.replayOf && <p className="text-xs text-slate-400">replay</p>}
                </Td>
                <Td className="font-mono text-[11px]">
                  {p.networkTxnId ?? '—'}
                  <br />
                  {p.clickId?.slice(0, 8) ?? ''}
                </Td>
                <Td>
                  {p.signatureValid === null ? (
                    '—'
                  ) : p.signatureValid ? (
                    <Check className="size-4 text-emerald-600" />
                  ) : (
                    <X className="size-4 text-rose-600" />
                  )}
                </Td>
                <Td className="tabular text-xs">{p.processingMs ?? '—'}</Td>
                <Td>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      replay.mutate(p.id);
                    }}
                  >
                    <RotateCcw className="size-3.5" /> Replay
                  </Button>
                </Td>
              </tr>
              {open === p.id && (
                <tr>
                  <td colSpan={8} className="bg-slate-50 px-4 py-3 dark:bg-slate-900/60">
                    {p.errorMessage && (
                      <p className="mb-2 text-sm text-rose-700 dark:text-rose-400">{p.errorMessage}</p>
                    )}
                    <p className="text-xs text-slate-500">
                      {p.method} {p.url.slice(0, 160)} · from {p.ip}
                    </p>
                    <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-emerald-200">
                      {JSON.stringify(p.query, null, 2)}
                    </pre>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

/* ── support & appeals ─────────────────────────────────────────────────────── */

interface AdminTicket {
  id: string;
  subject: string;
  category: string;
  status: string;
  priority: string;
  email: string | null;
  userId: string | null;
  slaDueAt: string;
  overdue: boolean;
  updatedAt: string;
}

export function AdminSupport() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('open');
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [newStatus, setNewStatus] = useState('pending_user');
  const { data } = useQuery({
    queryKey: ['admin', 'tickets', status],
    queryFn: () => get<AdminTicket[]>(`/admin/tickets?status=${status}`),
  });
  const { data: ticket } = useQuery({
    queryKey: ['admin', 'ticket', openId],
    queryFn: () => get<TicketDTO>(`/admin/tickets/${openId}`),
    enabled: Boolean(openId),
  });
  const send = useMutation({
    mutationFn: (appealDecision?: 'uphold' | 'lift') =>
      post<TicketDTO>(`/admin/tickets/${openId}/reply`, {
        message: reply,
        status: newStatus,
        ...(appealDecision ? { appealDecision } : {}),
      }),
    onSuccess: (t) => {
      qc.setQueryData(['admin', 'ticket', openId], t);
      qc.invalidateQueries({ queryKey: ['admin', 'tickets'] });
      setReply('');
      toast.success('Reply sent');
    },
  });
  return (
    <div>
      <PageHeader
        title="Support & appeals"
        subtitle="Ordered by SLA. Appeals must be reviewed by someone other than the original decision-maker."
      />
      <Segmented
        value={status}
        onChange={setStatus}
        options={['open', 'pending_user', 'resolved', 'closed'].map((s) => ({
          value: s,
          label: s.replace('_', ' '),
        }))}
        className="mb-4"
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-2">
          {!data?.length && <EmptyState icon="📭" title="No tickets" />}
          {data?.map((t) => (
            <button
              key={t.id}
              onClick={() => setOpenId(t.id)}
              className={cn(
                'w-full rounded-2xl border bg-white p-4 text-left dark:bg-slate-900',
                openId === t.id ? 'border-brand-500' : 'border-slate-200 dark:border-slate-800',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate font-medium">{t.subject}</p>
                {t.category === 'appeal' ? (
                  <Badge tone="violet">appeal</Badge>
                ) : (
                  <Badge>{t.category.replace('_', ' ')}</Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {t.email} · due {timeAgo(t.slaDueAt)} {t.overdue && <Badge tone="danger">overdue</Badge>}{' '}
                {t.priority === 'high' && <Badge tone="warning">high</Badge>}
              </p>
            </button>
          ))}
        </div>
        {ticket && (
          <Card className="space-y-3">
            <CardHeader title={ticket.subject} subtitle={`${ticket.category} · ${ticket.status}`} />
            <div className="max-h-96 space-y-2 overflow-y-auto">
              {ticket.messages?.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    'rounded-xl p-3 text-sm',
                    m.authorType === 'staff'
                      ? 'ml-6 bg-brand-50 dark:bg-brand-950/30'
                      : m.authorType === 'system'
                        ? 'bg-slate-50 text-slate-500 dark:bg-slate-800/50'
                        : 'mr-6 bg-slate-100 dark:bg-slate-800',
                  )}
                >
                  <p className="text-[11px] font-semibold uppercase text-slate-500">
                    {m.authorType} · {dateTime(m.createdAt)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
                </div>
              ))}
            </div>
            <Textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={3}
              placeholder="Reply to the member…"
            />
            <Select label="Set status" value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
              {['open', 'pending_user', 'resolved', 'closed'].map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ')}
                </option>
              ))}
            </Select>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!reply.trim()}
                loading={send.isPending}
                onClick={() => send.mutate(undefined)}
              >
                Send reply
              </Button>
              {ticket.category === 'appeal' && (
                <>
                  <Button variant="outline" disabled={!reply.trim()} onClick={() => send.mutate('lift')}>
                    Reply & lift restriction
                  </Button>
                  <Button variant="ghost" disabled={!reply.trim()} onClick={() => send.mutate('uphold')}>
                    Reply & uphold
                  </Button>
                </>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

/* ── community ─────────────────────────────────────────────────────────────── */

export function AdminCommunity() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['admin', 'community'],
    queryFn: () => get<FeatureRequestDTO[]>('/admin/community'),
  });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      patch(`/admin/community/${id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'community'] });
      toast.success('Status updated', 'Voters are notified when an idea ships.');
    },
  });
  return (
    <div>
      <PageHeader
        title="Community ideas"
        subtitle="Marking an idea “shipped” notifies everyone who voted for it."
      />
      <Table>
        <thead>
          <tr>
            <Th>Votes</Th>
            <Th>Idea</Th>
            <Th>Author</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {data?.map((i) => (
            <tr key={i.id}>
              <Td className="tabular font-bold">{i.votes}</Td>
              <Td>
                <p className="font-medium">{i.title}</p>
                <p className="text-xs text-slate-500">{i.body}</p>
              </Td>
              <Td className="text-xs">{i.authorLabel}</Td>
              <Td>
                <select
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
                  value={i.status}
                  onChange={(e) => update.mutate({ id: i.id, status: e.target.value })}
                >
                  {['open', 'planned', 'in_progress', 'shipped', 'declined'].map((s) => (
                    <option key={s} value={s}>
                      {s.replace('_', ' ')}
                    </option>
                  ))}
                </select>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
