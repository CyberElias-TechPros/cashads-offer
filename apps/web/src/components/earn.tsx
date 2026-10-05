import { Clock, Gauge, ShieldCheck, Wifi, Zap } from 'lucide-react';
import { Link } from 'react-router';
import {
  CLAIM_STATUS,
  CLICK_STATUS,
  type ClaimStatus,
  type ClickStatus,
  type FeedItemDTO,
  type OfferDTO,
  type OfferQualityDTO,
  PAYOUT_STATUS,
  PAY_SPEEDS,
  type PayoutStatus,
  formatUsd,
} from '@cashads/shared';
import { useMoney } from '../lib/queries';
import { cn, duration, minutesLabel, pct, timeAgo } from '../lib/utils';
import { Badge, type Tone } from './ui';

const GRADE_STYLE: Record<OfferQualityDTO['grade'], string> = {
  A: 'bg-emerald-600 text-white',
  B: 'bg-emerald-500/90 text-white',
  C: 'bg-amber-500 text-white',
  D: 'bg-orange-500 text-white',
  F: 'bg-rose-600 text-white',
  New: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
};

export function QualityBadge({ quality, compact }: { quality: OfferQualityDTO; compact?: boolean }) {
  const tip =
    quality.grade === 'New'
      ? 'Not enough data yet to grade this offer'
      : `Quality ${quality.score}/100 · completion ${pct(quality.completionRate)} · credits reliably ${pct(quality.creditReliability)} · rated ${pct(quality.rating)} positive${quality.reports ? ` · ${quality.reports} open report(s)` : ''}`;
  return (
    <span
      title={tip}
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold',
        GRADE_STYLE[quality.grade],
      )}
    >
      {!compact && <ShieldCheck className="size-3" />}
      {quality.grade === 'New' ? 'NEW' : quality.grade}
    </span>
  );
}

export function OfferIcon({
  icon,
  color,
  size = 'md',
}: {
  icon: string;
  color: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const s =
    size === 'lg'
      ? 'size-16 text-3xl rounded-2xl'
      : size === 'sm'
        ? 'size-9 text-lg rounded-lg'
        : 'size-12 text-2xl rounded-xl';
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center', s)}
      style={{ background: `${color}1f`, boxShadow: `inset 0 0 0 1px ${color}33` }}
      aria-hidden
    >
      {icon}
    </span>
  );
}

export function OfferCard({ offer, compact }: { offer: OfferDTO; compact?: boolean }) {
  const m = useMoney();
  const done = offer.completedByMe;
  return (
    <Link
      to={`/app/earn/${offer.id}`}
      className={cn(
        'group relative flex flex-col rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700',
        done && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-3">
        <OfferIcon icon={offer.icon} color={offer.color} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <QualityBadge quality={offer.quality} compact />
            {offer.myStatus && offer.myStatus !== 'credited' && (
              <Badge tone="warning">{CLICK_STATUS[offer.myStatus].label}</Badge>
            )}
            {done && <Badge tone="success">Done</Badge>}
          </div>
          <p className="mt-1 line-clamp-2 font-semibold leading-snug text-slate-900 dark:text-white">
            {offer.title}
          </p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{offer.advertiser}</p>
        </div>
        <div className="text-right">
          <p className="tabular text-lg font-bold tracking-tight text-slate-900 dark:text-white">
            {formatUsd(offer.userPayoutMicros)}
          </p>
          {m.local(offer.userPayoutMicros) && (
            <p className="tabular text-[11px] text-slate-400">≈ {m.local(offer.userPayoutMicros)}</p>
          )}
        </div>
      </div>
      {!compact && (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-500 dark:text-slate-400">
          <span
            className="inline-flex items-center gap-1"
            title={
              offer.measuredMinutes
                ? `Median of ${offer.measuredSamples} real completions`
                : 'Advertiser estimate'
            }
          >
            <Clock className="size-3.5" />
            {minutesLabel(offer.effectiveMinutes)}
            {offer.measuredMinutes ? (
              <span className="text-[10px] font-medium text-brand-600 dark:text-brand-400">measured</span>
            ) : null}
          </span>
          <span className="inline-flex items-center gap-1 font-semibold text-brand-700 dark:text-brand-400">
            <Gauge className="size-3.5" />
            {formatUsd(offer.hourlyRateMicros, { precision: 2 })}/hr
          </span>
          <span className="inline-flex items-center gap-1">
            <Zap className="size-3.5" />
            {offer.paySpeed === 'instant'
              ? 'Instant credit'
              : PAY_SPEEDS[offer.paySpeed].replace('Credited ', '')}
          </span>
          <span className="inline-flex items-center gap-1" title="Estimated mobile data used">
            <Wifi className="size-3.5" />~{offer.dataMb < 1 ? '<1' : Math.round(offer.dataMb)} MB
          </span>
        </div>
      )}
    </Link>
  );
}

export function OfferCardSkeleton() {
  return <div className="skeleton h-[124px] rounded-2xl" />;
}

const STATUS_TONE: Record<string, Tone> = {
  info: 'info',
  warning: 'warning',
  success: 'success',
  danger: 'danger',
  neutral: 'neutral',
};

export function ClickStatusBadge({ status }: { status: ClickStatus }) {
  const s = CLICK_STATUS[status];
  return (
    <Badge tone={STATUS_TONE[s.tone]} dot>
      {s.label}
    </Badge>
  );
}
export function ClaimStatusBadge({ status }: { status: ClaimStatus }) {
  const s = CLAIM_STATUS[status];
  return (
    <Badge tone={STATUS_TONE[s.tone]} dot>
      {s.label}
    </Badge>
  );
}
export function PayoutStatusBadge({ status }: { status: PayoutStatus }) {
  const s = PAYOUT_STATUS[status];
  return (
    <Badge tone={STATUS_TONE[s.tone]} dot>
      {s.label}
    </Badge>
  );
}

export function FeedRow({ item }: { item: FeedItemDTO }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-lg dark:bg-slate-800"
        aria-hidden
      >
        {item.methodIcon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-slate-700 dark:text-slate-300">
          <span className="font-medium text-slate-900 dark:text-white">{item.name}</span> {item.flag} cashed
          out via {item.methodName}
        </p>
        <p className="text-xs text-slate-400">
          {timeAgo(item.completedAt)}
          {item.durationSeconds !== null && <> · paid in {duration(item.durationSeconds)}</>}
        </p>
      </div>
      <span className="tabular text-sm font-semibold text-brand-700 dark:text-brand-400">
        {formatUsd(item.amountMicros)}
      </span>
    </li>
  );
}

export function FeedTicker({ items }: { items: FeedItemDTO[] }) {
  if (items.length === 0) return null;
  const loop = [...items, ...items];
  return (
    <div className="relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
      <div className="flex w-max animate-marquee gap-3 hover:[animation-play-state:paused]">
        {loop.map((item, i) => (
          <div
            key={`${item.id}-${i}`}
            className="flex items-center gap-2 whitespace-nowrap rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <span aria-hidden>{item.methodIcon}</span>
            <span className="text-slate-600 dark:text-slate-300">
              {item.flag} {item.name.replace('A member in ', '')}
            </span>
            <span className="tabular font-semibold text-brand-700 dark:text-brand-400">
              {formatUsd(item.amountMicros)}
            </span>
            {item.durationSeconds !== null && (
              <span className="text-xs text-slate-400">in {duration(item.durationSeconds)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
