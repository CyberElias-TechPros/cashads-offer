import crypto from 'node:crypto';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { formatMoney, type AdminOfferInput, type UserStatus } from '@cashads/shared';
import { withUow, type AppContext } from '../../context';
import type { Q } from '../../db/client';
import {
  auditLogs,
  claims,
  devices,
  fraudCases,
  jobs,
  kycSubmissions,
  ledgerEntries,
  ledgerPostings,
  loginEvents,
  networks,
  offerClicks,
  offerReports,
  offers,
  outboundMessages,
  payoutMethods,
  payouts,
  postbacks,
  referrals,
  riskSignals,
  sessions,
  supportTickets,
  transactions,
  userActivityDays,
  userNotes,
  users,
  wallets,
} from '../../db/schema';
import { enqueue } from '../../jobs/queue';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { clock, DAY } from '../../lib/clock';
import { randomToken } from '../../lib/crypto';
import { addSignal, clearSignals, linkedAccounts, SIGNALS } from '../fraud/service';
import { notify } from '../notifications/service';
import { templates } from '../notifications/templates';
import { postbackStats } from '../postbacks/service';
import { finalizeFailure } from '../payouts/service';
import { creditUser } from '../rewards/service';
import { acct, lockWallet, postEntry } from '../wallet/ledger';
import { revokeOtherSessions } from '../auth/service';

export async function audit(q: Q, actorId: string | null, action: string, targetType: string, targetId: string | null, details: Record<string, unknown> = {}, ip: string | null = null) {
  await q.insert(auditLogs).values({ actorId, action, targetType, targetId, details, ip, createdAt: clock.now() });
}

const n = (v: unknown) => Number(v ?? 0);

/* --------------------------------------------------------------- overview */

export async function overview(ctx: AppContext) {
  const now = clock.ms();
  const d1 = new Date(now - DAY);
  const d7 = new Date(now - 7 * DAY);
  const d30 = new Date(now - 30 * DAY);
  const today = new Date(now).toISOString().slice(0, 10);

  const [[u], [act], [money], [ledger30], queues, pb1, pb30, series, signupsSeries] = await Promise.all([
    ctx.db
      .select({
        total: sql<number>`count(*) filter (where ${users.status} <> 'deleted')::int`,
        new24: sql<number>`count(*) filter (where ${users.createdAt} >= ${d1})::int`,
        new7: sql<number>`count(*) filter (where ${users.createdAt} >= ${d7})::int`,
        verified: sql<number>`count(*) filter (where ${users.emailVerifiedAt} is not null)::int`,
        flagged: sql<number>`count(*) filter (where ${users.riskLevel} <> 'low')::int`,
      })
      .from(users),
    ctx.db
      .select({
        dau: sql<number>`count(distinct ${userActivityDays.userId}) filter (where ${userActivityDays.day} = ${today})::int`,
        mau: sql<number>`count(distinct ${userActivityDays.userId}) filter (where ${userActivityDays.day} >= ${d30.toISOString().slice(0, 10)})::int`,
      })
      .from(userActivityDays),
    ctx.db
      .select({ available: sql<string>`coalesce(sum(${wallets.availableMicros}),0)`, pending: sql<string>`coalesce(sum(${wallets.pendingMicros}),0)` })
      .from(wallets),
    ctx.db
      .select({
        gross: sql<string>`coalesce(-sum(${ledgerPostings.amountMicros}) filter (where ${ledgerPostings.account} like 'network:%' and ${ledgerPostings.amountMicros} < 0), 0)`,
        revenue: sql<string>`coalesce(sum(${ledgerPostings.amountMicros}) filter (where ${ledgerPostings.account} = 'platform:revenue'), 0)`,
        marketing: sql<string>`coalesce(-sum(${ledgerPostings.amountMicros}) filter (where ${ledgerPostings.account} = 'platform:marketing'), 0)`,
        goodwill: sql<string>`coalesce(-sum(${ledgerPostings.amountMicros}) filter (where ${ledgerPostings.account} = 'platform:goodwill'), 0)`,
        loss: sql<string>`coalesce(-sum(${ledgerPostings.amountMicros}) filter (where ${ledgerPostings.account} = 'platform:loss'), 0)`,
        paid: sql<string>`coalesce(sum(${ledgerPostings.amountMicros}) filter (where ${ledgerPostings.account} = 'platform:paid_out'), 0)`,
        fees: sql<string>`coalesce(sum(${ledgerPostings.amountMicros}) filter (where ${ledgerPostings.account} = 'platform:fees'), 0)`,
      })
      .from(ledgerPostings)
      .where(gte(ledgerPostings.createdAt, d30)),
    ctx.db.execute(sql`select
        (select count(*)::int from payouts where status = 'review') as payouts_review,
        (select count(*)::int from payouts where status in ('pending','processing')) as payouts_inflight,
        (select count(*)::int from claims where status in ('submitted','in_review')) as claims_open,
        (select count(*)::int from claims where status = 'in_review' and sla_due_at < ${clock.now()}) as claims_breached,
        (select count(*)::int from fraud_cases where status = 'open') as fraud_open,
        (select count(*)::int from support_tickets where status = 'open') as tickets_open,
        (select count(*)::int from support_tickets where status = 'open' and sla_due_at < ${clock.now()}) as tickets_breached,
        (select count(*)::int from kyc_submissions where status = 'pending') as kyc_pending,
        (select count(*)::int from jobs where status = 'dead') as jobs_dead,
        (select count(*)::int from offers where status = 'paused' and reports_open > 0) as offers_flagged`),
    postbackStats(ctx, 1),
    postbackStats(ctx, 30),
    ctx.db.execute(sql`
      select to_char(date_trunc('day', p.created_at), 'YYYY-MM-DD') as day,
        coalesce(-sum(p.amount_micros) filter (where p.account like 'network:%' and p.amount_micros < 0), 0)::bigint as gross,
        coalesce(sum(p.amount_micros) filter (where p.account like 'user:%' and p.amount_micros > 0 and e.kind like 'credit:%'), 0)::bigint as earned,
        coalesce(sum(p.amount_micros) filter (where p.account = 'platform:paid_out'), 0)::bigint as paid
      from ledger_postings p join ledger_entries e on e.id = p.entry_id
      where p.created_at >= ${d30}
      group by 1 order by 1`),
    ctx.db.execute(sql`select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, count(*)::int as n from users where created_at >= ${d30} group by 1 order by 1`),
  ]);
  const q = (queues as unknown as { rows?: Record<string, number>[] }).rows?.[0] ?? (queues as unknown as Record<string, number>[])[0] ?? {};
  const rowsOf = (r: unknown) => ((r as { rows?: Record<string, unknown>[] }).rows ?? (r as Record<string, unknown>[])) as Record<string, unknown>[];
  const signupMap = new Map(rowsOf(signupsSeries).map((r) => [String(r.day), n(r.n)]));
  const seriesMap = new Map(rowsOf(series).map((r) => [String(r.day), r]));
  const days = Array.from({ length: 30 }, (_, i) => new Date(now - (29 - i) * DAY).toISOString().slice(0, 10));
  return {
    users: { total: n(u.total), new24h: n(u.new24), new7d: n(u.new7), verified: n(u.verified), flagged: n(u.flagged), dau: n(act.dau), mau: n(act.mau) },
    money: {
      liabilitiesAvailable: n(money.available),
      liabilitiesPending: n(money.pending),
      gross30d: n(ledger30.gross),
      revenue30d: n(ledger30.revenue),
      marketing30d: n(ledger30.marketing),
      goodwill30d: n(ledger30.goodwill),
      loss30d: n(ledger30.loss),
      paidOut30d: n(ledger30.paid),
      fees30d: n(ledger30.fees),
      netMargin30d: n(ledger30.revenue) - n(ledger30.marketing) - n(ledger30.goodwill) - n(ledger30.loss) + n(ledger30.fees),
    },
    queues: {
      payoutsReview: n(q.payouts_review),
      payoutsInflight: n(q.payouts_inflight),
      claimsOpen: n(q.claims_open),
      claimsBreached: n(q.claims_breached),
      fraudOpen: n(q.fraud_open),
      ticketsOpen: n(q.tickets_open),
      ticketsBreached: n(q.tickets_breached),
      kycPending: n(q.kyc_pending),
      jobsDead: n(q.jobs_dead),
      offersFlagged: n(q.offers_flagged),
    },
    postbacks: { last24h: pb1, last30d: pb30 },
    series: days.map((day) => {
      const r = seriesMap.get(day);
      return { day, gross: n(r?.gross), earned: n(r?.earned), paid: n(r?.paid), signups: signupMap.get(day) ?? 0 };
    }),
  };
}

/* ------------------------------------------------------------------ users */

export async function listUsers(ctx: AppContext, opts: { q?: string; status?: string; risk?: string; page?: number }) {
  const conds = [];
  if (opts.q) {
    const like = `%${opts.q.trim()}%`;
    conds.push(or(ilike(users.email, like), ilike(users.displayName, like), ilike(users.referralCode, like), sql`${users.id}::text = ${opts.q.trim()}`));
  }
  if (opts.status) conds.push(eq(users.status, opts.status as UserStatus));
  if (opts.risk) conds.push(eq(users.riskLevel, opts.risk as 'low'));
  const page = Math.max(1, opts.page ?? 1);
  const rows = await ctx.db
    .select({ user: users, wallet: wallets })
    .from(users)
    .leftJoin(wallets, eq(wallets.userId, users.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(users.createdAt))
    .limit(50)
    .offset((page - 1) * 50);
  return rows.map(({ user, wallet }) => ({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    country: user.country,
    status: user.status,
    role: user.role,
    tier: user.tier,
    riskScore: user.riskScore,
    riskLevel: user.riskLevel,
    kycStatus: user.kycStatus,
    emailVerified: !!user.emailVerifiedAt,
    phoneVerified: !!user.phoneVerifiedAt,
    availableMicros: wallet?.availableMicros ?? 0,
    pendingMicros: wallet?.pendingMicros ?? 0,
    lifetimeEarnedMicros: wallet?.lifetimeEarnedMicros ?? 0,
    createdAt: user.createdAt.toISOString(),
    lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
    isSeed: user.isSeed,
  }));
}

export async function userDetail(ctx: AppContext, id: string) {
  const [user] = await ctx.db.select().from(users).where(eq(users.id, id));
  if (!user) throw notFound('User not found');
  const [wallet] = await ctx.db.select().from(wallets).where(eq(wallets.userId, id));
  const linked = await withUow(ctx, (uow) => linkedAccounts(uow, id));
  const [txs, pays, cls, signals, cases, devs, sess, notesRows, refsAsReferrer, kyc, logins, referrer] = await Promise.all([
    ctx.db.select().from(transactions).where(eq(transactions.userId, id)).orderBy(desc(transactions.createdAt)).limit(60),
    ctx.db.select().from(payouts).where(eq(payouts.userId, id)).orderBy(desc(payouts.createdAt)).limit(30),
    ctx.db.select({ claim: claims, title: offers.title }).from(claims).innerJoin(offers, eq(offers.id, claims.offerId)).where(eq(claims.userId, id)).orderBy(desc(claims.createdAt)),
    ctx.db.select().from(riskSignals).where(eq(riskSignals.userId, id)).orderBy(desc(riskSignals.createdAt)),
    ctx.db.select().from(fraudCases).where(eq(fraudCases.userId, id)).orderBy(desc(fraudCases.openedAt)),
    ctx.db.select().from(devices).where(eq(devices.userId, id)).orderBy(desc(devices.lastSeenAt)),
    ctx.db.select().from(sessions).where(and(eq(sessions.userId, id), isNull(sessions.revokedAt))).orderBy(desc(sessions.lastSeenAt)),
    ctx.db.select({ note: userNotes, author: users.displayName }).from(userNotes).leftJoin(users, eq(users.id, userNotes.authorId)).where(eq(userNotes.userId, id)).orderBy(desc(userNotes.createdAt)),
    ctx.db.select({ r: referrals, name: users.displayName }).from(referrals).innerJoin(users, eq(users.id, referrals.refereeId)).where(eq(referrals.referrerId, id)),
    ctx.db.select().from(kycSubmissions).where(eq(kycSubmissions.userId, id)).orderBy(desc(kycSubmissions.createdAt)),
    ctx.db.select().from(loginEvents).where(eq(loginEvents.userId, id)).orderBy(desc(loginEvents.createdAt)).limit(20),
    user.referredById ? ctx.db.select({ id: users.id, displayName: users.displayName, email: users.email }).from(users).where(eq(users.id, user.referredById)) : Promise.resolve([]),
  ]);
  const { passwordHash: _p, totpSecretEnc: _t, ...safeUser } = user;
  return {
    user: { ...safeUser, twoFactorEnabled: !!user.totpEnabledAt },
    wallet,
    transactions: txs,
    payouts: pays.map(({ destinationEnc: _e, ...p }) => p),
    claims: cls.map((c) => ({ ...c.claim, offerTitle: c.title })),
    signals: signals.map((s) => ({ ...s, label: SIGNALS[s.code as keyof typeof SIGNALS]?.label ?? s.code })),
    cases,
    devices: devs,
    sessions: sess.map(({ tokenHash: _h, ...s }) => s),
    notes: notesRows.map((r) => ({ ...r.note, authorName: r.author })),
    referrals: refsAsReferrer.map((r) => ({ ...r.r, refereeName: r.name })),
    referrer: referrer[0] ?? null,
    kyc,
    logins,
    linked,
  };
}

export async function setUserStatus(ctx: AppContext, actorId: string, id: string, status: 'active' | 'restricted' | 'banned', reason: string, ip: string | null) {
  await withUow(ctx, async (uow) => {
    const [u] = await uow.tx.select().from(users).where(eq(users.id, id)).for('update');
    if (!u) throw notFound();
    if (u.role === 'admin' && status !== 'active') throw badRequest('Demote the admin before restricting them');
    await uow.tx.update(users).set({ status, statusReason: status === 'active' ? null : reason, updatedAt: clock.now() }).where(eq(users.id, id));
    if (status === 'banned') {
      // Unsent cash outs are refunded to the (frozen) balance; nothing is confiscated without review.
      const open = await uow.tx.select({ id: payouts.id }).from(payouts).where(and(eq(payouts.userId, id), inArray(payouts.status, ['pending', 'review'])));
      uow.afterCommit(async () => {
        for (const p of open) await finalizeFailure(ctx, p.id, 'rejected', 'Account suspended pending review', actorId);
      });
    }
    await audit(uow.tx, actorId, `user.${status}`, 'user', id, { reason, previous: u.status }, ip);
    await notify(uow, id, {
      type: 'security',
      title: status === 'active' ? 'Your account is fully active again' : `Your account is ${status}`,
      body: status === 'active' ? 'Thanks for your patience. Everything works normally again.' : `Reason: ${reason}. You can appeal from Support — a human replies within 48 hours.`,
      link: status === 'active' ? '/app' : '/app/support/new?category=appeal',
      email:
        status === 'active'
          ? undefined
          : { category: 'security', template: 'account_status', content: templates.accountStatus(u.displayName, status, reason, `${ctx.config.PUBLIC_WEB_URL}/app/support/new?category=appeal`) },
    });
  });
}

export async function adjustBalance(ctx: AppContext, actorId: string, id: string, amount: number, reason: string, ip: string | null) {
  await withUow(ctx, async (uow) => {
    const w = await lockWallet(uow.tx, id);
    if (amount < 0 && w.availableMicros + amount < 0) throw badRequest(`Can only remove up to ${formatMoney(w.availableMicros)} (available balance)`);
    if (amount > 0) {
      await creditUser(uow, {
        userId: id,
        type: 'adjustment',
        description: `Adjustment: ${reason}`,
        idempotencyKey: `adjust:${randomToken(12)}`,
        amountMicros: amount,
        source: { account: acct.adjustments },
        earning: false,
        meta: { actorId, reason },
      });
    } else {
      const txId = crypto.randomUUID();
      await postEntry(uow.tx, {
        kind: 'adjustment',
        idempotencyKey: `adjust:${randomToken(12)}`,
        transactionId: txId,
        memo: reason,
        postings: [
          { account: acct.available(id), amount },
          { account: acct.adjustments, amount: -amount },
        ],
      });
      await uow.tx.insert(transactions).values({
        id: txId,
        userId: id,
        type: 'adjustment',
        status: 'completed',
        amountMicros: amount,
        description: `Adjustment: ${reason}`,
        meta: { actorId, reason },
        createdAt: clock.now(),
        settledAt: clock.now(),
      });
    }
    await audit(uow.tx, actorId, 'user.adjust_balance', 'user', id, { amount, reason }, ip);
    await notify(uow, id, { type: 'system', title: `Balance adjusted ${amount > 0 ? '+' : ''}${formatMoney(amount)}`, body: reason, link: '/app/wallet' });
  });
}

export async function addNote(ctx: AppContext, actorId: string, userId: string, note: string) {
  await ctx.db.insert(userNotes).values({ userId, authorId: actorId, note, createdAt: clock.now() });
}

export async function setRole(ctx: AppContext, actorId: string, userId: string, role: 'user' | 'support' | 'admin', ip: string | null) {
  if (actorId === userId) throw badRequest('You can’t change your own role');
  await ctx.db.update(users).set({ role, updatedAt: clock.now() }).where(eq(users.id, userId));
  await audit(ctx.db, actorId, 'user.role', 'user', userId, { role }, ip);
}

export async function flagUser(ctx: AppContext, actorId: string, userId: string, note: string) {
  await withUow(ctx, async (uow) => {
    await addSignal(uow, userId, 'manual_flag', { note, actorId });
    await audit(uow.tx, actorId, 'user.flag', 'user', userId, { note });
  });
}

export async function revokeAllSessions(ctx: AppContext, actorId: string, userId: string) {
  await revokeOtherSessions(ctx.db, userId, null);
  await audit(ctx.db, actorId, 'user.revoke_sessions', 'user', userId);
}

/* ---------------------------------------------------------------- payouts */

export async function listAdminPayouts(ctx: AppContext, status?: string) {
  const rows = await ctx.db
    .select({ p: payouts, email: users.email, name: users.displayName, risk: users.riskLevel, riskScore: users.riskScore, method: payoutMethods.name, logo: payoutMethods.logo, country: users.country })
    .from(payouts)
    .innerJoin(users, eq(users.id, payouts.userId))
    .innerJoin(payoutMethods, eq(payoutMethods.id, payouts.methodId))
    .where(status ? eq(payouts.status, status as 'pending') : undefined)
    .orderBy(status === 'review' ? asc(payouts.createdAt) : desc(payouts.createdAt))
    .limit(200);
  return rows.map(({ p, ...r }) => {
    const { destinationEnc: _e, ...rest } = p;
    return { ...rest, userEmail: r.email, userName: r.name, riskLevel: r.risk, riskScore: r.riskScore, methodName: r.method, methodLogo: r.logo, country: r.country };
  });
}

/* ------------------------------------------------------------------ fraud */

export async function listFraudCases(ctx: AppContext, status = 'open') {
  const rows = await ctx.db
    .select({ c: fraudCases, email: users.email, name: users.displayName, userStatus: users.status, country: users.country })
    .from(fraudCases)
    .innerJoin(users, eq(users.id, fraudCases.userId))
    .where(eq(fraudCases.status, status as 'open'))
    .orderBy(desc(fraudCases.score), asc(fraudCases.openedAt))
    .limit(200);
  return rows.map((r) => ({ ...r.c, userEmail: r.email, userName: r.name, userStatus: r.userStatus, country: r.country }));
}

export async function resolveFraudCase(ctx: AppContext, actorId: string, caseId: string, action: 'clear' | 'restrict' | 'ban', note: string, ip: string | null) {
  const [c] = await ctx.db.select().from(fraudCases).where(eq(fraudCases.id, caseId));
  if (!c) throw notFound();
  if (c.status !== 'open') throw conflict('Case already resolved');
  if (action === 'clear') {
    await withUow(ctx, async (uow) => {
      await clearSignals(uow, c.userId);
      await uow.tx.update(fraudCases).set({ status: 'cleared', resolution: note, resolvedById: actorId, resolvedAt: clock.now() }).where(eq(fraudCases.id, caseId));
      // Payouts held only because of risk go back into the automatic queue.
      const held = await uow.tx.select({ id: payouts.id }).from(payouts).where(and(eq(payouts.userId, c.userId), eq(payouts.status, 'review')));
      for (const p of held) {
        await uow.tx.update(payouts).set({ status: 'pending', statusReason: null, reviewedById: actorId, updatedAt: clock.now() }).where(eq(payouts.id, p.id));
        await enqueue(uow.tx, 'payout.process', { payoutId: p.id }, { dedupeKey: `payout:${p.id}:process:${Date.now()}` });
      }
      await audit(uow.tx, actorId, 'fraud.clear', 'user', c.userId, { caseId, note }, ip);
    });
  } else {
    await ctx.db.update(fraudCases).set({ status: 'actioned', resolution: `${action}: ${note}`, resolvedById: actorId, resolvedAt: clock.now() }).where(eq(fraudCases.id, caseId));
    await setUserStatus(ctx, actorId, c.userId, action === 'ban' ? 'banned' : 'restricted', note, ip);
  }
}

/* ----------------------------------------------------------------- claims */

export async function listAdminClaims(ctx: AppContext, status?: string) {
  const rows = await ctx.db
    .select({ c: claims, title: offers.title, icon: offers.icon, networkId: offers.networkId, email: users.email, name: users.displayName, tier: users.tier, risk: users.riskLevel })
    .from(claims)
    .innerJoin(offers, eq(offers.id, claims.offerId))
    .innerJoin(users, eq(users.id, claims.userId))
    .where(status ? eq(claims.status, status as 'in_review') : undefined)
    .orderBy(asc(claims.slaDueAt))
    .limit(200);
  const clickIds = rows.map((r) => r.c.clickId);
  const evidence = clickIds.length
    ? await ctx.db.select().from(postbacks).where(inArray(postbacks.clickId, clickIds))
    : [];
  const clicks = clickIds.length ? await ctx.db.select().from(offerClicks).where(inArray(offerClicks.id, clickIds)) : [];
  return rows.map((r) => ({
    ...r.c,
    offerTitle: r.title,
    offerIcon: r.icon,
    networkId: r.networkId,
    userEmail: r.email,
    userName: r.name,
    userTier: r.tier,
    userRisk: r.risk,
    click: clicks.find((c) => c.id === r.c.clickId) ?? null,
    postbacks: evidence.filter((p) => p.clickId === r.c.clickId).map((p) => ({ id: p.id, status: p.status, reason: p.statusReason, at: p.createdAt })),
  }));
}

/* ------------------------------------------------------------------ offers */

export async function listAdminOffers(ctx: AppContext) {
  const rows = await ctx.db.select().from(offers).orderBy(asc(offers.status), desc(offers.featured), desc(offers.createdAt));
  const clickCounts = await ctx.db
    .select({ offerId: offerClicks.offerId, clicks: sql<number>`count(*)::int`, credited: sql<number>`count(*) filter (where ${offerClicks.status} = 'credited')::int` })
    .from(offerClicks)
    .groupBy(offerClicks.offerId);
  const map = new Map(clickCounts.map((c) => [c.offerId, c]));
  return rows.map((o) => ({ ...o, clicks: n(map.get(o.id)?.clicks), creditedClicks: n(map.get(o.id)?.credited) }));
}

function offerValues(input: AdminOfferInput) {
  return {
    networkId: input.networkId,
    externalId: input.externalId || `manual-${randomToken(6)}`,
    title: input.title,
    advertiser: input.advertiser,
    shortDescription: input.shortDescription,
    description: input.description,
    category: input.category,
    icon: input.icon,
    brandColor: input.brandColor,
    partnerPayoutMicros: input.partnerPayoutMicros,
    estimatedMinutes: input.estimatedMinutes,
    dataUsage: input.dataUsage,
    steps: input.steps,
    requirements: input.requirements,
    goals: input.goals,
    countries: input.countries,
    platforms: input.platforms,
    holdHours: input.holdHours,
    conversionWindowHours: input.conversionWindowHours,
    featured: input.featured,
    status: input.status,
    sandboxDropPostback: input.sandboxDropPostback,
    sandboxDelaySeconds: input.sandboxDelaySeconds,
  };
}

export async function createOffer(ctx: AppContext, actorId: string, input: AdminOfferInput) {
  const [net] = await ctx.db.select().from(networks).where(eq(networks.id, input.networkId));
  if (!net) throw badRequest('Unknown network');
  const [o] = await ctx.db.insert(offers).values({ ...offerValues(input), createdAt: clock.now(), updatedAt: clock.now() }).returning();
  await audit(ctx.db, actorId, 'offer.create', 'offer', o.id, { title: o.title });
  return o;
}

export async function updateOffer(ctx: AppContext, actorId: string, id: string, input: Partial<AdminOfferInput>) {
  const [existing] = await ctx.db.select().from(offers).where(eq(offers.id, id));
  if (!existing) throw notFound();
  const patch: Record<string, unknown> = { updatedAt: clock.now() };
  for (const [k, v] of Object.entries(input)) if (v !== undefined) patch[k] = v;
  if (input.status === 'active' && existing.status === 'paused') {
    await ctx.db.update(offerReports).set({ status: 'resolved' }).where(and(eq(offerReports.offerId, id), eq(offerReports.status, 'open')));
    patch.reportsOpen = 0;
  }
  const [o] = await ctx.db.update(offers).set(patch).where(eq(offers.id, id)).returning();
  await audit(ctx.db, actorId, 'offer.update', 'offer', id, { changes: Object.keys(input) });
  return o;
}

export async function offerReportsList(ctx: AppContext, offerId: string) {
  return ctx.db
    .select({ r: offerReports, name: users.displayName })
    .from(offerReports)
    .innerJoin(users, eq(users.id, offerReports.userId))
    .where(eq(offerReports.offerId, offerId))
    .orderBy(desc(offerReports.createdAt));
}

/* ---------------------------------------------------------------- networks */

export async function listNetworks(ctx: AppContext, baseUrl: string) {
  const rows = await ctx.db.select().from(networks).orderBy(asc(networks.name));
  const stats = await ctx.db
    .select({
      networkId: postbacks.networkId,
      total: sql<number>`count(*)::int`,
      credited: sql<number>`count(*) filter (where ${postbacks.status} in ('credited','held'))::int`,
      errors: sql<number>`count(*) filter (where ${postbacks.status} in ('error','rejected'))::int`,
      last: sql<string>`max(${postbacks.createdAt})`,
    })
    .from(postbacks)
    .where(gte(postbacks.createdAt, new Date(clock.ms() - 30 * DAY)))
    .groupBy(postbacks.networkId);
  const m = new Map(stats.map((s) => [s.networkId, s]));
  return rows.map(({ secretEnc, ...net }) => {
    const pm = net.paramMap;
    const example = Object.entries({ [pm.clickId ?? 'click_id']: '{CLICK_ID}', [pm.txId]: '{TX_ID}', ...(pm.payout ? { [pm.payout]: '{PAYOUT}' } : {}), ...(pm.status ? { [pm.status]: '{STATUS}' } : {}) })
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    return {
      ...net,
      hasSecret: !!secretEnc,
      postbackUrl: `${baseUrl}/api/postback/${net.id}?${example}`,
      stats30d: { total: n(m.get(net.id)?.total), credited: n(m.get(net.id)?.credited), errors: n(m.get(net.id)?.errors), last: m.get(net.id)?.last ?? null },
    };
  });
}

export async function updateNetwork(ctx: AppContext, actorId: string, id: string, patch: { status?: 'active' | 'disabled'; ipAllowlist?: string[]; revenueShareBps?: number | null }) {
  const [net] = await ctx.db.update(networks).set({ ...patch, updatedAt: clock.now() }).where(eq(networks.id, id)).returning();
  if (!net) throw notFound();
  await audit(ctx.db, actorId, 'network.update', 'network', id, patch);
}

export async function rotateNetworkSecret(ctx: AppContext, actorId: string, id: string) {
  const secret = randomToken(24);
  const [net] = await ctx.db.update(networks).set({ secretEnc: ctx.vault.encrypt(secret), updatedAt: clock.now() }).where(eq(networks.id, id)).returning();
  if (!net) throw notFound();
  await audit(ctx.db, actorId, 'network.rotate_secret', 'network', id);
  return secret;
}

/* --------------------------------------------------------------- postbacks */

export async function listPostbacks(ctx: AppContext, opts: { status?: string; networkId?: string; q?: string }) {
  const conds = [];
  if (opts.status) conds.push(eq(postbacks.status, opts.status as 'credited'));
  if (opts.networkId) conds.push(eq(postbacks.networkId, opts.networkId));
  if (opts.q) conds.push(or(ilike(postbacks.externalTxId, `%${opts.q}%`), sql`${postbacks.clickId}::text = ${opts.q}`, sql`${postbacks.userId}::text = ${opts.q}`));
  return ctx.db
    .select({ p: postbacks, email: users.email, offerTitle: offers.title })
    .from(postbacks)
    .leftJoin(users, eq(users.id, postbacks.userId))
    .leftJoin(offers, eq(offers.id, postbacks.offerId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(postbacks.createdAt))
    .limit(200)
    .then((rows) => rows.map((r) => ({ ...r.p, userEmail: r.email, offerTitle: r.offerTitle })));
}

/* ------------------------------------------------------------------ ledger */

export async function trialBalance(ctx: AppContext) {
  const rows = await ctx.db
    .select({ account: ledgerPostings.account, total: sql<string>`sum(${ledgerPostings.amountMicros})` })
    .from(ledgerPostings)
    .groupBy(ledgerPostings.account);
  let userAvailable = 0;
  let userPending = 0;
  const platform: Array<{ account: string; balanceMicros: number }> = [];
  let grand = 0;
  for (const r of rows) {
    const v = n(r.total);
    grand += v;
    if (r.account.endsWith(':available')) userAvailable += v;
    else if (r.account.endsWith(':pending')) userPending += v;
    else platform.push({ account: r.account, balanceMicros: v });
  }
  platform.sort((a, b) => a.account.localeCompare(b.account));
  const [entries] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(ledgerEntries);
  return { balanced: grand === 0, sumMicros: grand, entries: n(entries.n), userAvailableMicros: userAvailable, userPendingMicros: userPending, accounts: platform };
}

/** Verifies the wallet cache equals the ledger for every member. */
export async function reconcile(ctx: AppContext) {
  const ledgerRows = await ctx.db.execute(sql`
    select split_part(account, ':', 2) as user_id,
      coalesce(sum(amount_micros) filter (where account like '%:available'), 0)::bigint as available,
      coalesce(sum(amount_micros) filter (where account like '%:pending'), 0)::bigint as pending
    from ledger_postings where account like 'user:%' group by 1`);
  const rows = ((ledgerRows as { rows?: Record<string, unknown>[] }).rows ?? (ledgerRows as unknown as Record<string, unknown>[])) as Array<{ user_id: string; available: number; pending: number }>;
  const ws = await ctx.db.select().from(wallets);
  const byUser = new Map(rows.map((r) => [r.user_id, r]));
  const mismatches = [];
  for (const w of ws) {
    const l = byUser.get(w.userId);
    const la = n(l?.available);
    const lp = n(l?.pending);
    if (la !== w.availableMicros || lp !== w.pendingMicros) mismatches.push({ userId: w.userId, walletAvailable: w.availableMicros, ledgerAvailable: la, walletPending: w.pendingMicros, ledgerPending: lp });
  }
  return { checkedWallets: ws.length, mismatches, ok: mismatches.length === 0, at: clock.now().toISOString() };
}

export async function recentEntries(ctx: AppContext) {
  const entries = await ctx.db.select().from(ledgerEntries).orderBy(desc(ledgerEntries.createdAt)).limit(40);
  const ids = entries.map((e) => e.id);
  const posts = ids.length ? await ctx.db.select().from(ledgerPostings).where(inArray(ledgerPostings.entryId, ids)) : [];
  return entries.map((e) => ({ ...e, postings: posts.filter((p) => p.entryId === e.id).map((p) => ({ account: p.account, amountMicros: p.amountMicros })) }));
}

/* --------------------------------------------------------------- analytics */

export async function analytics(ctx: AppContext) {
  const d30 = new Date(clock.ms() - 30 * DAY);
  const rowsOf = (r: unknown) => ((r as { rows?: Record<string, unknown>[] }).rows ?? (r as Record<string, unknown>[])) as Record<string, unknown>[];
  const [funnel] = rowsOf(
    await ctx.db.execute(sql`
    select count(*)::int as signed_up,
      count(*) filter (where u.email_verified_at is not null)::int as verified,
      count(*) filter (where exists (select 1 from transactions t where t.user_id = u.id and t.type in ('offer','video','goodwill')))::int as first_earning,
      count(*) filter (where exists (select 1 from payouts p where p.user_id = u.id and p.status = 'completed'))::int as first_payout
    from users u where u.created_at >= ${d30} and u.role = 'user'`),
  );
  const cohorts = rowsOf(
    await ctx.db.execute(sql`
    with c as (
      select u.id, date_trunc('week', u.created_at) as cohort, u.created_at::date as d0 from users u where u.created_at >= ${new Date(clock.ms() - 56 * DAY)} and u.role = 'user'
    )
    select to_char(cohort, 'YYYY-MM-DD') as cohort, count(*)::int as size,
      count(*) filter (where exists (select 1 from user_activity_days a where a.user_id = c.id and a.day::date = c.d0 + 1))::int as d1,
      count(*) filter (where exists (select 1 from user_activity_days a where a.user_id = c.id and a.day::date between c.d0 + 7 and c.d0 + 13))::int as d7,
      count(*) filter (where exists (select 1 from user_activity_days a where a.user_id = c.id and a.day::date between c.d0 + 30 and c.d0 + 36))::int as d30
    from c group by cohort order by cohort`),
  );
  const [ttfp] = rowsOf(
    await ctx.db.execute(sql`
    select percentile_cont(0.5) within group (order by extract(epoch from (fp.first_at - u.created_at)) / 3600) as median_hours
    from users u join (select user_id, min(completed_at) as first_at from payouts where status = 'completed' group by user_id) fp on fp.user_id = u.id`),
  );
  const [arpu] = rowsOf(
    await ctx.db.execute(sql`
    select coalesce(sum(amount_micros) filter (where type in ('offer','video','goodwill') and amount_micros > 0), 0)::bigint as earned,
      count(distinct user_id)::int as earners, coalesce(avg(amount_micros) filter (where type = 'payout' and status = 'completed'), 0)::bigint as avg_payout
    from transactions where created_at >= ${d30}`),
  );
  const [completion] = rowsOf(
    await ctx.db.execute(sql`select count(*)::int as clicks, count(*) filter (where status in ('credited','reversed'))::int as credited from offer_clicks where started_at >= ${d30}`),
  );
  const [refRate] = rowsOf(await ctx.db.execute(sql`select count(*)::int as total, count(*) filter (where referred_by_id is not null)::int as referred from users where role = 'user'`));
  const topOffers = rowsOf(
    await ctx.db.execute(sql`
    select o.title, o.icon, o.category, count(c.*)::int as conversions,
      coalesce(sum(c.partner_payout_micros), 0)::bigint as gross, coalesce(sum(c.user_payout_micros), 0)::bigint as paid_to_users
    from offers o join offer_clicks c on c.offer_id = o.id and c.status = 'credited' and c.credited_at >= ${d30}
    group by o.id order by gross desc limit 8`),
  );
  const categories = rowsOf(
    await ctx.db.execute(sql`
    select o.category, count(*)::int as conversions, coalesce(sum(c.user_payout_micros), 0)::bigint as paid_to_users
    from offer_clicks c join offers o on o.id = c.offer_id where c.status = 'credited' and c.credited_at >= ${d30} group by o.category order by 2 desc`),
  );
  const [fraud] = rowsOf(
    await ctx.db.execute(sql`select count(*) filter (where risk_level <> 'low')::int as flagged, count(*) filter (where status = 'banned')::int as banned, count(*)::int as total from users where role = 'user'`),
  );
  const pb = await postbackStats(ctx, 30);
  return {
    funnel: { signedUp: n(funnel?.signed_up), verified: n(funnel?.verified), firstEarning: n(funnel?.first_earning), firstPayout: n(funnel?.first_payout) },
    cohorts: cohorts.map((c) => ({ cohort: String(c.cohort), size: n(c.size), d1: n(c.d1), d7: n(c.d7), d30: n(c.d30) })),
    medianHoursToFirstPayout: ttfp?.median_hours != null ? Math.round(n(ttfp.median_hours) * 10) / 10 : null,
    arpu30dMicros: n(arpu?.earners) ? Math.round(n(arpu.earned) / n(arpu.earners)) : 0,
    avgPayoutMicros: n(arpu?.avg_payout) * -1,
    offerCompletionRate: n(completion?.clicks) ? n(completion.credited) / n(completion.clicks) : null,
    referralRate: n(refRate?.total) ? n(refRate.referred) / n(refRate.total) : null,
    fraudRate: n(fraud?.total) ? n(fraud.flagged) / n(fraud.total) : null,
    bannedUsers: n(fraud?.banned),
    postbacks: pb,
    topOffers: topOffers.map((o) => ({ title: String(o.title), icon: String(o.icon), category: String(o.category), conversions: n(o.conversions), grossMicros: n(o.gross), paidToUsersMicros: n(o.paid_to_users) })),
    categories: categories.map((c) => ({ category: String(c.category), conversions: n(c.conversions), paidToUsersMicros: n(c.paid_to_users) })),
  };
}

/* ------------------------------------------------------------- misc lists */

export async function listAudit(ctx: AppContext) {
  return ctx.db
    .select({ a: auditLogs, actor: users.displayName, actorEmail: users.email })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(300)
    .then((rows) => rows.map((r) => ({ ...r.a, actorName: r.actor ?? 'System', actorEmail: r.actorEmail })));
}

export async function listJobs(ctx: AppContext, status?: string) {
  return ctx.db
    .select()
    .from(jobs)
    .where(status ? eq(jobs.status, status as 'dead') : inArray(jobs.status, ['queued', 'running', 'dead']))
    .orderBy(desc(jobs.updatedAt))
    .limit(200);
}

export async function retryJob(ctx: AppContext, actorId: string, id: string) {
  await ctx.db.update(jobs).set({ status: 'queued', runAt: clock.now(), attempts: 0, lastError: null }).where(eq(jobs.id, id));
  await audit(ctx.db, actorId, 'job.retry', 'job', id);
}

export async function listOutbox(ctx: AppContext, limit = 100) {
  return ctx.db.select().from(outboundMessages).orderBy(desc(outboundMessages.createdAt)).limit(limit);
}

export async function listAdminTickets(ctx: AppContext, status?: string) {
  const rows = await ctx.db
    .select({ t: supportTickets, email: users.email, name: users.displayName, tier: users.tier })
    .from(supportTickets)
    .innerJoin(users, eq(users.id, supportTickets.userId))
    .where(status ? eq(supportTickets.status, status as 'open') : undefined)
    .orderBy(asc(supportTickets.slaDueAt))
    .limit(200);
  return rows.map((r) => ({ ...r.t, userEmail: r.email, userName: r.name, userTier: r.tier, breached: r.t.status === 'open' && r.t.slaDueAt.getTime() < clock.ms() }));
}

export async function listKycQueue(ctx: AppContext) {
  return ctx.db
    .select({ k: kycSubmissions, email: users.email, name: users.displayName })
    .from(kycSubmissions)
    .innerJoin(users, eq(users.id, kycSubmissions.userId))
    .where(eq(kycSubmissions.status, 'pending'))
    .orderBy(asc(kycSubmissions.createdAt))
    .then((rows) => rows.map((r) => ({ ...r.k, userEmail: r.email, userName: r.name })));
}

