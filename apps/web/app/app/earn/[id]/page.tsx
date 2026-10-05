'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Clock, Flag, Gauge, Info, LifeBuoy, Loader2, Lock, ShieldCheck, Star, Timer } from 'lucide-react';
import {
  CATEGORY_META,
  DATA_USAGE_META,
  formatDuration,
  formatMinutes,
  formatMoney,
  OFFER_REPORT_LABELS,
  OFFER_REPORT_REASONS,
  TIER_BY_ID,
  type OfferReportReason,
} from '@cashads/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert, Badge, Skeleton } from '@/components/ui/feedback';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { KeyValue } from '@/components/ui/misc';
import { ClaimModal } from '@/components/app/claim-modal';
import { api, errorMessage } from '@/lib/api';
import { qk, useClicks, useMe, useOffer } from '@/lib/queries';
import { toast } from '@/lib/store';
import { cn, pct } from '@/lib/utils';

function OfferDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: offer, isLoading, error, refetch } = useOffer(id);
  const { data: clicks } = useClicks();
  const [starting, setStarting] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState<OfferReportReason>('not_as_described');
  const [details, setDetails] = useState('');
  const returned = search.get('returned') === '1';
  const [waitedLong, setWaitedLong] = useState(false);
  const marked = useRef(false);

  // Always show fresh state when coming back from the partner site.
  useEffect(() => {
    if (returned) void refetch();
  }, [returned, refetch]);

  // Member came back from the partner: record it (feeds tracking-reliability stats) and poll briefly.
  useEffect(() => {
    if (!returned || !offer?.myClickId || marked.current) return;
    marked.current = true;
    void api(`/offers/clicks/${offer.myClickId}/returned`, { body: {} }).catch(() => undefined);
    const poll = setInterval(() => void qc.invalidateQueries({ queryKey: qk.offer(id) }), 3000);
    const t = setTimeout(() => setWaitedLong(true), 20_000);
    return () => {
      clearInterval(poll);
      clearTimeout(t);
    };
  }, [returned, offer?.myClickId, id, qc]);

  if (isLoading) return <Skeleton className="h-96 rounded-3xl" />;
  if (error || !offer) return <Alert tone="danger" title="Offer unavailable">{errorMessage(error)}</Alert>;

  const myClick = clicks?.find((c) => c.id === offer.myClickId);
  const credited = offer.myStatus === 'credited' || offer.myStatus === 'pending';
  const inProgress = offer.myStatus === 'started' || offer.myStatus === 'claimed';
  const share = offer.revenueShareBps / 100;

  async function start() {
    setStarting(true);
    try {
      const res = await api<{ clickId: string; redirectUrl: string }>(`/offers/${offer!.id}/start`, { body: {} });
      await Promise.all([qc.invalidateQueries({ queryKey: qk.clicks }), qc.invalidateQueries({ queryKey: qk.offer(offer!.id) }), qc.invalidateQueries({ queryKey: ['offers'] })]);
      if (res.redirectUrl.startsWith('/')) router.push(res.redirectUrl);
      else window.open(res.redirectUrl, '_blank', 'noopener');
    } catch (err) {
      toast({ title: errorMessage(err), tone: 'danger' });
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link href="/app/earn" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> All offers
      </Link>

      {returned && inProgress && (
        <Alert tone={waitedLong ? 'warning' : 'info'} icon={waitedLong ? <Clock className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />} title={waitedLong ? 'Taking longer than usual' : 'Verifying with the partner…'}>
          {waitedLong ? (
            <>
              Some partners confirm in minutes, others take a few hours. If it doesn’t arrive, file a{' '}
              <button className="font-semibold underline" onClick={() => setClaimOpen(true)}>
                missing-credit claim
              </button>{' '}
              — we check their records automatically and pay you if we can verify it.
            </>
          ) : (
            'Most credits land within seconds. Keep this tab open — you’ll see it the moment it arrives.'
          )}
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <div className="h-2" style={{ background: offer.brandColor }} />
            <CardBody className="sm:p-8">
              <div className="flex items-start gap-4">
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-3xl" style={{ background: `${offer.brandColor}1a` }}>
                  {offer.icon}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>
                      {CATEGORY_META[offer.category].emoji} {CATEGORY_META[offer.category].label}
                    </Badge>
                    {offer.featured && (
                      <Badge tone="warning">
                        <Star className="h-3 w-3 fill-current" /> Featured
                      </Badge>
                    )}
                  </div>
                  <h1 className="mt-2 text-2xl font-bold leading-tight sm:text-3xl">{offer.title}</h1>
                  <p className="mt-1 text-sm text-muted">
                    by {offer.advertiser} · via {offer.networkName}
                  </p>
                </div>
              </div>
              <p className="mt-6 whitespace-pre-line text-muted">{offer.description || offer.shortDescription}</p>

              {offer.steps.length > 0 && (
                <div className="mt-6">
                  <p className="text-sm font-semibold">What to do</p>
                  <ol className="mt-3 space-y-2.5">
                    {offer.steps.map((s, i) => (
                      <li key={i} className="flex gap-3 text-sm">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">{i + 1}</span>
                        <span className="pt-0.5">{s}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {offer.requirements.length > 0 && (
                <div className="mt-6 rounded-2xl bg-surface-2 p-4">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <Info className="h-4 w-4" /> Requirements
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-muted">
                    {offer.requirements.map((r) => (
                      <li key={r}>• {r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardBody>
          </Card>

          {offer.goals.length > 0 && (
            <Card>
              <CardHeader title="Milestones" description="Each milestone pays the moment the partner confirms it." />
              <CardBody>
                <ol className="space-y-2">
                  {offer.goals.map((g, i) => (
                    <li key={g.id} className={cn('flex items-center gap-3 rounded-xl border p-3', g.credited ? 'border-brand-300 bg-brand-50/50 dark:border-brand-500/30 dark:bg-brand-500/5' : 'border-line')}>
                      {g.credited ? <CheckCircle2 className="h-5 w-5 text-brand-600" /> : <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-line-strong text-[10px] font-bold text-muted">{i + 1}</span>}
                      <span className="flex-1 text-sm font-medium">{g.label}</span>
                      <span className="tabular text-sm font-bold text-brand-700 dark:text-brand-400">{formatMoney(g.userPayoutMicros)}</span>
                    </li>
                  ))}
                </ol>
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card className="lg:sticky lg:top-24">
            <CardBody className="sm:p-6">
              <p className="text-sm text-muted">{offer.goals.length ? 'Total if you finish every milestone' : 'You get'}</p>
              <p className="tabular mt-1 font-display text-5xl font-extrabold tracking-tight text-brand-700 dark:text-brand-400">{formatMoney(offer.userPayoutMicros)}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge tone="brand">
                  <Gauge className="h-3 w-3" /> {formatMoney(offer.hourlyRateMicros, { decimals: 2 })}/hr
                </Badge>
                <Badge>
                  <Timer className="h-3 w-3" /> {formatMinutes(offer.medianMinutes ?? offer.estimatedMinutes)}
                  {offer.medianMinutes ? ' (real median)' : ' (estimate)'}
                </Badge>
              </div>

              <div className="mt-5 rounded-2xl border border-line bg-surface-2 p-4">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                  <ShieldCheck className="h-3.5 w-3.5" /> Transparent split
                </p>
                <KeyValue
                  className="mt-1"
                  items={[
                    ['Partner pays CashAds', formatMoney(offer.partnerPayoutMicros)],
                    [`Your ${share}% share`, formatMoney(offer.baseUserPayoutMicros)],
                    ...(offer.tierBonusMicros > 0 ? ([[`${TIER_BY_ID[me?.user.tier ?? 'bronze'].label} tier bonus (paid by us)`, `+${formatMoney(offer.tierBonusMicros)}`]] as Array<[string, string]>) : []),
                  ]}
                />
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                  <Lock className="h-3 w-3" /> Price locked when you start — even if the partner lowers it.
                </p>
              </div>

              <div className="mt-5">
                {credited ? (
                  <Alert tone="success" icon={<CheckCircle2 className="h-4 w-4" />} title={offer.myStatus === 'pending' ? 'Credited — in safety hold' : 'Completed & credited'}>
                    {offer.myStatus === 'pending' ? 'It unlocks automatically — see your Wallet for the exact time.' : 'Thanks! Rate it below to help other members.'}
                  </Alert>
                ) : offer.myStatus === 'reversed' ? (
                  <Alert tone="danger" title="Reversed by the partner">
                    Think this is wrong?{' '}
                    <Link href="/app/support/new?category=offer" className="font-semibold underline">
                      Contact support
                    </Link>{' '}
                    and we’ll dispute it for you.
                  </Alert>
                ) : (
                  <Button size="lg" className="w-full" onClick={start} loading={starting} disabled={me?.user.status !== 'active'}>
                    {inProgress ? 'Continue offer' : offer.goals.length ? 'Start playing' : 'Start offer'}
                  </Button>
                )}
                {inProgress && (
                  <button onClick={() => setClaimOpen(true)} className="mt-3 flex w-full items-center justify-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300">
                    <LifeBuoy className="h-4 w-4" /> Finished but not credited?
                  </button>
                )}
              </div>

              <KeyValue
                className="mt-5"
                items={[
                  ['Safety hold', offer.holdHours > 0 ? `${offer.holdHours}h, then available` : 'None — instant'],
                  ['Tracking reliability', offer.trackingReliability !== null ? pct(offer.trackingReliability) : 'New offer'],
                  ['Typical credit time', offer.medianCreditSeconds !== null ? formatDuration(offer.medianCreditSeconds) : 'Seconds to minutes'],
                  ['Quality score', `${offer.qualityScore}/100`],
                  ['Member rating', offer.ratingAvg ? `${offer.ratingAvg} ★ (${offer.ratingCount})` : 'Not rated yet'],
                  ['Data usage', DATA_USAGE_META[offer.dataUsage].approx],
                  ['Completed by', `${offer.completions.toLocaleString()} members`],
                ]}
              />
              {offer.holdHours > 0 && (
                <p className="mt-3 text-xs text-muted">
                  Why a hold? Partners can reverse fraudulent sign-ups for high-value offers. Higher tiers get shorter holds —{' '}
                  <Link href="/app/rewards" className="underline">
                    see tiers
                  </Link>
                  .
                </p>
              )}
            </CardBody>
          </Card>

          {credited && <RateOffer offerId={offer.id} myRating={offer.myRating} />}

          <button onClick={() => setReportOpen(true)} className="flex w-full items-center justify-center gap-1.5 text-xs text-muted hover:text-rose-600">
            <Flag className="h-3.5 w-3.5" /> Report this offer
          </button>
        </div>
      </div>

      {clicks && <ClaimModal open={claimOpen} onClose={() => setClaimOpen(false)} clicks={clicks} defaultClickId={myClick?.id} />}
      <Modal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title="Report this offer"
        description="Reports have consequences: offers with repeated reports are paused automatically while our team reviews them."
        footer={
          <Button
            variant="danger"
            onClick={async () => {
              try {
                const r = await api<{ message: string }>(`/offers/${offer.id}/report`, { body: { reason, details: details || undefined } });
                toast({ title: 'Report received', description: r.message, tone: 'success' });
                setReportOpen(false);
              } catch (err) {
                toast({ title: errorMessage(err), tone: 'danger' });
              }
            }}
          >
            Send report
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label="What’s wrong?">
            <Select value={reason} onChange={(e) => setReason(e.target.value as OfferReportReason)}>
              {OFFER_REPORT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {OFFER_REPORT_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Details" optional>
            <Textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

function RateOffer({ offerId, myRating }: { offerId: string; myRating: number | null }) {
  const qc = useQueryClient();
  const [rating, setRating] = useState(myRating ?? 0);
  return (
    <Card>
      <CardBody>
        <p className="text-sm font-semibold">How was it?</p>
        <p className="text-xs text-muted">Ratings feed the quality score other members see.</p>
        <div className="mt-3 flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              aria-label={`${n} stars`}
              onClick={async () => {
                setRating(n);
                try {
                  await api(`/offers/${offerId}/review`, { body: { rating: n } });
                  await qc.invalidateQueries({ queryKey: qk.offer(offerId) });
                  toast({ title: 'Thanks for rating!', tone: 'success' });
                } catch (err) {
                  toast({ title: errorMessage(err), tone: 'danger' });
                }
              }}
            >
              <Star className={cn('h-7 w-7 transition-colors', n <= rating ? 'fill-amber-400 text-amber-400' : 'text-line-strong hover:text-amber-300')} />
            </button>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

export default function OfferPage() {
  return (
    <Suspense>
      <OfferDetail />
    </Suspense>
  );
}
