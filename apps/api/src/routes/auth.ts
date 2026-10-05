import type { FastifyInstance } from 'fastify';
import {
  forgotPasswordSchema,
  login2faSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
  tokenSchema,
} from '@cashads/shared';
import type { AppContext } from '../context';
import { clearSessionCookie, clientMeta, parse, requireUser, setSessionCookie } from '../http/plumbing';
import { me } from '../modules/account/service';
import {
  completeLogin2fa,
  forgotPassword,
  googleCallback,
  googleEnabled,
  googleStart,
  login,
  resendVerification,
  resetPassword,
  resolveSession,
  revokeSession,
  signup,
  verifyEmail,
} from '../modules/auth/service';

const strict = { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } };

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  const fallback = ctx.config.PUBLIC_WEB_URL;

  app.get('/api/auth/providers', async () => ({ google: googleEnabled(ctx), demoMode: ctx.config.DEMO_MODE }));

  app.post('/api/auth/signup', strict, async (req, reply) => {
    const input = parse(signupSchema, req.body);
    const meta = clientMeta(req, fallback);
    const { user, token } = await signup(ctx, input, meta, req.cookies?.ca_ref ?? null);
    setSessionCookie(req, reply, token);
    reply.code(201);
    return me(ctx, user, googleEnabled(ctx));
  });

  app.post('/api/auth/login', strict, async (req, reply) => {
    const input = parse(loginSchema, req.body);
    const result = await login(ctx, input, clientMeta(req, fallback));
    if (result.kind === '2fa') return { twoFactorRequired: true, challengeId: result.challengeId };
    setSessionCookie(req, reply, result.token);
    return me(ctx, result.user, googleEnabled(ctx));
  });

  app.post('/api/auth/login/2fa', strict, async (req, reply) => {
    const input = parse(login2faSchema, req.body);
    const result = await completeLogin2fa(ctx, input.challengeId, input.code, clientMeta(req, fallback));
    setSessionCookie(req, reply, result.token);
    return me(ctx, result.user, googleEnabled(ctx));
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.auth) await revokeSession(ctx.db, req.auth.session.id);
    clearSessionCookie(req, reply);
    return { ok: true };
  });

  app.post('/api/auth/verify-email', strict, async (req) => {
    const { token } = parse(tokenSchema, req.body);
    await verifyEmail(ctx, token);
    return { ok: true };
  });

  app.post('/api/auth/resend-verification', strict, async (req) => {
    const { user } = requireUser(req);
    await resendVerification(ctx, user, clientMeta(req, fallback).baseUrl);
    return { ok: true };
  });

  app.post('/api/auth/forgot-password', strict, async (req) => {
    const { email } = parse(forgotPasswordSchema, req.body);
    await forgotPassword(ctx, email, clientMeta(req, fallback).baseUrl);
    return { ok: true, message: 'If an account exists for that email, a reset link is on its way.' };
  });

  app.post('/api/auth/reset-password', strict, async (req) => {
    const input = parse(resetPasswordSchema, req.body);
    await resetPassword(ctx, input.token, input.password);
    return { ok: true };
  });

  app.get('/api/auth/google/start', async (req, reply) => {
    if (!googleEnabled(ctx)) return reply.redirect('/login?error=google_not_configured');
    const base = clientMeta(req, fallback).baseUrl;
    const ref = (req.query as { ref?: string }).ref ?? req.cookies?.ca_ref ?? null;
    return reply.redirect(await googleStart(ctx, `${base}/api/auth/google/callback`, ref));
  });

  app.get('/api/auth/google/callback', async (req, reply) => {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state) return reply.redirect('/login?error=google_failed');
    try {
      const result = await googleCallback(ctx, code, state, clientMeta(req, fallback));
      setSessionCookie(req, reply, result.token);
      return reply.redirect(result.isNew ? '/app/onboarding' : '/app');
    } catch {
      return reply.redirect('/login?error=google_failed');
    }
  });

  // Lightweight session probe used by the web proxy for route protection.
  app.get('/api/auth/session', async (req) => {
    if (!req.auth) return { authenticated: false };
    const fresh = await resolveSession(ctx, req.cookies?.ca_session ?? '');
    return { authenticated: !!fresh || !!req.auth, role: req.auth.user.role, onboarded: !!req.auth.user.onboardingCompletedAt };
  });
}
