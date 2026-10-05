import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, CircleCheck, CircleX, Lock, Plus, ShieldCheck, Trash2, UserCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  type DestinationDTO,
  type PayoutDTO,
  type PayoutMethodDTO,
  type PayoutQuoteDTO,
  floorToCent,
  formatLocal,
  formatUsd,
  parseDollarInput,
} from '@lucrum/shared';
import { PhoneVerifyModal } from '../../components/verify';
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
  Select,
  Skeleton,
} from '../../components/ui';
import { ApiError, del, errorMessage, get, post } from '../../lib/api';
import { qk, useMe, useWallet } from '../../lib/queries';
import { cn, duration, newIdempotencyKey } from '../../lib/utils';
import { toast } from '../../store/ui';

function feeLabel(m: PayoutMethodDTO): string {
  if (!m.feeFixedMicros && !m.feePercentBps) return 'No fee';
  const parts = [];
  if (m.feePercentBps) parts.push(`${m.feePercentBps / 100}%`);
  if (m.feeFixedMicros) parts.push(formatUsd(m.feeFixedMicros));
  return parts.join(' + ') + (m.feeCapMicros ? ` (max ${formatUsd(m.feeCapMicros)})` : '');
}

export function Cashout() {
  const { data: me } = useMe();
  const { data: wallet } = useWallet();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: methods } = useQuery({
    queryKey: ['payout-methods'],
    queryFn: () => get<PayoutMethodDTO[]>('/payouts/methods'),
  });
  const { data: destinations = [] } = useQuery({
    queryKey: ['destinations'],
    queryFn: () => get<DestinationDTO[]>('/payouts/destinations'),
  });
  const [methodId, setMethodId] = useState<string | null>(null);
  const [destinationId, setDestinationId] = useState<string | 'new' | null>(null);
  const [details, setDetails] = useState<Record<string, string>>({});
  const [save, setSave] = useState(true);
  const [verifiedName, setVerifiedName] = useState<string | null>(null);
  const [amountText, setAmountText] = useState('');
  const [quote, setQuote] = useState<PayoutQuoteDTO | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [totp, setTotp] = useState('');
  const [idemKey, setIdemKey] = useState(() => newIdempotencyKey('payout'));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const method = methods?.find((m) => m.id === methodId) ?? null;
  const savedForMethod = destinations.filter((d) => d.methodId === methodId);
  const amountMicros = parseDollarInput(amountText);
  const maxCashable = floorToCent(wallet?.availableMicros ?? 0);

  useEffect(() => {
    if (!methodId) return;
    setDestinationId(savedForMethod[0]?.id ?? 'new');
    setDetails({});
    setVerifiedName(null);
    setFieldErrors({});
  }, [methodId]);

  // Live quote (debounced) — fee, net, local amount, requirements.
  useEffect(() => {
    if (!methodId || !amountMicros) {
      setQuote(null);
      return;
    }
    const t = setTimeout(() => {
      post<PayoutQuoteDTO>('/payouts/quote', { methodId, amountMicros })
        .then(setQuote)
        .catch(() => setQuote(null));
    }, 250);
    return () => clearTimeout(t);
  }, [methodId, amountMicros, me?.phoneVerified, me?.emailVerified, me?.kycStatus]);

  const enquiry = useMutation({
    mutationFn: () => post<{ name: string | null }>('/payouts/name-enquiry', { methodId, details }),
    onSuccess: (r) => {
      setVerifiedName(r.name);
      setFieldErrors({});
    },
    onError: (err) => {
      setVerifiedName(null);
      if (err instanceof ApiError && err.fields) setFieldErrors(err.fields);
      else toast.error('Couldn’t verify the account', errorMessage(err));
    },
  });

  const removeDest = useMutation({
    mutationFn: (id: string) => del(`/payouts/destinations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['destinations'] }),
  });

  const submit = useMutation({
    mutationFn: () =>
      post<PayoutDTO>('/payouts', {
        methodId,
        amountMicros,
        idempotencyKey: idemKey,
        ...(destinationId && destinationId !== 'new'
          ? { destinationId }
          : { details, saveDestination: save }),
        ...(me?.totpEnabled ? { totpCode: totp } : {}),
      }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: qk.wallet });
      qc.invalidateQueries({ queryKey: ['payouts'] });
      qc.invalidateQueries({ queryKey: ['destinations'] });
      navigate(`/app/payouts/${p.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.fields) setFieldErrors(err.fields);
      if (err instanceof ApiError && err.code !== 'TOTP_REQUIRED' && err.code !== 'INVALID_CODE')
        setIdemKey(newIdempotencyKey('payout'));
    },
  });

  const destinationReady =
    destinationId && destinationId !== 'new'
      ? true
      : method
        ? method.fields.every((f) => (details[f.key] ?? '').trim())
        : false;
  const canContinue = Boolean(method && destinationReady && quote?.ok);

  const recommended = useMemo(() => methods?.find((m) => m.countries !== 'global')?.id, [methods]);

  if (!methods || !wallet) return <Skeleton className="h-[600px]" />;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Cash out" subtitle="No Lucrum minimum. You see every fee before you confirm." />
      <Card className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 text-white dark:bg-slate-900">
        <div>
          <p className="text-sm text-slate-400">Available</p>
          <p className="tabular text-3xl font-bold">{formatUsd(maxCashable)}</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-300">
          <ShieldCheck className="size-4 text-brand-400" /> Failed cash-outs are refunded in full — including
          fees
        </div>
      </Card>

      {me?.status !== 'active' && (
        <Callout tone="danger" title="Cash-outs are paused for your account">
          See{' '}
          <Link to="/app/restricted" className="underline">
            the reason and how to appeal
          </Link>
          .
        </Callout>
      )}

      <Card>
        <CardHeader title="1 · Where should we send it?" subtitle={`Methods that work in your country`} />
        <div className="grid gap-2.5 sm:grid-cols-2">
          {methods.map((m) => (
            <button
              key={m.id}
              onClick={() => setMethodId(m.id)}
              className={cn(
                'relative flex items-start gap-3 rounded-2xl border p-4 text-left transition',
                methodId === m.id
                  ? 'border-brand-500 bg-brand-50/60 ring-2 ring-brand-500/20 dark:bg-brand-950/30'
                  : 'border-slate-200 hover:border-slate-300 dark:border-slate-800',
              )}
            >
              <span className="text-2xl">{m.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {m.name} {m.id === recommended && <Badge tone="brand">Local</Badge>}
                </p>
                <p className="text-xs text-slate-500">{m.speed}</p>
                <p className="mt-1.5 text-xs">
                  <span className="font-medium text-slate-700 dark:text-slate-300">{feeLabel(m)}</span>
                  <span className="text-slate-400"> · from {formatUsd(m.minMicros)}</span>
                </p>
              </div>
            </button>
          ))}
        </div>
      </Card>

      {method && (
        <Card className="animate-slide-up">
          <CardHeader title="2 · Destination" subtitle={method.description} />
          {savedForMethod.length > 0 && (
            <div className="mb-4 space-y-2">
              {savedForMethod.map((d) => (
                <label
                  key={d.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3',
                    destinationId === d.id
                      ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-950/30'
                      : 'border-slate-200 dark:border-slate-800',
                  )}
                >
                  <input
                    type="radio"
                    className="accent-brand-600"
                    checked={destinationId === d.id}
                    onChange={() => setDestinationId(d.id)}
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{d.masked}</p>
                    {d.verifiedName && (
                      <p className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                        <UserCheck className="size-3.5" /> {d.verifiedName}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      removeDest.mutate(d.id);
                    }}
                    className="text-slate-400 hover:text-rose-600"
                    aria-label="Remove destination"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </label>
              ))}
              <label
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm',
                  destinationId === 'new' ? 'border-brand-500' : 'border-slate-200 dark:border-slate-800',
                )}
              >
                <input
                  type="radio"
                  className="accent-brand-600"
                  checked={destinationId === 'new'}
                  onChange={() => setDestinationId('new')}
                />
                <Plus className="size-4" /> Use a new {method.kind === 'bank' ? 'account' : 'destination'}
              </label>
            </div>
          )}
          {destinationId === 'new' && (
            <div className="space-y-4">
              {method.fields.map((f) =>
                f.type === 'select' ? (
                  <Select
                    key={f.key}
                    label={f.label}
                    value={details[f.key] ?? ''}
                    onChange={(e) => {
                      setDetails({ ...details, [f.key]: e.target.value });
                      setVerifiedName(null);
                    }}
                    error={fieldErrors[f.key]}
                  >
                    <option value="">Choose…</option>
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    key={f.key}
                    label={f.label}
                    type={f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : 'text'}
                    inputMode={f.key === 'accountNumber' || f.key === 'routingNumber' ? 'numeric' : undefined}
                    placeholder={f.placeholder}
                    value={details[f.key] ?? ''}
                    onChange={(e) => {
                      setDetails({ ...details, [f.key]: e.target.value });
                      setVerifiedName(null);
                    }}
                    error={fieldErrors[f.key]}
                    hint={f.help}
                  />
                ),
              )}
              {method.supportsNameEnquiry && (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => enquiry.mutate()}
                    loading={enquiry.isPending}
                    disabled={!destinationReady}
                  >
                    <BadgeCheck className="size-4" /> Confirm account name
                  </Button>
                  {verifiedName && (
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                      <CircleCheck className="size-4" /> {verifiedName}
                    </span>
                  )}
                </div>
              )}
              <Checkbox
                checked={save}
                onChange={setSave}
                label="Save for next time"
                description="Stored encrypted; only the last digits are ever shown."
              />
            </div>
          )}
        </Card>
      )}

      {method && destinationReady && (
        <Card className="animate-slide-up">
          <CardHeader title="3 · How much?" subtitle="Any amount — try $0.05 to see how fast it lands." />
          <Input
            label="Amount (USD)"
            inputMode="decimal"
            prefix="$"
            placeholder="0.00"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value.replace(/[^\d.]/g, ''))}
            error={amountText && !amountMicros ? 'Enter an amount like 2.50' : null}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {[0.05, 1, 5].map((v) => (
              <Button
                key={v}
                size="sm"
                variant="secondary"
                onClick={() => setAmountText(v.toFixed(2))}
                disabled={v * 1_000_000 > maxCashable}
              >
                {formatUsd(v * 1_000_000)}
              </Button>
            ))}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setAmountText((maxCashable / 1_000_000).toFixed(2))}
              disabled={!maxCashable}
            >
              Max {formatUsd(maxCashable)}
            </Button>
          </div>

          {quote && (
            <div className="mt-5 space-y-4">
              <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/50">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">From your balance</span>
                  <span className="tabular">{formatUsd(quote.amountMicros)}</span>
                </div>
                <div className="mt-1 flex justify-between text-sm">
                  <span className="text-slate-500">{method.provider} fee</span>
                  <span className="tabular">
                    {quote.feeMicros ? `− ${formatUsd(quote.feeMicros)}` : 'Free'}
                  </span>
                </div>
                <div className="mt-3 flex items-end justify-between border-t border-slate-200 pt-3 dark:border-slate-700">
                  <span className="font-semibold">You receive</span>
                  <span className="text-right">
                    <span className="tabular block text-2xl font-bold">{formatUsd(quote.netMicros)}</span>
                    {quote.localCurrency !== 'USD' && (
                      <span className="tabular text-sm text-slate-500">
                        ≈ {formatLocal(quote.netMicros, quote.localCurrency, quote.fxRate)}
                      </span>
                    )}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Usually arrives in {duration(quote.etaSeconds)} · {quote.speed}
                </p>
              </div>
              {quote.blockers.map((b) => (
                <Callout key={b} tone="warning">
                  {b}
                </Callout>
              ))}
              <ul className="space-y-1.5">
                {quote.requirements.map((r) => (
                  <li key={r.code} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2">
                      {r.met ? (
                        <CircleCheck className="size-4 text-emerald-500" />
                      ) : (
                        <CircleX className="size-4 text-rose-500" />
                      )}
                      {r.label}
                    </span>
                    {!r.met && r.action === 'verify_phone' && (
                      <Button size="sm" variant="outline" onClick={() => setPhoneOpen(true)}>
                        Verify phone
                      </Button>
                    )}
                    {!r.met && r.action === 'verify_email' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          post('/auth/resend-verification')
                            .then(() =>
                              toast.success('Verification email sent', 'Sandbox: check the Dev inbox.'),
                            )
                            .catch((e) => toast.error('Couldn’t send', errorMessage(e)))
                        }
                      >
                        Resend email
                      </Button>
                    )}
                    {!r.met && r.action === '/app/kyc' && (
                      <Link to="/app/kyc" className="text-sm font-semibold text-brand-700 underline">
                        Verify ID
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
              <Button
                block
                size="lg"
                disabled={!canContinue || me?.status !== 'active'}
                onClick={() => setConfirmOpen(true)}
              >
                Review cash-out
              </Button>
            </div>
          )}
        </Card>
      )}

      {!method && (
        <EmptyState
          icon="💸"
          title="Pick a method to start"
          body="Local rails are fastest and cheapest. You’ll see the fee and exact amount before confirming."
        />
      )}

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm cash-out"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Back
            </Button>
            <Button
              loading={submit.isPending}
              onClick={() => submit.mutate()}
              disabled={Boolean(me?.totpEnabled) && totp.length < 6}
            >
              Send {quote ? formatUsd(quote.netMicros) : ''}
            </Button>
          </>
        }
      >
        {quote && method && (
          <div className="space-y-3 text-sm">
            <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/50">
              <p className="tabular text-3xl font-bold">{formatUsd(quote.netMicros)}</p>
              {quote.localCurrency !== 'USD' && (
                <p className="tabular text-slate-500">
                  ≈ {formatLocal(quote.netMicros, quote.localCurrency, quote.fxRate)}
                </p>
              )}
              <p className="mt-2">
                to <strong>{method.name}</strong> ·{' '}
                {destinationId && destinationId !== 'new'
                  ? savedForMethod.find((d) => d.id === destinationId)?.masked
                  : Object.values(details).join(' · ')}
              </p>
              {verifiedName && (
                <p className="mt-1 text-emerald-700 dark:text-emerald-400">Account name: {verifiedName}</p>
              )}
            </div>
            <p className="text-slate-500">
              Fee {quote.feeMicros ? formatUsd(quote.feeMicros) : 'none'} · arrives in about{' '}
              {duration(quote.etaSeconds)}. You can cancel until it’s sent.
            </p>
            {me?.totpEnabled && (
              <Input
                label="Authenticator code"
                inputMode="numeric"
                value={totp}
                onChange={(e) => setTotp(e.target.value)}
                prefix={<Lock className="size-4" />}
                error={fieldErrors.totpCode}
              />
            )}
            {submit.isError && <Callout tone="danger">{errorMessage(submit.error)}</Callout>}
          </div>
        )}
      </Modal>
      <PhoneVerifyModal open={phoneOpen} onClose={() => setPhoneOpen(false)} />
    </div>
  );
}
