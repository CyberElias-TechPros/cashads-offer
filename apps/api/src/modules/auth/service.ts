import QRCode from 'qrcode';
import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import {
  DEFAULT_PREFS,
  type LoginEventDTO,
  type LoginInput,
  type RegisterInput,
  type SessionDTO,
  TERMS_VERSION,
  getCountry,
} from '@cashads/shared';
import type { AppContext } from '../../context';
import type { DbOrTx } from '../../db/client';
import { loginEvents, sessions, users, verificationTokens } from '../../db/schema';
import { type ClientInfo, type UserRow, createSession } from '../../http/auth';
import {
  blindIndex,
  decrypt,
  encrypt,
  hashPassword,
  numericCode,
  randomToken,
  referralCode,
  sha256,
  verifyPassword,
} from '../../lib/crypto';
import { AppError, badRequest, isUniqueViolation, tooMany, unauthorized } from '../../lib/errors';
import { deviceLabel } from '../../lib/net';
import { HOUR, MINUTE } from '../../lib/time';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../../lib/totp';
import { evaluateSignup } from '../fraud/service';
import { audit, notify, sendEmail, sendSms } from '../platform/messaging';
import { attachReferral } from '../referrals/service';
import { ensureUserAccount } from '../wallet/ledger';

const LOGIN_FAILURE_WINDOW_MIN = 15;
const LOGIN_FAILURE_LIMIT = 8;

/* ── registration ──────────────────────────────────────────────────────────── */

export async function register(
  ctx: AppContext,
  reply: FastifyReply,
  input: RegisterInput,
  client: ClientInfo,
  baseUrl: string,
): Promise<UserRow> {
  const passwordHash = await hashPassword(input.password);
  const country = getCountry(input.country);
  const user = await ctx.db.transaction(async (tx) => {
    const existing = await tx.select({ id: users.id }).from(users).where(eq(users.email, input.email));
    if (existing[0]) {
      throw new AppError(
        409,
        'EMAIL_TAKEN',
        'An account with this email already exists. Try signing in instead.',
        {
          email: 'Already registered',
        },
      );
    }
    let created: UserRow | undefined;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      try {
        const rows = await tx
          .insert(users)
          .values({
            email: input.email,
            passwordHash,
            country: country.code,
            timezone: input.timezone || country.timezone,
            displayCurrency: country.currency,
            referralCode: referralCode(),
            prefs: DEFAULT_PREFS,
            termsVersion: TERMS_VERSION,
            termsAcceptedAt: new Date(),
            signupIp: client.ip,
          })
          .returning();
        created = rows[0];
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    if (!created) throw new Error('Could not allocate a referral code');
    await ensureUserAccount(tx, created.id);
    await createSession(tx, reply, created, client, ctx.config.COOKIE_SECURE);
    if (input.referralCode) await attachReferral(ctx, tx, created, input.referralCode, client);
    await evaluateSignup(ctx, tx, created, client);
    await issueEmailVerification(tx, created, baseUrl);
    await notify(ctx, tx, created.id, {
      type: 'welcome',
      title: 'Welcome to CashAds 👋',
      body: 'Real money, no points, no minimum. Start with a 20-second quick task — you can cash out right after.',
      link: '/app/earn/quick',
    });
    return created;
  });
  return (await ctx.db.select().from(users).where(eq(users.id, user.id)))[0]!;
}

export async function issueEmailVerification(db: DbOrTx, user: UserRow, baseUrl: string): Promise<void> {
  const token = randomToken(24);
  await db.insert(verificationTokens).values({
    userId: user.id,
    type: 'email_verify',
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 48 * HOUR),
  });
  const link = `${baseUrl}/verify-email?token=${token}`;
  await sendEmail(db, {
    userId: user.id,
    to: user.email,
    subject: 'Confirm your email for CashAds',
    body: `Confirm your email to enable cash-outs:\n\n${link}\n\nThis link expires in 48 hours. If you didn't sign up, ignore this email.`,
    meta: { link, kind: 'email_verify' },
  });
}

export async function verifyEmail(ctx: AppContext, token: string): Promise<UserRow> {
  return ctx.db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(verificationTokens)
      .where(
        and(eq(verificationTokens.tokenHash, sha256(token)), eq(verificationTokens.type, 'email_verify')),
      );
    const vt = rows[0];
    // Idempotent: opening the same link twice (double-click, email prefetchers) is a success.
    if (vt?.usedAt) {
      const [already] = await tx.select().from(users).where(eq(users.id, vt.userId));
      if (already?.emailVerifiedAt) return already;
    }
    if (!vt || vt.usedAt || vt.expiresAt < new Date()) {
      throw badRequest(
        'INVALID_TOKEN',
        'This verification link is invalid or has expired. Request a new one from your dashboard.',
      );
    }
    await tx.update(verificationTokens).set({ usedAt: new Date() }).where(eq(verificationTokens.id, vt.id));
    const [user] = await tx
      .update(users)
      .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, vt.userId))
      .returning();
    await notify(ctx, tx, vt.userId, {
      type: 'email_verified',
      title: 'Email confirmed ✅',
      body: 'Cash-outs are now unlocked. You can withdraw any amount from $0.01.',
      link: '/app/cashout',
    });
    return user!;
  });
}

export async function resendVerification(ctx: AppContext, user: UserRow, baseUrl: string): Promise<void> {
  if (user.emailVerifiedAt) throw badRequest('ALREADY_VERIFIED', 'Your email is already verified');
  const recent = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(verificationTokens)
    .where(
      and(
        eq(verificationTokens.userId, user.id),
        eq(verificationTokens.type, 'email_verify'),
        gt(verificationTokens.createdAt, new Date(Date.now() - HOUR)),
      ),
    );
  if ((recent[0]?.n ?? 0) >= 5)
    throw tooMany('Too many verification emails. Please wait an hour and try again.');
  await issueEmailVerification(ctx.db, user, baseUrl);
}

/* ── login (with brute-force protection and optional TOTP) ─────────────────── */

export async function login(
  ctx: AppContext,
  reply: FastifyReply,
  input: LoginInput,
  client: ClientInfo,
): Promise<{ user?: UserRow; mfaToken?: string }> {
  const failures = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginEvents)
    .where(
      and(
        eq(loginEvents.email, input.email),
        eq(loginEvents.success, false),
        gt(loginEvents.createdAt, new Date(Date.now() - LOGIN_FAILURE_WINDOW_MIN * MINUTE)),
      ),
    );
  if ((failures[0]?.n ?? 0) >= LOGIN_FAILURE_LIMIT) {
    throw tooMany(
      `Too many failed attempts. For your security, please wait ${LOGIN_FAILURE_WINDOW_MIN} minutes or reset your password.`,
    );
  }
  const rows = await ctx.db
    .select()
    .from(users)
    .where(and(eq(users.email, input.email), isNull(users.deletedAt)));
  const user = rows[0];
  const ok = await verifyPassword(user?.passwordHash, input.password);
  if (!user || !ok) {
    await ctx.db.insert(loginEvents).values({
      userId: user?.id ?? null,
      email: input.email,
      success: false,
      reason: 'bad_credentials',
      ip: client.ip,
      userAgent: client.userAgent,
    });
    throw unauthorized('Email or password is incorrect');
  }
  if (user.totpEnabledAt) {
    const token = randomToken(24);
    await ctx.db.insert(verificationTokens).values({
      userId: user.id,
      type: 'login_mfa',
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 5 * MINUTE),
      meta: { ip: client.ip },
    });
    return { mfaToken: token };
  }
  return { user: await completeLogin(ctx, reply, user, client) };
}

export async function completeLogin(
  ctx: AppContext,
  reply: FastifyReply,
  user: UserRow,
  client: ClientInfo,
): Promise<UserRow> {
  return ctx.db.transaction(async (tx) => {
    const { newDevice } = await createSession(tx, reply, user, client, ctx.config.COOKIE_SECURE);
    await tx.insert(loginEvents).values({
      userId: user.id,
      email: user.email,
      success: true,
      ip: client.ip,
      userAgent: client.userAgent,
    });
    if (newDevice) {
      await notify(ctx, tx, user.id, {
        type: 'security_new_device',
        title: 'New sign-in',
        body: `Signed in on ${client.label} (${client.ip}). If this wasn’t you, sign out that device and change your password.`,
        link: '/app/profile?tab=security',
        email: { category: 'security', subject: 'New sign-in to your CashAds account' },
      });
    }
    return user;
  });
}

export async function loginWithMfa(
  ctx: AppContext,
  reply: FastifyReply,
  mfaToken: string,
  code: string,
  client: ClientInfo,
): Promise<UserRow> {
  const rows = await ctx.db
    .select()
    .from(verificationTokens)
    .where(and(eq(verificationTokens.tokenHash, sha256(mfaToken)), eq(verificationTokens.type, 'login_mfa')));
  const vt = rows[0];
  if (!vt || vt.usedAt || vt.expiresAt < new Date() || vt.attempts >= 5) {
    throw unauthorized('Your sign-in session expired. Please sign in again.');
  }
  const user = (await ctx.db.select().from(users).where(eq(users.id, vt.userId)))[0]!;
  const valid = await checkSecondFactor(ctx, user, code);
  if (!valid) {
    await ctx.db
      .update(verificationTokens)
      .set({ attempts: vt.attempts + 1 })
      .where(eq(verificationTokens.id, vt.id));
    throw badRequest('INVALID_CODE', 'That code didn’t work. Check your authenticator app and try again.');
  }
  await ctx.db.update(verificationTokens).set({ usedAt: new Date() }).where(eq(verificationTokens.id, vt.id));
  return completeLogin(ctx, reply, user, client);
}

/** Accepts a TOTP code (with replay protection) or a single-use recovery code. */
export async function checkSecondFactor(ctx: AppContext, user: UserRow, code: string): Promise<boolean> {
  if (!user.totpSecretEnc || !user.totpEnabledAt) return false;
  const clean = code.replace(/\s/g, '');
  if (/^\d{6}$/.test(clean)) {
    const step = verifyTotp(decrypt(user.totpSecretEnc), clean, user.totpLastStep ?? null);
    if (step === null) return false;
    await ctx.db.update(users).set({ totpLastStep: step }).where(eq(users.id, user.id));
    return true;
  }
  const hashed = sha256(clean.toUpperCase());
  const codes = user.recoveryCodes ?? [];
  if (!codes.includes(hashed)) return false;
  await ctx.db
    .update(users)
    .set({ recoveryCodes: codes.filter((c) => c !== hashed) })
    .where(eq(users.id, user.id));
  return true;
}

/* ── passwords ─────────────────────────────────────────────────────────────── */

export async function forgotPassword(ctx: AppContext, email: string, baseUrl: string): Promise<void> {
  const rows = await ctx.db
    .select()
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)));
  const user = rows[0];
  if (!user) return; // never reveal whether an account exists
  const token = randomToken(24);
  await ctx.db.insert(verificationTokens).values({
    userId: user.id,
    type: 'password_reset',
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + HOUR),
  });
  const link = `${baseUrl}/reset-password?token=${token}`;
  await sendEmail(ctx.db, {
    userId: user.id,
    to: user.email,
    subject: 'Reset your CashAds password',
    body: `Reset your password using this link (valid for 1 hour):\n\n${link}\n\nIf you didn't request this, you can ignore this email — your password won't change.`,
    meta: { link, kind: 'password_reset' },
  });
}

export async function resetPassword(ctx: AppContext, token: string, password: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(verificationTokens)
      .where(
        and(eq(verificationTokens.tokenHash, sha256(token)), eq(verificationTokens.type, 'password_reset')),
      );
    const vt = rows[0];
    if (!vt || vt.usedAt || vt.expiresAt < new Date())
      throw badRequest('INVALID_TOKEN', 'This reset link is invalid or has expired.');
    await tx.update(verificationTokens).set({ usedAt: new Date() }).where(eq(verificationTokens.id, vt.id));
    await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, vt.userId));
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, vt.userId), isNull(sessions.revokedAt)));
    await notify(ctx, tx, vt.userId, {
      type: 'security_password',
      title: 'Your password was changed',
      body: 'All devices were signed out. If this wasn’t you, contact support immediately.',
      email: { category: 'security' },
    });
  });
}

export async function changePassword(
  ctx: AppContext,
  user: UserRow,
  currentSessionId: string,
  current: string,
  next: string,
): Promise<void> {
  if (!(await verifyPassword(user.passwordHash, current)))
    throw badRequest('INVALID_PASSWORD', 'Current password is incorrect', {
      currentPassword: 'Incorrect password',
    });
  const passwordHash = await hashPassword(next);
  await ctx.db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, user.id));
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(sessions.userId, user.id), ne(sessions.id, currentSessionId), isNull(sessions.revokedAt)),
      );
    await notify(ctx, tx, user.id, {
      type: 'security_password',
      title: 'Password changed',
      body: 'Your password was changed and your other devices were signed out.',
      email: { category: 'security' },
    });
  });
}

/* ── sessions & login history ──────────────────────────────────────────────── */

export async function listSessions(
  ctx: AppContext,
  userId: string,
  currentId: string,
): Promise<SessionDTO[]> {
  const rows = await ctx.db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastUsedAt));
  return rows.map((s) => ({
    id: s.id,
    current: s.id === currentId,
    label: s.label,
    ip: s.ip,
    createdAt: s.createdAt.toISOString(),
    lastUsedAt: s.lastUsedAt.toISOString(),
  }));
}

export async function revokeSession(ctx: AppContext, userId: string, sessionId: string): Promise<void> {
  await ctx.db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
}

export async function revokeOtherSessions(ctx: AppContext, userId: string, currentId: string): Promise<void> {
  await ctx.db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), ne(sessions.id, currentId), isNull(sessions.revokedAt)));
}

export async function loginHistory(ctx: AppContext, userId: string): Promise<LoginEventDTO[]> {
  const rows = await ctx.db
    .select()
    .from(loginEvents)
    .where(eq(loginEvents.userId, userId))
    .orderBy(desc(loginEvents.createdAt))
    .limit(30);
  return rows.map((r) => ({
    id: r.id,
    success: r.success,
    reason: r.reason,
    ip: r.ip,
    label: deviceLabel(r.userAgent ?? undefined),
    createdAt: r.createdAt.toISOString(),
  }));
}

/* ── two-factor authentication (TOTP) ──────────────────────────────────────── */

export async function setupTotp(
  ctx: AppContext,
  user: UserRow,
): Promise<{ secret: string; otpauthUrl: string; qrSvg: string }> {
  if (user.totpEnabledAt) throw badRequest('ALREADY_ENABLED', 'Two-factor authentication is already on');
  const secret = generateTotpSecret();
  await ctx.db
    .update(users)
    .set({ totpSecretEnc: encrypt(secret) })
    .where(eq(users.id, user.id));
  const url = otpauthUrl(secret, user.email);
  const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 200 });
  return { secret, otpauthUrl: url, qrSvg };
}

export async function enableTotp(
  ctx: AppContext,
  user: UserRow,
  code: string,
  ip: string,
): Promise<string[]> {
  if (!user.totpSecretEnc) throw badRequest('NOT_SET_UP', 'Start the set-up first');
  const step = verifyTotp(decrypt(user.totpSecretEnc), code, null);
  if (step === null)
    throw badRequest(
      'INVALID_CODE',
      'That code didn’t match. Make sure your phone’s clock is set automatically.',
    );
  const recovery = Array.from({ length: 10 }, () => `${referralCode(4)}-${referralCode(4)}`);
  await ctx.db
    .update(users)
    .set({ totpEnabledAt: new Date(), totpLastStep: step, recoveryCodes: recovery.map((c) => sha256(c)) })
    .where(eq(users.id, user.id));
  await audit(ctx.db, {
    actorId: user.id,
    action: 'security.2fa_enabled',
    targetType: 'user',
    targetId: user.id,
    ip,
  });
  await notify(ctx, ctx.db, user.id, {
    type: 'security_2fa',
    title: 'Two-factor authentication is on 🔐',
    body: 'You’ll be asked for a code when signing in and cashing out. Keep your recovery codes somewhere safe.',
    email: { category: 'security' },
  });
  return recovery;
}

export async function disableTotp(ctx: AppContext, user: UserRow, code: string, ip: string): Promise<void> {
  if (!(await checkSecondFactor(ctx, user, code))) throw badRequest('INVALID_CODE', 'That code didn’t work');
  await ctx.db
    .update(users)
    .set({ totpEnabledAt: null, totpSecretEnc: null, recoveryCodes: null, totpLastStep: null })
    .where(eq(users.id, user.id));
  await audit(ctx.db, {
    actorId: user.id,
    action: 'security.2fa_disabled',
    targetType: 'user',
    targetId: user.id,
    ip,
  });
  await notify(ctx, ctx.db, user.id, {
    type: 'security_2fa',
    title: 'Two-factor authentication turned off',
    body: 'If this wasn’t you, change your password right away.',
    email: { category: 'security' },
  });
}

/* ── phone verification (OTP via SMS) ──────────────────────────────────────── */

export function normalizePhone(raw: string, country: string): string {
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  const prefix = getCountry(country).phonePrefix;
  if (digits.startsWith('0')) return `${prefix}${digits.slice(1)}`;
  if (digits.startsWith(prefix.slice(1))) return `+${digits}`;
  return `${prefix}${digits}`;
}

export async function startPhoneVerification(
  ctx: AppContext,
  user: UserRow,
  rawPhone: string,
): Promise<{ maskedPhone: string }> {
  const phone = normalizePhone(rawPhone, user.country);
  if (!/^\+\d{9,15}$/.test(phone))
    throw badRequest('INVALID_PHONE', 'Enter a valid phone number', { phone: 'Invalid phone number' });
  const hash = blindIndex(phone);
  const taken = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.phoneHash, hash), ne(users.id, user.id), isNull(users.deletedAt)));
  if (taken[0])
    throw new AppError(409, 'PHONE_TAKEN', 'This phone number is already verified on another account.', {
      phone: 'Already in use',
    });
  const recent = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(verificationTokens)
    .where(
      and(
        eq(verificationTokens.userId, user.id),
        eq(verificationTokens.type, 'phone_otp'),
        gt(verificationTokens.createdAt, new Date(Date.now() - HOUR)),
      ),
    );
  if ((recent[0]?.n ?? 0) >= 5) throw tooMany('Too many codes requested. Please wait an hour.');
  const code = numericCode(6);
  await ctx.db.insert(verificationTokens).values({
    userId: user.id,
    type: 'phone_otp',
    tokenHash: sha256(`${user.id}:${code}:${randomToken(8)}`),
    meta: { phoneEnc: encrypt(phone), codeHash: sha256(`${user.id}:${code}`) },
    expiresAt: new Date(Date.now() + 10 * MINUTE),
  });
  await sendSms(ctx.db, {
    userId: user.id,
    to: phone,
    body: `Your CashAds code is ${code}. It expires in 10 minutes. Never share it with anyone.`,
  });
  return { maskedPhone: `${phone.slice(0, 4)}••••${phone.slice(-3)}` };
}

export async function confirmPhoneVerification(ctx: AppContext, user: UserRow, code: string): Promise<void> {
  const rows = await ctx.db
    .select()
    .from(verificationTokens)
    .where(
      and(
        eq(verificationTokens.userId, user.id),
        eq(verificationTokens.type, 'phone_otp'),
        isNull(verificationTokens.usedAt),
      ),
    )
    .orderBy(desc(verificationTokens.createdAt))
    .limit(1);
  const vt = rows[0];
  if (!vt || vt.expiresAt < new Date())
    throw badRequest('CODE_EXPIRED', 'That code has expired. Request a new one.');
  if (vt.attempts >= 5) throw tooMany('Too many wrong codes. Request a new one.');
  const meta = vt.meta as { phoneEnc: string; codeHash: string };
  if (meta.codeHash !== sha256(`${user.id}:${code}`)) {
    await ctx.db
      .update(verificationTokens)
      .set({ attempts: vt.attempts + 1 })
      .where(eq(verificationTokens.id, vt.id));
    throw badRequest('INVALID_CODE', 'That code isn’t right. Check the SMS and try again.', {
      code: 'Incorrect code',
    });
  }
  const phone = decrypt(meta.phoneEnc);
  try {
    await ctx.db.transaction(async (tx) => {
      await tx.update(verificationTokens).set({ usedAt: new Date() }).where(eq(verificationTokens.id, vt.id));
      await tx
        .update(users)
        .set({
          phoneEnc: meta.phoneEnc,
          phoneHash: blindIndex(phone),
          phoneLast4: phone.slice(-4),
          phoneVerifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));
      await ctx.jobs.enqueue(tx, 'engagement.achievements', { userId: user.id });
    });
  } catch (err) {
    if (isUniqueViolation(err))
      throw new AppError(409, 'PHONE_TAKEN', 'This phone number is already verified on another account.');
    throw err;
  }
}
