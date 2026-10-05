'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronRight, Circle, Clock, ShieldCheck, Trash2, Zap } from 'lucide-react';
import { formatDuration, formatLocal, formatMoney, parseMoneyInput, type PayoutQuoteDTO } from '@cashads/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card';
import { Alert, EmptyState, Skeleton } from '@/components/ui/feedback';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { KeyValue, Money, TimeAgo } from '@/components/ui/misc';
import { PayoutStatusBadge } from '@/components/app/widgets';
import { PhoneVerifyModal } from '@/components/app/phone-verify';
import { api, ApiError, errorMessage } from '@/lib/api';
import { qk, useDestinations, useMe, usePayoutMethods, usePayouts } from '@/lib/queries';
import { toast } from '@/lib/store';
import { cn, idempotencyKey } from '@/lib/utils';

export default function CashoutPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: methods, isLoading } = usePayoutMethods();
  const { data: destinations } = useDestinations();
  const { data: payouts } = usePayouts();
  const [methodId, setMethodId] = useState<string | null>(null);
  const [amountText, setAmountText] = useState('');
  const [destId, setDestId] = useState<string | 'new'>('new');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [save, setSave] = useState(true);
  const [quote, setQuote] = useState<PayoutQuoteDTO | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<{ field?: string; message: string } | null>(null);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const idem = useRef(idempotencyKey());

  const available = me?.wallet.availableMicros ?? 0;
  const method = methods?.find((m) => m.id === methodId) ?? null;
  const amount = parseMoneyInput(amountText) ?? 0;
  const savedForMethod = useMemo(() => destinations?.filter((d) => d.methodId === methodId) ?? [], [destinations, methodId]);

  useEffect(() => {
    if (methods && !methodId) {
      const lastUsed = destinations?.[0]?.methodId;
      setMethodId(methods.find((m) => m.id === lastUsed)?.id ?? methods[0]?.id ?? null);
    }
  }, [methods, methodId, destinations]);
  useEffect(() => {
    if (!amountText && available > 0) setAmountText((Math.floor(available / 10_000) / 100).toFixed(2));
  }, [available, amountText]);
  useEffect(() => {
    setDestId(savedForMethod[0]?.id ?? 'new');
    setFields({});
    setFieldError(null);
  }, [methodId, savedForMethod]);

  // Live quote (debounced).
  useEffect(() => {
    if (!methodId || amount <= 0) {
      setQuote(null);
      return;
    }
    setQuoting(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        setQuote(await api<PayoutQuoteDTO>('/payouts/quote', { body: { methodId, amountMicros: amount }, signal: ctrl.signal }));
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setQuote(null);
      } finally {
        setQuoting(false);
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [methodId, amount]);

  async function submit() {
    if (!method || !quote) return;
    setSubmitting(true);
    setFieldError(null);
    try {
      const body = destId === 'new' ? { methodId: method.id, amountMicros: amount, destination: fields, saveDestination: save, idempotencyKey: idem.current } : { methodId: method.id, amountMicros: amount, destinationId: destId, idempotencyKey: idem.current };
      const p = await api<{ id: string }>('/payouts', { body });
      await Promise.all([qc.invalidateQueries({ queryKey: qk.me }), qc.invalidateQueries({ queryKey: qk.payouts }), qc.invalidateQueries({ queryKey: qk.destinations })]);
      idem.current = idempotencyKey();
      router.push(`/app/cashout/${p.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_destination') setFieldError({ field: (err.details as { field?: string })?.field, message: err.message });
      else toast({ title: errorMessage(err), tone: 'danger' });
    } finally {
      setSubmitting(false);
    }
  }

  if (!me) return null;
  const unmet = quote?.requirements.filter((r) => !r.met) ?? [];

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      <PageHeader title="Cash out" description="No minimum, ever. You see the provider fee before you confirm, and most cash outs arrive in minutes." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="1. Where should we send it?" description={`Showing methods that work in your country.`} />
            <CardBody className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {isLoading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
              {methods?.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMethodId(m.id)}
                  className={cn('rounded-2xl border p-4 text-left transition-all', methodId === m.id ? 'border-brand-500 bg-brand-50/60 ring-4 ring-brand-500/10 dark:bg-brand-500/5' : 'border-line hover:border-line-strong')}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{m.logo}</span>
                    <span className="font-semibold">{m.name}</span>
                    {m.etaLabel.toLowerCase().includes('instant') || (m.medianSeconds !== null && m.medianSeconds < 600) ? <Zap className="ml-auto h-4 w-4 text-amber-500" /> : null}
                  </div>
                  <p className="mt-1.5 text-xs text-muted">{m.description}</p>
                  <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    <span className="font-medium">{m.feeBps === 0 && m.feeFixedMicros === 0 ? 'No fee' : `Fee ${[m.feeBps ? `${m.feeBps / 100}%` : '', m.feeFixedMicros ? formatMoney(m.feeFixedMicros) : ''].filter(Boolean).join(' + ')}`}</span>
                    <span className="text-muted">Min {formatMoney(m.minMicros)}</span>
                    <span className="text-muted">{m.medianSeconds !== null ? `Real median ${formatDuration(m.medianSeconds)}` : m.etaLabel}</span>
                  </div>
                </button>
              ))}
            </CardBody>
          </Card>

          {method && (
            <Card>
              <CardHeader title="2. How much?" description={`Available: ${formatMoney(available)}`} />
              <CardBody className="space-y-3">
                <div className="relative">
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-semibold text-muted">$</span>
                  <Input value={amountText} onChange={(e) => setAmountText(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" className="tabular h-16 pl-10 text-3xl font-bold" aria-label="Amount in USD" />
                </div>
                <div className="flex flex-wrap gap-2">
                  {[0.25, 0.5, 1].map((f) => (
                    <button key={f} onClick={() => setAmountText((Math.floor((available * f) / 10_000) / 100).toFixed(2))} className="rounded-full border border-line px-3 py-1 text-sm hover:border-brand-400">
                      {f === 1 ? 'Max' : `${f * 100}%`}
                    </button>
                  ))}
                  {['1', '5', '10'].map((v) => (
                    <button key={v} onClick={() => setAmountText(v)} className="rounded-full border border-line px-3 py-1 text-sm hover:border-brand-400">
                      ${v}
                    </button>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}

          {method && (
            <Card>
              <CardHeader title="3. Your details" description="Encrypted at rest. Only shown masked after saving." />
              <CardBody className="space-y-4">
                {savedForMethod.length > 0 && (
                  <div className="space-y-2">
                    {savedForMethod.map((d) => (
                      <label key={d.id} className={cn('flex cursor-pointer items-center gap-3 rounded-xl border p-3', destId === d.id ? 'border-brand-500' : 'border-line')}>
                        <input type="radio" checked={destId === d.id} onChange={() => setDestId(d.id)} className="accent-emerald-600" />
                        <span className="flex-1 text-sm font-medium">{d.masked}</span>
                        {d.lastUsedAt && <span className="text-xs text-muted">used <TimeAgo iso={d.lastUsedAt} /></span>}
                        <button
                          type="button"
                          aria-label="Remove saved destination"
                          onClick={async (e) => {
                            e.preventDefault();
                            await api(`/payouts/destinations/${d.id}`, { method: 'DELETE' });
                            await qc.invalidateQueries({ queryKey: qk.destinations });
                          }}
                          className="rounded-md p-1 text-subtle hover:text-rose-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </label>
                    ))}
                    <label className={cn('flex cursor-pointer items-center gap-3 rounded-xl border p-3', destId === 'new' ? 'border-brand-500' : 'border-line')}>
                      <input type="radio" checked={destId === 'new'} onChange={() => setDestId('new')} className="accent-emerald-600" />
                      <span className="text-sm font-medium">Use a different one</span>
                    </label>
                  </div>
                )}
                {destId === 'new' && (
                  <div className="space-y-4">
                    {method.fields.map((f) => (
                      <Field key={f.key} label={f.label} hint={f.hint} error={fieldError?.field === f.key ? fieldError.message : null}>
                        {f.type === 'select' ? (
                          <Select value={fields[f.key] ?? ''} onChange={(e) => setFields((x) => ({ ...x, [f.key]: e.target.value }))}>
                            <option value="" disabled>
                              Choose…
                            </option>
                            {f.options?.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <Input type={f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : 'text'} placeholder={f.placeholder} value={fields[f.key] ?? ''} onChange={(e) => setFields((x) => ({ ...x, [f.key]: e.target.value }))} invalid={fieldError?.field === f.key} autoComplete="off" />
                        )}
                      </Field>
                    ))}
                    <Checkbox checked={save} onChange={setSave} label="Save for one-tap cash outs next time" />
                    {fieldError && !fieldError.field && <Alert tone="danger">{fieldError.message}</Alert>}
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card className="lg:sticky lg:top-24">
            <CardHeader title="Summary" />
            <CardBody className="space-y-4">
              {quote && method ? (
                <>
                  <KeyValue
                    items={[
                      ['Amount', formatMoney(quote.amountMicros)],
                      [`${method.name} fee`, quote.feeMicros ? `−${formatMoney(quote.feeMicros)}` : 'Free'],
                      [
                        'You receive',
                        <span key="net" className="text-base font-bold text-brand-700 dark:text-brand-400">
                          {formatMoney(quote.netMicros)}
                          {quote.localCurrency && quote.fxRate ? <span className="block text-xs font-medium text-muted">≈ {formatLocal(quote.netMicros, quote.fxRate, quote.localCurrency)}</span> : null}
                        </span>,
                      ],
                      ['Arrives', quote.etaLabel],
                    ]}
                  />
                  {quote.localCurrency && <p className="text-xs text-muted">Rate locked when you confirm. Indicative mid-market rate, with no hidden FX markup.</p>}
                  {quote.problems.map((p) => (
                    <Alert key={p} tone="warning">
                      {p}
                    </Alert>
                  ))}
                  {unmet.length > 0 && (
                    <div className="rounded-2xl border border-line p-4">
                      <p className="text-sm font-semibold">Before your cash out</p>
                      <ul className="mt-2 space-y-2">
                        {quote.requirements.map((r) => (
                          <li key={r.id} className="flex items-center gap-2 text-sm">
                            {r.met ? <CheckCircle2 className="h-4 w-4 text-brand-600" /> : <Circle className="h-4 w-4 text-subtle" />}
                            <span className={cn('flex-1', r.met && 'text-muted line-through')}>{r.label}</span>
                            {!r.met && r.id === 'phone_verified' && (
                              <button onClick={() => setPhoneOpen(true)} className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
                                Verify now
                              </button>
                            )}
                            {!r.met && r.id !== 'phone_verified' && r.action && (
                              <Link href={r.action} className="inline-flex items-center text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
                                Fix <ChevronRight className="h-3 w-3" />
                              </Link>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <Button size="lg" className="w-full" disabled={!quote.canSubmit || quoting} loading={submitting} onClick={submit}>
                    Cash out {formatMoney(quote.netMicros)}
                  </Button>
                  <p className="flex items-start gap-1.5 text-xs text-muted">
                    {quote.willAutoApprove ? <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" /> : <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                    {quote.willAutoApprove ? 'Sent automatically — no review needed.' : 'Larger cash outs get a quick safety review (usually under 24h). We’ll notify you either way.'}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted">{available <= 0 ? 'Your available balance is $0.00 — complete an offer to get started.' : 'Pick a method and amount to see your exact fee.'}</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader title="Recent cash outs" icon={<Clock className="h-5 w-5" />} />
        <CardBody className="p-0 sm:p-0">
          {payouts && payouts.length === 0 ? (
            <EmptyState className="m-5" icon="💸" title="No cash outs yet" description="Your first one is one tap away — there’s no minimum." />
          ) : (
            <ul className="mt-3 divide-y divide-line border-t border-line">
              {payouts?.map((p) => (
                <li key={p.id}>
                  <Link href={`/app/cashout/${p.id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-surface-2 sm:px-6">
                    <span className="text-xl">{p.methodLogo}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {p.methodName} · {p.destinationMasked}
                      </p>
                      <p className="text-xs text-muted">
                        <TimeAgo iso={p.createdAt} />
                        {p.durationSeconds !== null && <> · arrived in {formatDuration(p.durationSeconds)}</>}
                      </p>
                    </div>
                    <Money micros={p.netMicros} className="text-sm font-bold" />
                    <PayoutStatusBadge status={p.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      {/* Mobile: keep the confirm action within thumb reach, above the bottom navigation. */}
      {quote && method && (
        <div className="fixed inset-x-0 bottom-[calc(57px+env(safe-area-inset-bottom))] z-20 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur-xl lg:hidden">
          <div className="mx-auto flex max-w-md items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted">You receive</p>
              <p className="tabular truncate font-bold text-brand-700 dark:text-brand-400">
                {formatMoney(quote.netMicros)}{' '}
                <span className="text-xs font-normal text-muted">
                  {quote.localCurrency && quote.fxRate ? `≈ ${formatLocal(quote.netMicros, quote.fxRate, quote.localCurrency)} · ` : ''}via {method.name}
                </span>
              </p>
            </div>
            <Button disabled={!quote.canSubmit || quoting} loading={submitting} onClick={submit}>
              Cash out
            </Button>
          </div>
        </div>
      )}
      <PhoneVerifyModal open={phoneOpen} onClose={() => setPhoneOpen(false)} />
    </div>
  );
}
