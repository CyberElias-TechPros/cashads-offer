import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  BAN_REASONS,
  type BanReasonCode,
  DEFAULT_PREFS,
  type MeDTO,
  type UserPrefs,
  getCountry,
  updatePrefsSchema,
  updateProfileSchema,
} from '@cashads/shared';
import type { z } from 'zod';
import type { AppContext } from '../../context';
import type { DbOrTx } from '../../db/client';
import {
  claims,
  devices,
  donations,
  loginEvents,
  offerClicks,
  payouts,
  sessions,
  tickets,
  users,
} from '../../db/schema';
import type { UserRow } from '../../http/auth';
import { verifyPassword } from '../../lib/crypto';
import { AppError, badRequest, notFound } from '../../lib/errors';
import { maskEmail } from '../../lib/net';
import { audit } from '../platform/messaging';
import { listUserTransactions } from '../wallet/ledger';

export async function getUser(db: DbOrTx, userId: string): Promise<UserRow> {
  const rows = await db.select().from(users).where(eq(users.id, userId));
  if (!rows[0]) throw notFound('User');
  return rows[0];
}

export function mergePrefs(prefs: Partial<UserPrefs> | null | undefined): UserPrefs {
  return {
    ...DEFAULT_PREFS,
    ...(prefs ?? {}),
    notifyEmail: { ...DEFAULT_PREFS.notifyEmail, ...(prefs?.notifyEmail ?? {}) },
  };
}

export async function toMeDTO(ctx: AppContext, db: DbOrTx, user: UserRow): Promise<MeDTO> {
  const settings = ctx.settings.get();
  let restriction: MeDTO['restriction'] = null;
  if (user.status === 'banned' || user.status === 'restricted') {
    const code = (user.banReasonCode ?? 'other') as BanReasonCode;
    const reason = BAN_REASONS[code] ?? BAN_REASONS.other;
    const appeal = await db
      .select({ id: tickets.id, status: tickets.status, updatedAt: tickets.updatedAt })
      .from(tickets)
      .where(and(eq(tickets.userId, user.id), eq(tickets.category, 'appeal')))
      .orderBy(desc(tickets.createdAt))
      .limit(1);
    restriction = {
      reasonCode: code,
      title:
        user.status === 'restricted' && !user.banReasonCode ? 'Security review in progress' : reason.title,
      explanation:
        user.status === 'restricted' && !user.banReasonCode
          ? 'Our automated checks noticed unusual activity. Earning and cash-outs are paused while a person reviews it — usually within 24 hours. Your balance is safe.'
          : reason.explanation,
      message: user.banMessage,
      at: user.bannedAt?.toISOString() ?? null,
      balanceFrozen: user.balanceFrozen,
      appeal: appeal[0]
        ? { ticketId: appeal[0].id, status: appeal[0].status, updatedAt: appeal[0].updatedAt.toISOString() }
        : null,
    };
  }
  const accountHealth: MeDTO['accountHealth'] =
    user.status !== 'active'
      ? 'restricted'
      : user.fraudScore > settings.autoApproveMaxFraudScore
        ? 'review'
        : 'good';
  return {
    id: user.id,
    email: user.email,
    emailVerified: Boolean(user.emailVerifiedAt),
    displayName: user.displayName,
    fullName: user.fullName,
    country: user.country,
    timezone: user.timezone,
    language: user.language,
    displayCurrency: user.displayCurrency,
    role: user.role,
    status: user.status,
    restriction,
    referralCode: user.referralCode,
    kycStatus: user.kycStatus,
    phoneVerified: Boolean(user.phoneVerifiedAt),
    phoneLast4: user.phoneLast4,
    totpEnabled: Boolean(user.totpEnabledAt),
    tier: user.tier as MeDTO['tier'],
    accountHealth,
    prefs: mergePrefs(user.prefs),
    onboardingDone: Boolean(user.onboardingDoneAt),
    createdAt: user.createdAt.toISOString(),
  };
}

export async function updateProfile(
  ctx: AppContext,
  user: UserRow,
  input: z.infer<typeof updateProfileSchema>,
): Promise<UserRow> {
  const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (input.displayName !== undefined) patch.displayName = input.displayName;
  if (input.fullName !== undefined) patch.fullName = input.fullName;
  if (input.timezone !== undefined) patch.timezone = input.timezone;
  if (input.language !== undefined) patch.language = input.language;
  if (input.displayCurrency !== undefined) {
    if (!ctx.settings.get().fxRates[input.displayCurrency])
      throw badRequest('INVALID_CURRENCY', 'Unsupported display currency');
    patch.displayCurrency = input.displayCurrency;
  }
  if (input.country !== undefined && input.country !== user.country) {
    // Changing country changes which offers/payout methods apply; limit abuse by
    // only allowing it before the first completed payout.
    const paid = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(payouts)
      .where(and(eq(payouts.userId, user.id), eq(payouts.status, 'completed')));
    if ((paid[0]?.n ?? 0) > 0) {
      throw new AppError(
        409,
        'COUNTRY_LOCKED',
        'Country can only be changed by support after your first cash-out.',
      );
    }
    patch.country = input.country;
    patch.displayCurrency = getCountry(input.country).currency;
  }
  const [row] = await ctx.db.update(users).set(patch).where(eq(users.id, user.id)).returning();
  return row!;
}

export async function updatePrefs(
  ctx: AppContext,
  user: UserRow,
  input: z.infer<typeof updatePrefsSchema>,
): Promise<UserRow> {
  const current = mergePrefs(user.prefs);
  const next: UserPrefs = {
    ...current,
    ...Object.fromEntries(Object.entries(input).filter(([k, v]) => v !== undefined && k !== 'notifyEmail')),
    notifyEmail: { ...current.notifyEmail, ...(input.notifyEmail ?? {}) },
  };
  const [row] = await ctx.db
    .update(users)
    .set({ prefs: next, updatedAt: new Date() })
    .where(eq(users.id, user.id))
    .returning();
  return row!;
}

/** GDPR / NDPA data export — everything we hold about the member, in one JSON file. */
export async function exportUserData(ctx: AppContext, user: UserRow): Promise<Record<string, unknown>> {
  const db = ctx.db;
  const [txns, payoutRows, clickRows, claimRows, ticketRows, deviceRows, loginRows, donationRows] =
    await Promise.all([
      listUserTransactions(db, user.id, { limit: 100 }),
      db.select().from(payouts).where(eq(payouts.userId, user.id)),
      db.select().from(offerClicks).where(eq(offerClicks.userId, user.id)),
      db.select().from(claims).where(eq(claims.userId, user.id)),
      db.select().from(tickets).where(eq(tickets.userId, user.id)),
      db.select().from(devices).where(eq(devices.userId, user.id)),
      db
        .select()
        .from(loginEvents)
        .where(eq(loginEvents.userId, user.id))
        .orderBy(desc(loginEvents.createdAt))
        .limit(200),
      db.select().from(donations).where(eq(donations.userId, user.id)),
    ]);
  const me = await toMeDTO(ctx, db, user);
  return {
    exportedAt: new Date().toISOString(),
    profile: me,
    transactions: txns.items,
    payouts: payoutRows.map(({ detailsEnc: _d, ...p }) => p),
    tasks: clickRows,
    claims: claimRows.map(({ screenshotPath: _s, ...c }) => c),
    supportTickets: ticketRows,
    devices: deviceRows.map((d) => ({
      label: d.label,
      firstSeenAt: d.firstSeenAt,
      lastSeenAt: d.lastSeenAt,
      lastIp: d.lastIp,
    })),
    loginHistory: loginRows.map((l) => ({ success: l.success, ip: l.ip, at: l.createdAt, reason: l.reason })),
    donations: donationRows,
  };
}

/**
 * Account deletion: PII is erased and the account anonymised; ledger records are
 * retained (financial/tax obligations) but no longer link to an identifiable person.
 */
export async function deleteAccount(
  ctx: AppContext,
  user: UserRow,
  password: string,
  ip: string,
): Promise<void> {
  if (!(await verifyPassword(user.passwordHash, password)))
    throw badRequest('INVALID_PASSWORD', 'Password is incorrect');
  const inflight = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(payouts)
    .where(and(eq(payouts.userId, user.id), inArray(payouts.status, ['pending', 'review', 'processing'])));
  if ((inflight[0]?.n ?? 0) > 0) {
    throw new AppError(
      409,
      'PAYOUT_IN_FLIGHT',
      'Please wait for your in-progress cash-out to finish before deleting your account.',
    );
  }
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        email: `deleted-${user.id}@deleted.invalid`,
        passwordHash: null,
        displayName: null,
        fullName: null,
        phoneEnc: null,
        phoneHash: null,
        phoneLast4: null,
        totpSecretEnc: null,
        recoveryCodes: null,
        status: 'deleted',
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
    await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, user.id));
    await audit(tx, {
      actorId: user.id,
      action: 'account.delete',
      targetType: 'user',
      targetId: user.id,
      before: { email: maskEmail(user.email) },
      ip,
    });
  });
}
