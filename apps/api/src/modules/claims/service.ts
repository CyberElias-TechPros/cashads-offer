import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { formatMoney, TIER_BY_ID, type ClaimCreateInput, type ClaimDTO } from '@cashads/shared';
import { withUow, type AppContext, type Uow } from '../../context';
import { claims, ledgerEntries, offerClicks, offers, postbacks, uploads, users } from '../../db/schema';
import { enqueue } from '../../jobs/queue';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { clock, DAY, HOUR } from '../../lib/clock';
import { notify } from '../notifications/service';
import { templates } from '../notifications/templates';
import { replayPostback } from '../postbacks/service';
import { onEarned } from '../rewards/earned';
import { creditUser } from '../rewards/service';
import { lookupConversion, SANDBOX_NETWORK_ID } from '../sandbox/service';
import { acct } from '../wallet/ledger';

type ClaimRow = typeof claims.$inferSelect;

export async function claimDTO(ctx: AppContext, c: ClaimRow): Promise<ClaimDTO> {
  const [o] = await ctx.db.select({ title: offers.title, icon: offers.icon }).from(offers).where(eq(offers.id, c.offerId));
  return {
    id: c.id,
    offerId: c.offerId,
    offerTitle: o?.title ?? 'Offer',
    offerIcon: o?.icon ?? '🎯',
    clickId: c.clickId,
    status: c.status,
    amountMicros: c.amountMicros,
    note: c.note,
    resolution: c.resolution,
    slaDueAt: c.slaDueAt.toISOString(),
    createdAt: c.createdAt.toISOString(),
    resolvedAt: c.resolvedAt?.toISOString() ?? null,
    timeline: c.timeline,
  };
}

export async function createClaim(ctx: AppContext, userId: string, input: ClaimCreateInput): Promise<ClaimDTO> {
  const [row] = await ctx.db
    .select({ click: offerClicks, offer: offers })
    .from(offerClicks)
    .innerJoin(offers, eq(offers.id, offerClicks.offerId))
    .where(and(eq(offerClicks.id, input.clickId), eq(offerClicks.userId, userId)));
  if (!row) throw notFound('We couldn’t find that offer in your history');
  const { click, offer } = row;
  if (click.status === 'credited') throw conflict('Good news — this offer is already credited. Check your wallet.', 'already_credited');
  if (clock.ms() - click.startedAt.getTime() > 30 * DAY) throw badRequest('Claims must be filed within 30 days of starting the offer', 'claim_too_old');
  const completedAt = new Date(input.completedAt);
  if (completedAt.getTime() < click.startedAt.getTime() - 5 * 60_000) throw badRequest('That’s before you started the offer — check the time', 'invalid_time');
  if (completedAt.getTime() > clock.ms() + 5 * 60_000) throw badRequest('That time is in the future', 'invalid_time');
  if (input.uploadId) {
    const [up] = await ctx.db.select({ id: uploads.id }).from(uploads).where(and(eq(uploads.id, input.uploadId), eq(uploads.userId, userId)));
    if (!up) throw badRequest('Screenshot upload not found');
  }
  let amount = click.userPayoutMicros;
  if (click.goalsSnapshot.length) {
    const credited = await ctx.db
      .select({ goalId: postbacks.goalId })
      .from(postbacks)
      .where(and(eq(postbacks.clickId, click.id), inArray(postbacks.status, ['credited', 'held'])));
    const done = new Set(credited.map((c) => c.goalId));
    amount = click.goalsSnapshot.find((g) => !done.has(g.id))?.userPayoutMicros ?? 0;
  }
  const now = clock.now();
  const sla = ctx.settings.get().claimSlaHours;
  const inserted = await ctx.db
    .insert(claims)
    .values({
      userId,
      offerId: offer.id,
      clickId: click.id,
      amountMicros: amount,
      completedAtClaimed: completedAt,
      note: input.note ?? null,
      uploadId: input.uploadId ?? null,
      slaDueAt: new Date(now.getTime() + sla * HOUR),
      timeline: [{ label: 'Claim received — checking the partner’s records', at: now.toISOString() }],
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (!inserted.length) throw conflict('You already filed a claim for this offer', 'claim_exists');
  await enqueue(ctx.db, 'claims.auto_check', { claimId: inserted[0].id }, { maxAttempts: 3 });
  return claimDTO(ctx, inserted[0]);
}

async function resolve(uow: Uow, c: ClaimRow, patch: { status: ClaimRow['status']; resolution: string; label: string; transactionId?: string | null; resolvedById?: string | null }) {
  const now = clock.now();
  await uow.tx
    .update(claims)
    .set({
      status: patch.status,
      resolution: patch.resolution,
      transactionId: patch.transactionId ?? c.transactionId,
      resolvedById: patch.resolvedById ?? null,
      resolvedAt: ['auto_approved', 'approved', 'rejected'].includes(patch.status) ? now : null,
      timeline: [...c.timeline, { label: patch.label, at: now.toISOString() }],
      updatedAt: now,
    })
    .where(eq(claims.id, c.id));
  uow.afterCommit(() => uow.ctx.bus.publishToUser(c.userId, { type: 'claim', claimId: c.id, status: patch.status }));
}

/** Pay a claim from goodwill — "we pay first, then chase the partner". Shares the conversion idempotency key, so it can never double-pay. */
async function payClaim(uow: Uow, c: ClaimRow, amount: number, source: 'goodwill' | 'network'): Promise<string | null> {
  const [click] = await uow.tx.select().from(offerClicks).where(eq(offerClicks.id, c.clickId)).for('update');
  const [offer] = await uow.tx.select().from(offers).where(eq(offers.id, c.offerId));
  const credited = await uow.tx
    .select({ goalId: postbacks.goalId })
    .from(postbacks)
    .where(and(eq(postbacks.clickId, click.id), inArray(postbacks.status, ['credited', 'held'])));
  const done = new Set(credited.map((x) => x.goalId));
  const goal = click.goalsSnapshot.find((g) => !done.has(g.id));
  const key = `conv:${click.id}:${goal?.id ?? 'main'}`;
  const [prior] = await uow.tx.select().from(ledgerEntries).where(eq(ledgerEntries.idempotencyKey, key));
  if (prior) return prior.transactionId;
  const gross = goal ? goal.partnerPayoutMicros : click.partnerPayoutMicros;
  const base = goal ? goal.baseMicros : click.baseUserPayoutMicros;
  const scale = amount / Math.max(1, goal ? goal.userPayoutMicros : click.userPayoutMicros);
  const res = await creditUser(uow, {
    userId: c.userId,
    type: source === 'goodwill' ? 'goodwill' : 'offer',
    description: `${offer.title}${goal ? ` — ${goal.label}` : ''} (missing credit)`,
    idempotencyKey: key,
    amountMicros: source === 'goodwill' ? amount : Math.round(base * scale),
    bonusMicros: source === 'goodwill' ? 0 : amount - Math.round(base * scale),
    source: source === 'goodwill' ? { account: acct.goodwill } : { account: acct.network(offer.networkId), grossMicros: gross },
    referenceType: 'click',
    referenceId: click.id,
    meta: { offerId: offer.id, claimId: c.id, goalId: goal?.id ?? null, category: offer.category },
    earning: true,
  });
  const allDone = click.goalsSnapshot.length === 0 || click.goalsSnapshot.every((g) => done.has(g.id) || g.id === goal?.id);
  await uow.tx
    .update(offerClicks)
    .set({ status: allDone ? 'credited' : 'completed', creditedAt: click.creditedAt ?? clock.now() })
    .where(eq(offerClicks.id, click.id));
  if (allDone) await uow.tx.update(offers).set({ completions: sql`${offers.completions} + 1` }).where(eq(offers.id, offer.id));
  await onEarned(uow, c.userId, { kind: source === 'goodwill' ? 'goodwill' : 'offer', baseMicros: base });
  return res.transactionId;
}

/** Automatic checks run seconds after a claim is filed. */
export async function autoCheckClaim(ctx: AppContext, claimId: string): Promise<void> {
  const [c0] = await ctx.db.select().from(claims).where(eq(claims.id, claimId));
  if (!c0 || c0.status !== 'submitted') return;
  const [offer] = await ctx.db.select().from(offers).where(eq(offers.id, c0.offerId));

  // 1) A partner signal exists but failed on our side → replay it.
  const signals = await ctx.db.select().from(postbacks).where(eq(postbacks.clickId, c0.clickId)).orderBy(desc(postbacks.createdAt));
  const failed = signals.find((p) => p.signatureValid && ['error', 'needs_review', 'rejected'].includes(p.status));
  if (failed) {
    try {
      const res = await replayPostback(ctx, failed.id, { force: true });
      if (res.status === 'credited' || res.status === 'held') {
        await withUow(ctx, async (uow) => {
          const [c] = await uow.tx.select().from(claims).where(eq(claims.id, claimId));
          if (c.status === 'approved' || c.status === 'auto_approved') {
            await uow.tx
              .update(claims)
              .set({ status: 'auto_approved', resolution: 'We found the partner’s confirmation — it had failed to process on our side. Fixed and credited.' })
              .where(eq(claims.id, claimId));
          }
        });
        return;
      }
    } catch (err) {
      ctx.log.warn({ err, claimId }, 'claim replay failed');
    }
  }

  await withUow(ctx, async (uow) => {
    const [c] = await uow.tx.select().from(claims).where(eq(claims.id, claimId)).for('update');
    if (!c || c.status !== 'submitted') return;
    const [user] = await uow.tx.select().from(users).where(eq(users.id, c.userId));

    // 2) Ask the partner's conversion API.
    if (offer.networkId === SANDBOX_NETWORK_ID) {
      const conversions = await lookupConversion(uow.tx, c.clickId);
      if (conversions.length) {
        const txId = await payClaim(uow, c, c.amountMicros, 'network');
        await resolve(uow, c, {
          status: 'auto_approved',
          resolution: 'The partner confirmed you completed the offer even though their tracking signal never reached us. Credited.',
          label: 'Partner confirmed completion — credited automatically',
          transactionId: txId,
        });
        await notify(uow, c.userId, {
          type: 'claim',
          title: `Missing credit approved: +${formatMoney(c.amountMicros)}`,
          body: `${offer.title} — the partner confirmed your completion.`,
          link: `/app/claims/${c.id}`,
          email: {
            category: 'payouts',
            template: 'claim_resolved',
            content: templates.claimResolved(user.displayName, true, offer.title, `The partner confirmed your completion and we credited ${formatMoney(c.amountMicros)}.`, `${ctx.config.PUBLIC_WEB_URL}/app/claims/${c.id}`),
          },
        });
        return;
      }
    }

    // 3) Trusted-member fast lane (Gold+): small claims approved instantly, we absorb the risk.
    const tier = TIER_BY_ID[user.tier];
    if (tier.instantClaimMicros >= c.amountMicros && user.riskLevel === 'low') {
      const [recent] = await uow.tx
        .select({ n: sql<number>`count(*)::int` })
        .from(claims)
        .where(and(eq(claims.userId, c.userId), eq(claims.status, 'auto_approved'), gte(claims.createdAt, new Date(clock.ms() - 30 * DAY))));
      if (Number(recent?.n ?? 0) < 3) {
        const txId = await payClaim(uow, c, c.amountMicros, 'goodwill');
        await resolve(uow, c, {
          status: 'auto_approved',
          resolution: `Approved instantly thanks to your ${tier.label} status. We’ll follow up with the partner ourselves.`,
          label: `${tier.label} fast lane — credited instantly`,
          transactionId: txId,
        });
        await notify(uow, c.userId, { type: 'claim', title: `Missing credit approved: +${formatMoney(c.amountMicros)}`, body: `${offer.title} — approved instantly (${tier.label} perk).`, link: `/app/claims/${c.id}` });
        return;
      }
    }

    // 4) Human review within SLA.
    await resolve(uow, c, {
      status: 'in_review',
      resolution: '',
      label: `No automatic match — a human will review it by ${c.slaDueAt.toUTCString().slice(0, 22)} UTC`,
    });
    await notify(uow, c.userId, {
      type: 'claim',
      title: 'Your claim is with our team',
      body: `${offer.title}: we couldn’t confirm it automatically, so a person will review it within ${ctx.settings.get().claimSlaHours} hours.`,
      link: `/app/claims/${c.id}`,
    });
  });
}

export async function decideClaim(ctx: AppContext, claimId: string, actorId: string, input: { decision: 'approve' | 'reject'; reason: string; amountMicros?: number }) {
  return withUow(ctx, async (uow) => {
    const [c] = await uow.tx.select().from(claims).where(eq(claims.id, claimId)).for('update');
    if (!c) throw notFound();
    if (!['submitted', 'in_review'].includes(c.status)) throw conflict(`Claim already ${c.status}`);
    const [[offer], [user]] = await Promise.all([
      uow.tx.select().from(offers).where(eq(offers.id, c.offerId)),
      uow.tx.select().from(users).where(eq(users.id, c.userId)),
    ]);
    if (input.decision === 'approve') {
      const amount = input.amountMicros ?? c.amountMicros;
      const txId = await payClaim(uow, c, amount, 'goodwill');
      await resolve(uow, c, { status: 'approved', resolution: input.reason, label: `Approved by our team — ${formatMoney(amount)} credited`, transactionId: txId, resolvedById: actorId });
      await notify(uow, c.userId, {
        type: 'claim',
        title: `Missing credit approved: +${formatMoney(amount)}`,
        body: `${offer.title} — ${input.reason}`,
        link: `/app/claims/${c.id}`,
        email: {
          category: 'payouts',
          template: 'claim_resolved',
          content: templates.claimResolved(user.displayName, true, offer.title, `${input.reason} We credited ${formatMoney(amount)}.`, `${ctx.config.PUBLIC_WEB_URL}/app/claims/${c.id}`),
        },
      });
    } else {
      await resolve(uow, c, { status: 'rejected', resolution: input.reason, label: 'Reviewed — not approved', resolvedById: actorId });
      await notify(uow, c.userId, {
        type: 'claim',
        title: 'Update on your missing-credit claim',
        body: `${offer.title}: ${input.reason} You can reply via support if you have more evidence.`,
        link: `/app/claims/${c.id}`,
        email: {
          category: 'transactional',
          template: 'claim_resolved',
          content: templates.claimResolved(user.displayName, false, offer.title, `${input.reason} If you have more evidence, reply via support and we’ll take another look.`, `${ctx.config.PUBLIC_WEB_URL}/app/claims/${c.id}`),
        },
      });
    }
  });
}

export async function listClaims(ctx: AppContext, userId: string): Promise<ClaimDTO[]> {
  const rows = await ctx.db.select().from(claims).where(eq(claims.userId, userId)).orderBy(desc(claims.createdAt)).limit(100);
  return Promise.all(rows.map((c) => claimDTO(ctx, c)));
}

export async function getClaim(ctx: AppContext, userId: string, id: string): Promise<ClaimDTO> {
  const [c] = await ctx.db.select().from(claims).where(and(eq(claims.id, id), eq(claims.userId, userId)));
  if (!c) throw notFound('Claim not found');
  return claimDTO(ctx, c);
}
