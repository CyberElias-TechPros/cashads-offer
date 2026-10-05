import crypto from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import {
  computeFee,
  formatDuration,
  formatMoney,
  PAYOUT_STATUS_META,
  type PayoutDestinationDTO,
  type PayoutDTO,
  type PayoutMethodDTO,
  type PayoutQuoteDTO,
  type PayoutRequestInput,
  type PayoutRequirement,
  type PayoutStatus,
} from '@cashads/shared';
import { withUow, type AppContext, type Uow } from '../../context';
import type { Q } from '../../db/client';
import { fxRates, payoutDestinations, payoutEvents, payoutMethods, payouts, transactions, users, wallets } from '../../db/schema';
import { enqueue, PermanentJobError } from '../../jobs/queue';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { clock, DAY } from '../../lib/clock';
import { maskEmail, maskMiddle, maskPhone, maskTail, publicName } from '../../lib/mask';
import { checkAchievements } from '../engagement/service';
import { checkPayoutDestination } from '../fraud/service';
import { notify } from '../notifications/service';
import { templates } from '../notifications/templates';
import { publishWallet } from '../rewards/service';
import { acct, bumpLifetime, lockWallet, postEntry } from '../wallet/ledger';
import { ProviderError, providerFor } from './providers';

type UserRow = typeof users.$inferSelect;
type MethodRow = typeof payoutMethods.$inferSelect;
type PayoutRow = typeof payouts.$inferSelect;

const ACTIVE_STATUSES: PayoutStatus[] = ['pending', 'review', 'processing', 'completed'];

/* ---------------------------------------------------------------- methods */

async function fxMap(q: Q) {
  const rows = await q.select().from(fxRates);
  return new Map(rows.map((r) => [r.currency, r.ratePerUsd]));
}

function methodAvailable(m: MethodRow, country: string) {
  return m.status === 'active' && (m.countries.length === 0 || m.countries.includes(country));
}

export async function methodMedianSeconds(q: Q): Promise<Map<string, number>> {
  const since = new Date(clock.ms() - 30 * DAY);
  const rows = await q
    .select({
      methodId: payouts.methodId,
      median: sql<number>`percentile_cont(0.5) within group (order by extract(epoch from (${payouts.completedAt} - ${payouts.createdAt})))`,
    })
    .from(payouts)
    .where(and(eq(payouts.status, 'completed'), gte(payouts.completedAt, since)))
    .groupBy(payouts.methodId);
  return new Map(rows.map((r) => [r.methodId, Math.round(Number(r.median))]));
}

export function toMethodDTO(m: MethodRow, fx: Map<string, number>, medians: Map<string, number>): PayoutMethodDTO {
  return {
    id: m.id,
    name: m.name,
    kind: m.kind,
    description: m.description,
    minMicros: m.minMicros,
    maxMicros: m.maxMicros,
    feeFixedMicros: m.feeFixedMicros,
    feeBps: m.feeBps,
    etaLabel: m.etaLabel,
    medianSeconds: medians.get(m.id) ?? null,
    fields: m.fields,
    localCurrency: m.currency,
    fxRate: m.currency ? (fx.get(m.currency) ?? null) : null,
    countries: m.countries,
    logo: m.logo,
  };
}

export async function listMethods(ctx: AppContext, country: string): Promise<PayoutMethodDTO[]> {
  const [rows, fx, medians] = await Promise.all([
    ctx.db.select().from(payoutMethods).orderBy(asc(payoutMethods.sortOrder)),
    fxMap(ctx.db),
    methodMedianSeconds(ctx.db),
  ]);
  return rows.filter((m) => methodAvailable(m, country)).map((m) => toMethodDTO(m, fx, medians));
}

/* ------------------------------------------------------------ destinations */

function validateDestination(method: MethodRow, input: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of method.fields) {
    let v = (input[f.key] ?? '').trim();
    if (!v) throw badRequest(`${f.label} is required`, 'invalid_destination', { field: f.key });
    if (f.type === 'email') {
      v = v.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) throw badRequest(`${f.label} doesn’t look like an email address`, 'invalid_destination', { field: f.key });
    }
    if (f.type === 'select' && f.options && !f.options.some((o) => o.value === v)) {
      throw badRequest(`Pick a valid option for ${f.label}`, 'invalid_destination', { field: f.key });
    }
    if (f.pattern && !new RegExp(f.pattern).test(v)) {
      throw badRequest(`${f.label} doesn’t look right${f.hint ? ` — ${f.hint}` : ''}`, 'invalid_destination', { field: f.key });
    }
    out[f.key] = v;
  }
  return out;
}

/** The value that identifies who actually receives the money (used for cross-account duplicate detection). */
function identityOf(d: Record<string, string>): string {
  if (d.email) return d.email;
  if (d.address) return d.address;
  if (d.phone) return d.phone;
  if (d.vpa) return d.vpa;
  if (d.pixKey) return d.pixKey;
  if (d.accountNumber) return `${d.bankCode ?? d.routingNumber ?? ''}:${d.accountNumber}`;
  if (d.charity) return d.charity;
  return JSON.stringify(d);
}

function maskOf(method: MethodRow, d: Record<string, string>): string {
  switch (method.kind) {
    case 'paypal':
    case 'wise':
      return maskEmail(d.email);
    case 'giftcard':
      return `${d.region ? `${d.region} · ` : ''}${maskEmail(d.email)}`;
    case 'crypto':
      return maskMiddle(d.address);
    case 'bank': {
      const bank = method.fields.find((f) => f.key === 'bankCode')?.options?.find((o) => o.value === d.bankCode)?.label;
      return `${bank ?? 'Bank'} ${maskTail(d.accountNumber)}`;
    }
    case 'mobile_money':
      return d.phone ? maskPhone(d.phone) : d.vpa ? maskMiddle(d.vpa, 3, 6) : maskMiddle(d.pixKey ?? '', 3, 4);
    case 'charity':
      return method.fields.find((f) => f.key === 'charity')?.options?.find((o) => o.value === d.charity)?.label ?? d.charity;
    default:
      return '••••';
  }
}

export async function listDestinations(ctx: AppContext, userId: string): Promise<PayoutDestinationDTO[]> {
  const rows = await ctx.db
    .select()
    .from(payoutDestinations)
    .where(and(eq(payoutDestinations.userId, userId), isNull(payoutDestinations.deletedAt)))
    .orderBy(desc(payoutDestinations.lastUsedAt));
  return rows.map((r) => ({ id: r.id, methodId: r.methodId, masked: r.masked, label: r.label, lastUsedAt: r.lastUsedAt?.toISOString() ?? null }));
}

export async function deleteDestination(ctx: AppContext, userId: string, id: string) {
  await ctx.db
    .update(payoutDestinations)
    .set({ deletedAt: clock.now() })
    .where(and(eq(payoutDestinations.id, id), eq(payoutDestinations.userId, userId)));
}

/* ------------------------------------------------------------------ quote */

export function payoutRequirements(user: UserRow, lifetimeWithdrawn: number, amount: number, s: ReturnType<AppContext['settings']['get']>): PayoutRequirement[] {
  const reqs: PayoutRequirement[] = [
    { id: 'account_active', label: 'Account in good standing', met: user.status === 'active', action: '/app/settings/health' },
    { id: 'email_verified', label: 'Verify your email', met: !!user.emailVerifiedAt, action: '/app/settings/verification' },
  ];
  if (s.requirePhoneForPayout) reqs.push({ id: 'phone_verified', label: 'Verify your phone (one-time)', met: !!user.phoneVerifiedAt, action: '/app/settings/verification' });
  const needsKyc = amount >= s.kycSinglePayoutMicros || lifetimeWithdrawn + amount >= s.kycLifetimeMicros;
  if (needsKyc) {
    reqs.push({
      id: 'kyc',
      label: `Verify your identity (required above ${formatMoney(s.kycSinglePayoutMicros)})`,
      met: user.kycStatus === 'verified',
      action: '/app/settings/verification',
    });
  }
  return reqs;
}

export async function quotePayout(ctx: AppContext, user: UserRow, methodId: string, amount: number, q: Q = ctx.db): Promise<PayoutQuoteDTO & { method: MethodRow }> {
  const s = ctx.settings.get();
  const [method] = await q.select().from(payoutMethods).where(eq(payoutMethods.id, methodId));
  if (!method || !methodAvailable(method, user.country)) throw badRequest('This payout method isn’t available in your country', 'method_unavailable');
  const [w] = await q.select().from(wallets).where(eq(wallets.userId, user.id));
  const fee = computeFee(amount, method.feeFixedMicros, method.feeBps);
  const net = amount - fee;
  const problems: string[] = [];
  if (amount < method.minMicros) problems.push(`The smallest ${method.name} cash out is ${formatMoney(method.minMicros)} (a provider limit, not ours).`);
  if (amount > method.maxMicros) problems.push(`The largest single ${method.name} cash out is ${formatMoney(method.maxMicros)}.`);
  if (amount > (w?.availableMicros ?? 0)) problems.push(`You have ${formatMoney(w?.availableMicros ?? 0)} available.`);
  if (net <= 0) problems.push(`Amount must be more than the ${formatMoney(fee)} provider fee.`);

  const since = new Date(clock.ms() - DAY);
  const weekSince = new Date(clock.ms() - 7 * DAY);
  const [velocity] = await q
    .select({
      today: sql<number>`count(*) filter (where ${payouts.createdAt} >= ${since})::int`,
      week: sql<string>`coalesce(sum(${payouts.amountMicros}) filter (where ${payouts.createdAt} >= ${weekSince}), 0)`,
    })
    .from(payouts)
    .where(and(eq(payouts.userId, user.id), inArray(payouts.status, ACTIVE_STATUSES)));
  if (Number(velocity.today) >= s.maxPayoutsPerDay) problems.push(`You can cash out up to ${s.maxPayoutsPerDay} times per day. Try again tomorrow.`);
  if (Number(velocity.week) + amount > s.maxPayoutWeeklyMicros) {
    problems.push(`Weekly cash out limit is ${formatMoney(s.maxPayoutWeeklyMicros)} — ${formatMoney(Math.max(0, s.maxPayoutWeeklyMicros - Number(velocity.week)))} left this week.`);
  }

  const requirements = payoutRequirements(user, w?.lifetimeWithdrawnMicros ?? 0, amount, s);
  const fx = await fxMap(q);
  const rate = method.currency ? (fx.get(method.currency) ?? null) : null;
  return {
    method,
    methodId,
    amountMicros: amount,
    feeMicros: fee,
    netMicros: Math.max(0, net),
    localCurrency: method.currency,
    localAmount: rate ? Math.round((Math.max(0, net) / 1_000_000) * rate * 100) / 100 : null,
    fxRate: rate,
    requirements,
    problems,
    canSubmit: problems.length === 0 && requirements.every((r) => r.met),
    willAutoApprove: user.riskLevel === 'low' && amount <= s.autoApprovePayoutMaxMicros,
    etaLabel: method.etaLabel,
  };
}

/* ---------------------------------------------------------------- request */

async function addEvent(q: Q, payoutId: string, status: string, message: string) {
  await q.insert(payoutEvents).values({ payoutId, status, message, createdAt: clock.now() });
}

export async function requestPayout(uow: Uow, user: UserRow, input: PayoutRequestInput): Promise<PayoutDTO> {
  const { tx, ctx } = uow;
  const [existing] = await tx
    .select()
    .from(payouts)
    .where(and(eq(payouts.userId, user.id), eq(payouts.idempotencyKey, input.idempotencyKey)));
  if (existing) return payoutDTO(tx, existing);

  const [lockedUser] = await tx.select().from(users).where(eq(users.id, user.id)).for('update');
  const quote = await quotePayout(ctx, lockedUser, input.methodId, input.amountMicros, tx);
  if (quote.problems.length) throw badRequest(quote.problems[0], 'payout_invalid', { problems: quote.problems });
  const unmet = quote.requirements.filter((r) => !r.met);
  if (unmet.length) throw forbidden(unmet.map((r) => r.label).join(' · '), 'payout_requirements', { requirements: unmet });

  const method = quote.method;
  let destination: Record<string, string>;
  let destinationId: string | null = null;
  if (input.destinationId) {
    const [d] = await tx
      .select()
      .from(payoutDestinations)
      .where(and(eq(payoutDestinations.id, input.destinationId), eq(payoutDestinations.userId, user.id), isNull(payoutDestinations.deletedAt)));
    if (!d || d.methodId !== method.id) throw badRequest('Saved destination not found for this method', 'invalid_destination');
    destination = JSON.parse(ctx.vault.decrypt(d.dataEnc));
    destinationId = d.id;
  } else {
    destination = validateDestination(method, input.destination ?? {});
  }
  const masked = maskOf(method, destination);
  const hash = ctx.vault.fingerprint(`${method.kind}:${identityOf(destination)}`);
  const encrypted = ctx.vault.encrypt(JSON.stringify(destination));

  const w = await lockWallet(tx, user.id);
  if (w.availableMicros < input.amountMicros) throw conflict(`You have ${formatMoney(w.availableMicros)} available.`, 'insufficient_funds');

  const shared = method.kind === 'charity' ? false : await checkPayoutDestination(uow, user.id, hash);
  const [fresh] = await tx.select({ riskLevel: users.riskLevel, riskScore: users.riskScore }).from(users).where(eq(users.id, user.id));
  const s = ctx.settings.get();
  const needsReview = shared || fresh.riskLevel !== 'low' || input.amountMicros > s.autoApprovePayoutMaxMicros;
  const now = clock.now();
  const payoutId = crypto.randomUUID();

  if (!destinationId && input.saveDestination !== false) {
    const [dup] = await tx
      .select({ id: payoutDestinations.id })
      .from(payoutDestinations)
      .where(and(eq(payoutDestinations.userId, user.id), eq(payoutDestinations.hash, hash), isNull(payoutDestinations.deletedAt)));
    if (dup) destinationId = dup.id;
    else {
      const [d] = await tx
        .insert(payoutDestinations)
        .values({ userId: user.id, methodId: method.id, masked, hash, dataEnc: encrypted, lastUsedAt: now })
        .returning({ id: payoutDestinations.id });
      destinationId = d.id;
    }
  }
  if (destinationId) await tx.update(payoutDestinations).set({ lastUsedAt: now }).where(eq(payoutDestinations.id, destinationId));

  const [p] = await tx
    .insert(payouts)
    .values({
      id: payoutId,
      userId: user.id,
      methodId: method.id,
      destinationId,
      destinationMasked: masked,
      destinationHash: hash,
      destinationEnc: encrypted,
      amountMicros: input.amountMicros,
      feeMicros: quote.feeMicros,
      netMicros: quote.netMicros,
      localCurrency: quote.localCurrency,
      localAmount: quote.localAmount,
      fxRate: quote.fxRate,
      status: needsReview ? 'review' : 'pending',
      statusReason: needsReview ? 'Quick safety review' : null,
      riskScoreAtRequest: fresh.riskScore,
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
    })
    .returning();

  await postEntry(tx, {
    kind: 'payout_reserve',
    idempotencyKey: `payout:${payoutId}:reserve`,
    memo: `Reserve for payout ${payoutId}`,
    postings: [
      { account: acct.available(user.id), amount: -input.amountMicros },
      { account: acct.inTransit, amount: input.amountMicros },
    ],
  });
  await tx.insert(transactions).values({
    userId: user.id,
    type: 'payout',
    status: 'pending',
    amountMicros: -input.amountMicros,
    description: `Cash out to ${method.name} (${masked})`,
    referenceType: 'payout',
    referenceId: payoutId,
    meta: { feeMicros: quote.feeMicros, netMicros: quote.netMicros, methodId: method.id },
    createdAt: now,
  });
  await addEvent(tx, payoutId, 'requested', `Cash out requested — ${formatMoney(input.amountMicros)} reserved from your balance`);
  if (needsReview) {
    await addEvent(tx, payoutId, 'review', 'Quick safety review — we aim to finish within 24 hours. No action needed from you.');
    await notify(uow, user.id, {
      type: 'payout',
      title: `Your ${formatMoney(input.amountMicros)} cash out is in a quick review`,
      body: 'We aim to finish within 24 hours and will notify you either way.',
      link: `/app/cashout/${payoutId}`,
      email: { category: 'payouts', template: 'payout_review', content: templates.payoutReview(user.displayName, formatMoney(input.amountMicros), `${baseUrlOf(ctx)}/app/cashout/${payoutId}`) },
    });
  } else {
    await enqueue(tx, 'payout.process', { payoutId }, { dedupeKey: `payout:${payoutId}:process`, maxAttempts: 8 });
  }
  uow.afterCommit(() => {
    ctx.bus.publishToUser(user.id, { type: 'payout', payoutId, status: p.status });
    return publishWallet(uow, user.id);
  });
  return payoutDTO(tx, p);
}

function baseUrlOf(ctx: AppContext) {
  return ctx.config.PUBLIC_WEB_URL.replace(/\/$/, '');
}

/* ------------------------------------------------------------- processing */

export async function processPayout(ctx: AppContext, payoutId: string): Promise<void> {
  const claimed = await withUow(ctx, async (uow) => {
    const [p] = await uow.tx.select().from(payouts).where(eq(payouts.id, payoutId)).for('update');
    if (!p || p.status !== 'pending') return null;
    const [u] = await uow.tx.select().from(users).where(eq(users.id, p.userId));
    if (!u || u.status !== 'active' || u.riskLevel === 'high') {
      await uow.tx.update(payouts).set({ status: 'review', statusReason: 'Held for a quick safety review', updatedAt: clock.now() }).where(eq(payouts.id, p.id));
      await addEvent(uow.tx, p.id, 'review', 'Held for a quick safety review — we aim to finish within 24 hours.');
      return null;
    }
    const [method] = await uow.tx.select().from(payoutMethods).where(eq(payoutMethods.id, p.methodId));
    await uow.tx
      .update(payouts)
      .set({ status: 'processing', processingAt: clock.now(), attempts: p.attempts + 1, updatedAt: clock.now() })
      .where(eq(payouts.id, p.id));
    await addEvent(uow.tx, p.id, 'processing', `Sending to ${method.name}`);
    uow.afterCommit(() => ctx.bus.publishToUser(p.userId, { type: 'payout', payoutId: p.id, status: 'processing' }));
    return { p: { ...p, attempts: p.attempts + 1 }, method, destination: JSON.parse(ctx.vault.decrypt(p.destinationEnc)) as Record<string, string> };
  });
  if (!claimed) return;
  const { p, method, destination } = claimed;
  const provider = providerFor(ctx, method);
  try {
    const res = await provider.send({ payoutId: p.id, netMicros: p.netMicros, localAmount: p.localAmount, localCurrency: p.localCurrency, destination, method });
    if (res.status === 'completed') {
      await completePayout(ctx, p.id, res.reference);
    } else {
      await ctx.db.update(payouts).set({ providerReference: res.reference, updatedAt: clock.now() }).where(eq(payouts.id, p.id));
      await enqueue(ctx.db, 'payout.check', { payoutId: p.id }, { delayMs: 10_000, maxAttempts: 200 });
    }
  } catch (err) {
    const transient = err instanceof ProviderError ? err.transient : true;
    const message = err instanceof Error ? err.message : 'Provider error';
    if (transient && p.attempts < 6) {
      await withUow(ctx, async (uow) => {
        await uow.tx.update(payouts).set({ status: 'pending', statusReason: message, updatedAt: clock.now() }).where(eq(payouts.id, p.id));
        await addEvent(uow.tx, p.id, 'retrying', `${message} — we’ll retry automatically (attempt ${p.attempts + 1}). Your money is safe.`);
        if (p.attempts === 1) {
          await notify(uow, p.userId, {
            type: 'payout',
            title: `${method.name} is having issues`,
            body: `Your ${formatMoney(p.amountMicros)} cash out is queued and will retry automatically. No action needed.`,
            link: `/app/cashout/${p.id}`,
          });
        }
        uow.afterCommit(() => ctx.bus.publishToUser(p.userId, { type: 'payout', payoutId: p.id, status: 'pending' }));
      });
      throw err; // job retries with exponential backoff
    }
    await finalizeFailure(ctx, p.id, 'failed', message, null);
    if (!transient) throw new PermanentJobError(message);
  }
}

export async function checkPayout(ctx: AppContext, payoutId: string): Promise<void> {
  const [p] = await ctx.db.select().from(payouts).where(eq(payouts.id, payoutId));
  if (!p || p.status !== 'processing' || !p.providerReference) return;
  const [method] = await ctx.db.select().from(payoutMethods).where(eq(payoutMethods.id, p.methodId));
  const provider = providerFor(ctx, method);
  const status = provider.check ? await provider.check(p.providerReference) : 'completed';
  if (status === 'completed') await completePayout(ctx, p.id, p.providerReference);
  else if (status === 'failed') await finalizeFailure(ctx, p.id, 'failed', 'The provider returned the payment', null);
  else await enqueue(ctx.db, 'payout.check', { payoutId }, { delayMs: 15_000, maxAttempts: 200 });
}

export async function completePayout(ctx: AppContext, payoutId: string, reference: string) {
  await withUow(ctx, async (uow) => {
    const [p] = await uow.tx.select().from(payouts).where(eq(payouts.id, payoutId)).for('update');
    if (!p || p.status !== 'processing') return;
    const now = clock.now();
    await postEntry(uow.tx, {
      kind: 'payout_complete',
      idempotencyKey: `payout:${p.id}:complete`,
      memo: `Paid via ${p.methodId} (${reference})`,
      postings: [
        { account: acct.inTransit, amount: -p.amountMicros },
        { account: acct.paidOut, amount: p.netMicros },
        { account: acct.fees, amount: p.feeMicros },
      ],
    });
    await uow.tx.update(payouts).set({ status: 'completed', completedAt: now, providerReference: reference, statusReason: null, updatedAt: now }).where(eq(payouts.id, p.id));
    await uow.tx
      .update(transactions)
      .set({ status: 'completed', settledAt: now })
      .where(and(eq(transactions.referenceType, 'payout'), eq(transactions.referenceId, p.id)));
    await bumpLifetime(uow.tx, p.userId, { withdrawn: p.amountMicros });
    const duration = Math.round((now.getTime() - p.createdAt.getTime()) / 1000);
    await addEvent(uow.tx, p.id, 'completed', `Paid ${formatMoney(p.netMicros)} — took ${formatDuration(duration)}`);
    const [[u], [method]] = await Promise.all([
      uow.tx.select().from(users).where(eq(users.id, p.userId)),
      uow.tx.select().from(payoutMethods).where(eq(payoutMethods.id, p.methodId)),
    ]);
    await notify(uow, p.userId, {
      type: 'payout',
      title: `You got paid ${formatMoney(p.netMicros)} 🎉`,
      body: `Sent to ${method.name} (${p.destinationMasked}) in ${formatDuration(duration)}.`,
      link: `/app/cashout/${p.id}`,
      email: {
        category: 'payouts',
        template: 'payout_completed',
        content: templates.payoutCompleted(u.displayName, formatMoney(p.netMicros), method.name, formatDuration(duration), `${baseUrlOf(ctx)}/app/cashout/${p.id}`),
      },
    });
    await checkAchievements(uow, p.userId);
    uow.afterCommit(() => {
      ctx.bus.publishToUser(p.userId, { type: 'payout', payoutId: p.id, status: 'completed' });
      ctx.bus.publishPublic({
        type: 'payout',
        item: {
          id: p.id,
          name: publicName(u.displayName),
          country: u.country,
          methodName: method.name,
          methodLogo: method.logo,
          amountMicros: p.netMicros,
          durationSeconds: duration,
          at: now.toISOString(),
        },
      });
    });
  });
}

/** Failed / rejected / canceled → full refund (fee included) back to available. */
export async function finalizeFailure(ctx: AppContext, payoutId: string, status: 'failed' | 'rejected' | 'canceled', reason: string, actorId: string | null) {
  return withUow(ctx, async (uow) => {
    const [p] = await uow.tx.select().from(payouts).where(eq(payouts.id, payoutId)).for('update');
    if (!p || PAYOUT_STATUS_META[p.status].final) return null;
    const now = clock.now();
    await postEntry(uow.tx, {
      kind: 'payout_refund',
      idempotencyKey: `payout:${p.id}:refund`,
      memo: `${status}: ${reason}`,
      postings: [
        { account: acct.inTransit, amount: -p.amountMicros },
        { account: acct.available(p.userId), amount: p.amountMicros },
      ],
    });
    await uow.tx.update(payouts).set({ status, statusReason: reason, failedAt: now, reviewedById: actorId, updatedAt: now }).where(eq(payouts.id, p.id));
    await uow.tx
      .update(transactions)
      .set({ status: 'canceled', settledAt: now, meta: sql`${transactions.meta} || ${JSON.stringify({ refundReason: reason })}::jsonb` })
      .where(and(eq(transactions.referenceType, 'payout'), eq(transactions.referenceId, p.id)));
    const label = status === 'canceled' ? 'Canceled by you' : status === 'rejected' ? `Not approved: ${reason}` : `Couldn’t send: ${reason}`;
    await addEvent(uow.tx, p.id, status, `${label} — ${formatMoney(p.amountMicros)} refunded to your balance`);
    if (status !== 'canceled') {
      const [u] = await uow.tx.select().from(users).where(eq(users.id, p.userId));
      await notify(uow, p.userId, {
        type: 'payout',
        title: `Cash out ${status === 'rejected' ? 'not approved' : 'couldn’t be sent'} — refunded`,
        body: `${reason}. ${formatMoney(p.amountMicros)} is back in your balance.`,
        link: `/app/cashout/${p.id}`,
        email: { category: 'transactional', template: 'payout_failed', content: templates.payoutFailed(u.displayName, formatMoney(p.amountMicros), reason, `${baseUrlOf(ctx)}/app/cashout`) },
      });
    }
    uow.afterCommit(() => {
      ctx.bus.publishToUser(p.userId, { type: 'payout', payoutId: p.id, status });
      return publishWallet(uow, p.userId);
    });
    return p;
  });
}

export async function cancelPayout(ctx: AppContext, userId: string, payoutId: string) {
  const [p] = await ctx.db.select().from(payouts).where(and(eq(payouts.id, payoutId), eq(payouts.userId, userId)));
  if (!p) throw notFound('Cash out not found');
  if (p.status !== 'pending' && p.status !== 'review') throw conflict('This cash out is already being sent and can’t be canceled', 'not_cancelable');
  await finalizeFailure(ctx, payoutId, 'canceled', 'Canceled by you', null);
}

export async function approvePayout(ctx: AppContext, payoutId: string, actorId: string) {
  return withUow(ctx, async (uow) => {
    const [p] = await uow.tx.select().from(payouts).where(eq(payouts.id, payoutId)).for('update');
    if (!p) throw notFound();
    if (p.status !== 'review') throw conflict(`Payout is ${p.status}, not in review`);
    await uow.tx.update(payouts).set({ status: 'pending', statusReason: null, reviewedById: actorId, updatedAt: clock.now() }).where(eq(payouts.id, p.id));
    await addEvent(uow.tx, p.id, 'pending', 'Approved by our team — sending now');
    await enqueue(uow.tx, 'payout.process', { payoutId: p.id }, { dedupeKey: `payout:${p.id}:process:${Date.now()}`, maxAttempts: 8 });
    uow.afterCommit(() => ctx.bus.publishToUser(p.userId, { type: 'payout', payoutId: p.id, status: 'pending' }));
    return p;
  });
}

/* -------------------------------------------------------------------- DTO */

export async function payoutDTO(q: Q, p: PayoutRow): Promise<PayoutDTO> {
  const [[method], events] = await Promise.all([
    q.select().from(payoutMethods).where(eq(payoutMethods.id, p.methodId)),
    q.select().from(payoutEvents).where(eq(payoutEvents.payoutId, p.id)).orderBy(asc(payoutEvents.createdAt)),
  ]);
  return {
    id: p.id,
    methodId: p.methodId,
    methodName: method?.name ?? p.methodId,
    methodLogo: method?.logo ?? '💸',
    kind: method?.kind ?? 'paypal',
    amountMicros: p.amountMicros,
    feeMicros: p.feeMicros,
    netMicros: p.netMicros,
    localCurrency: p.localCurrency,
    localAmount: p.localAmount,
    destinationMasked: p.destinationMasked,
    status: p.status,
    statusReason: p.statusReason,
    providerReference: p.providerReference,
    createdAt: p.createdAt.toISOString(),
    completedAt: p.completedAt?.toISOString() ?? null,
    durationSeconds: p.completedAt ? Math.round((p.completedAt.getTime() - p.createdAt.getTime()) / 1000) : null,
    timeline: events.map((e) => ({ status: e.status as PayoutDTO['timeline'][number]['status'], message: e.message, at: e.createdAt.toISOString() })),
    canCancel: p.status === 'pending' || p.status === 'review',
  };
}

export async function listPayouts(ctx: AppContext, userId: string): Promise<PayoutDTO[]> {
  const rows = await ctx.db.select().from(payouts).where(eq(payouts.userId, userId)).orderBy(desc(payouts.createdAt)).limit(100);
  return Promise.all(rows.map((p) => payoutDTO(ctx.db, p)));
}

export async function getPayout(ctx: AppContext, userId: string, payoutId: string): Promise<PayoutDTO> {
  const [p] = await ctx.db.select().from(payouts).where(and(eq(payouts.id, payoutId), eq(payouts.userId, userId)));
  if (!p) throw notFound('Cash out not found');
  return payoutDTO(ctx.db, p);
}

