import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { applyBps, floorToCents, formatMoney, TIER_BY_ID } from '@cashads/shared';
import { withUow, type AppContext, type Uow } from '../../context';
import { claims, ledgerEntries, networks, offerClicks, offers, postbacks, transactions, users } from '../../db/schema';
import { clock, DAY, HOUR } from '../../lib/clock';
import { notFound, badRequest } from '../../lib/errors';
import { addSignal } from '../fraud/service';
import { notify } from '../notifications/service';
import { onEarned } from '../rewards/earned';
import { creditUser, holdHoursFor, reverseCredit } from '../rewards/service';
import { acct, postEntry } from '../wallet/ledger';
import { isUuid, toCanonical, verifySignature, type CanonicalPostback } from './adapters';

type NetworkRow = typeof networks.$inferSelect;

export interface IncomingPostback {
  networkId: string;
  method: string;
  params: Record<string, string>;
  fullUrl: string;
  headers: Record<string, string | string[] | undefined>;
  ip: string | null;
}

export interface PostbackResult {
  httpStatus: number;
  body: string;
  status: string;
  reason?: string;
  postbackId?: string;
}

interface Outcome {
  status: 'credited' | 'held' | 'duplicate' | 'rejected' | 'reversed' | 'needs_review';
  reason?: string;
  userId?: string;
  offerId?: string;
  clickId?: string;
  goalId?: string;
  payoutMicros?: number;
  userAmountMicros?: number;
  transactionId?: string;
}

function respond(o: Outcome): { httpStatus: number; body: string } {
  // 200 for everything the partner can't fix by retrying; "1" = accepted.
  if (o.status === 'rejected') return { httpStatus: 200, body: '0' };
  return { httpStatus: 200, body: '1' };
}

function redactRaw(input: IncomingPostback) {
  const headers: Record<string, string> = {};
  for (const k of ['user-agent', 'content-type', 'x-forwarded-for']) {
    const v = input.headers[k];
    if (typeof v === 'string') headers[k] = v.slice(0, 300);
  }
  return { method: input.method, params: input.params, url: input.fullUrl.slice(0, 2000), headers };
}

/** Entry point for every partner callback (server-to-server). */
export async function handlePostback(ctx: AppContext, input: IncomingPostback): Promise<PostbackResult> {
  const [network] = await ctx.db.select().from(networks).where(eq(networks.id, input.networkId));
  if (!network) return { httpStatus: 404, body: 'unknown network', status: 'rejected', reason: 'unknown_network' };

  const log = async (status: 'rejected' | 'error', reason: string, signatureValid: boolean, extra: Partial<typeof postbacks.$inferInsert> = {}) => {
    const [row] = await ctx.db
      .insert(postbacks)
      .values({
        networkId: network.id,
        externalTxId: input.params[network.paramMap.txId] ?? null,
        status,
        statusReason: reason,
        signatureValid,
        ip: input.ip,
        method: input.method,
        raw: redactRaw(input),
        processedAt: clock.now(),
        createdAt: clock.now(),
        ...extra,
      })
      .returning({ id: postbacks.id });
    return row.id;
  };

  if (network.status !== 'active') {
    const id = await log('rejected', 'network_disabled', false);
    return { httpStatus: 403, body: 'network disabled', status: 'rejected', reason: 'network_disabled', postbackId: id };
  }
  if (network.ipAllowlist.length > 0 && (!input.ip || !network.ipAllowlist.includes(input.ip))) {
    const id = await log('rejected', 'ip_not_allowed', false);
    return { httpStatus: 403, body: 'forbidden', status: 'rejected', reason: 'ip_not_allowed', postbackId: id };
  }
  const secret = network.secretEnc ? ctx.vault.decrypt(network.secretEnc) : null;
  if (!verifySignature(network, secret, input.params, { fullUrl: input.fullUrl, headers: input.headers, ip: input.ip })) {
    const id = await log('rejected', 'invalid_signature', false);
    ctx.log.warn({ networkId: network.id, ip: input.ip }, 'postback rejected: invalid signature');
    return { httpStatus: 403, body: 'invalid signature', status: 'rejected', reason: 'invalid_signature', postbackId: id };
  }
  const canonical = toCanonical(network, input.params);
  if ('error' in canonical) {
    const id = await log('rejected', `malformed: ${canonical.error}`, true);
    return { httpStatus: 400, body: canonical.error, status: 'rejected', reason: 'malformed', postbackId: id };
  }
  const dedupeKey = `${network.id}:${canonical.kind}:${canonical.txId}`;

  try {
    return await withUow(ctx, async (uow) => {
      const inserted = await uow.tx
        .insert(postbacks)
        .values({
          networkId: network.id,
          externalTxId: canonical.txId,
          dedupeKey,
          kind: canonical.kind,
          signatureValid: true,
          status: 'received',
          ip: input.ip,
          method: input.method,
          raw: redactRaw(input),
          createdAt: clock.now(),
        })
        .onConflictDoNothing({ target: postbacks.dedupeKey })
        .returning({ id: postbacks.id });
      if (!inserted.length) {
        const [orig] = await uow.tx.select({ id: postbacks.id }).from(postbacks).where(eq(postbacks.dedupeKey, dedupeKey));
        const [dup] = await uow.tx
          .insert(postbacks)
          .values({
            networkId: network.id,
            externalTxId: canonical.txId,
            kind: canonical.kind,
            signatureValid: true,
            status: 'duplicate',
            statusReason: `retry of ${orig?.id ?? 'earlier postback'} — ignored`,
            ip: input.ip,
            method: input.method,
            raw: redactRaw(input),
            processedAt: clock.now(),
            createdAt: clock.now(),
          })
          .returning({ id: postbacks.id });
        return { httpStatus: 200, body: '1', status: 'duplicate', reason: 'duplicate_postback', postbackId: dup.id };
      }
      const postbackId = inserted[0].id;
      const outcome = await processCanonical(uow, network, canonical, postbackId, { force: false });
      await saveOutcome(uow, postbackId, outcome);
      return { ...respond(outcome), status: outcome.status, reason: outcome.reason, postbackId };
    });
  } catch (err) {
    ctx.log.error({ err, networkId: network.id }, 'postback processing error');
    const id = await log('error', err instanceof Error ? err.message.slice(0, 300) : 'processing error', true, {
      externalTxId: canonical.txId,
      kind: canonical.kind,
    });
    // 500 → the partner will retry; the error row can also be replayed by staff or by a missing-credit claim.
    return { httpStatus: 500, body: 'error', status: 'error', postbackId: id };
  }
}

async function saveOutcome(uow: Uow, postbackId: string, o: Outcome) {
  await uow.tx
    .update(postbacks)
    .set({
      status: o.status,
      statusReason: o.reason ?? null,
      userId: o.userId ?? null,
      offerId: o.offerId ?? null,
      clickId: o.clickId ?? null,
      goalId: o.goalId ?? null,
      payoutMicros: o.payoutMicros ?? null,
      userAmountMicros: o.userAmountMicros ?? null,
      transactionId: o.transactionId ?? null,
      processedAt: clock.now(),
    })
    .where(eq(postbacks.id, postbackId));
}

async function processCanonical(uow: Uow, network: NetworkRow, c: CanonicalPostback, postbackId: string, opts: { force: boolean }): Promise<Outcome> {
  if (c.kind === 'reversal') return processReversal(uow, network, c);
  const { tx, ctx } = uow;
  const settings = ctx.settings.get();
  const now = clock.now();

  let click: typeof offerClicks.$inferSelect | undefined;
  let offer: typeof offers.$inferSelect | undefined;
  if (isUuid(c.clickId)) [click] = await tx.select().from(offerClicks).where(eq(offerClicks.id, c.clickId));
  if (!click && c.offerExternalId && isUuid(c.userId)) {
    [offer] = await tx.select().from(offers).where(and(eq(offers.networkId, network.id), eq(offers.externalId, c.offerExternalId)));
    if (offer) {
      [click] = await tx
        .select()
        .from(offerClicks)
        .where(and(eq(offerClicks.userId, c.userId), eq(offerClicks.offerId, offer.id)))
        .orderBy(desc(offerClicks.startedAt))
        .limit(1);
    }
  }
  if (click && !offer) [offer] = await tx.select().from(offers).where(eq(offers.id, click.offerId));
  if (click && offer && offer.networkId !== network.id) return { status: 'rejected', reason: 'click_belongs_to_other_network', clickId: click.id };
  if (click && isUuid(c.userId) && c.userId !== click.userId) return { status: 'rejected', reason: 'user_mismatch', clickId: click.id };

  const userId = click?.userId ?? (isUuid(c.userId) ? c.userId : undefined);
  if (!userId) return { status: 'rejected', reason: 'unknown_click_or_user' };
  const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
  if (!user) return { status: 'rejected', reason: 'unknown_user' };
  if (user.status === 'deleted') return { status: 'rejected', reason: 'account_deleted', userId };
  if (user.status === 'banned') return { status: 'rejected', reason: 'account_banned', userId };

  const shareBps = network.revenueShareBps ?? settings.revenueShareBps;
  let base: number;
  let bonus: number;
  let gross: number;
  let goal: (typeof offerClicks.$inferSelect)['goalsSnapshot'][number] | undefined;
  let idempotencyKey: string;
  let description: string;

  if (click && offer) {
    if (offer.goals.length > 0) {
      goal = click.goalsSnapshot.find((g) => g.id === c.goalId) ?? (click.goalsSnapshot.length === 1 && !c.goalId ? click.goalsSnapshot[0] : undefined);
      if (!goal) return { status: 'rejected', reason: `unknown_goal:${c.goalId ?? 'none'}`, userId, clickId: click.id, offerId: offer.id };
      base = goal.baseMicros;
      bonus = goal.bonusMicros;
      gross = c.payoutMicros ?? goal.partnerPayoutMicros;
    } else {
      // Price lock: the member gets exactly what they saw when they started.
      base = click.baseUserPayoutMicros;
      bonus = click.tierBonusMicros;
      gross = c.payoutMicros ?? click.partnerPayoutMicros;
    }
    idempotencyKey = `conv:${click.id}:${goal?.id ?? 'main'}`;
    description = goal ? `${offer.title} — ${goal.label}` : offer.title;

    // Already credited? (e.g. we paid a missing-credit claim before the partner's signal arrived)
    const [prior] = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.idempotencyKey, idempotencyKey));
    if (prior) {
      const [priorTx] = prior.transactionId ? await tx.select().from(transactions).where(eq(transactions.id, prior.transactionId)) : [];
      if (priorTx?.type === 'goodwill') {
        // We fronted the money from goodwill; the partner has now paid — recover it in the books.
        await postEntry(tx, {
          kind: 'goodwill_recovery',
          idempotencyKey: `recovery:${click.id}:${goal?.id ?? 'main'}`,
          transactionId: priorTx.id,
          memo: `Partner confirmed ${description}`,
          postings: [
            { account: acct.network(network.id), amount: -gross },
            { account: acct.goodwill, amount: priorTx.amountMicros },
            { account: acct.revenue, amount: gross - priorTx.amountMicros },
          ],
        });
        return { status: 'duplicate', reason: 'recovered_goodwill_credit', userId, clickId: click.id, offerId: offer.id, transactionId: priorTx.id, payoutMicros: gross };
      }
      return { status: 'duplicate', reason: 'conversion_already_credited', userId, clickId: click.id, offerId: offer.id, transactionId: priorTx?.id };
    }

    if (!opts.force && now.getTime() - click.startedAt.getTime() > offer.conversionWindowHours * HOUR) {
      return { status: 'needs_review', reason: 'outside_conversion_window', userId, clickId: click.id, offerId: offer.id, goalId: goal?.id, payoutMicros: gross };
    }
    const minutes = (now.getTime() - click.startedAt.getTime()) / 60_000;
    if (offer.estimatedMinutes >= 3 && minutes < offer.estimatedMinutes * 0.2) {
      await addSignal(uow, userId, 'fast_completion', { offerId: offer.id, minutes: Math.round(minutes * 10) / 10, expected: offer.estimatedMinutes });
    }
  } else {
    // Iframe-offerwall style networks: no click on our side, the partner tells us user + payout.
    if (c.payoutMicros === undefined) return { status: 'rejected', reason: 'missing_payout', userId };
    gross = c.payoutMicros;
    base = applyBps(gross, shareBps);
    bonus = floorToCents(applyBps(base, TIER_BY_ID[user.tier].bonusBps));
    idempotencyKey = `conv:${network.id}:${c.txId}`;
    description = c.offerName ? `${c.offerName} (${network.name})` : `${network.name} offer`;
  }

  const [freshUser] = await tx.select({ riskLevel: users.riskLevel, status: users.status }).from(users).where(eq(users.id, userId));
  const total = base + bonus;
  let holdHours = holdHoursFor(settings, { offerHoldHours: offer?.holdHours ?? null, amount: total, tier: user.tier, riskLevel: freshUser.riskLevel });
  const heldForReview = freshUser.riskLevel === 'high' || freshUser.status === 'restricted';
  if (heldForReview) holdHours = Math.max(holdHours, 30 * 24);
  const holdUntil = holdHours > 0 ? new Date(now.getTime() + holdHours * HOUR) : null;

  const credit = await creditUser(uow, {
    userId,
    type: 'offer',
    description,
    idempotencyKey,
    amountMicros: base,
    bonusMicros: bonus,
    source: { account: acct.network(network.id), grossMicros: gross },
    holdUntil,
    referenceType: click ? 'click' : 'postback',
    referenceId: click?.id ?? postbackId,
    meta: { offerId: offer?.id ?? null, goalId: goal?.id ?? null, networkId: network.id, postbackId, category: offer?.category ?? null },
    earning: true,
  });

  if (click && offer) {
    const allGoalsDone =
      offer.goals.length === 0 ||
      (await (async () => {
        const credited = await tx
          .select({ goalId: postbacks.goalId })
          .from(postbacks)
          .where(and(eq(postbacks.clickId, click!.id), inArray(postbacks.status, ['credited', 'held'])));
        const ids = new Set(credited.map((p) => p.goalId));
        if (goal) ids.add(goal.id);
        return click!.goalsSnapshot.every((g) => ids.has(g.id));
      })());
    const firstCredit = click.status !== 'credited';
    await tx
      .update(offerClicks)
      .set({ status: allGoalsDone ? 'credited' : click.status === 'started' ? 'completed' : click.status, creditedAt: click.creditedAt ?? now })
      .where(eq(offerClicks.id, click.id));
    if (firstCredit && allGoalsDone) await tx.update(offers).set({ completions: sql`${offers.completions} + 1` }).where(eq(offers.id, offer.id));

    // A claim was open for this click? The partner's signal settles it.
    const [openClaim] = await tx
      .select()
      .from(claims)
      .where(and(eq(claims.clickId, click.id), inArray(claims.status, ['submitted', 'in_review'])));
    if (openClaim) {
      await tx
        .update(claims)
        .set({
          status: 'approved',
          resolution: 'The partner’s confirmation arrived and you’ve been credited.',
          transactionId: credit.transactionId,
          resolvedAt: now,
          timeline: [...openClaim.timeline, { label: 'Partner confirmed — credited', at: now.toISOString() }],
          updatedAt: now,
        })
        .where(eq(claims.id, openClaim.id));
      uow.afterCommit(() => uow.ctx.bus.publishToUser(userId, { type: 'claim', claimId: openClaim.id, status: 'approved' }));
    }
  }

  await onEarned(uow, userId, { kind: 'offer', baseMicros: base });
  await notify(uow, userId, {
    type: 'credit',
    title: `You earned ${formatMoney(total)}`,
    body: holdUntil
      ? `${description} — ${heldForReview ? 'held while your account is reviewed' : `in a ${holdHours}h safety hold, then it’s yours`}.`
      : `${description} — available to cash out now.`,
    link: '/app/wallet',
  });

  return {
    status: heldForReview ? 'held' : 'credited',
    reason: holdUntil ? `hold_${holdHours}h` : undefined,
    userId,
    offerId: offer?.id,
    clickId: click?.id,
    goalId: goal?.id,
    payoutMicros: gross,
    userAmountMicros: total,
    transactionId: credit.transactionId,
  };
}

async function processReversal(uow: Uow, network: NetworkRow, c: CanonicalPostback): Promise<Outcome> {
  const { tx } = uow;
  const [original] = await tx
    .select()
    .from(postbacks)
    .where(eq(postbacks.dedupeKey, `${network.id}:credit:${c.txId}`));
  if (!original?.transactionId) return { status: 'rejected', reason: 'unknown_original_conversion' };
  const res = await reverseCredit(
    uow,
    original.transactionId,
    'The partner reported this conversion as invalid (for example a duplicate or unverified sign-up).',
  );
  await tx.update(postbacks).set({ status: 'reversed' }).where(eq(postbacks.id, original.id));
  if (original.clickId) await tx.update(offerClicks).set({ status: 'reversed' }).where(eq(offerClicks.id, original.clickId));
  return {
    status: res.reversed ? 'reversed' : 'duplicate',
    reason: res.reversed ? (res.lossMicros ? `loss_absorbed:${res.lossMicros}` : undefined) : 'already_reversed',
    userId: original.userId ?? undefined,
    offerId: original.offerId ?? undefined,
    clickId: original.clickId ?? undefined,
    transactionId: original.transactionId,
  };
}

/** Re-run a logged postback through the pipeline (staff replay / claim auto-check). */
export async function replayPostback(ctx: AppContext, postbackId: string, opts: { force: boolean }): Promise<PostbackResult> {
  const [row] = await ctx.db.select().from(postbacks).where(eq(postbacks.id, postbackId));
  if (!row) throw notFound('Postback not found');
  if (!row.signatureValid) throw badRequest('Postbacks with an invalid signature can never be replayed', 'invalid_signature');
  if (!['error', 'rejected', 'needs_review', 'received'].includes(row.status)) throw badRequest(`Nothing to replay — status is ${row.status}`, 'not_replayable');
  const [network] = await ctx.db.select().from(networks).where(eq(networks.id, row.networkId));
  if (!network) throw notFound('Network not found');
  const params = ((row.raw as { params?: Record<string, string> }).params ?? {}) as Record<string, string>;
  const canonical = toCanonical(network, params);
  if ('error' in canonical) throw badRequest(`Cannot parse postback: ${canonical.error}`);
  const dedupeKey = `${network.id}:${canonical.kind}:${canonical.txId}`;
  return withUow(ctx, async (uow) => {
    const [holder] = await uow.tx.select({ id: postbacks.id }).from(postbacks).where(eq(postbacks.dedupeKey, dedupeKey));
    if (holder && holder.id !== row.id) {
      const [h] = await uow.tx.select().from(postbacks).where(eq(postbacks.id, holder.id));
      if (h && !['error', 'rejected', 'needs_review', 'received'].includes(h.status)) {
        await uow.tx
          .update(postbacks)
          .set({ status: 'duplicate', statusReason: `already processed as ${holder.id}`, replays: row.replays + 1, processedAt: clock.now() })
          .where(eq(postbacks.id, row.id));
        return { httpStatus: 200, body: '1', status: 'duplicate', postbackId: row.id };
      }
      await uow.tx.update(postbacks).set({ dedupeKey: null }).where(eq(postbacks.id, holder.id));
    }
    await uow.tx.update(postbacks).set({ dedupeKey, replays: row.replays + 1 }).where(eq(postbacks.id, row.id));
    const outcome = await processCanonical(uow, network, canonical, row.id, opts);
    await saveOutcome(uow, row.id, outcome);
    return { ...respond(outcome), status: outcome.status, reason: outcome.reason, postbackId: row.id };
  });
}

export async function postbackStats(ctx: AppContext, days = 30) {
  const since = new Date(clock.ms() - days * DAY);
  const [row] = await ctx.db
    .select({
      total: sql<number>`count(*) filter (where ${postbacks.signatureValid} and ${postbacks.status} <> 'duplicate')::int`,
      credited: sql<number>`count(*) filter (where ${postbacks.status} in ('credited','held','reversed'))::int`,
      errors: sql<number>`count(*) filter (where ${postbacks.status} = 'error')::int`,
      rejected: sql<number>`count(*) filter (where ${postbacks.status} = 'rejected')::int`,
      invalidSig: sql<number>`count(*) filter (where ${postbacks.statusReason} = 'invalid_signature')::int`,
      duplicates: sql<number>`count(*) filter (where ${postbacks.status} = 'duplicate')::int`,
      review: sql<number>`count(*) filter (where ${postbacks.status} = 'needs_review')::int`,
    })
    .from(postbacks)
    .where(sql`${postbacks.createdAt} >= ${since}`);
  const total = Number(row.total);
  return {
    total,
    credited: Number(row.credited),
    errors: Number(row.errors),
    rejected: Number(row.rejected),
    invalidSignature: Number(row.invalidSig),
    duplicates: Number(row.duplicates),
    needsReview: Number(row.review),
    successRate:
      Number(row.credited) + Number(row.errors) + Number(row.review) > 0
        ? Number(row.credited) / (Number(row.credited) + Number(row.errors) + Number(row.review))
        : null,
  };
}
