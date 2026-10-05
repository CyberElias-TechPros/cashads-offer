import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { Role } from '@cashads/shared';
import type { sessions, users } from '../db/schema';
import { AppError, forbidden, unauthorized } from '../lib/errors';
import { SESSION_COOKIE, SESSION_TTL_MS, type RequestMeta } from '../modules/auth/service';

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export interface AuthState {
  user: UserRow;
  session: SessionRow;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthState | null;
  }
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issues = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw new AppError(400, 'validation_error', issues[0]?.message ?? 'Invalid request', { issues });
  }
  return r.data;
}

export function requireUser(req: FastifyRequest): AuthState {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

/** Earning/cash-out actions need an account that isn't banned (banned members can still log in to read why and appeal). */
export function requireActiveUser(req: FastifyRequest): AuthState {
  const auth = requireUser(req);
  if (auth.user.status === 'banned') throw forbidden(`Your account is suspended: ${auth.user.statusReason ?? 'see Support'}`, 'account_banned');
  return auth;
}

export function requireRole(req: FastifyRequest, roles: Role[]): AuthState {
  const auth = requireUser(req);
  if (!roles.includes(auth.user.role)) throw forbidden('Staff only');
  return auth;
}

function header(req: FastifyRequest, name: string): string | null {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0] ?? null;
  return typeof v === 'string' && v.length ? v : null;
}

export function isHttps(req: FastifyRequest): boolean {
  return (header(req, 'x-forwarded-proto') ?? req.protocol).split(',')[0].trim() === 'https';
}

/** Public base URL of the web app, derived from the proxy headers so links work on any preview domain. */
export function baseUrl(req: FastifyRequest, fallback: string): string {
  const host = header(req, 'x-forwarded-host') ?? header(req, 'host');
  if (!host || /^(127\.0\.0\.1|localhost):4000$/.test(host)) return fallback.replace(/\/$/, '');
  const proto = (header(req, 'x-forwarded-proto') ?? 'http').split(',')[0].trim();
  return `${proto}://${host.split(',')[0].trim()}`;
}

export function clientMeta(req: FastifyRequest, fallbackBase: string): RequestMeta {
  const deviceKey = header(req, 'x-device-key');
  const fp = header(req, 'x-device-fp');
  return {
    ip: req.ip ?? null,
    userAgent: header(req, 'user-agent'),
    deviceKey: deviceKey && /^[\w-]{8,80}$/.test(deviceKey) ? deviceKey : null,
    fingerprint: fp && /^[a-f0-9]{16,128}$/i.test(fp) ? fp : null,
    ipCountry: (header(req, 'cf-ipcountry') ?? header(req, 'x-vercel-ip-country') ?? header(req, 'x-country-code'))?.toUpperCase().slice(0, 2) ?? null,
    baseUrl: baseUrl(req, fallbackBase),
  };
}

/**
 * Session cookie. Over HTTPS we use SameSite=None + Partitioned (CHIPS) so the
 * app also works when embedded (e.g. preview iframes); CSRF is handled by the
 * custom-header check in app.ts. Over plain HTTP (local dev) we use Lax.
 */
export function setSessionCookie(req: FastifyRequest, reply: FastifyReply, token: string) {
  const secure = isHttps(req);
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure,
    sameSite: secure ? 'none' : 'lax',
    partitioned: secure,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function clearSessionCookie(req: FastifyRequest, reply: FastifyReply) {
  const secure = isHttps(req);
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure, sameSite: secure ? 'none' : 'lax', partitioned: secure });
}

export function sessionToken(req: FastifyRequest): string | null {
  const authz = header(req, 'authorization');
  if (authz?.startsWith('Bearer ')) return authz.slice(7).trim() || null;
  return req.cookies?.[SESSION_COOKIE] ?? null;
}

export function usedBearer(req: FastifyRequest): boolean {
  return !!header(req, 'authorization')?.startsWith('Bearer ');
}
