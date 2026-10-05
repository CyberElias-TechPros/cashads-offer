import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import {
  COUNTRY_BY_CODE,
  TRANSACTION_TYPE_META,
  type AccountHealthDTO,
  type KycSubmitInput,
  type MeResponse,
  type OnboardingInput,
  type ProfileUpdateInput,
  type SessionDTO,
  type TaxSummaryDTO,
  type TransactionType,
  type UserDTO,
  type UserPreferences,
  type WalletDTO,
} from '@cashads/shared';
import { withUow, type AppContext } from '../../context';
import type { Q } from '../../db/client';
import {
  claims,
  devices,
  fxRates,
  kycSubmissions,
  loginEvents,
  notifications,
  payoutDestinations,
  payouts,
  referrals,
  sessions,
  supportTickets,
  ticketMessages,
  transactions,
  uploads,
  users,
  wallets,
} from '../../db/schema';
import { enqueue } from '../../jobs/queue';
import { badRequest, conflict } from '../../lib/errors';
import { clock } from '../../lib/clock';
import { sha256, verifyPassword } from '../../lib/crypto';
import { addSignal } from '../fraud/service';
import { recomputeTier } from '../engagement/service';
import { notify, unreadCount } from '../notifications/service';
import { revokeOtherSessions } from '../auth/service';

type UserRow = typeof users.$inferSelect;

export const DEFAULT_PREFERENCES: UserPreferences = {
  dataSaver: false,
  theme: 'system',
  emailPayouts: true,
  emailCredits: false,
  emailStreak: false,
  emailProduct: false,
  leaderboardOptIn: true,
  showLocalCurrency: true,
  interests: [],
  dailyMinutes: 15,
};

export function preferencesOf(u: UserRow): UserPreferences {
  return { ...DEFAULT_PREFERENCES, ...(u.preferences ?? {}) };
}

export function userDTO(u: UserRow): UserDTO {
  return {
    id: u.id,
    email: u.email,
    emailVerified: !!u.emailVerifiedAt,
    phone: u.phone,
    phoneVerified: !!u.phoneVerifiedAt,
    displayName: u.displayName,
    country: u.country,
    timezone: u.timezone,
    role: u.role,
    status: u.status,
    statusReason: u.statusReason,
    tier: u.tier,
    kycStatus: u.kycStatus,
    referralCode: u.referralCode,
    twoFactorEnabled: !!u.totpEnabledAt,
    onboardingCompleted: !!u.onboardingCompletedAt,
    hasPassword: !!u.passwordHash,
    createdAt: u.createdAt.toISOString(),
    preferences: preferencesOf(u),
    goal: u.goalLabel && u.goalTargetMicros ? { label: u.goalLabel, targetMicros: u.goalTargetMicros } : null,
  };
}

export async function walletDTO(q: Q, userId: string): Promise<WalletDTO> {
  const [w] = await q.select().from(wallets).where(eq(wallets.userId, userId));
  const [next] = await q
    .select({ at: transactions.availableAt, amount: transactions.amountMicros })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.status, 'pending'), sql`${transactions.availableAt} is not null`, sql`${transactions.amountMicros} > 0`))
    .orderBy(asc(transactions.availableAt))
    .limit(1);
  return {
    availableMicros: w?.availableMicros ?? 0,
    pendingMicros: w?.pendingMicros ?? 0,
    lifetimeEarnedMicros: w?.lifetimeEarnedMicros ?? 0,
    lifetimeWithdrawnMicros: w?.lifetimeWithdrawnMicros ?? 0,
    nextRelease: next?.at ? { amountMicros: next.amount, at: next.at.toISOString() } : null,
  };
}

export async function me(ctx: AppContext, u: UserRow, googleAuth: boolean): Promise<MeResponse> {
  const currency = COUNTRY_BY_CODE[u.country]?.currency;
  const [wallet, unread, fx] = await Promise.all([
    walletDTO(ctx.db, u.id),
    unreadCount(ctx.db, u.id),
    currency && currency !== 'USD' ? ctx.db.select().from(fxRates).where(eq(fxRates.currency, currency)) : Promise.resolve([]),
  ]);
  const banner = ctx.settings.get().maintenanceBanner;
  return {
    user: userDTO(u),
    wallet,
    unreadNotifications: unread,
    localCurrency: fx[0] ? { code: fx[0].currency, rate: fx[0].ratePerUsd } : null,
    flags: { demoMode: ctx.config.DEMO_MODE, maintenanceBanner: banner || null, googleAuth },
  };
}

export async function updateProfile(ctx: AppContext, u: UserRow, input: ProfileUpdateInput): Promise<UserDTO> {
  const patch: Partial<typeof users.$inferInsert> = { updatedAt: clock.now() };
  if (input.displayName) patch.displayName = input.displayName;
  if (input.timezone) patch.timezone = input.timezone;
  if (input.country && input.country !== u.country) {
    if (!COUNTRY_BY_CODE[input.country]) throw badRequest('Unsupported country');
    const [paid] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(payouts).where(eq(payouts.userId, u.id));
    if (Number(paid?.n ?? 0) > 0) throw badRequest('Your country can’t be changed after your first cash out — contact support if you moved.', 'country_locked');
    patch.country = input.country;
  }
  if (input.preferences) patch.preferences = { ...preferencesOf(u), ...input.preferences };
  const [updated] = await ctx.db.update(users).set(patch).where(eq(users.id, u.id)).returning();
  return userDTO(updated);
}

export async function completeOnboarding(ctx: AppContext, u: UserRow, input: OnboardingInput): Promise<UserDTO> {
  const [updated] = await ctx.db
    .update(users)
    .set({
      country: input.country,
      preferences: { ...preferencesOf(u), interests: input.interests, dailyMinutes: input.dailyMinutes, dataSaver: input.dataSaver },
      goalLabel: input.goal?.label ?? u.goalLabel,
      goalTargetMicros: input.goal?.targetMicros ?? u.goalTargetMicros,
      onboardingCompletedAt: u.onboardingCompletedAt ?? clock.now(),
      updatedAt: clock.now(),
    })
    .where(eq(users.id, u.id))
    .returning();
  return userDTO(updated);
}

export async function setGoal(ctx: AppContext, u: UserRow, goal: { label: string; targetMicros: number } | null): Promise<UserDTO> {
  const [updated] = await ctx.db
    .update(users)
    .set({ goalLabel: goal?.label ?? null, goalTargetMicros: goal?.targetMicros ?? null, updatedAt: clock.now() })
    .where(eq(users.id, u.id))
    .returning();
  return userDTO(updated);
}

export async function listSessions(ctx: AppContext, userId: string, currentId: string): Promise<SessionDTO[]> {
  const rows = await ctx.db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gte(sessions.expiresAt, clock.now())))
    .orderBy(desc(sessions.lastSeenAt));
  return rows.map((s) => ({
    id: s.id,
    deviceLabel: s.deviceLabel ?? 'Unknown device',
    ip: s.ip,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
    current: s.id === currentId,
  }));
}

export async function revokeUserSession(ctx: AppContext, userId: string, sessionId: string) {
  await ctx.db.update(sessions).set({ revokedAt: clock.now() }).where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
}

export async function loginHistory(ctx: AppContext, userId: string) {
  const rows = await ctx.db.select().from(loginEvents).where(eq(loginEvents.userId, userId)).orderBy(desc(loginEvents.createdAt)).limit(30);
  return rows.map((r) => ({ id: r.id, ip: r.ip, userAgent: r.userAgent, success: r.success, reason: r.reason, at: r.createdAt.toISOString() }));
}

export async function listDevices(ctx: AppContext, userId: string) {
  const rows = await ctx.db.select().from(devices).where(eq(devices.userId, userId)).orderBy(desc(devices.lastSeenAt));
  return rows.map((d) => ({ id: d.id, label: d.label ?? 'Unknown device', lastIp: d.lastIp, firstSeenAt: d.firstSeenAt.toISOString(), lastSeenAt: d.lastSeenAt.toISOString() }));
}

export function accountHealth(u: UserRow): AccountHealthDTO {
  const tips: string[] = [];
  if (!u.emailVerifiedAt) tips.push('Verify your email to unlock cash outs.');
  if (!u.phoneVerifiedAt) tips.push('Verify your phone — it speeds up reviews and is needed before your first cash out.');
  if (!u.totpEnabledAt) tips.push('Turn on two-factor authentication to protect your balance.');
  if (u.status === 'banned' || u.status === 'restricted') {
    return {
      level: 'restricted',
      title: u.status === 'banned' ? 'Your account is suspended' : 'Your account is restricted',
      description: u.statusReason ?? 'Our team restricted this account.',
      tips: ['You can appeal this decision from Support — a human replies within 48 hours.', ...tips],
      riskLevel: u.riskLevel,
    };
  }
  if (u.riskLevel !== 'low') {
    return {
      level: 'attention',
      title: 'Cash outs get a quick manual check',
      description: 'Some activity on your account needs a human look, so cash outs are reviewed before sending (usually within 24h). Earning works normally.',
      tips: ['Verifying your phone and identity usually clears this up.', ...tips],
      riskLevel: u.riskLevel,
    };
  }
  return { level: 'good', title: 'Your account is in great shape', description: 'Cash outs are sent automatically.', tips, riskLevel: u.riskLevel };
}

export async function exportData(ctx: AppContext, u: UserRow) {
  const [wallet, txs, pays, cls, tickets, devs, sess, logins, notes, refs] = await Promise.all([
    walletDTO(ctx.db, u.id),
    ctx.db.select().from(transactions).where(eq(transactions.userId, u.id)).orderBy(desc(transactions.createdAt)),
    ctx.db.select().from(payouts).where(eq(payouts.userId, u.id)).orderBy(desc(payouts.createdAt)),
    ctx.db.select().from(claims).where(eq(claims.userId, u.id)),
    ctx.db.select().from(supportTickets).where(eq(supportTickets.userId, u.id)),
    ctx.db.select().from(devices).where(eq(devices.userId, u.id)),
    ctx.db.select().from(sessions).where(eq(sessions.userId, u.id)),
    ctx.db.select().from(loginEvents).where(eq(loginEvents.userId, u.id)).orderBy(desc(loginEvents.createdAt)).limit(200),
    ctx.db.select().from(notifications).where(eq(notifications.userId, u.id)).orderBy(desc(notifications.createdAt)).limit(500),
    ctx.db.select().from(referrals).where(eq(referrals.referrerId, u.id)),
  ]);
  const ticketIds = tickets.map((t) => t.id);
  const msgs = ticketIds.length ? await ctx.db.select().from(ticketMessages).where(inArray(ticketMessages.ticketId, ticketIds)) : [];
  return {
    exportedAt: clock.now().toISOString(),
    profile: userDTO(u),
    wallet,
    transactions: txs.map((t) => ({ ...t, meta: undefined })),
    payouts: pays.map(({ destinationEnc: _e, destinationHash: _h, ...p }) => p),
    claims: cls,
    supportTickets: tickets.map((t) => ({ ...t, messages: msgs.filter((m) => m.ticketId === t.id) })),
    devices: devs.map(({ fingerprint: _f, ...d }) => d),
    sessions: sess.map(({ tokenHash: _t, ...s }) => s),
    loginHistory: logins,
    notifications: notes,
    referrals: refs.map((r) => ({ id: r.id, status: r.status, createdAt: r.createdAt, earnedMicros: r.earnedMicros })),
  };
}

export async function deleteAccount(ctx: AppContext, u: UserRow, password: string) {
  if (u.passwordHash && !(await verifyPassword(password, u.passwordHash))) throw badRequest('Password is incorrect', 'invalid_password');
  const wallet = await walletDTO(ctx.db, u.id);
  if (wallet.availableMicros >= 10_000 || wallet.pendingMicros > 0) {
    throw conflict('You still have money in your account. Cash it out first (no minimum!) — your earnings are yours.', 'balance_remaining', wallet);
  }
  const [inflight] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(payouts)
    .where(and(eq(payouts.userId, u.id), inArray(payouts.status, ['pending', 'review', 'processing'])));
  if (Number(inflight?.n ?? 0) > 0) throw conflict('Wait for your cash out to finish, then delete your account.', 'payout_in_flight');
  await withUow(ctx, async ({ tx }) => {
    // Personal data is erased; the financial ledger is kept (legally required) but anonymised.
    await tx
      .update(users)
      .set({
        status: 'deleted',
        deletedAt: clock.now(),
        email: `deleted+${u.id}@deleted.cashads.invalid`,
        displayName: 'Deleted member',
        phone: null,
        passwordHash: null,
        googleSub: null,
        totpSecretEnc: null,
        goalLabel: null,
        preferences: {},
        updatedAt: clock.now(),
      })
      .where(eq(users.id, u.id));
    await tx.update(payoutDestinations).set({ deletedAt: clock.now() }).where(eq(payoutDestinations.userId, u.id));
    await revokeOtherSessions(tx, u.id, null);
  });
}

/* --------------------------------------------------------------------- KYC */

export async function submitKyc(ctx: AppContext, u: UserRow, input: KycSubmitInput) {
  if (u.kycStatus === 'verified') throw badRequest('Your identity is already verified');
  if (u.kycStatus === 'pending') throw conflict('Your documents are being reviewed', 'kyc_pending');
  const owned = await ctx.db
    .select({ id: uploads.id })
    .from(uploads)
    .where(and(eq(uploads.userId, u.id), inArray(uploads.id, [input.documentUploadId, input.selfieUploadId])));
  if (owned.length !== 2) throw badRequest('Upload both your document and a selfie');
  const docHash = sha256(`${input.documentCountry}:${input.documentType}:${input.documentNumber.replace(/\s+/g, '').toUpperCase()}`);
  await withUow(ctx, async (uow) => {
    const [dup] = await uow.tx
      .select({ userId: kycSubmissions.userId })
      .from(kycSubmissions)
      .where(and(eq(kycSubmissions.documentNumberHash, docHash), ne(kycSubmissions.userId, u.id), eq(kycSubmissions.status, 'verified')));
    const [sub] = await uow.tx
      .insert(kycSubmissions)
      .values({
        userId: u.id,
        documentType: input.documentType,
        documentCountry: input.documentCountry,
        documentNumberLast4: input.documentNumber.slice(-4),
        documentNumberHash: docHash,
        legalName: input.legalName,
        dateOfBirth: input.dateOfBirth,
        documentUploadId: input.documentUploadId,
        selfieUploadId: input.selfieUploadId,
        status: 'pending',
      })
      .returning();
    await uow.tx.update(users).set({ kycStatus: 'pending', updatedAt: clock.now() }).where(eq(users.id, u.id));
    if (dup) {
      await addSignal(uow, u.id, 'shared_payout_destination', { reason: 'identity_document_reused', otherUserId: dup.userId });
    }
    // Sandbox auto-review (swap for Persona / Onfido / Smile ID webhooks in production).
    if (ctx.config.DEMO_MODE) await enqueue(uow.tx, 'kyc.auto_review', { submissionId: sub.id }, { delayMs: 8_000 });
  });
}

export async function decideKyc(ctx: AppContext, submissionId: string, decision: 'verified' | 'rejected', reason: string | null, actorId: string | null) {
  await withUow(ctx, async (uow) => {
    const [sub] = await uow.tx.select().from(kycSubmissions).where(eq(kycSubmissions.id, submissionId)).for('update');
    if (!sub || sub.status !== 'pending') return;
    await uow.tx.update(kycSubmissions).set({ status: decision, reason, reviewedById: actorId, decidedAt: clock.now() }).where(eq(kycSubmissions.id, sub.id));
    await uow.tx.update(users).set({ kycStatus: decision, updatedAt: clock.now() }).where(eq(users.id, sub.userId));
    if (decision === 'verified') {
      await addSignal(uow, sub.userId, 'kyc_verified', {});
      await recomputeTier(uow, sub.userId);
    }
    await notify(uow, sub.userId, {
      type: 'security',
      title: decision === 'verified' ? 'Identity verified ✅' : 'We couldn’t verify your identity',
      body: decision === 'verified' ? 'Large cash outs are unlocked.' : `${reason ?? 'The documents were unclear.'} You can submit again.`,
      link: '/app/settings/verification',
    });
  });
}

export async function autoReviewKyc(ctx: AppContext, submissionId: string) {
  const [sub] = await ctx.db.select().from(kycSubmissions).where(eq(kycSubmissions.id, submissionId));
  if (!sub || sub.status !== 'pending') return;
  const age = (clock.ms() - new Date(sub.dateOfBirth).getTime()) / (365.25 * 24 * 3600 * 1000);
  if (age < 18) return decideKyc(ctx, sub.id, 'rejected', 'You must be 18 or older to verify.', null);
  const [user] = await ctx.db.select({ riskLevel: users.riskLevel }).from(users).where(eq(users.id, sub.userId));
  if (user?.riskLevel === 'high') return; // leave for a human
  return decideKyc(ctx, sub.id, 'verified', null, null);
}

export async function latestKyc(ctx: AppContext, userId: string) {
  const [sub] = await ctx.db.select().from(kycSubmissions).where(eq(kycSubmissions.userId, userId)).orderBy(desc(kycSubmissions.createdAt)).limit(1);
  return sub ? { status: sub.status, reason: sub.reason, submittedAt: sub.createdAt.toISOString(), documentType: sub.documentType } : null;
}

/* --------------------------------------------------------------------- tax */

const TAX_GUIDANCE: Record<string, string[]> = {
  US: [
    'Rewards are generally taxable income in the US.',
    'If you are paid $600 or more in a calendar year, we will ask for a W-9 and issue a 1099-MISC by January 31.',
    'Keep this summary and the CSV export for your records.',
  ],
  GB: ['Occasional small rewards are usually not taxable, but regular earnings can count as trading income.', 'The £1,000 trading allowance may apply — check HMRC guidance.'],
  NG: ['Earnings may count as income under the Personal Income Tax Act.', 'Keep this summary for your annual self-assessment with your State Internal Revenue Service.'],
  IN: ['Rewards may be taxable as "income from other sources".', 'Keep this summary for your ITR filing.'],
};

export async function taxSummary(ctx: AppContext, u: UserRow, year: number): Promise<TaxSummaryDTO> {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));
  const rows = await ctx.db
    .select({ type: transactions.type, status: transactions.status, amount: transactions.amountMicros, createdAt: transactions.createdAt, meta: transactions.meta })
    .from(transactions)
    .where(and(eq(transactions.userId, u.id), gte(transactions.createdAt, start), lt(transactions.createdAt, end)));
  const [first] = await ctx.db.select({ min: sql<string>`min(${transactions.createdAt})` }).from(transactions).where(eq(transactions.userId, u.id));
  const firstYear = first?.min ? new Date(first.min).getUTCFullYear() : clock.now().getUTCFullYear();
  const years: number[] = [];
  for (let y = clock.now().getUTCFullYear(); y >= firstYear; y--) years.push(y);

  const byType = new Map<TransactionType, { amount: number; count: number }>();
  const byMonth = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, earnedMicros: 0, withdrawnMicros: 0 }));
  let earned = 0;
  let bonuses = 0;
  let withdrawn = 0;
  let fees = 0;
  for (const r of rows) {
    if (r.status === 'canceled' || r.status === 'reversed') continue;
    const group = TRANSACTION_TYPE_META[r.type].group;
    const m = byMonth[r.createdAt.getUTCMonth()];
    if (r.type === 'payout') {
      if (r.status !== 'completed') continue;
      withdrawn += -r.amount;
      fees += Number((r.meta as { feeMicros?: number }).feeMicros ?? 0);
      m.withdrawnMicros += -r.amount;
    } else if (r.amount > 0) {
      if (group === 'bonus') bonuses += r.amount;
      else earned += r.amount;
      m.earnedMicros += r.amount;
    }
    const agg = byType.get(r.type) ?? { amount: 0, count: 0 };
    agg.amount += r.amount;
    agg.count++;
    byType.set(r.type, agg);
  }
  return {
    year,
    years,
    totals: { earnedMicros: earned, bonusesMicros: bonuses, withdrawnMicros: withdrawn, feesMicros: fees },
    byType: [...byType.entries()].map(([type, v]) => ({ type, amountMicros: v.amount, count: v.count })).sort((a, b) => b.amountMicros - a.amountMicros),
    byMonth,
    country: u.country,
    guidance: [
      ...(TAX_GUIDANCE[u.country] ?? ['Rules differ by country — rewards may be taxable where you live.']),
      'This summary is provided for convenience and isn’t tax advice. When in doubt, ask a qualified tax professional.',
    ],
  };
}
