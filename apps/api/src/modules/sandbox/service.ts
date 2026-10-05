import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { AppContext } from '../../context';
import type { Q } from '../../db/client';
import { networks, offerClicks, offers, postbacks, sandboxConversions } from '../../db/schema';
import { enqueue } from '../../jobs/queue';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { clock } from '../../lib/clock';
import { signHmacSorted } from '../postbacks/adapters';

/**
 * A fully working stand-in for an external offer network ("Demo Network").
 * It has its own pages (/partner/demo/…), keeps its own conversion records,
 * and notifies CashAds the way real partners do: a signed server-to-server
 * HTTP postback with retries. It can also be told to "lose" postbacks so the
 * missing-credit flow can be exercised end to end.
 */
export const SANDBOX_NETWORK_ID = 'demo';

async function loadClick(ctx: AppContext, offerId: string, clickId: string) {
  const [row] = await ctx.db
    .select({ click: offerClicks, offer: offers })
    .from(offerClicks)
    .innerJoin(offers, eq(offers.id, offerClicks.offerId))
    .where(and(eq(offerClicks.id, clickId), eq(offerClicks.offerId, offerId)));
  if (!row) throw notFound('This partner link is invalid or expired. Start the offer again from CashAds.');
  if (row.offer.networkId !== SANDBOX_NETWORK_ID) throw badRequest('Not a sandbox offer');
  return row;
}

export async function partnerView(ctx: AppContext, offerId: string, clickId: string) {
  const { click, offer } = await loadClick(ctx, offerId, clickId);
  const done = await ctx.db.select().from(sandboxConversions).where(eq(sandboxConversions.clickId, click.id));
  return {
    offer: {
      id: offer.id,
      title: offer.title,
      advertiser: offer.advertiser,
      category: offer.category,
      icon: offer.icon,
      brandColor: offer.brandColor,
      steps: offer.steps,
      estimatedMinutes: offer.estimatedMinutes,
      goals: offer.goals.map((g) => ({ id: g.id, label: g.label })),
      content: offer.partnerContent,
      tracking: offer.sandboxDropPostback ? 'broken' : 'ok',
    },
    click: { id: click.id, startedAt: click.startedAt.toISOString() },
    completedGoals: done.map((d) => d.goalId),
    completed: offer.goals.length ? offer.goals.every((g) => done.some((d) => d.goalId === g.id)) : done.length > 0,
  };
}

export async function completeTask(ctx: AppContext, input: { offerId: string; clickId: string; goalId?: string; answers?: number[] }) {
  const { click, offer } = await loadClick(ctx, input.offerId, input.clickId);
  let goalId = '';
  if (offer.goals.length) {
    const idx = offer.goals.findIndex((g) => g.id === input.goalId);
    if (idx === -1) throw badRequest('Unknown milestone');
    const done = await ctx.db.select({ goalId: sandboxConversions.goalId }).from(sandboxConversions).where(eq(sandboxConversions.clickId, click.id));
    const doneSet = new Set(done.map((d) => d.goalId));
    if (offer.goals.slice(0, idx).some((g) => !doneSet.has(g.id))) throw badRequest('Reach the previous milestone first');
    goalId = offer.goals[idx].id;
  }
  if (offer.category === 'learn' && offer.partnerContent.lesson) {
    const quiz = offer.partnerContent.lesson.quiz;
    const answers = input.answers ?? [];
    const wrong = quiz.filter((q, i) => answers[i] !== q.answer).length;
    if (wrong > 0) throw badRequest(`${wrong} answer${wrong > 1 ? 's are' : ' is'} not quite right — have another look at the lesson.`, 'quiz_failed');
  }
  const txId = `DEMO-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  const [conv] = await ctx.db
    .insert(sandboxConversions)
    .values({ clickId: click.id, offerId: offer.id, goalId, txId, createdAt: clock.now() })
    .onConflictDoNothing()
    .returning();
  if (!conv) throw conflict('Already completed — your reward is on its way', 'already_completed');
  if (offer.sandboxDropPostback) {
    return { scheduled: false, dropped: true, delaySeconds: 0 };
  }
  await enqueue(ctx.db, 'sandbox.fire_postback', { conversionId: conv.id, kind: 'credit' }, { delayMs: offer.sandboxDelaySeconds * 1000, maxAttempts: 10 });
  return { scheduled: true, dropped: false, delaySeconds: offer.sandboxDelaySeconds };
}

/** The partner's server calling ours — a real HTTP request, signed with the shared secret. */
export async function firePostback(ctx: AppContext, conversionId: string, kind: 'credit' | 'reversal') {
  const [conv] = await ctx.db.select().from(sandboxConversions).where(eq(sandboxConversions.id, conversionId));
  if (!conv) return;
  const [offer] = await ctx.db.select().from(offers).where(eq(offers.id, conv.offerId));
  const [net] = await ctx.db.select().from(networks).where(eq(networks.id, SANDBOX_NETWORK_ID));
  if (!offer || !net?.secretEnc) throw new Error('Sandbox network not configured');
  const secret = ctx.vault.decrypt(net.secretEnc);
  const payout = conv.goalId ? (offer.goals.find((g) => g.id === conv.goalId)?.partnerPayoutMicros ?? offer.partnerPayoutMicros) : offer.partnerPayoutMicros;
  const params: Record<string, string> = {
    click_id: conv.clickId,
    tx_id: conv.txId,
    payout: (payout / 1_000_000).toFixed(4),
    status: kind === 'credit' ? '1' : '2',
    offer_id: offer.externalId,
  };
  if (conv.goalId) params.goal = conv.goalId;
  params.sig = signHmacSorted(params, secret);
  const url = `${ctx.config.INTERNAL_API_URL.replace(/\/$/, '')}/api/postback/${SANDBOX_NETWORK_ID}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, { method: 'GET', headers: { 'User-Agent': 'DemoNetwork-Postback/1.0' } });
  if (res.status >= 500) throw new Error(`CashAds returned ${res.status}`);
  if (kind === 'credit') await ctx.db.update(sandboxConversions).set({ postbackSent: true }).where(eq(sandboxConversions.id, conv.id));
  else await ctx.db.update(sandboxConversions).set({ reversed: true }).where(eq(sandboxConversions.id, conv.id));
}

/** Partner "conversion status" API — used by missing-credit auto-checks. */
export async function lookupConversion(q: Q, clickId: string) {
  const rows = await q.select().from(sandboxConversions).where(eq(sandboxConversions.clickId, clickId));
  return rows.filter((r) => !r.reversed).map((r) => ({ goalId: r.goalId, txId: r.txId, at: r.createdAt.toISOString() }));
}

/** Admin tool: make the demo partner send a chargeback for a credited conversion. */
export async function simulateReversal(ctx: AppContext, postbackId: string) {
  const [pb] = await ctx.db.select().from(postbacks).where(eq(postbacks.id, postbackId));
  if (!pb || pb.networkId !== SANDBOX_NETWORK_ID || !pb.clickId) throw badRequest('Only credited Demo Network conversions can be reversed');
  const [conv] = await ctx.db
    .select()
    .from(sandboxConversions)
    .where(and(eq(sandboxConversions.clickId, pb.clickId), eq(sandboxConversions.goalId, pb.goalId ?? '')));
  if (!conv) throw notFound('Partner-side conversion not found');
  await firePostback(ctx, conv.id, 'reversal');
}
