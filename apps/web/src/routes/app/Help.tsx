import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  ChevronUp,
  Lightbulb,
  MessageCircle,
  Receipt,
  Rocket,
  Search,
  Send,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import {
  FAQ,
  type FeatureRequestDTO,
  type TaxSummaryDTO,
  TICKET_CATEGORIES,
  type TicketDTO,
  formatUsd,
} from '@cashads/shared';
import { FaqList } from '../public/pages';
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  Input,
  PageHeader,
  Segmented,
  Select,
  Skeleton,
  Stat,
  Textarea,
} from '../../components/ui';
import { errorMessage, get, post } from '../../lib/api';
import { useConfig, useMe } from '../../lib/queries';
import { cn, dateTime, downloadUrl, timeAgo } from '../../lib/utils';
import { toast } from '../../store/ui';

const TICKET_TONE = {
  open: 'info',
  pending_user: 'warning',
  resolved: 'success',
  closed: 'neutral',
} as const;

export function Support() {
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const { data: tickets } = useQuery({
    queryKey: ['tickets'],
    queryFn: () => get<TicketDTO[]>('/support/tickets'),
  });
  const [q, setQ] = useState('');
  const [form, setForm] = useState({
    subject: params.get('subject') ?? '',
    category: params.get('category') ?? 'other',
    message: '',
  });
  const [open, setOpen] = useState(Boolean(params.get('subject')));
  const matches = useMemo(() => {
    const needle = (q || form.subject).trim().toLowerCase();
    if (needle.length < 3) return [];
    return FAQ.filter((f) => `${f.q} ${f.a}`.toLowerCase().includes(needle)).slice(0, 4);
  }, [q, form.subject]);
  const create = useMutation({
    mutationFn: () => post<TicketDTO>('/support/tickets', form),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ['tickets'] });
      setForm({ subject: '', category: 'other', message: '' });
      setOpen(false);
      toast.success('Ticket opened', `A person will reply by ${dateTime(t.slaDueAt)}.`);
    },
  });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Support"
        subtitle="Real people, 24-hour reply promise (4 hours for Gold)."
        actions={
          <Button onClick={() => setOpen((v) => !v)}>
            <MessageCircle className="size-4" /> New ticket
          </Button>
        }
      />
      <Input
        placeholder="Search help articles…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        prefix={<Search className="size-4" />}
      />
      {matches.length > 0 && <FaqList items={matches} />}
      {open && (
        <Card className="animate-slide-up space-y-4">
          <CardHeader
            title="Tell us what’s up"
            subtitle="Include task names, amounts and times — it speeds things up."
          />
          {create.isError && <Callout tone="danger">{errorMessage(create.error)}</Callout>}
          <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
            <Input
              label="Subject"
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
            />
            <Select
              label="Topic"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              {TICKET_CATEGORIES.filter((c) => c !== 'appeal').map((c) => (
                <option key={c} value={c}>
                  {c.replace('_', ' ')}
                </option>
              ))}
            </Select>
          </div>
          {form.category === 'missing_credit' && (
            <Callout tone="info">
              Faster: file a Missing Credit claim from{' '}
              <Link to="/app/activity" className="font-semibold underline">
                Activity
              </Link>{' '}
              — it checks the network automatically.
            </Callout>
          )}
          <Textarea
            label="Message"
            rows={5}
            value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
          />
          <Button loading={create.isPending} onClick={() => create.mutate()}>
            Send to support
          </Button>
        </Card>
      )}
      <Card>
        <CardHeader title="Your tickets" />
        {!tickets ? (
          <Skeleton className="h-24" />
        ) : tickets.length === 0 ? (
          <EmptyState icon="💬" title="No tickets" body="Most answers are in the help articles above." />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {tickets.map((t) => (
              <li key={t.id}>
                <Link
                  to={`/app/support/${t.id}`}
                  className="flex items-center justify-between gap-3 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{t.subject}</p>
                    <p className="text-xs text-slate-500">
                      {t.category.replace('_', ' ')} · updated {timeAgo(t.updatedAt)}
                    </p>
                  </div>
                  <Badge tone={TICKET_TONE[t.status]}>{t.status.replace('_', ' ')}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function TicketPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const { data: t, isLoading } = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => get<TicketDTO>(`/support/tickets/${id}`),
    refetchInterval: 15_000,
  });
  const [message, setMessage] = useState('');
  const reply = useMutation({
    mutationFn: () => post<TicketDTO>(`/support/tickets/${id}/messages`, { message }),
    onSuccess: (r) => {
      qc.setQueryData(['ticket', id], r);
      setMessage('');
    },
  });
  if (isLoading || !t) return <Skeleton className="h-96" />;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={t.subject}
        subtitle={`Reply due by ${dateTime(t.slaDueAt)}`}
        back={{ to: '/app/support', label: 'Support' }}
        actions={<Badge tone={TICKET_TONE[t.status]}>{t.status.replace('_', ' ')}</Badge>}
      />
      <div className="space-y-3">
        {t.messages?.map((m) => (
          <div key={m.id} className={cn('flex', m.authorType === 'user' ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-4 py-3 text-sm',
                m.authorType === 'user'
                  ? 'bg-brand-600 text-white'
                  : m.authorType === 'staff'
                    ? 'border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
              )}
            >
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide opacity-70">
                {m.authorType === 'user' ? 'You' : m.authorType === 'staff' ? 'CashAds support' : 'Automatic'}
              </p>
              <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
              <p className="mt-1 text-[11px] opacity-60">{dateTime(m.createdAt)}</p>
            </div>
          </div>
        ))}
      </div>
      {t.status !== 'closed' && (
        <Card className="mt-5">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Write a reply…"
            rows={3}
          />
          <Button
            className="mt-3"
            loading={reply.isPending}
            disabled={!message.trim()}
            onClick={() => reply.mutate()}
          >
            <Send className="size-4" /> Send
          </Button>
        </Card>
      )}
    </div>
  );
}

const STATUS_STYLE: Record<
  FeatureRequestDTO['status'],
  { label: string; tone: 'neutral' | 'info' | 'warning' | 'success' | 'danger' }
> = {
  open: { label: 'Open', tone: 'neutral' },
  planned: { label: 'Planned', tone: 'info' },
  in_progress: { label: 'In progress', tone: 'warning' },
  shipped: { label: 'Shipped', tone: 'success' },
  declined: { label: 'Declined', tone: 'danger' },
};

export function Community() {
  const qc = useQueryClient();
  const { data: config } = useConfig();
  const [sort, setSort] = useState<'top' | 'new'>('top');
  const { data: ideas } = useQuery({
    queryKey: ['ideas', sort],
    queryFn: () => get<FeatureRequestDTO[]>(`/community/requests?sort=${sort}`),
  });
  const [form, setForm] = useState({ title: '', body: '' });
  const vote = useMutation({
    mutationFn: (id: string) => post<{ voted: boolean; votes: number }>(`/community/requests/${id}/vote`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ideas'] }),
  });
  const create = useMutation({
    mutationFn: () => post<FeatureRequestDTO[]>('/community/requests', form),
    onSuccess: () => {
      setForm({ title: '', body: '' });
      qc.invalidateQueries({ queryKey: ['ideas'] });
      toast.success('Idea posted', 'Members can vote on it now.');
    },
    onError: (e) => toast.error('Couldn’t post', errorMessage(e)),
  });
  const shipped = ideas?.filter((i) => i.status === 'shipped') ?? [];
  return (
    <div className="space-y-5">
      <PageHeader
        title="Community ideas"
        subtitle="You tell us what to build. The most-voted ideas ship — and we tell you when they do."
      />
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-3">
          <Segmented
            value={sort}
            onChange={setSort}
            options={[
              { value: 'top', label: 'Top' },
              { value: 'new', label: 'New' },
            ]}
          />
          {ideas?.map((i) => (
            <Card key={i.id} className="flex gap-4 p-4">
              <button
                onClick={() => vote.mutate(i.id)}
                className={cn(
                  'flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded-xl border text-sm font-bold transition',
                  i.votedByMe
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
                    : 'border-slate-200 hover:border-slate-400 dark:border-slate-700',
                )}
                aria-label={i.votedByMe ? 'Remove vote' : 'Vote'}
              >
                <ChevronUp className="size-4" />
                {i.votes}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{i.title}</p>
                  <Badge tone={STATUS_STYLE[i.status].tone}>{STATUS_STYLE[i.status].label}</Badge>
                </div>
                {i.body && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{i.body}</p>}
                <p className="mt-1 text-xs text-slate-400">
                  by {i.authorLabel} · {timeAgo(i.createdAt)}
                </p>
              </div>
            </Card>
          ))}
        </div>
        <div className="space-y-5">
          <Card className="space-y-3">
            <CardHeader title="Suggest something" icon={<Lightbulb className="size-5 text-amber-500" />} />
            <Input
              label="Idea"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Cash out to my Opay wallet"
            />
            <Textarea
              label="Why it matters (optional)"
              rows={3}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
            <Button
              loading={create.isPending}
              disabled={form.title.trim().length < 5}
              onClick={() => create.mutate()}
            >
              Post idea
            </Button>
          </Card>
          <Card>
            <CardHeader title="Recently shipped" icon={<Rocket className="size-5 text-brand-600" />} />
            {shipped.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {shipped.map((s) => (
                  <li key={s.id}>✅ {s.title}</li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Talk to other members" />
            <div className="flex flex-col gap-2 text-sm">
              <a
                href={config?.brand.community.telegram}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-brand-700 hover:underline dark:text-brand-400"
              >
                Telegram group →
              </a>
              <a
                href={config?.brand.community.discord}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-brand-700 hover:underline dark:text-brand-400"
              >
                Discord server →
              </a>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function Tax() {
  const { data: me } = useMe();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const { data, isLoading } = useQuery({
    queryKey: ['tax', year],
    queryFn: () => get<TaxSummaryDTO>(`/tax/summary?year=${year}`),
  });
  const max = Math.max(1, ...(data?.byMonth.map((m) => Math.max(m.earningsMicros, m.payoutsMicros)) ?? [1]));
  return (
    <div className="space-y-5">
      <PageHeader
        title="Tax centre"
        subtitle="Your yearly statement, ready when you need it."
        actions={
          <>
            <Select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
              {[thisYear, thisYear - 1].map((y) => (
                <option key={y}>{y}</option>
              ))}
            </Select>
            <Button
              variant="outline"
              className="h-11"
              onClick={() => downloadUrl(`/tax/summary.csv?year=${year}`)}
            >
              <ArrowDownToLine className="size-4" /> CSV
            </Button>
          </>
        }
      />
      {isLoading || !data ? (
        <Skeleton className="h-80" />
      ) : (
        <>
          <Card className="grid grid-cols-2 gap-6 p-6 lg:grid-cols-4">
            <Stat label="Task earnings" value={formatUsd(data.totals.earningsMicros)} />
            <Stat label="Bonuses" value={formatUsd(data.totals.bonusesMicros)} />
            <Stat label="Cashed out" value={formatUsd(data.totals.payoutsMicros)} />
            <Stat label="Donated" value={formatUsd(data.totals.donationsMicros)} />
          </Card>
          <Card>
            <CardHeader title="By month" icon={<Receipt className="size-5 text-slate-400" />} />
            <div className="flex h-44 items-end gap-2">
              {data.byMonth.map((m) => (
                <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex h-36 w-full items-end justify-center gap-0.5">
                    <div
                      className="w-1/2 rounded-t bg-brand-500"
                      style={{ height: `${(m.earningsMicros / max) * 100}%` }}
                      title={`Earned ${formatUsd(m.earningsMicros)}`}
                    />
                    <div
                      className="w-1/2 rounded-t bg-slate-300 dark:bg-slate-600"
                      style={{ height: `${(m.payoutsMicros / max) * 100}%` }}
                      title={`Cashed out ${formatUsd(m.payoutsMicros)}`}
                    />
                  </div>
                  <span className="text-[10px] text-slate-500">
                    {new Date(2000, m.month - 1).toLocaleString('en', { month: 'short' })}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded bg-brand-500" /> Earned
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded bg-slate-300" /> Cashed out
              </span>
            </div>
          </Card>
          {data.us1099.applicable && (
            <Callout
              tone={data.us1099.likely ? 'warning' : 'info'}
              title={
                data.us1099.likely
                  ? 'You’ve reached the 1099-MISC reporting threshold'
                  : `1099-MISC threshold for ${year}: ${formatUsd(data.us1099.thresholdMicros, { precision: 0 })}`
              }
            >
              {formatUsd(data.us1099.reportableMicros)} counted so far this year.
            </Callout>
          )}
          <Card>
            <CardHeader title="Notes for your country" subtitle={me?.country} />
            <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
              {data.notes.map((n) => (
                <li key={n}>• {n}</li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
