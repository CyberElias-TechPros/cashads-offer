import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { type ClaimDTO, formatUsd, getTier } from '@lucrum/shared';
import type { AppContext } from '../../context';
import type { DbOrTx } from '../../db/client';
import { claimEvents, claims, networks, offerClicks, offers, postbackLogs, users } from '../../db/schema';
import type { UserRow } from '../../http/auth';
import { AppError, conflict, notFound } from '../../lib/errors';
import { DAY, HOUR, MINUTE } from '../../lib/time';
import { recordSignal } from '../fraud/service';
import { getAdapter } from '../networks/adapters';
import { refreshOfferStats } from '../offers/service';
import { notify } from '../platform/messaging';
import { creditConversion, creditGoodwill, userPayoutFor } from '../rewards/service';

/**
 * Missing Credit — "we pay even when tracking fails" (spec pain points #2 and #19).
 *
 * Resolution ladder, fully automatic until the last step:
 *   1. Our own postback logs — did the network tell us and something failed on our side?
 *   2. The network's conversion API — ask them directly using our click id.
 *   3. Goodwill — trusted members (tier limit, fraud score low, monthly cap) are paid
 *      instantly from Lucrum' budget; we chase the network afterwards.
 *   4. A human, with a visible SLA. If we miss the SLA, small claims auto-approve.
 */

const CLAIM_WINDOW = 30 * DAY;

async function addEvent(db: DbOrTx, claimId: string, type: string, message: string): Promise<void> {
  await db.insert(claimEvents).values({ claimId, type, message });
}

export async function createClaim(
  ctx: AppContext,
  user: UserRow,
  input: { clickId: string; completedAt?: string | undefined; note: string },
  opts: { autoFiled?: boolean } = {},
): Promise<string> {
  const settings = ctx.settings.get();
  const claimId = await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .select({ click: offerClicks, offer: offers })
      .from(offerClicks)
      .innerJoin(offers, eq(offers.id, offerClicks.offerId))
      .where(and(eq(offerClicks.id, input.clickId), eq(offerClicks.userId, user.id)))
      .for('update', { of: offerClicks });
    const row = rows[0];
    if (!row) throw notFound('Task');
    const { click, offer } = row;
    if (click.status === 'credited')
      throw conflict('ALREADY_CREDITED', 'Good news — this task has already been credited.');
    const existing = await tx.select({ id: claims.id }).from(claims).where(eq(claims.clickId, click.id));
    if (existing[0])
      throw conflict('CLAIM_EXISTS', 'You already filed a claim for this task.', { claimId: existing[0].id });
    const age = Date.now() - click.startedAt.getTime();
    if (!opts.autoFiled && age < settings.claimMinWaitMinutes * MINUTE) {
      const mins = Math.ceil((settings.claimMinWaitMinutes * MINUTE - age) / MINUTE);
      throw new AppError(
        425,
        'TOO_EARLY',
        `Most networks confirm within a few minutes. You can file a claim in ${mins} minute${mins === 1 ? '' : 's'}.`,
      );
    }
    if (age > CLAIM_WINDOW)
      throw new AppError(
        410,
        'CLAIM_WINDOW_CLOSED',
        'Claims can be filed up to 30 days after starting a task.',
      );

    const [claim] = await tx
      .insert(claims)
      .values({
        userId: user.id,
        clickId: click.id,
        offerId: offer.id,
        status: 'checking',
        amountMicros: userPayoutFor(offer, settings.revenueShareBps),
        note: input.note,
        completedAtEstimate: input.completedAt ? new Date(input.completedAt) : null,
        autoFiled: Boolean(opts.autoFiled),
        slaDueAt: new Date(Date.now() + settings.claimSlaHours * HOUR),
      })
      .returning({ id: claims.id });
    await tx.update(offerClicks).set({ status: 'claimed' }).where(eq(offerClicks.id, click.id));
    await addEvent(
      tx,
      claim!.id,
      'submitted',
      opts.autoFiled
        ? 'Filed automatically by Lucrum after 72 hours without confirmation.'
        : 'Claim received. Checking automatically now…',
    );
    await ctx.jobs.enqueue(tx, 'claim.autoresolve', { claimId: claim!.id });
    return claim!.id;
  });
  await refreshOfferStats(
    ctx.db,
    (await ctx.db.select({ offerId: claims.offerId }).from(claims).where(eq(claims.id, claimId)))[0]!.offerId,
  );
  return claimId;
}

/** Job: walk the resolution ladder. */
export async function autoResolveClaim(ctx: AppContext, claimId: string): Promise<void> {
  const rows = await ctx.db
    .select({ claim: claims, click: offerClicks, offer: offers, network: networks, user: users })
    .from(claims)
    .innerJoin(offerClicks, eq(offerClicks.id, claims.clickId))
    .innerJoin(offers, eq(offers.id, claims.offerId))
    .innerJoin(networks, eq(networks.id, offers.networkId))
    .innerJoin(users, eq(users.id, claims.userId))
    .where(eq(claims.id, claimId));
  const row = rows[0];
  if (!row || row.claim.status !== 'checking') return;
  const { claim, click, offer, network, user } = row;
  const settings = ctx.settings.get();

  // 1 — Postback logs: a signed postback we failed to process (expired window, outage…).
  await addEvent(ctx.db, claim.id, 'check_logs', `Searching ${network.name} postback logs for your click…`);
  const logs = await ctx.db
    .select()
    .from(postbackLogs)
    .where(
      and(
        eq(postbackLogs.clickId, click.id),
        eq(postbackLogs.signatureValid, true),
        inArray(postbackLogs.status, ['rejected', 'error']),
      ),
    )
    .orderBy(desc(postbackLogs.createdAt))
    .limit(1);
  const evidence = logs[0];
  const adapter = getAdapter(network.adapter);
  if (evidence?.networkTxnId) {
    // Re-parse with the network's own dialect to recover the exact payout it reported.
    let payout = offer.payoutMicros;
    try {
      const q = Object.fromEntries(Object.entries(evidence.query).map(([k, v]) => [k, String(v)]));
      const parsed = adapter?.parse({
        method: evidence.method,
        url: evidence.url,
        fullUrl: evidence.url,
        query: q,
        body: evidence.body,
        headers: {},
        ip: evidence.ip ?? '',
      });
      if (parsed && parsed.payoutMicros > 0) payout = parsed.payoutMicros;
    } catch {
      /* fall back to the catalogue payout */
    }
    const res = await creditConversion(ctx, {
      networkId: network.id,
      networkTxnId: evidence.networkTxnId,
      userId: user.id,
      offer,
      click: { ...click, status: 'started', expiresAt: new Date(Date.now() + HOUR) },
      payoutMicros: payout,
      kind: 'complete',
      source: 'claim',
    });
    return approve(
      ctx,
      claim.id,
      'postback_found',
      res.userAmountMicros,
      null,
      `${network.name} did report your completion — a processing error on our side stopped it. Paid now.`,
    );
  }

  // 2 — Ask the network directly.
  if (adapter?.checkConversion) {
    await addEvent(ctx.db, claim.id, 'check_network', `Asking ${network.name} to confirm your completion…`);
    const check = await adapter.checkConversion(ctx.db, network.id, click.id);
    if (check.converted && check.networkTxnId) {
      const res = await creditConversion(ctx, {
        networkId: network.id,
        networkTxnId: check.networkTxnId,
        userId: user.id,
        offer,
        click: { ...click, status: 'started', expiresAt: new Date(Date.now() + HOUR) },
        payoutMicros: check.payoutMicros ?? offer.payoutMicros,
        kind: check.kind ?? 'complete',
        source: 'network_api',
      });
      return approve(
        ctx,
        claim.id,
        'network_confirmed',
        res.userAmountMicros,
        null,
        `${network.name} confirmed your completion. Paid now.`,
      );
    }
    await addEvent(
      ctx.db,
      claim.id,
      'network_no_record',
      `${network.name} has no record of the completion yet.`,
    );
  }

  // 3 — Goodwill for trusted members.
  const tier = getTier(user.tier);
  const monthAgo = new Date(Date.now() - 30 * DAY);
  const used = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(claims)
    .where(
      and(
        eq(claims.userId, user.id),
        eq(claims.resolution, 'goodwill_auto'),
        gte(claims.resolvedAt, monthAgo),
      ),
    );
  const plausible =
    !claim.completedAtEstimate ||
    claim.completedAtEstimate.getTime() - click.startedAt.getTime() >= offer.estMinutes * 60_000 * 0.3;
  if (
    tier.autoGoodwillMaxMicros >= claim.amountMicros &&
    user.fraudScore <= settings.autoApproveMaxFraudScore &&
    (used[0]?.n ?? 0) < settings.claimAutoGoodwillPerMonth &&
    plausible &&
    user.status === 'active'
  ) {
    return approve(
      ctx,
      claim.id,
      'goodwill_auto',
      claim.amountMicros,
      null,
      `As a ${tier.name} member you’re paid instantly while we chase ${network.name} ourselves.`,
    );
  }

  // 4 — Human review with a visible SLA.
  await ctx.db
    .update(claims)
    .set({ status: 'needs_review', updatedAt: new Date() })
    .where(eq(claims.id, claim.id));
  await addEvent(
    ctx.db,
    claim.id,
    'needs_review',
    `A person will review this by ${claim.slaDueAt.toUTCString()}.`,
  );
  await notify(ctx, ctx.db, user.id, {
    type: 'claim_review',
    title: 'Missing credit: under review',
    body: `We couldn’t confirm “${offer.title}” automatically, so a person will review it within ${settings.claimSlaHours} hours.`,
    link: `/app/claims/${claim.id}`,
    email: { category: 'claims' },
  });
  ctx.events.toUser(user.id, 'claim', { claimId: claim.id, status: 'needs_review' });
}

export async function approve(
  ctx: AppContext,
  claimId: string,
  resolution: 'postback_found' | 'network_confirmed' | 'goodwill_auto' | 'goodwill_manual' | 'sla_auto',
  amountMicros: number,
  actorId: string | null,
  message: string,
): Promise<void> {
  const result = await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .select({ claim: claims, offer: offers })
      .from(claims)
      .innerJoin(offers, eq(offers.id, claims.offerId))
      .where(eq(claims.id, claimId))
      .for('update', { of: claims });
    const row = rows[0];
    if (!row) throw notFound('Claim');
    if (row.claim.status === 'approved' || row.claim.status === 'rejected') return null;
    let ledgerTxnId: string | null = null;
    const goodwill =
      resolution === 'goodwill_auto' || resolution === 'goodwill_manual' || resolution === 'sla_auto';
    if (goodwill) {
      ledgerTxnId = await creditGoodwill(ctx, tx, {
        userId: row.claim.userId,
        claimId,
        amountMicros,
        title: row.offer.title,
      });
      await tx
        .update(offerClicks)
        .set({ status: 'credited', creditedAt: new Date() })
        .where(eq(offerClicks.id, row.claim.clickId));
      await ctx.jobs.enqueue(tx, 'earning.after', {
        userId: row.claim.userId,
        kind: 'goodwill',
        amountMicros,
        offerId: row.offer.id,
        sourceKey: `goodwill:${claimId}`,
      });
    }
    await tx
      .update(claims)
      .set({
        status: 'approved',
        resolution,
        amountMicros,
        resolvedAt: new Date(),
        resolvedBy: actorId,
        chaseNetwork: goodwill,
        ledgerTxnId,
        updatedAt: new Date(),
      })
      .where(eq(claims.id, claimId));
    await addEvent(tx, claimId, 'approved', `${message} (${formatUsd(amountMicros)})`);
    await notify(ctx, tx, row.claim.userId, {
      type: 'claim_approved',
      title: `Missing credit approved: +${formatUsd(amountMicros)}`,
      body: `“${row.offer.title}” — ${message}`,
      link: `/app/claims/${claimId}`,
      email: { category: 'claims' },
    });
    return { userId: row.claim.userId, title: row.offer.title, goodwill };
  });
  if (result) {
    ctx.events.toUser(result.userId, 'claim', { claimId, status: 'approved' });
    if (result.goodwill)
      ctx.events.toUser(result.userId, 'reward', { kind: 'goodwill', amountMicros, title: result.title });
  }
}

export async function rejectClaim(
  ctx: AppContext,
  claimId: string,
  reason: string,
  actorId: string,
): Promise<void> {
  const userId = await ctx.db.transaction(async (tx) => {
    const rows = await tx.select().from(claims).where(eq(claims.id, claimId)).for('update');
    const claim = rows[0];
    if (!claim) throw notFound('Claim');
    if (claim.status === 'approved' || claim.status === 'rejected')
      throw conflict('CLAIM_RESOLVED', 'This claim is already resolved');
    await tx
      .update(claims)
      .set({
        status: 'rejected',
        resolution: 'rejected',
        rejectionReason: reason,
        resolvedAt: new Date(),
        resolvedBy: actorId,
        updatedAt: new Date(),
      })
      .where(eq(claims.id, claimId));
    await tx.update(offerClicks).set({ status: 'rejected' }).where(eq(offerClicks.id, claim.clickId));
    await addEvent(tx, claimId, 'rejected', `Not approved: ${reason}`);
    await notify(ctx, tx, claim.userId, {
      type: 'claim_rejected',
      title: 'Missing credit: not approved',
      body: `${reason} If you think we got this wrong, reply from the claim page and a different reviewer will take a look.`,
      link: `/app/claims/${claimId}`,
      email: { category: 'claims' },
    });
    const rejected = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(claims)
      .where(
        and(
          eq(claims.userId, claim.userId),
          eq(claims.status, 'rejected'),
          gte(claims.createdAt, new Date(Date.now() - 30 * DAY)),
        ),
      );
    if ((rejected[0]?.n ?? 0) >= 3)
      await recordSignal(ctx, tx, claim.userId, 'claim_abuse', { rejected30d: rejected[0]!.n });
    return claim.userId;
  });
  ctx.events.toUser(userId, 'claim', { claimId, status: 'rejected' });
}

/** Job: SLA guarantee — overdue small claims from members in good standing auto-approve. */
export async function sweepClaimSla(ctx: AppContext): Promise<number> {
  const settings = ctx.settings.get();
  const overdue = await ctx.db
    .select({ claim: claims, user: users })
    .from(claims)
    .innerJoin(users, eq(users.id, claims.userId))
    .where(and(eq(claims.status, 'needs_review'), lte(claims.slaDueAt, new Date())))
    .orderBy(asc(claims.slaDueAt))
    .limit(100);
  let approved = 0;
  for (const { claim, user } of overdue) {
    if (
      claim.amountMicros <= settings.claimSlaAutoApproveMaxMicros &&
      user.fraudScore <= settings.autoApproveMaxFraudScore &&
      user.status === 'active'
    ) {
      await approve(
        ctx,
        claim.id,
        'sla_auto',
        claim.amountMicros,
        null,
        'We missed our 24-hour review promise, so we approved it automatically.',
      );
      approved++;
    }
  }
  return approved;
}

export async function getClaimDTO(ctx: AppContext, claimId: string, userId?: string): Promise<ClaimDTO> {
  const settings = ctx.settings.get();
  const rows = await ctx.db
    .select({ claim: claims, offer: offers, networkName: networks.name })
    .from(claims)
    .innerJoin(offers, eq(offers.id, claims.offerId))
    .innerJoin(networks, eq(networks.id, offers.networkId))
    .where(userId ? and(eq(claims.id, claimId), eq(claims.userId, userId)) : eq(claims.id, claimId));
  const row = rows[0];
  if (!row) throw notFound('Claim');
  const events = await ctx.db
    .select()
    .from(claimEvents)
    .where(eq(claimEvents.claimId, claimId))
    .orderBy(asc(claimEvents.createdAt));
  const { claim, offer } = row;
  return {
    id: claim.id,
    clickId: claim.clickId,
    offer: {
      id: offer.id,
      title: offer.title,
      icon: offer.icon,
      color: offer.color,
      category: offer.category as ClaimDTO['offer']['category'],
      userPayoutMicros: userPayoutFor(offer, settings.revenueShareBps),
      networkName: row.networkName,
    },
    status: claim.status,
    resolution: claim.resolution,
    amountMicros: claim.amountMicros,
    note: claim.note,
    slaDueAt: claim.slaDueAt.toISOString(),
    resolvedAt: claim.resolvedAt?.toISOString() ?? null,
    rejectionReason: claim.rejectionReason,
    hasScreenshot: Boolean(claim.screenshotPath),
    createdAt: claim.createdAt.toISOString(),
    events: events.map((e) => ({ type: e.type, message: e.message, at: e.createdAt.toISOString() })),
  };
}

export async function listClaims(ctx: AppContext, userId: string): Promise<ClaimDTO[]> {
  const rows = await ctx.db
    .select({ id: claims.id })
    .from(claims)
    .where(eq(claims.userId, userId))
    .orderBy(desc(claims.createdAt))
    .limit(50);
  return Promise.all(rows.map((r) => getClaimDTO(ctx, r.id, userId)));
}
