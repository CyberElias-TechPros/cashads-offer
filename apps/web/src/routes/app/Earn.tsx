import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CircleCheck,
  Clock,
  ExternalLink,
  Flag,
  Gauge,
  GraduationCap,
  CirclePlay,
  Radio,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  ThumbsDown,
  ThumbsUp,
  Wifi,
  Zap,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  OFFER_CATEGORIES,
  OFFER_REPORT_REASONS,
  type OfferCategory,
  type OfferDTO,
  type OfferDetailDTO,
  type OfferSort,
  type OfferStartDTO,
  PAY_SPEEDS,
  formatUsd,
} from '@lucrum/shared';
import { Money } from '../../components/brand';
import {
  ClickStatusBadge,
  OfferCard,
  OfferCardSkeleton,
  OfferIcon,
  QualityBadge,
} from '../../components/earn';
import {
  Badge,
  Button,
  ButtonLink,
  Callout,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Progress,
  Select,
  Skeleton,
  Switch,
  Textarea,
} from '../../components/ui';
import { errorMessage, get, post } from '../../lib/api';
import { useMe } from '../../lib/queries';
import { cn, minutesLabel, pct } from '../../lib/utils';
import { toast } from '../../store/ui';

const SORTS: { value: OfferSort; label: string }[] = [
  { value: 'hourly', label: 'Best $/hour' },
  { value: 'payout', label: 'Highest pay' },
  { value: 'quick', label: 'Shortest' },
  { value: 'quality', label: 'Best quality' },
  { value: 'new', label: 'Newest' },
];

export function EarnPage() {
  const { data: me } = useMe();
  const [category, setCategory] = useState<OfferCategory | 'all'>('all');
  const [sort, setSort] = useState<OfferSort>('hourly');
  const [q, setQ] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [minHourly, setMinHourly] = useState(0);
  const [lite, setLite] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(true);
  const navigate = useNavigate();

  const params = new URLSearchParams({ sort });
  if (category !== 'all') params.set('category', category);
  if (lite) params.set('lite', 'true');
  if (hideCompleted) params.set('hideCompleted', 'true');
  if (minHourly) params.set('minHourlyMicros', String(minHourly));
  const { data: offers, isLoading } = useQuery({
    queryKey: ['offers', params.toString()],
    queryFn: () => get<OfferDTO[]>(`/offers?${params.toString()}`),
  });
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (offers ?? []).filter(
      (o) => !needle || `${o.title} ${o.advertiser} ${o.tags.join(' ')}`.toLowerCase().includes(needle),
    );
  }, [offers, q]);

  const totalAvailable = filtered.filter((o) => !o.completedByMe).reduce((s, o) => s + o.userPayoutMicros, 0);

  return (
    <div>
      <PageHeader
        title="Earn"
        subtitle={
          <>
            {filtered.length} tasks ·{' '}
            <span className="tabular font-medium text-slate-700 dark:text-slate-300">
              {formatUsd(totalAvailable)}
            </span>{' '}
            available · sorted by what your time is worth
          </>
        }
      />
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <Input
            placeholder="Search tasks or brands…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            prefix={<Search className="size-4" />}
          />
        </div>
        <div className="flex gap-2">
          <Select value={sort} onChange={(e) => setSort(e.target.value as OfferSort)} aria-label="Sort">
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          <Button
            variant={showFilters ? 'dark' : 'outline'}
            onClick={() => setShowFilters((v) => !v)}
            className="h-11"
            aria-label="Filters"
          >
            <SlidersHorizontal className="size-4" />
          </Button>
        </div>
      </div>

      {showFilters && (
        <Card className="mt-3 grid gap-x-6 sm:grid-cols-3">
          <Select
            label="Minimum hourly rate"
            value={minHourly}
            onChange={(e) => setMinHourly(Number(e.target.value))}
          >
            <option value={0}>Any</option>
            {[2, 5, 10, 20].map((v) => (
              <option key={v} value={v * 1_000_000}>
                {formatUsd(v * 1_000_000, { precision: 0 })}/hr or more
              </option>
            ))}
          </Select>
          <Switch
            checked={lite || Boolean(me?.prefs.dataSaver)}
            disabled={Boolean(me?.prefs.dataSaver)}
            onChange={setLite}
            label="Low-data tasks only"
            description={me?.prefs.dataSaver ? 'Data-saver is on in your profile' : 'Hide tasks over ~5 MB'}
          />
          <Switch checked={hideCompleted} onChange={setHideCompleted} label="Hide completed" />
        </Card>
      )}

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        <Chip active={category === 'all'} onClick={() => setCategory('all')}>
          All
        </Chip>
        {OFFER_CATEGORIES.filter((c) => c.id !== 'learn' && c.id !== 'video').map((c) => (
          <Chip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>
            {c.icon} {c.label}
          </Chip>
        ))}
        <Chip onClick={() => navigate('/app/learn')}>
          <GraduationCap className="size-4" /> Earn + learn
        </Chip>
        <Chip onClick={() => navigate('/app/watch')}>
          <CirclePlay className="size-4" /> Videos
        </Chip>
      </div>

      {category === 'quick' && (
        <Callout
          tone="info"
          className="mt-4"
          title="Short on time?"
          action={
            <ButtonLink to="/app/earn/quick" size="sm">
              While-you-wait mode
            </ButtonLink>
          }
        >
          One-question tasks back to back — perfect for queues and bus rides.
        </Callout>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {isLoading && Array.from({ length: 6 }, (_, i) => <OfferCardSkeleton key={i} />)}
        {filtered.map((o) => (
          <OfferCard key={o.id} offer={o} />
        ))}
      </div>
      {!isLoading && filtered.length === 0 && (
        <EmptyState
          icon="🔎"
          title="No tasks match"
          body="Try another category, remove filters, or check back later — new tasks arrive daily."
          action={<ButtonLink to="/app/earn/quick">Try quick tasks</ButtonLink>}
        />
      )}
    </div>
  );
}

export function OfferDetail() {
  const { offerId = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const {
    data: offer,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['offers', 'detail', offerId],
    queryFn: () => get<OfferDetailDTO>(`/offers/${offerId}`),
    refetchInterval: (q) =>
      q.state.data?.myStatus === 'started' || q.state.data?.myStatus === 'reported' ? 8000 : false,
  });
  const [tracking, setTracking] = useState<OfferStartDTO | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const start = useMutation({
    mutationFn: () => post<OfferStartDTO>(`/offers/${offerId}/start`),
  });
  const completed = useMutation({
    mutationFn: (clickId: string) => post(`/clicks/${clickId}/completed`),
    onSuccess: () => {
      toast.info(
        'Got it — we’re checking with the network',
        'Most confirmations arrive within minutes. We’ll notify you either way.',
      );
      qc.invalidateQueries({ queryKey: ['offers'] });
      qc.invalidateQueries({ queryKey: ['activity'] });
    },
  });
  const rate = useMutation({
    mutationFn: (value: 1 | -1) => post(`/offers/${offerId}/rate`, { value }),
    onSuccess: () => {
      toast.success('Thanks for rating', 'Ratings feed the quality grade other members see.');
      qc.invalidateQueries({ queryKey: ['offers', 'detail', offerId] });
    },
  });

  if (isLoading) return <Skeleton className="h-96" />;
  if (error || !offer)
    return (
      <EmptyState
        icon="🫥"
        title="Offer not available"
        body={errorMessage(error)}
        action={<ButtonLink to="/app/earn">Back to tasks</ButtonLink>}
      />
    );

  const clickId = tracking?.clickId ?? offer.myClickId;
  const inProgress = offer.myStatus === 'started' || offer.myStatus === 'reported';

  const begin = async () => {
    // Open the tab synchronously (popup blockers), then point it at the tracking URL.
    const tab = window.open('about:blank', '_blank');
    try {
      const res = await start.mutateAsync();
      setTracking(res);
      if (tab) tab.location.href = res.redirectUrl;
      else navigate(res.redirectUrl);
      qc.invalidateQueries({ queryKey: ['offers'] });
    } catch (err) {
      tab?.close();
      toast.error('Couldn’t start this task', errorMessage(err));
    }
  };

  return (
    <div className="space-y-5">
      <Link
        to="/app/earn"
        className="text-sm font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white"
      >
        ← All tasks
      </Link>
      <Card className="p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <OfferIcon icon={offer.icon} color={offer.color} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <QualityBadge quality={offer.quality} />
              {offer.myStatus && <ClickStatusBadge status={offer.myStatus} />}
              {offer.isLite && <Badge tone="info">Works on slow connections</Badge>}
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight">{offer.title}</h1>
            <p className="text-sm text-slate-500">
              {offer.advertiser} · via {offer.networkName}
            </p>
            <p className="mt-3 leading-relaxed text-slate-700 dark:text-slate-300">{offer.description}</p>
          </div>
          <div className="shrink-0 rounded-2xl bg-slate-50 p-4 text-right sm:min-w-44 dark:bg-slate-800/50">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">You earn</p>
            <Money micros={offer.userPayoutMicros} size="lg" />
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Fact
            icon={Gauge}
            label="Hourly rate"
            value={`${formatUsd(offer.hourlyRateMicros, { precision: 2 })}/hr`}
            highlight
          />
          <Fact
            icon={Clock}
            label={
              offer.measuredMinutes
                ? `Measured (${offer.measuredSamples} completions)`
                : 'Advertiser estimate'
            }
            value={minutesLabel(offer.effectiveMinutes)}
          />
          <Fact icon={Zap} label="Credit speed" value={PAY_SPEEDS[offer.paySpeed]} />
          <Fact
            icon={Wifi}
            label="Data used"
            value={`~${offer.dataMb < 1 ? '<1' : Math.round(offer.dataMb)} MB`}
          />
        </div>
      </Card>

      {(tracking || inProgress) && clickId && (
        <Callout
          tone="info"
          title={
            offer.myStatus === 'reported' ? 'Checking with the network…' : 'We’re listening for confirmation'
          }
          action={
            offer.myStatus === 'started' || (tracking && offer.myStatus !== 'reported') ? (
              <Button size="sm" onClick={() => completed.mutate(clickId)} loading={completed.isPending}>
                I finished
              </Button>
            ) : (
              <ButtonLink to="/app/activity" size="sm" variant="outline">
                Activity
              </ButtonLink>
            )
          }
        >
          <span className="flex items-center gap-1.5">
            <Radio className="size-3.5 animate-pulse" /> {offer.networkName} notifies us server-to-server —
            this page updates live. Not credited after 10 minutes? File a Missing Credit claim from Activity.
          </span>
        </Callout>
      )}

      {offer.myStatus === 'credited' && (
        <Callout tone="success" title="Completed and credited">
          Nice work. How was it?
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant={offer.myRating === 1 ? 'primary' : 'outline'}
              onClick={() => rate.mutate(1)}
            >
              <ThumbsUp className="size-4" /> Good
            </Button>
            <Button
              size="sm"
              variant={offer.myRating === -1 ? 'danger' : 'outline'}
              onClick={() => rate.mutate(-1)}
            >
              <ThumbsDown className="size-4" /> Not great
            </Button>
          </div>
        </Callout>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader title="What to do" subtitle="Complete every step on the advertiser’s site." />
          <ol className="space-y-3">
            {offer.steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white dark:bg-white dark:text-slate-900">
                  {i + 1}
                </span>
                <span className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{s}</span>
              </li>
            ))}
          </ol>
          <div className="mt-6">
            {offer.completedByMe ? (
              <Button block size="lg" disabled>
                <CircleCheck className="size-4" /> Already completed
              </Button>
            ) : (
              <Button block size="lg" onClick={begin} loading={start.isPending}>
                {inProgress ? 'Continue task' : 'Start task'} <ExternalLink className="size-4" />
              </Button>
            )}
            <p className="mt-2 text-center text-xs text-slate-500">
              Opens the advertiser’s page in a new tab. Your balance updates here automatically.
            </p>
          </div>
          <div className="mt-6 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50">
            <p className="mb-2 text-sm font-semibold">Tips for reliable credit</p>
            <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-400">
              {offer.tips.map((t) => (
                <li key={t} className="flex gap-2">
                  <span className="text-brand-600">•</span> {t}
                </li>
              ))}
            </ul>
          </div>
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Quality report"
              subtitle="From real member data — the grade can’t be bought."
              icon={<ShieldCheck className="size-5 text-brand-600" />}
            />
            <QualityRow label="Members who finish it" value={offer.quality.completionRate} />
            <QualityRow label="Credits reliably" value={offer.quality.creditReliability} />
            <QualityRow
              label="Positive ratings"
              value={offer.quality.rating}
              sub={`${offer.ratingCounts.up} 👍 · ${offer.ratingCounts.down} 👎`}
            />
            <QualityRow
              label={`${offer.networkName} postback reliability`}
              value={offer.networkReliability}
            />
            {offer.quality.reports > 0 && (
              <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">
                ⚠️ {offer.quality.reports} open member report(s) under review
              </p>
            )}
          </Card>
          <Card>
            <p className="text-sm font-medium">Something wrong with this offer?</p>
            <p className="mt-1 text-sm text-slate-500">
              Scams, hidden charges, spam — reports with real consequences. Confirmed offers go on our public
              Wall of Shame.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => setReportOpen(true)}
              disabled={!offer.myStatus && !offer.completedByMe}
            >
              <Flag className="size-4" /> Report this offer
            </Button>
            {!offer.myStatus && !offer.completedByMe && (
              <p className="mt-2 text-xs text-slate-400">You can report after starting it.</p>
            )}
          </Card>
        </div>
      </div>
      <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} offerId={offerId} />
    </div>
  );
}

function Fact({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border p-3',
        highlight
          ? 'border-brand-200 bg-brand-50 dark:border-brand-900 dark:bg-brand-950/40'
          : 'border-slate-200 dark:border-slate-800',
      )}
    >
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <Icon className="size-3.5" /> {label}
      </p>
      <p className={cn('tabular mt-1 font-semibold', highlight && 'text-brand-800 dark:text-brand-300')}>
        {value}
      </p>
    </div>
  );
}

function QualityRow({ label, value, sub }: { label: string; value: number | null; sub?: string }) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-slate-600 dark:text-slate-400">{label}</span>
        <span className="tabular font-medium">{value === null ? 'Not enough data' : pct(value)}</span>
      </div>
      <Progress value={value ?? 0} />
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function ReportModal({ open, onClose, offerId }: { open: boolean; onClose: () => void; offerId: string }) {
  const [reason, setReason] = useState<string>('scam');
  const [details, setDetails] = useState('');
  const report = useMutation({
    mutationFn: () =>
      post<{ autoPaused: boolean }>(`/offers/${offerId}/report`, { reason, details: details || undefined }),
    onSuccess: (r) => {
      toast.success(
        'Report received',
        r.autoPaused
          ? 'Multiple members reported this offer, so it’s paused while we review.'
          : 'We review every report. Thank you for protecting other members.',
      );
      onClose();
    },
    onError: (err) => toast.error('Couldn’t send report', errorMessage(err)),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Report this offer"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={report.isPending} onClick={() => report.mutate()}>
            Send report
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {OFFER_REPORT_REASONS.map((r) => (
          <label
            key={r.id}
            className={cn(
              'flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm',
              reason === r.id
                ? 'border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/30'
                : 'border-slate-200 dark:border-slate-800',
            )}
          >
            <input
              type="radio"
              name="reason"
              checked={reason === r.id}
              onChange={() => setReason(r.id)}
              className="accent-rose-600"
            />
            {r.label}
          </label>
        ))}
      </div>
      <div className="mt-4">
        <Textarea
          label="Details (optional)"
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="What happened?"
          rows={3}
        />
      </div>
      <p className="mt-3 text-xs text-slate-500">
        When several members report the same serious problem, the offer pauses automatically until a person
        reviews it.
      </p>
    </Modal>
  );
}
