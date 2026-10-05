import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaLoginSchema,
  otpSchema,
  phoneStartSchema,
  registerSchema,
  resetPasswordSchema,
  tokenSchema,
} from '@lucrum/shared';
import { z } from 'zod';
import { clearSessionCookie, requireUser } from '../http/auth';
import { sessions } from '../db/schema';
import { eq } from 'drizzle-orm';
import {
  changePassword,
  confirmPhoneVerification,
  disableTotp,
  enableTotp,
  forgotPassword,
  listSessions,
  login,
  loginHistory,
  loginWithMfa,
  register,
  resendVerification,
  resetPassword,
  revokeOtherSessions,
  revokeSession,
  setupTotp,
  startPhoneVerification,
  verifyEmail,
} from '../modules/auth/service';
import { getUser, toMeDTO } from '../modules/users/service';
import { publicBaseUrl } from './util';

const strict = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;
  const tags = ['auth'];

  app.post(
    '/register',
    { schema: { tags, summary: 'Create an account', body: registerSchema }, config: strict },
    async (req, reply) => {
      const user = await register(ctx, reply, req.body, req.client, publicBaseUrl(req));
      return { user: await toMeDTO(ctx, ctx.db, user) };
    },
  );

  app.post(
    '/login',
    { schema: { tags, summary: 'Sign in', body: loginSchema }, config: strict },
    async (req, reply) => {
      const res = await login(ctx, reply, req.body, req.client);
      if (res.mfaToken) return { mfaRequired: true, mfaToken: res.mfaToken };
      return { user: await toMeDTO(ctx, ctx.db, res.user!) };
    },
  );

  app.post(
    '/login/mfa',
    { schema: { tags, summary: 'Complete sign-in with a 2FA code', body: mfaLoginSchema }, config: strict },
    async (req, reply) => {
      const user = await loginWithMfa(ctx, reply, req.body.mfaToken, req.body.code, req.client);
      return { user: await toMeDTO(ctx, ctx.db, user) };
    },
  );

  app.post('/logout', { schema: { tags, summary: 'Sign out this device' } }, async (req, reply) => {
    if (req.auth)
      await ctx.db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.id, req.auth.session.id));
    clearSessionCookie(reply, ctx.config.COOKIE_SECURE);
    return { ok: true };
  });

  app.get('/me', { schema: { tags, summary: 'Current member (null when signed out)' } }, async (req) => {
    if (!req.auth) return { user: null };
    return { user: await toMeDTO(ctx, ctx.db, req.auth.user) };
  });

  app.post(
    '/verify-email',
    { schema: { tags, summary: 'Confirm email address', body: tokenSchema }, config: strict },
    async (req) => {
      const user = await verifyEmail(ctx, req.body.token);
      return { user: await toMeDTO(ctx, ctx.db, user) };
    },
  );

  app.post(
    '/resend-verification',
    { schema: { tags, summary: 'Resend the verification email' }, config: strict },
    async (req) => {
      await resendVerification(ctx, requireUser(req), publicBaseUrl(req));
      return { ok: true };
    },
  );

  app.post(
    '/forgot-password',
    { schema: { tags, summary: 'Email a password reset link', body: forgotPasswordSchema }, config: strict },
    async (req) => {
      await forgotPassword(ctx, req.body.email, publicBaseUrl(req));
      return { ok: true };
    },
  );

  app.post(
    '/reset-password',
    {
      schema: { tags, summary: 'Set a new password from a reset link', body: resetPasswordSchema },
      config: strict,
    },
    async (req) => {
      await resetPassword(ctx, req.body.token, req.body.password);
      return { ok: true };
    },
  );

  app.post(
    '/change-password',
    { schema: { tags, summary: 'Change password', body: changePasswordSchema }, config: strict },
    async (req) => {
      const user = requireUser(req);
      await changePassword(ctx, user, req.auth!.session.id, req.body.currentPassword, req.body.newPassword);
      return { ok: true };
    },
  );

  app.get('/sessions', { schema: { tags, summary: 'Signed-in devices' } }, async (req) => {
    const user = requireUser(req);
    return listSessions(ctx, user.id, req.auth!.session.id);
  });

  app.delete(
    '/sessions/:id',
    { schema: { tags, summary: 'Sign out a device', params: z.object({ id: z.uuid() }) } },
    async (req) => {
      const user = requireUser(req);
      await revokeSession(ctx, user.id, req.params.id);
      return { ok: true };
    },
  );

  app.post(
    '/sessions/revoke-others',
    { schema: { tags, summary: 'Sign out all other devices' } },
    async (req) => {
      const user = requireUser(req);
      await revokeOtherSessions(ctx, user.id, req.auth!.session.id);
      return { ok: true };
    },
  );

  app.get('/login-history', { schema: { tags, summary: 'Recent sign-ins' } }, async (req) =>
    loginHistory(ctx, requireUser(req).id),
  );

  app.post('/2fa/setup', { schema: { tags, summary: 'Start authenticator-app set-up' } }, async (req) =>
    setupTotp(ctx, requireUser(req)),
  );

  app.post(
    '/2fa/enable',
    {
      schema: { tags, summary: 'Confirm authenticator code and enable 2FA', body: otpSchema },
      config: strict,
    },
    async (req) => {
      const user = await getUser(ctx.db, requireUser(req).id);
      return { recoveryCodes: await enableTotp(ctx, user, req.body.code, req.client.ip) };
    },
  );

  app.post(
    '/2fa/disable',
    {
      schema: { tags, summary: 'Disable 2FA', body: z.object({ code: z.string().min(6).max(20) }) },
      config: strict,
    },
    async (req) => {
      const user = await getUser(ctx.db, requireUser(req).id);
      await disableTotp(ctx, user, req.body.code, req.client.ip);
      return { ok: true };
    },
  );

  app.post(
    '/phone/start',
    { schema: { tags, summary: 'Send a phone verification code', body: phoneStartSchema }, config: strict },
    async (req) => startPhoneVerification(ctx, requireUser(req), req.body.phone),
  );

  app.post(
    '/phone/verify',
    { schema: { tags, summary: 'Confirm the phone verification code', body: otpSchema }, config: strict },
    async (req) => {
      const user = requireUser(req);
      await confirmPhoneVerification(ctx, user, req.body.code);
      return { user: await toMeDTO(ctx, ctx.db, await getUser(ctx.db, user.id)) };
    },
  );
};
