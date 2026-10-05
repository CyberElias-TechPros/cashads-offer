import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, CircleHelp, Clock, Search, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { type ActivityItemDTO, type ClaimDTO, formatUsd } from '@cashads/shared';
import { ClaimStatusBadge, ClickStatusBadge, OfferIcon } from '../../components/earn';
import {
  Button,
  ButtonLink,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  Input,
  PageHeader,
  Segmented,
  Skeleton,
  Textarea,
  Timeline,
} from '../../components/ui';
import { api, errorMessage, get, post } from '../../lib/api';
import { dateTime, timeAgo } from '../../lib/utils';
import { toast } from '../../store/ui';

type Tab = 'progress' | 'credited' | 'claims' | 'all';

export function ActivityPage() {
  const [tab, setTab] = useState<Tab>('progress');
  const qc = useQueryClient();
  const { data: items, isLoading } = useQuery({
    queryKey: ['activity'],
    queryFn: () => get<ActivityItemDTO[]>('/activity'),
    refetchInterval: 20_000,
  });
  const { data: claims } = useQuery({
    queryKey: ['claims'],
    queryFn: () => get<ClaimDTO[]>('/claims'),
    enabled: tab === 'claims',
  });
  const finished = useMutation({
    mutationFn: (clickId: string) => post(`/clicks/${clickId}/completed`),
    onSuccess: () => {
      toast.info('We’re checking with the network', 'You’ll be notified as soon as it confirms.');
      qc.invalidateQueries({ queryKey: ['activity'] });
    },
  });

  const filtered = (items ?? []).filter((i) =>
    tab === 'progress'
      ? ['started', 'reported', 'claimed'].includes(i.status)
      : tab === 'credited'
        ? i.status === 'credited'
        : true,
  );

  return (
    <div>
      <PageHeader
        title="Activity & claims"
        subtitle="Every task you start is tracked here — with a way to get paid if tracking fails."
      />
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'progress', label: 'In progress' },
          { value: 'credited', label: 'Credited' },
          { value: 'claims', label: 'Claims' },
          { value: 'all', label: 'All' },
        ]}
        className="mb-4"
      />
      {tab === 'claims' ? (
        <div className="space-y-3">
          {claims?.length === 0 && (
            <EmptyState
              icon="🤝"
              title="No claims yet"
              body="If a task doesn’t credit, file a claim from the In progress tab. We’ll do the chasing."
            />
          )}
          {claims?.map((c) => (
            <Link
              key={c.id}
              to={`/app/claims/${c.id}`}
              className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900"
            >
              <OfferIcon icon={c.offer.icon} color={c.offer.color} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{c.offer.title}</p>
                <p className="text-xs text-slate-500">Filed {timeAgo(c.createdAt)}</p>
              </div>
              <ClaimStatusBadge status={c.status} />
              <span className="tabular text-sm font-semibold">{formatUsd(c.amountMicros)}</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {isLoading && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-20" />)}
          {!isLoading && filtered.length === 0 && (
            <EmptyState
              icon="🧾"
              title={tab === 'progress' ? 'Nothing in progress' : 'Nothing here yet'}
              body="Start a task and it will appear here with live status."
              action={<ButtonLink to="/app/earn">Find a task</ButtonLink>}
            />
          )}
          {filtered.map((i) => (
            <Card key={i.clickId} className="p-4">
              <div className="flex items-start gap-3">
                <OfferIcon icon={i.offer.icon} color={i.offer.color} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/app/earn/${i.offer.id}`} className="truncate font-medium hover:underline">
                      {i.offer.title}
                    </Link>
                    <ClickStatusBadge status={i.status} />
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {i.offer.networkName} · started {timeAgo(i.startedAt)}
                    {i.creditedAt && <> · credited {timeAgo(i.creditedAt)}</>}
                  </p>
                </div>
                <span className="tabular shrink-0 font-semibold">
                  {formatUsd(i.creditedMicros ?? i.offer.userPayoutMicros)}
                </span>
              </div>
              {(i.status === 'started' || i.canClaim || i.claimAvailableAt || i.claim) && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                  {i.status === 'started' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => finished.mutate(i.clickId)}
                      loading={finished.isPending && finished.variables === i.clickId}
                    >
                      I finished this
                    </Button>
                  )}
                  {i.canClaim && (
                    <ButtonLink size="sm" to={`/app/claims/new?click=${i.clickId}`}>
                      <CircleHelp className="size-4" /> Missing credit?
                    </ButtonLink>
                  )}
                  {i.claimAvailableAt && (
                    <span className="flex items-center gap-1 text-xs text-slate-500">
                      <Clock className="size-3.5" /> Missing-credit claims open {timeAgo(i.claimAvailableAt)}{' '}
                      (most credits arrive before then)
                    </span>
                  )}
                  {i.claim && (
                    <ButtonLink size="sm" variant="outline" to={`/app/claims/${i.claim.id}`}>
                      View claim
                    </ButtonLink>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function ClaimNew() {
  const [params] = useSearchParams();
  const clickId = params.get('click') ?? '';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: items } = useQuery({
    queryKey: ['activity'],
    queryFn: () => get<ActivityItemDTO[]>('/activity'),
  });
  const item = items?.find((i) => i.clickId === clickId);
  const [completedAt, setCompletedAt] = useState(() =>
    new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16),
  );
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const submit = useMutation({
    mutationFn: async () => {
      const claim = await post<ClaimDTO>('/claims', {
        clickId,
        note,
        completedAt: new Date(completedAt).toISOString(),
      });
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        await api(`/claims/${claim.id}/screenshot`, { method: 'POST', body: fd }).catch(() =>
          toast.info('Claim filed', 'The screenshot couldn’t be attached, but your claim is in.'),
        );
      }
      return claim;
    },
    onSuccess: (claim) => {
      qc.invalidateQueries({ queryKey: ['activity'] });
      navigate(`/app/claims/${claim.id}`, { replace: true });
    },
  });
  if (!items) return <Skeleton className="h-96" />;
  if (!item)
    return (
      <EmptyState
        icon="🤔"
        title="Task not found"
        body="Open Activity and pick the task you want to claim."
        action={<ButtonLink to="/app/activity">Activity</ButtonLink>}
      />
    );
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Missing credit"
        subtitle="Tell us what happened. We do the chasing."
        back={{ to: '/app/activity', label: 'Activity' }}
      />
      <Card className="mb-5 flex items-center gap-3">
        <OfferIcon icon={item.offer.icon} color={item.offer.color} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{item.offer.title}</p>
          <p className="text-xs text-slate-500">
            {item.offer.networkName} · started {dateTime(item.startedAt)}
          </p>
        </div>
        <span className="tabular text-lg font-bold">{formatUsd(item.offer.userPayoutMicros)}</span>
      </Card>
      <Card className="mb-5">
        <CardHeader title="What happens next" icon={<ShieldCheck className="size-5 text-brand-600" />} />
        <ol className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
          <li className="flex gap-2">
            <Search className="mt-0.5 size-4 shrink-0 text-brand-600" /> We search {item.offer.networkName}’s
            postback logs for your click.
          </li>
          <li className="flex gap-2">
            <Search className="mt-0.5 size-4 shrink-0 text-brand-600" /> We ask {item.offer.networkName}{' '}
            directly whether you completed it. If yes, you’re paid on the spot.
          </li>
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-600" /> Silver+ members are paid
            instantly as goodwill while we chase the network.
          </li>
          <li className="flex gap-2">
            <Clock className="mt-0.5 size-4 shrink-0 text-brand-600" /> Otherwise a person decides within 24
            hours — and if we miss that, small claims are approved automatically.
          </li>
        </ol>
      </Card>
      <Card className="space-y-4">
        {submit.isError && <Callout tone="danger">{errorMessage(submit.error)}</Callout>}
        <Input
          label="When did you finish?"
          type="datetime-local"
          value={completedAt}
          onChange={(e) => setCompletedAt(e.target.value)}
        />
        <Textarea
          label="What happened?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. I reached the thank-you page but nothing was credited."
          rows={4}
        />
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:text-slate-400">
          <Camera className="size-5" />
          <span className="flex-1">
            {file ? file.name : 'Add a screenshot (optional, helps a human reviewer)'}
          </span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <Button
          block
          size="lg"
          loading={submit.isPending}
          disabled={note.trim().length < 5}
          onClick={() => submit.mutate()}
        >
          File claim
        </Button>
      </Card>
    </div>
  );
}

export function ClaimDetail() {
  const { id = '' } = useParams();
  const { data: claim, isLoading } = useQuery({
    queryKey: ['claim', id],
    queryFn: () => get<ClaimDTO>(`/claims/${id}`),
    refetchInterval: (q) =>
      q.state.data?.status === 'checking' || q.state.data?.status === 'submitted' ? 2500 : false,
  });
  if (isLoading || !claim) return <Skeleton className="h-96" />;
  const resolutionCopy: Record<string, string> = {
    postback_found: 'The network had reported your completion — a processing error on our side held it up.',
    network_confirmed: 'The network confirmed your completion when we asked.',
    goodwill_auto: 'Paid instantly as goodwill for trusted members. We’re chasing the network ourselves.',
    goodwill_manual: 'Approved by a reviewer and paid by CashAds.',
    sla_auto: 'We missed our 24-hour promise, so it was approved automatically.',
  };
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Missing-credit claim" back={{ to: '/app/activity', label: 'Activity' }} />
      <Card className="mb-5">
        <div className="flex items-center gap-3">
          <OfferIcon icon={claim.offer.icon} color={claim.offer.color} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{claim.offer.title}</p>
            <p className="text-xs text-slate-500">
              {claim.offer.networkName} · filed {timeAgo(claim.createdAt)}
            </p>
          </div>
          <div className="text-right">
            <ClaimStatusBadge status={claim.status} />
            <p className="tabular mt-1 text-lg font-bold">{formatUsd(claim.amountMicros)}</p>
          </div>
        </div>
        {claim.status === 'approved' && claim.resolution && (
          <Callout tone="success" className="mt-4" title={`Paid: +${formatUsd(claim.amountMicros)}`}>
            {resolutionCopy[claim.resolution]}
          </Callout>
        )}
        {claim.status === 'needs_review' && (
          <Callout tone="warning" className="mt-4" title="A person is reviewing this">
            Decision due by {dateTime(claim.slaDueAt)}. If we miss it, claims up to $5 are approved
            automatically.
          </Callout>
        )}
        {claim.status === 'rejected' && (
          <Callout
            tone="danger"
            className="mt-4"
            title="Not approved"
            action={
              <ButtonLink
                size="sm"
                variant="outline"
                to={`/app/support?subject=${encodeURIComponent(`Claim ${claim.id.slice(0, 8)} review`)}&category=missing_credit`}
              >
                Ask for a second look
              </ButtonLink>
            }
          >
            {claim.rejectionReason}
          </Callout>
        )}
      </Card>
      <Card>
        <CardHeader title="Timeline" subtitle="Live — updates as each check completes." />
        <Timeline
          items={claim.events.map((e, i) => ({
            title: e.message,
            at: dateTime(e.at),
            tone:
              e.type === 'approved'
                ? 'success'
                : e.type === 'rejected'
                  ? 'danger'
                  : e.type === 'needs_review'
                    ? 'warning'
                    : 'info',
            active: i === claim.events.length - 1 && claim.status === 'checking',
          }))}
        />
        <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800/50">
          <p className="font-medium">Your note</p>
          <p className="mt-1 text-slate-600 dark:text-slate-400">{claim.note}</p>
          {claim.hasScreenshot && (
            <p className="mt-2 text-xs text-slate-500">📎 Screenshot attached (visible to reviewers only)</p>
          )}
        </div>
      </Card>
    </div>
  );
}
