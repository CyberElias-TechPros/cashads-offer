import { and, asc, desc, eq, gte, inArray, isNull, ne, notInArray, sql } from 'drizzle-orm';
import {
  type DestinationDTO,
  FRAUD_SIGNAL_LABELS,
  type PayoutCreateInput,
  type PayoutDTO,
  type PayoutMethod,
  type PayoutMethodDTO,
  type PayoutQuoteDTO,
  type PayoutRequirementDTO,
  computeFee,
  formatUsd,
  getPayoutMethod,
  getTier,
  isWholeCents,
  payoutMethodsForCountry,
} from '@lucrum/shared';
import type { AppContext } from '../../context';
import type { DbOrTx } from '../../db/client';
import { fraudFlags, payoutDestinations, payoutEvents, payouts, users } from '../../db/schema';
import type { UserRow } from '../../http/auth';
import { blindIndex, decrypt, encrypt } from '../../lib/crypto';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { maskEmail, maskTail } from '../../lib/net';
import { DAY, HOUR, MINUTE } from '../../lib/time';
import { checkSecondFactor } from '../auth/service';
import { recordSignal } from '../fraud/service';
import { audit, notify } from '../platform/messaging';
import { SYS, getAvailableMicros, postTransaction, userAccountCode } from '../wallet/ledger';
import { bankName, providerFor } from './providers';

type PayoutRow = typeof payouts.$inferSelect;

const ACTIVE_STATUSES = ['pending', 'review', 'processing', 'completed'] as const;
export const RETRY_BACKOFF_MS = [MINUTE, 5 * MINUTE, 15 * MINUTE, HOUR, 3 * HOUR, 6 * HOUR];

/* ── methods & destination details ─────────────────────────────────────────── */

export function methodsForUser(ctx: AppContext, user: UserRow): PayoutMethodDTO[] {
  const fx = ctx.settings.get().fxRates;
  return payoutMethodsForCountry(user.country).map((m) => ({ ...m, fxRate: fx[m.currency] ?? 1 }));
}

function requireMethod(user: UserRow, methodId: string): PayoutMethod {
  const method = getPayoutMethod(methodId);
  if (!method || (method.countries !== 'global' && !method.countries.includes(user.country))) {
    throw badRequest('METHOD_UNAVAILABLE', 'That payout method isn’t available in your country');
  }
  return method;
}

export function validateDetails(method: PayoutMethod, raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const fields: Record<string, string> = {};
  for (const f of method.fields) {
    let v = (raw[f.key] ?? '').trim();
    if (f.type === 'tel' || f.key === 'accountNumber' || f.key === 'routingNumber')
      v = v.replace(/[\s-]/g, '');
    if (f.key === 'sortCode') v = v.replace(/-/g, '');
    if (!v) {
      fields[f.key] = `${f.label} is required`;
      continue;
    }
    if (f.type === 'select' && f.options && !f.options.some((o) => o.value === v))
      fields[f.key] = `Choose a valid ${f.label.toLowerCase()}`;
    if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) fields[f.key] = 'Enter a valid email';
    if (f.pattern && !new RegExp(f.pattern).test(v))
      fields[f.key] = f.patternMessage ?? `Invalid ${f.label.toLowerCase()}`;
    out[f.key] = v;
  }
  if (Object.keys(fields).length > 0)
    throw badRequest('INVALID_DETAILS', 'Please check your payout details', fields);
  return out;
}

export function maskDetails(method: PayoutMethod, d: Record<string, string>): string {
  switch (method.id) {
    case 'ng_bank':
      return `${bankName(d.bankCode)} ${maskTail(d.accountNumber ?? '')}`;
    case 'ng_airtime':
      return `${(d.network ?? '').toUpperCase()} ${maskTail(d.phone ?? '', 3)}`;
    case 'us_ach':
    case 'gb_fps':
      return `Account ${maskTail(d.accountNumber ?? '')}`;
    case 'usdt_polygon': {
      const a = d.address ?? '';
      return `${a.slice(0, 6)}…${a.slice(-4)}`;
    }
    default: {
      const v = d.email ?? d.phone ?? d.address ?? d.vpa ?? d.pixKey ?? d.shapId ?? Object.values(d)[0] ?? '';
      return v.includes('@') ? maskEmail(v) : maskTail(v);
    }
  }
}

function detailsHash(methodId: string, d: Record<string, string>): string {
  return blindIndex(
    `${methodId}|${Object.keys(d)
      .sort()
      .map((k) => `${k}=${d[k]}`)
      .join('&')}`,
  );
}

/* ── quotes & requirements ─────────────────────────────────────────────────── */

async function usageWindow(
  db: DbOrTx,
  userId: string,
): Promise<{ today: number; weekMicros: number; completedCount: number }> {
  const since24h = new Date(Date.now() - DAY);
  const since7d = new Date(Date.now() - 7 * DAY);
  const rows = await db
    .select({
      today: sql<number>`count(*) filter (where ${payouts.requestedAt} >= ${since24h})::int`,
      week: sql<string>`coalesce(sum(${payouts.amountMicros}) filter (where ${payouts.requestedAt} >= ${since7d}), 0)`,
      completed: sql<number>`count(*) filter (where ${payouts.status} = 'completed')::int`,
    })
    .from(payouts)
    .where(and(eq(payouts.userId, userId), inArray(payouts.status, [...ACTIVE_STATUSES])));
  return {
    today: rows[0]?.today ?? 0,
    weekMicros: Number(rows[0]?.week ?? 0),
    completedCount: rows[0]?.completed ?? 0,
  };
}

export async function buildQuote(
  ctx: AppContext,
  db: DbOrTx,
  user: UserRow,
  methodId: string,
  amountMicros: number,
): Promise<PayoutQuoteDTO> {
  const settings = ctx.settings.get();
  const method = requireMethod(user, methodId);
  const fee = computeFee(amountMicros, method);
  const net = amountMicros - fee;
  const fxRate = settings.fxRates[method.currency] ?? 1;
  const available = await getAvailableMicros(db, user.id);
  const usage = await usageWindow(db, user.id);
  const weeklyLimit = getTier(user.tier).weeklyPayoutLimitMicros;
  const blockers: string[] = [];

  if (!isWholeCents(amountMicros)) blockers.push('Cash-outs are in whole cents.');
  if (amountMicros < method.minMicros)
    blockers.push(
      `${method.provider} has a minimum of ${formatUsd(method.minMicros)} (that’s their floor, not ours).`,
    );
  if (amountMicros > method.maxMicros)
    blockers.push(`The maximum for ${method.name} is ${formatUsd(method.maxMicros)} per cash-out.`);
  if (net < 10_000)
    blockers.push(
      `After the ${formatUsd(fee)} provider fee you’d receive less than $0.01 — try a larger amount or another method.`,
    );
  if (user.balanceFrozen) blockers.push('Your balance is frozen while an appeal is reviewed.');

  const requirements: PayoutRequirementDTO[] = [
    { code: 'balance', label: `Balance covers ${formatUsd(amountMicros)}`, met: available >= amountMicros },
    { code: 'email', label: 'Email verified', met: Boolean(user.emailVerifiedAt), action: 'verify_email' },
  ];
  if (amountMicros > settings.phoneRequiredAboveMicros) {
    requirements.push({
      code: 'phone',
      label: `Phone verified (cash-outs above ${formatUsd(settings.phoneRequiredAboveMicros)})`,
      met: Boolean(user.phoneVerifiedAt),
      action: 'verify_phone',
    });
  }
  if (amountMicros > settings.kycThresholdMicros) {
    requirements.push({
      code: 'kyc',
      label: `ID verified (single cash-outs above ${formatUsd(settings.kycThresholdMicros)})`,
      met: user.kycStatus === 'verified',
      action: '/app/kyc',
    });
  }
  requirements.push({
    code: 'limits',
    label: `Within limits (${settings.payoutMaxPerDay}/day · ${formatUsd(weeklyLimit, { precision: 0 })}/week)`,
    met: usage.today < settings.payoutMaxPerDay && usage.weekMicros + amountMicros <= weeklyLimit,
  });
  if (user.totpEnabledAt) requirements.push({ code: 'totp', label: 'Authenticator code', met: true });
  if (user.status !== 'active')
    requirements.push({ code: 'account', label: 'Account in good standing', met: false });

  return {
    methodId,
    amountMicros,
    feeMicros: fee,
    netMicros: Math.max(0, net),
    localCurrency: method.currency,
    localAmount: Math.round((Math.max(0, net) / 1_000_000) * fxRate * 100) / 100,
    fxRate,
    etaSeconds: method.etaSeconds,
    speed: method.speed,
    requirements,
    blockers,
    ok: blockers.length === 0 && requirements.every((r) => r.met),
  };
}

/* ── destinations ──────────────────────────────────────────────────────────── */

export async function listDestinations(ctx: AppContext, user: UserRow): Promise<DestinationDTO[]> {
  const rows = await ctx.db
    .select()
    .from(payoutDestinations)
    .where(and(eq(payoutDestinations.userId, user.id), isNull(payoutDestinations.deletedAt)))
    .orderBy(desc(payoutDestinations.lastUsedAt), desc(payoutDestinations.createdAt));
  return rows.map((r) => ({
    id: r.id,
    methodId: r.methodId,
    label: r.label,
    masked: r.masked,
    verifiedName: r.verifiedName,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
  }));
}

export async function nameEnquiry(
  ctx: AppContext,
  user: UserRow,
  methodId: string,
  raw: Record<string, string>,
): Promise<{ name: string | null }> {
  const method = requireMethod(user, methodId);
  if (!method.supportsNameEnquiry) return { name: null };
  const details = validateDetails(method, raw);
  const name = await providerFor(ctx, methodId).nameEnquiry?.(ctx, methodId, details);
  if (!name)
    throw badRequest(
      'ACCOUNT_NOT_FOUND',
      'We couldn’t find that account. Double-check the bank and account number.',
      { accountNumber: 'Account not found' },
    );
  return { name };
}

export async function saveDestination(
  ctx: AppContext,
  db: DbOrTx,
  user: UserRow,
  methodId: string,
  raw: Record<string, string>,
  label?: string,
): Promise<typeof payoutDestinations.$inferSelect> {
  const method = requireMethod(user, methodId);
  const details = validateDetails(method, raw);
  const hash = detailsHash(methodId, details);
  const existing = await db
    .select()
    .from(payoutDestinations)
    .where(
      and(
        eq(payoutDestinations.userId, user.id),
        eq(payoutDestinations.detailsHash, hash),
        isNull(payoutDestinations.deletedAt),
      ),
    );
  if (existing[0]) return existing[0];
  const verifiedName = method.supportsNameEnquiry
    ? ((await providerFor(ctx, methodId).nameEnquiry?.(ctx, methodId, details)) ?? null)
    : null;
  const [row] = await db
    .insert(payoutDestinations)
    .values({
      userId: user.id,
      methodId,
      label: label || method.name,
      detailsEnc: encrypt(JSON.stringify(details)),
      detailsHash: hash,
      masked: maskDetails(method, details),
      verifiedName,
    })
    .returning();
  await checkSharedDestination(ctx, db, user.id, hash);
  return row!;
}

export async function deleteDestination(ctx: AppContext, user: UserRow, id: string): Promise<void> {
  await ctx.db
    .update(payoutDestinations)
    .set({ deletedAt: new Date() })
    .where(and(eq(payoutDestinations.id, id), eq(payoutDestinations.userId, user.id)));
}

async function checkSharedDestination(
  ctx: AppContext,
  db: DbOrTx,
  userId: string,
  hash: string,
): Promise<void> {
  const others = await db
    .select({ userId: payoutDestinations.userId })
    .from(payoutDestinations)
    .innerJoin(users, eq(users.id, payoutDestinations.userId))
    .where(
      and(
        eq(payoutDestinations.detailsHash, hash),
        ne(payoutDestinations.userId, userId),
        isNull(users.deletedAt),
      ),
    );
  if (others.length > 0)
    await recordSignal(ctx, db, userId, 'shared_payout_destination', {
      otherAccounts: [...new Set(others.map((o) => o.userId))].slice(0, 5),
    });
}

/* ── request ───────────────────────────────────────────────────────────────── */

export async function requestPayout(
  ctx: AppContext,
  user: UserRow,
  input: PayoutCreateInput,
): Promise<PayoutDTO> {
  const settings = ctx.settings.get();
  const method = requireMethod(user, input.methodId);

  const prior = await ctx.db
    .select()
    .from(payouts)
    .where(and(eq(payouts.userId, user.id), eq(payouts.idempotencyKey, input.idempotencyKey)));
  if (prior[0]) return getPayoutDTO(ctx, prior[0].id, user.id); // safe client retry

  if (user.totpEnabledAt) {
    if (!input.totpCode)
      throw new AppError(
        401,
        'TOTP_REQUIRED',
        'Enter the code from your authenticator app to confirm this cash-out.',
      );
    if (!(await checkSecondFactor(ctx, user, input.totpCode)))
      throw badRequest('INVALID_CODE', 'That authenticator code didn’t work.', { totpCode: 'Invalid code' });
  }

  const payoutId = await ctx.db.transaction(async (tx) => {
    // Lock the member's ledger account first: concurrent requests serialise here,
    // so balance and velocity checks below can't race each other.
    await tx.execute(sql`select id from ledger_accounts where code = ${userAccountCode(user.id)} for update`);
    const fresh = (await tx.select().from(users).where(eq(users.id, user.id)))[0]!;
    if (fresh.status !== 'active')
      throw forbidden(
        'Cash-outs are paused for your account. See your dashboard for details.',
        'ACCOUNT_RESTRICTED',
      );

    let details: Record<string, string>;
    let destinationId: string | null = null;
    let recipientName: string | null = null;
    if (input.destinationId) {
      const d = (
        await tx
          .select()
          .from(payoutDestinations)
          .where(
            and(
              eq(payoutDestinations.id, input.destinationId),
              eq(payoutDestinations.userId, user.id),
              isNull(payoutDestinations.deletedAt),
            ),
          )
      )[0];
      if (!d || d.methodId !== method.id)
        throw badRequest('INVALID_DESTINATION', 'Choose a saved destination for this method');
      details = JSON.parse(decrypt(d.detailsEnc)) as Record<string, string>;
      destinationId = d.id;
      recipientName = d.verifiedName;
      await tx
        .update(payoutDestinations)
        .set({ lastUsedAt: new Date() })
        .where(eq(payoutDestinations.id, d.id));
    } else if (input.details) {
      details = validateDetails(method, input.details);
      if (input.saveDestination) {
        const saved = await saveDestination(ctx, tx, fresh, method.id, details);
        destinationId = saved.id;
        recipientName = saved.verifiedName;
      } else {
        await checkSharedDestination(ctx, tx, user.id, detailsHash(method.id, details));
      }
    } else {
      throw badRequest('DESTINATION_REQUIRED', 'Tell us where to send the money');
    }

    const latest = (await tx.select().from(users).where(eq(users.id, user.id)))[0]!;
    const quote = await buildQuote(ctx, tx, latest, method.id, input.amountMicros);
    if (quote.blockers.length > 0) throw badRequest('PAYOUT_BLOCKED', quote.blockers[0]!);
    const unmet = quote.requirements.find((r) => !r.met);
    if (unmet) {
      const messages: Record<string, string> = {
        balance: 'Your available balance doesn’t cover this amount.',
        email: 'Confirm your email address to cash out.',
        phone: `Verify your phone number to cash out more than ${formatUsd(settings.phoneRequiredAboveMicros)}.`,
        kyc: `Verify your ID to cash out more than ${formatUsd(settings.kycThresholdMicros)} at once.`,
        limits: `You’ve reached your cash-out limit (${settings.payoutMaxPerDay} per day / weekly cap). Try again later.`,
        account: 'Your account isn’t in good standing.',
      };
      throw new AppError(
        400,
        `REQUIREMENT_${unmet.code.toUpperCase()}`,
        messages[unmet.code] ?? unmet.label,
        undefined,
        { action: unmet.action ?? null },
      );
    }

    // Risk routing: explainable reasons, shown to the member if held.
    const reviewReasons: string[] = [];
    if (latest.fraudScore > settings.autoApproveMaxFraudScore) {
      const flags = await tx
        .select()
        .from(fraudFlags)
        .where(and(eq(fraudFlags.userId, user.id), inArray(fraudFlags.status, ['open', 'confirmed'])));
      reviewReasons.push(...flags.map((f) => FRAUD_SIGNAL_LABELS[f.type] ?? f.type));
      if (reviewReasons.length === 0) reviewReasons.push('Account activity needs a quick check');
    }
    const ageMs = Date.now() - latest.createdAt.getTime();
    const usage = await usageWindow(tx, user.id);
    if (usage.completedCount === 0 && input.amountMicros > 20_000_000 && ageMs < DAY)
      reviewReasons.push('Larger first cash-out on a brand-new account');
    const status: PayoutRow['status'] = reviewReasons.length > 0 ? 'review' : 'pending';

    const [payout] = await tx
      .insert(payouts)
      .values({
        userId: user.id,
        methodId: method.id,
        destinationId,
        detailsEnc: encrypt(
          JSON.stringify({ ...details, ...(recipientName ? { __name: recipientName } : {}) }),
        ),
        detailsHash: detailsHash(method.id, details),
        destinationMasked: maskDetails(method, details),
        amountMicros: input.amountMicros,
        feeMicros: quote.feeMicros,
        netMicros: quote.netMicros,
        localCurrency: method.currency,
        fxRate: quote.fxRate,
        status,
        reviewReasons,
        idempotencyKey: input.idempotencyKey,
      })
      .returning();
    const posted = await postTransaction(tx, {
      type: 'payout_request',
      userId: user.id,
      idempotencyKey: `payout_request:${payout!.id}`,
      description: `Cash-out to ${method.name} · ${maskDetails(method, details)}`,
      referenceType: 'payout',
      referenceId: payout!.id,
      entries: [
        { account: userAccountCode(user.id), direction: 'debit', amount: input.amountMicros },
        { account: SYS.payoutClearing, direction: 'credit', amount: input.amountMicros },
      ],
    });
    await tx.update(payouts).set({ requestTxnId: posted.id }).where(eq(payouts.id, payout!.id));
    await addEvent(
      tx,
      payout!.id,
      'pending',
      `Requested ${formatUsd(input.amountMicros)} to ${method.name}. Fee ${formatUsd(quote.feeMicros)} · you receive ${formatUsd(quote.netMicros)}.`,
      'user',
    );
    if (status === 'review') {
      await addEvent(
        tx,
        payout!.id,
        'review',
        `Quick safety review: ${reviewReasons.join('; ')}. We’ll finish within 24 hours.`,
      );
    } else {
      await ctx.jobs.enqueue(
        tx,
        'payout.process',
        { payoutId: payout!.id },
        { dedupeKey: `payout.process:${payout!.id}:1` },
      );
    }
    return payout!.id;
  });

  ctx.events.toUser(user.id, 'balance', { reason: 'payout_request' });
  return getPayoutDTO(ctx, payoutId, user.id);
}

async function addEvent(
  db: DbOrTx,
  payoutId: string,
  status: string,
  message: string,
  actor = 'system',
): Promise<void> {
  await db.insert(payoutEvents).values({ payoutId, status, message, actor });
}

/* ── processing (worker) ───────────────────────────────────────────────────── */

function loadDetails(p: PayoutRow): { details: Record<string, string>; name: string | null } {
  const all = JSON.parse(decrypt(p.detailsEnc)) as Record<string, string>;
  const { __name, ...details } = all;
  return { details, name: __name ?? null };
}

export async function processPayout(ctx: AppContext, payoutId: string): Promise<void> {
  const claimed = await ctx.db.transaction(async (tx) => {
    const rows = await tx.select().from(payouts).where(eq(payouts.id, payoutId)).for('update');
    const p = rows[0];
    if (!p || (p.status !== 'pending' && p.status !== 'processing')) return null;
    const method = getPayoutMethod(p.methodId)!;
    const [updated] = await tx
      .update(payouts)
      .set({
        status: 'processing',
        attempts: p.attempts + 1,
        processingAt: p.processingAt ?? new Date(),
        nextAttemptAt: null,
        updatedAt: new Date(),
      })
      .where(eq(payouts.id, payoutId))
      .returning();
    if (p.attempts === 0) await addEvent(tx, payoutId, 'processing', `Sent to ${method.provider}.`);
    return updated!;
  });
  if (!claimed) return;
  ctx.events.toUser(claimed.userId, 'payout', { payoutId, status: 'processing' });

  const method = getPayoutMethod(claimed.methodId)!;
  const provider = providerFor(ctx, claimed.methodId);
  const { details, name } = loadDetails(claimed);
  const input = {
    payoutId,
    reference: `lucrum_${payoutId}`,
    methodId: claimed.methodId,
    netMicros: claimed.netMicros,
    localCurrency: claimed.localCurrency,
    localAmount: Math.round((claimed.netMicros / 1_000_000) * claimed.fxRate * 100) / 100,
    details,
    recipientName: name,
  };
  let result;
  try {
    result = await provider.send(ctx, input);
  } catch (err) {
    result = {
      status: 'failed' as const,
      retryable: true,
      error: err instanceof Error ? err.message : 'Provider error',
    };
  }
  await applyProviderResult(ctx, claimed, method, result);
}

export async function pollPayout(ctx: AppContext, payoutId: string): Promise<void> {
  const p = (await ctx.db.select().from(payouts).where(eq(payouts.id, payoutId)))[0];
  if (!p || p.status !== 'processing' || !p.providerReference) return;
  const provider = providerFor(ctx, p.methodId);
  const { details, name } = loadDetails(p);
  const result = provider.poll
    ? await provider.poll(ctx, p.providerReference, {
        payoutId,
        reference: `lucrum_${payoutId}`,
        methodId: p.methodId,
        netMicros: p.netMicros,
        localCurrency: p.localCurrency,
        localAmount: 0,
        details,
        recipientName: name,
      })
    : ({ status: 'completed', reference: p.providerReference } as const);
  await applyProviderResult(ctx, p, getPayoutMethod(p.methodId)!, result);
}

async function applyProviderResult(
  ctx: AppContext,
  p: PayoutRow,
  method: PayoutMethod,
  result: Awaited<ReturnType<ReturnType<typeof providerFor>['send']>>,
): Promise<void> {
  if (result.status === 'completed') {
    const done = await ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .update(payouts)
        .set({
          status: 'completed',
          completedAt: new Date(),
          providerReference: result.reference,
          updatedAt: new Date(),
        })
        .where(and(eq(payouts.id, p.id), eq(payouts.status, 'processing')))
        .returning();
      if (!row) return null;
      const posted = await postTransaction(tx, {
        type: 'payout_complete',
        userId: p.userId,
        idempotencyKey: `payout_complete:${p.id}`,
        description: `Cash-out settled via ${method.provider}`,
        referenceType: 'payout',
        referenceId: p.id,
        entries: [
          { account: SYS.payoutClearing, direction: 'debit', amount: p.amountMicros },
          { account: SYS.cash, direction: 'credit', amount: p.amountMicros },
        ],
      });
      await tx.update(payouts).set({ finalTxnId: posted.id }).where(eq(payouts.id, p.id));
      const secs = Math.round((Date.now() - p.requestedAt.getTime()) / 1000);
      await addEvent(
        tx,
        p.id,
        'completed',
        `Paid ✓ ${formatUsd(p.netMicros)} sent to ${p.destinationMasked} in ${humanDuration(secs)}. Reference ${result.reference}.`,
      );
      await notify(ctx, tx, p.userId, {
        type: 'payout_completed',
        title: `💸 ${formatUsd(p.netMicros)} sent to ${method.name}`,
        body: `Your cash-out to ${p.destinationMasked} is complete (${humanDuration(secs)}). Reference: ${result.reference}.`,
        link: `/app/payouts/${p.id}`,
        email: { category: 'payouts', subject: 'You got paid!' },
      });
      await ctx.jobs.enqueue(tx, 'engagement.achievements', { userId: p.userId });
      return row;
    });
    if (done) {
      ctx.events.toUser(p.userId, 'payout', { payoutId: p.id, status: 'completed' });
      const feed = await feedItemFor(ctx, p.id);
      if (feed) ctx.events.broadcast('feed.payout', feed);
    }
    return;
  }

  if (result.status === 'processing') {
    await ctx.db
      .update(payouts)
      .set({ providerReference: result.reference, updatedAt: new Date() })
      .where(eq(payouts.id, p.id));
    await addEvent(
      ctx.db,
      p.id,
      'processing',
      `${method.provider} accepted the transfer — waiting for final confirmation from the banking network.`,
    );
    await ctx.jobs.enqueue(
      ctx.db,
      'payout.poll',
      { payoutId: p.id },
      { delayMs: result.pollAfterMs, dedupeKey: `payout.poll:${p.id}:${Date.now()}` },
    );
    return;
  }

  const attempts =
    (await ctx.db.select({ attempts: payouts.attempts }).from(payouts).where(eq(payouts.id, p.id)))[0]
      ?.attempts ?? p.attempts;
  if (result.retryable && attempts < RETRY_BACKOFF_MS.length) {
    const delay = RETRY_BACKOFF_MS[attempts - 1] ?? HOUR;
    const at = new Date(Date.now() + delay);
    await ctx.db
      .update(payouts)
      .set({ nextAttemptAt: at, statusReason: result.error, updatedAt: new Date() })
      .where(eq(payouts.id, p.id));
    await addEvent(
      ctx.db,
      p.id,
      'processing',
      `${result.error}. We’ll retry automatically at ${at.toUTCString().slice(17, 22)} UTC (attempt ${attempts + 1} of ${RETRY_BACKOFF_MS.length}). No action needed.`,
    );
    if (attempts === 1) {
      await notify(ctx, ctx.db, p.userId, {
        type: 'payout_delayed',
        title: `${method.provider} is having issues — we’re on it`,
        body: `Your ${formatUsd(p.netMicros)} cash-out is safe. We’ll retry automatically and tell you the moment it lands. If it can’t go through, the full amount returns to your balance.`,
        link: `/app/payouts/${p.id}`,
        email: { category: 'payouts' },
      });
    }
    await ctx.jobs.enqueue(
      ctx.db,
      'payout.process',
      { payoutId: p.id },
      { runAt: at, dedupeKey: `payout.process:${p.id}:${attempts + 1}` },
    );
    ctx.events.toUser(p.userId, 'payout', { payoutId: p.id, status: 'processing' });
    return;
  }
  await failAndRefund(ctx, p.id, result.error);
}

export async function failAndRefund(ctx: AppContext, payoutId: string, reason: string): Promise<void> {
  const userId = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(payouts)
      .set({ status: 'failed', statusReason: reason, nextAttemptAt: null, updatedAt: new Date() })
      .where(and(eq(payouts.id, payoutId), inArray(payouts.status, ['pending', 'processing', 'review'])))
      .returning();
    if (!row) return null;
    await refund(
      tx,
      row,
      'payout_refund',
      `Cash-out failed — ${formatUsd(row.amountMicros)} returned (incl. fee)`,
    );
    await addEvent(
      tx,
      payoutId,
      'failed',
      `${reason} The full ${formatUsd(row.amountMicros)} (including the fee) is back in your balance.`,
    );
    await notify(ctx, tx, row.userId, {
      type: 'payout_failed',
      title: 'Cash-out couldn’t be completed — refunded',
      body: `${reason} The full ${formatUsd(row.amountMicros)} is back in your balance.`,
      link: `/app/payouts/${payoutId}`,
      email: { category: 'payouts' },
    });
    return row.userId;
  });
  if (userId) {
    ctx.events.toUser(userId, 'payout', { payoutId, status: 'failed' });
    ctx.events.toUser(userId, 'balance', { reason: 'payout_refund' });
  }
}

async function refund(tx: DbOrTx, p: PayoutRow, type: 'payout_refund', description: string): Promise<void> {
  const posted = await postTransaction(tx, {
    type,
    userId: p.userId,
    idempotencyKey: `payout_refund:${p.id}`,
    description,
    referenceType: 'payout',
    referenceId: p.id,
    entries: [
      { account: SYS.payoutClearing, direction: 'debit', amount: p.amountMicros },
      { account: userAccountCode(p.userId), direction: 'credit', amount: p.amountMicros },
    ],
  });
  await tx.update(payouts).set({ finalTxnId: posted.id }).where(eq(payouts.id, p.id));
}

/* ── member & staff actions ────────────────────────────────────────────────── */

export async function cancelPayout(ctx: AppContext, user: UserRow, payoutId: string): Promise<PayoutDTO> {
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(payouts)
      .set({ status: 'cancelled', statusReason: 'Cancelled by you', updatedAt: new Date() })
      .where(
        and(
          eq(payouts.id, payoutId),
          eq(payouts.userId, user.id),
          inArray(payouts.status, ['pending', 'review']),
        ),
      )
      .returning();
    if (!row)
      throw conflict('NOT_CANCELLABLE', 'This cash-out is already being sent and can’t be cancelled.');
    await refund(tx, row, 'payout_refund', 'Cash-out cancelled — funds returned');
    await addEvent(tx, payoutId, 'cancelled', 'Cancelled. Funds returned to your balance.', 'user');
  });
  ctx.events.toUser(user.id, 'balance', { reason: 'payout_cancel' });
  return getPayoutDTO(ctx, payoutId, user.id);
}

export async function approvePayout(
  ctx: AppContext,
  payoutId: string,
  actorId: string,
  ip: string,
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(payouts)
      .set({ status: 'pending', updatedAt: new Date() })
      .where(and(eq(payouts.id, payoutId), eq(payouts.status, 'review')))
      .returning();
    if (!row) throw conflict('NOT_IN_REVIEW', 'Only payouts under review can be approved');
    await addEvent(tx, payoutId, 'pending', 'Review complete — approved. Sending now.', `admin:${actorId}`);
    await audit(tx, { actorId, action: 'payout.approve', targetType: 'payout', targetId: payoutId, ip });
    await ctx.jobs.enqueue(
      tx,
      'payout.process',
      { payoutId },
      { dedupeKey: `payout.process:${payoutId}:approved` },
    );
  });
}

export async function rejectPayout(
  ctx: AppContext,
  payoutId: string,
  reason: string,
  refundFunds: boolean,
  actorId: string,
  ip: string,
): Promise<void> {
  const userId = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(payouts)
      .set({ status: 'reversed', statusReason: reason, updatedAt: new Date() })
      .where(and(eq(payouts.id, payoutId), inArray(payouts.status, ['review', 'pending'])))
      .returning();
    if (!row) throw conflict('NOT_REJECTABLE', 'Only payouts under review or pending can be rejected');
    if (refundFunds) {
      await refund(tx, row, 'payout_refund', 'Cash-out declined after review — funds returned');
    } else {
      // Confirmed fraud only: funds move to recovery instead of back to the member.
      const posted = await postTransaction(tx, {
        type: 'clawback',
        userId: row.userId,
        idempotencyKey: `payout_forfeit:${row.id}`,
        description: 'Cash-out declined — fraudulent earnings withheld',
        referenceType: 'payout',
        referenceId: row.id,
        entries: [
          { account: SYS.payoutClearing, direction: 'debit', amount: row.amountMicros },
          { account: SYS.fraudRecovery, direction: 'credit', amount: row.amountMicros },
        ],
      });
      await tx.update(payouts).set({ finalTxnId: posted.id }).where(eq(payouts.id, row.id));
    }
    await addEvent(
      tx,
      payoutId,
      'reversed',
      `Declined after review: ${reason}${refundFunds ? ' Funds returned to your balance.' : ''}`,
      `admin:${actorId}`,
    );
    await audit(tx, {
      actorId,
      action: 'payout.reject',
      targetType: 'payout',
      targetId: payoutId,
      after: { reason, refundFunds },
      ip,
    });
    await notify(ctx, tx, row.userId, {
      type: 'payout_rejected',
      title: 'Cash-out declined after review',
      body: `${reason}${refundFunds ? ' The full amount is back in your balance.' : ''} You can reply to support if you disagree.`,
      link: `/app/payouts/${payoutId}`,
      email: { category: 'payouts' },
    });
    return row.userId;
  });
  ctx.events.toUser(userId, 'balance', { reason: 'payout_reject' });
}

export async function retryNow(ctx: AppContext, payoutId: string, actorId: string): Promise<void> {
  const p = (await ctx.db.select().from(payouts).where(eq(payouts.id, payoutId)))[0];
  if (!p || p.status !== 'processing')
    throw conflict('NOT_RETRYABLE', 'Only payouts waiting for a retry can be retried');
  await addEvent(ctx.db, payoutId, 'processing', 'Retry triggered by our payments team.', `admin:${actorId}`);
  await ctx.jobs.enqueue(
    ctx.db,
    'payout.process',
    { payoutId },
    { dedupeKey: `payout.process:${payoutId}:manual:${Date.now()}` },
  );
}

/* ── reads ─────────────────────────────────────────────────────────────────── */

export function humanDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86_400)}d ${Math.floor((seconds % 86_400) / 3600)}h`;
}

export async function getPayoutDTO(ctx: AppContext, payoutId: string, userId?: string): Promise<PayoutDTO> {
  const rows = await ctx.db
    .select()
    .from(payouts)
    .where(userId ? and(eq(payouts.id, payoutId), eq(payouts.userId, userId)) : eq(payouts.id, payoutId));
  const p = rows[0];
  if (!p) throw notFound('Cash-out');
  const events = await ctx.db
    .select()
    .from(payoutEvents)
    .where(eq(payoutEvents.payoutId, payoutId))
    .orderBy(asc(payoutEvents.createdAt));
  return toPayoutDTO(p, events);
}

export function toPayoutDTO(p: PayoutRow, events: (typeof payoutEvents.$inferSelect)[] = []): PayoutDTO {
  const method = getPayoutMethod(p.methodId);
  return {
    id: p.id,
    methodId: p.methodId,
    methodName: method?.name ?? p.methodId,
    methodIcon: method?.icon ?? '💸',
    destinationMasked: p.destinationMasked,
    amountMicros: p.amountMicros,
    feeMicros: p.feeMicros,
    netMicros: p.netMicros,
    localCurrency: p.localCurrency,
    localAmount: Math.round((p.netMicros / 1_000_000) * p.fxRate * 100) / 100,
    status: p.status,
    statusReason: p.statusReason,
    attempts: p.attempts,
    nextAttemptAt: p.nextAttemptAt?.toISOString() ?? null,
    providerReference: p.providerReference,
    requestedAt: p.requestedAt.toISOString(),
    completedAt: p.completedAt?.toISOString() ?? null,
    durationSeconds: p.completedAt
      ? Math.round((p.completedAt.getTime() - p.requestedAt.getTime()) / 1000)
      : null,
    canCancel: p.status === 'pending' || p.status === 'review',
    events: events.map((e) => ({ status: e.status, message: e.message, at: e.createdAt.toISOString() })),
  };
}

export async function listPayouts(ctx: AppContext, userId: string): Promise<PayoutDTO[]> {
  const rows = await ctx.db
    .select()
    .from(payouts)
    .where(eq(payouts.userId, userId))
    .orderBy(desc(payouts.requestedAt))
    .limit(50);
  return rows.map((r) => toPayoutDTO(r));
}

/** Public, anonymised feed item for a completed payout ("never fake proof"). */
export async function feedItemFor(ctx: AppContext, payoutId: string) {
  const { publicFeed } = await import('../transparency/service');
  const items = await publicFeed(ctx, 50);
  return items.find((i) => i.id === payoutId) ?? null;
}
