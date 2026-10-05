import { and, eq, gt, gte, isNull, ne, sql } from 'drizzle-orm';
import QRCode from 'qrcode';
import { dayKey, type LoginInput, type SignupInput } from '@cashads/shared';
import { withUow, type AppContext } from '../../context';
import type { Q } from '../../db/client';
import { devices, loginEvents, sessions, userActivityDays, users, verificationTokens, wallets } from '../../db/schema';
import { badRequest, conflict, tooMany, unauthorized } from '../../lib/errors';
import { clock, DAY, HOUR, MINUTE } from '../../lib/clock';
import { hashPassword, numericCode, randomToken, referralCode, sha256, verifyPassword } from '../../lib/crypto';
import { isDisposableEmail } from '../../lib/disposable';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../../lib/totp';
import { deviceLabel, isLikelyBot } from '../../lib/useragent';
import { recomputeTier } from '../engagement/service';
import { addSignal, checkDeviceSharing, checkSignupVelocity } from '../fraud/service';
import { notify, queueEmail, queueSms } from '../notifications/service';
import { smsCode, templates } from '../notifications/templates';
import { attachReferral } from '../referrals/service';

export const SESSION_COOKIE = 'ca_session';
export const SESSION_TTL_MS = 30 * DAY;

type UserRow = typeof users.$inferSelect;
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  deviceKey: string | null;
  fingerprint: string | null;
  ipCountry: string | null;
  baseUrl: string;
}

/* --------------------------------------------------------------- sessions */

export async function upsertDevice(q: Q, userId: string, meta: RequestMeta): Promise<{ id: string; isNew: boolean } | null> {
  if (!meta.deviceKey) return null;
  const now = clock.now();
  const [existing] = await q.select().from(devices).where(and(eq(devices.userId, userId), eq(devices.deviceKey, meta.deviceKey)));
  if (existing) {
    await q
      .update(devices)
      .set({ lastSeenAt: now, lastIp: meta.ip, fingerprint: meta.fingerprint ?? existing.fingerprint, userAgent: meta.userAgent })
      .where(eq(devices.id, existing.id));
    return { id: existing.id, isNew: false };
  }
  const [d] = await q
    .insert(devices)
    .values({
      userId,
      deviceKey: meta.deviceKey,
      fingerprint: meta.fingerprint,
      label: deviceLabel(meta.userAgent),
      userAgent: meta.userAgent,
      firstIp: meta.ip,
      lastIp: meta.ip,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .returning({ id: devices.id });
  return { id: d.id, isNew: true };
}

export async function createSession(q: Q, userId: string, meta: RequestMeta, deviceId: string | null) {
  const token = randomToken(32);
  const now = clock.now();
  await q.insert(userActivityDays).values({ userId, day: dayKey(now) }).onConflictDoNothing();
  const [session] = await q
    .insert(sessions)
    .values({
      userId,
      tokenHash: sha256(token),
      deviceId,
      deviceLabel: deviceLabel(meta.userAgent),
      ip: meta.ip,
      userAgent: meta.userAgent,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    })
    .returning();
  return { token, session };
}

export async function resolveSession(ctx: AppContext, token: string) {
  const [row] = await ctx.db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, clock.now())));
  if (!row || row.user.status === 'deleted') return null;
  return row;
}

export async function revokeSession(q: Q, sessionId: string) {
  await q.update(sessions).set({ revokedAt: clock.now() }).where(eq(sessions.id, sessionId));
}

export async function revokeOtherSessions(q: Q, userId: string, keepSessionId: string | null) {
  const conds = [eq(sessions.userId, userId), isNull(sessions.revokedAt)];
  if (keepSessionId) conds.push(ne(sessions.id, keepSessionId));
  await q.update(sessions).set({ revokedAt: clock.now() }).where(and(...conds));
}

async function logLogin(q: Q, userId: string | null, email: string, meta: RequestMeta, success: boolean, reason?: string) {
  await q.insert(loginEvents).values({ userId, email, ip: meta.ip, userAgent: meta.userAgent, success, reason: reason ?? null, createdAt: clock.now() });
}

/* ------------------------------------------------------------------ tokens */

async function issueToken(q: Q, userId: string | null, kind: (typeof verificationTokens.$inferInsert)['kind'], ttlMs: number, extra: Partial<typeof verificationTokens.$inferInsert> = {}) {
  const token = randomToken(32);
  await q.insert(verificationTokens).values({
    userId,
    kind,
    tokenHash: sha256(token),
    expiresAt: new Date(clock.ms() + ttlMs),
    createdAt: clock.now(),
    ...extra,
  });
  return token;
}

async function consumeToken(q: Q, token: string, kind: (typeof verificationTokens.$inferInsert)['kind']) {
  const [row] = await q
    .select()
    .from(verificationTokens)
    .where(and(eq(verificationTokens.tokenHash, sha256(token)), eq(verificationTokens.kind, kind)));
  if (!row || row.consumedAt || row.expiresAt.getTime() < clock.ms()) return null;
  await q.update(verificationTokens).set({ consumedAt: clock.now() }).where(eq(verificationTokens.id, row.id));
  return row;
}

export async function sendVerificationEmail(q: Q, user: Pick<UserRow, 'id' | 'email' | 'displayName'>, baseUrl: string) {
  const token = await issueToken(q, user.id, 'email_verify', DAY);
  await queueEmail(q, {
    userId: user.id,
    to: user.email,
    template: 'verify_email',
    content: templates.verifyEmail(user.displayName, `${baseUrl}/verify-email?token=${token}`),
  });
}

/* ------------------------------------------------------------------ signup */

async function uniqueReferralCode(q: Q): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = referralCode();
    const [taken] = await q.select({ id: users.id }).from(users).where(eq(users.referralCode, code));
    if (!taken) return code;
  }
  throw new Error('Could not allocate referral code');
}

export async function signup(ctx: AppContext, input: SignupInput, meta: RequestMeta, refCookie?: string | null) {
  const [exists] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, input.email));
  if (exists) throw conflict('An account with this email already exists. Try logging in instead.', 'email_taken');
  const passwordHash = await hashPassword(input.password);
  return withUow(ctx, async (uow) => {
    const { tx } = uow;
    const now = clock.now();
    const [user] = await tx
      .insert(users)
      .values({
        email: input.email,
        passwordHash,
        displayName: input.displayName,
        country: input.country,
        timezone: input.timezone || 'UTC',
        referralCode: await uniqueReferralCode(tx),
        signupIp: meta.ip,
        ipCountry: meta.ipCountry,
        preferences: { emailPayouts: true, leaderboardOptIn: true, showLocalCurrency: true, theme: 'system' },
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
      })
      .returning();
    await tx.insert(wallets).values({ userId: user.id });
    const device = await upsertDevice(tx, user.id, meta);
    const { token } = await createSession(tx, user.id, meta, device?.id ?? null);
    await sendVerificationEmail(tx, user, meta.baseUrl);
    await logLogin(tx, user.id, user.email, meta, true, 'signup');

    // Risk signals at sign-up (never blocking — they only route payouts to review).
    if (isDisposableEmail(user.email)) await addSignal(uow, user.id, 'disposable_email', { domain: user.email.split('@')[1] });
    if (isLikelyBot(meta.userAgent)) await addSignal(uow, user.id, 'bot_user_agent', { userAgent: meta.userAgent });
    if (meta.ipCountry && meta.ipCountry !== input.country) await addSignal(uow, user.id, 'country_mismatch', { ipCountry: meta.ipCountry, profile: input.country });
    await checkDeviceSharing(uow, user.id, { deviceKey: meta.deviceKey, fingerprint: meta.fingerprint });
    await checkSignupVelocity(uow, user.id, meta.ip);

    const code = input.referralCode || refCookie;
    if (code) await attachReferral(uow, user.id, code, { ip: meta.ip, deviceKey: meta.deviceKey });

    await notify(uow, user.id, {
      type: 'system',
      title: 'Welcome to CashAds 👋',
      body: 'Every amount you see is real money. Finish your first offer to unlock a welcome bonus — and cash out anytime, no minimum.',
      link: '/app/earn',
    });
    const [fresh] = await tx.select().from(users).where(eq(users.id, user.id));
    return { user: fresh, token };
  });
}

/* ------------------------------------------------------------------- login */

export async function login(ctx: AppContext, input: LoginInput, meta: RequestMeta): Promise<{ kind: 'session'; user: UserRow; token: string } | { kind: '2fa'; challengeId: string }> {
  const [user] = await ctx.db.select().from(users).where(eq(users.email, input.email));
  if (user?.lockedUntil && user.lockedUntil.getTime() > clock.ms()) {
    const mins = Math.ceil((user.lockedUntil.getTime() - clock.ms()) / MINUTE);
    throw tooMany(`Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}, or reset your password.`, 'account_locked');
  }
  const ok = await verifyPassword(input.password, user?.passwordHash);
  if (!user || user.status === 'deleted' || !ok) {
    if (user) {
      const failed = user.failedLoginCount + 1;
      await ctx.db
        .update(users)
        .set({ failedLoginCount: failed, lockedUntil: failed >= 5 ? new Date(clock.ms() + 15 * MINUTE) : user.lockedUntil })
        .where(eq(users.id, user.id));
      await logLogin(ctx.db, user.id, input.email, meta, false, 'bad_password');
    } else {
      await logLogin(ctx.db, null, input.email, meta, false, 'unknown_email');
    }
    throw unauthorized('Email or password is incorrect', 'invalid_credentials');
  }
  await ctx.db.update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, user.id));
  if (user.totpEnabledAt && user.totpSecretEnc) {
    const challengeId = await issueToken(ctx.db, user.id, 'login_2fa', 10 * MINUTE);
    return { kind: '2fa', challengeId };
  }
  return { kind: 'session', ...(await finishLogin(ctx, user, meta)) };
}

async function finishLogin(ctx: AppContext, user: UserRow, meta: RequestMeta) {
  return withUow(ctx, async (uow) => {
    const { tx } = uow;
    const [deviceCount] = await tx.select({ n: sql<number>`count(*)::int` }).from(devices).where(eq(devices.userId, user.id));
    const device = await upsertDevice(tx, user.id, meta);
    const { token } = await createSession(tx, user.id, meta, device?.id ?? null);
    await tx.update(users).set({ lastSeenAt: clock.now() }).where(eq(users.id, user.id));
    await logLogin(tx, user.id, user.email, meta, true);
    await checkDeviceSharing(uow, user.id, { deviceKey: meta.deviceKey, fingerprint: meta.fingerprint });
    if (device?.isNew && Number(deviceCount?.n ?? 0) > 0) {
      await notify(uow, user.id, {
        type: 'security',
        title: 'New sign-in',
        body: `${deviceLabel(meta.userAgent)} · ${meta.ip ?? 'unknown IP'}. Not you? Sign out other sessions in Settings → Security.`,
        link: '/app/settings/security',
        email: {
          category: 'security',
          template: 'new_device',
          content: templates.newDevice(user.displayName, deviceLabel(meta.userAgent), meta.ip ?? 'unknown', `${meta.baseUrl}/app/settings/security`),
        },
      });
    }
    return { user, token };
  });
}

export async function completeLogin2fa(ctx: AppContext, challengeId: string, code: string, meta: RequestMeta) {
  const [row] = await ctx.db
    .select()
    .from(verificationTokens)
    .where(and(eq(verificationTokens.tokenHash, sha256(challengeId)), eq(verificationTokens.kind, 'login_2fa')));
  if (!row || row.consumedAt || row.expiresAt.getTime() < clock.ms() || !row.userId) throw unauthorized('This sign-in attempt expired — please log in again', 'challenge_expired');
  if (row.attempts >= 5) throw tooMany('Too many wrong codes — please log in again');
  const [user] = await ctx.db.select().from(users).where(eq(users.id, row.userId));
  const step = user?.totpSecretEnc ? verifyTotp(ctx.vault.decrypt(user.totpSecretEnc), code, clock.ms(), user.totpLastStep) : null;
  if (!user || step === null) {
    await ctx.db.update(verificationTokens).set({ attempts: row.attempts + 1 }).where(eq(verificationTokens.id, row.id));
    throw unauthorized('That code didn’t work — check your authenticator app', 'invalid_code');
  }
  await ctx.db.update(verificationTokens).set({ consumedAt: clock.now() }).where(eq(verificationTokens.id, row.id));
  await ctx.db.update(users).set({ totpLastStep: step }).where(eq(users.id, user.id));
  return finishLogin(ctx, user, meta);
}

/* ----------------------------------------------------- email & passwords */

export async function verifyEmail(ctx: AppContext, token: string) {
  return withUow(ctx, async (uow) => {
    const row = await consumeToken(uow.tx, token, 'email_verify');
    if (!row?.userId) throw badRequest('This link is invalid or expired. Request a new one from your dashboard.', 'invalid_token');
    await uow.tx.update(users).set({ emailVerifiedAt: clock.now(), updatedAt: clock.now() }).where(and(eq(users.id, row.userId), isNull(users.emailVerifiedAt)));
    await recomputeTier(uow, row.userId);
    return row.userId;
  });
}

export async function resendVerification(ctx: AppContext, user: UserRow, baseUrl: string) {
  if (user.emailVerifiedAt) throw badRequest('Your email is already verified', 'already_verified');
  const [recent] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(verificationTokens)
    .where(and(eq(verificationTokens.userId, user.id), eq(verificationTokens.kind, 'email_verify'), gte(verificationTokens.createdAt, new Date(clock.ms() - HOUR))));
  if (Number(recent?.n ?? 0) >= 5) throw tooMany('We’ve sent several emails already — check your spam folder, or try again in an hour.');
  await sendVerificationEmail(ctx.db, user, baseUrl);
}

export async function forgotPassword(ctx: AppContext, email: string, baseUrl: string) {
  const [user] = await ctx.db.select().from(users).where(eq(users.email, email));
  if (!user || user.status === 'deleted') return; // never reveal whether an email exists
  const token = await issueToken(ctx.db, user.id, 'password_reset', HOUR);
  await queueEmail(ctx.db, {
    userId: user.id,
    to: user.email,
    template: 'reset_password',
    content: templates.resetPassword(user.displayName, `${baseUrl}/reset-password?token=${token}`),
  });
}

export async function resetPassword(ctx: AppContext, token: string, password: string) {
  const hash = await hashPassword(password);
  return withUow(ctx, async (uow) => {
    const row = await consumeToken(uow.tx, token, 'password_reset');
    if (!row?.userId) throw badRequest('This reset link is invalid or expired. Request a new one.', 'invalid_token');
    await uow.tx.update(users).set({ passwordHash: hash, failedLoginCount: 0, lockedUntil: null, updatedAt: clock.now() }).where(eq(users.id, row.userId));
    await revokeOtherSessions(uow.tx, row.userId, null);
    await notify(uow, row.userId, { type: 'security', title: 'Password changed', body: 'Your password was reset and all sessions were signed out.', link: '/app/settings/security' });
  });
}

export async function changePassword(ctx: AppContext, user: UserRow, current: string, next: string, keepSessionId: string) {
  if (user.passwordHash && !(await verifyPassword(current, user.passwordHash))) throw badRequest('Your current password is incorrect', 'invalid_password');
  const hash = await hashPassword(next);
  await withUow(ctx, async (uow) => {
    await uow.tx.update(users).set({ passwordHash: hash, updatedAt: clock.now() }).where(eq(users.id, user.id));
    await revokeOtherSessions(uow.tx, user.id, keepSessionId);
    await notify(uow, user.id, { type: 'security', title: 'Password changed', body: 'Other sessions were signed out for your safety.', link: '/app/settings/security' });
  });
}

/* ------------------------------------------------------------------- phone */

export async function startPhoneVerification(ctx: AppContext, user: UserRow, phone: string) {
  const [taken] = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.phone, phone), ne(users.id, user.id), sql`${users.phoneVerifiedAt} is not null`));
  if (taken) throw conflict('This number is already linked to another account. Each person can have one account.', 'phone_taken');
  const [recent] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(verificationTokens)
    .where(and(eq(verificationTokens.userId, user.id), eq(verificationTokens.kind, 'phone_otp'), gte(verificationTokens.createdAt, new Date(clock.ms() - HOUR))));
  if (Number(recent?.n ?? 0) >= 5) throw tooMany('Too many codes requested — try again in an hour.');
  const code = numericCode(6);
  await issueToken(ctx.db, user.id, 'phone_otp', 10 * MINUTE, { codeHash: sha256(`${user.id}:${code}`), target: phone });
  await queueSms(ctx.db, { userId: user.id, to: phone, text: smsCode(code), template: 'phone_otp' });
}

export async function verifyPhone(ctx: AppContext, user: UserRow, code: string) {
  return withUow(ctx, async (uow) => {
    const [row] = await uow.tx
      .select()
      .from(verificationTokens)
      .where(and(eq(verificationTokens.userId, user.id), eq(verificationTokens.kind, 'phone_otp'), isNull(verificationTokens.consumedAt), gt(verificationTokens.expiresAt, clock.now())))
      .orderBy(sql`${verificationTokens.createdAt} desc`)
      .limit(1);
    if (!row) throw badRequest('Your code expired — request a new one', 'code_expired');
    if (row.attempts >= 5) throw tooMany('Too many wrong codes — request a new one');
    if (row.codeHash !== sha256(`${user.id}:${code}`)) {
      await uow.tx.update(verificationTokens).set({ attempts: row.attempts + 1 }).where(eq(verificationTokens.id, row.id));
      throw badRequest('That code isn’t right — check the SMS and try again', 'invalid_code');
    }
    await uow.tx.update(verificationTokens).set({ consumedAt: clock.now() }).where(eq(verificationTokens.id, row.id));
    await uow.tx.update(users).set({ phone: row.target, phoneVerifiedAt: clock.now(), updatedAt: clock.now() }).where(eq(users.id, user.id));
    await addSignal(uow, user.id, 'phone_verified', {});
    await recomputeTier(uow, user.id);
  });
}

/* --------------------------------------------------------------------- 2FA */

export async function totpSetup(ctx: AppContext, user: UserRow) {
  if (user.totpEnabledAt) throw badRequest('Two-factor authentication is already on', 'already_enabled');
  const secret = generateTotpSecret();
  await ctx.db.delete(verificationTokens).where(and(eq(verificationTokens.userId, user.id), eq(verificationTokens.kind, 'totp_setup')));
  await issueToken(ctx.db, user.id, 'totp_setup', 15 * MINUTE, { data: { secretEnc: ctx.vault.encrypt(secret) } });
  const url = otpauthUrl(secret, user.email);
  return { secret, otpauthUrl: url, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
}

export async function totpEnable(ctx: AppContext, user: UserRow, code: string) {
  const [row] = await ctx.db
    .select()
    .from(verificationTokens)
    .where(and(eq(verificationTokens.userId, user.id), eq(verificationTokens.kind, 'totp_setup'), isNull(verificationTokens.consumedAt), gt(verificationTokens.expiresAt, clock.now())));
  if (!row) throw badRequest('Setup expired — start again', 'setup_expired');
  const secretEnc = (row.data as { secretEnc?: string }).secretEnc!;
  const step = verifyTotp(ctx.vault.decrypt(secretEnc), code, clock.ms());
  if (step === null) throw badRequest('That code didn’t match — make sure your phone’s clock is correct', 'invalid_code');
  await withUow(ctx, async (uow) => {
    await uow.tx.update(verificationTokens).set({ consumedAt: clock.now() }).where(eq(verificationTokens.id, row.id));
    await uow.tx.update(users).set({ totpSecretEnc: secretEnc, totpEnabledAt: clock.now(), totpLastStep: step }).where(eq(users.id, user.id));
    await notify(uow, user.id, { type: 'security', title: 'Two-factor authentication is on 🔐', body: 'You’ll be asked for a code when you sign in.', link: '/app/settings/security' });
  });
}

export async function totpDisable(ctx: AppContext, user: UserRow, password: string, code: string) {
  if (!user.totpSecretEnc) throw badRequest('Two-factor authentication is not enabled');
  if (user.passwordHash && !(await verifyPassword(password, user.passwordHash))) throw badRequest('Password is incorrect', 'invalid_password');
  if (verifyTotp(ctx.vault.decrypt(user.totpSecretEnc), code, clock.ms()) === null) throw badRequest('That code didn’t work', 'invalid_code');
  await withUow(ctx, async (uow) => {
    await uow.tx.update(users).set({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null }).where(eq(users.id, user.id));
    await notify(uow, user.id, { type: 'security', title: 'Two-factor authentication turned off', body: 'If this wasn’t you, reset your password now.', link: '/app/settings/security' });
  });
}

/* --------------------------------------------------------------- Google */

export function googleEnabled(ctx: AppContext) {
  return !!(ctx.config.GOOGLE_CLIENT_ID && ctx.config.GOOGLE_CLIENT_SECRET);
}

export async function googleStart(ctx: AppContext, redirectUri: string, ref: string | null) {
  const state = await issueToken(ctx.db, null, 'oauth_state', 10 * MINUTE, { data: { redirectUri, ref } });
  const params = new URLSearchParams({
    client_id: ctx.config.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function googleCallback(ctx: AppContext, code: string, state: string, meta: RequestMeta) {
  const row = await consumeToken(ctx.db, state, 'oauth_state');
  if (!row) throw badRequest('Sign-in expired — please try again', 'invalid_state');
  const { redirectUri, ref } = row.data as { redirectUri: string; ref: string | null };
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: ctx.config.GOOGLE_CLIENT_ID!, client_secret: ctx.config.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  });
  if (!tokenRes.ok) throw badRequest('Google sign-in failed — please try again', 'oauth_failed');
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${access_token}` } });
  const info = (await infoRes.json()) as { sub: string; email: string; email_verified: boolean; name?: string };
  if (!info.email_verified) throw badRequest('Your Google email isn’t verified', 'oauth_unverified');
  const email = info.email.toLowerCase();
  const [bySub] = await ctx.db.select().from(users).where(eq(users.googleSub, info.sub));
  const [byEmail] = bySub ? [bySub] : await ctx.db.select().from(users).where(eq(users.email, email));
  if (byEmail) {
    if (byEmail.status === 'deleted') throw badRequest('This account was deleted');
    await ctx.db.update(users).set({ googleSub: info.sub, emailVerifiedAt: byEmail.emailVerifiedAt ?? clock.now() }).where(eq(users.id, byEmail.id));
    return { ...(await finishLogin(ctx, byEmail, meta)), isNew: false };
  }
  const result = await signup(
    ctx,
    {
      email,
      password: randomToken(24),
      displayName: (info.name ?? email.split('@')[0]).slice(0, 40),
      country: meta.ipCountry ?? 'US',
      acceptTerms: true,
      confirmAge: true,
      referralCode: ref ?? '',
    },
    meta,
  );
  await ctx.db.update(users).set({ googleSub: info.sub, emailVerifiedAt: clock.now(), passwordHash: null }).where(eq(users.id, result.user.id));
  return { user: result.user, token: result.token, isNew: true };
}

