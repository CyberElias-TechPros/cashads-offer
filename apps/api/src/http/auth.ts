import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Role } from '@lucrum/shared';
import type { AppContext } from '../context';
import type { DbOrTx } from '../db/client';
import { devices, sessions, users } from '../db/schema';
import { randomToken, sha256 } from '../lib/crypto';
import { forbidden, unauthorized } from '../lib/errors';
import { deviceLabel } from '../lib/net';
import { DAY, MINUTE } from '../lib/time';

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;

export const SESSION_COOKIE = 'ca_session';
const SESSION_TTL = 30 * DAY;

export interface ClientInfo {
  ip: string;
  userAgent: string;
  deviceKey: string;
  fingerprint: string | null;
  label: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: { user: UserRow; session: SessionRow } | null;
    client: ClientInfo;
  }
  interface FastifyInstance {
    ctx: AppContext;
  }
}

const DEVICE_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function clientInfo(req: FastifyRequest): ClientInfo {
  const ua = String(req.headers['user-agent'] ?? '').slice(0, 400);
  const rawKey = String(req.headers['x-device-id'] ?? '');
  const fp = String(req.headers['x-device-fp'] ?? '');
  return {
    ip: req.ip,
    userAgent: ua,
    // Clients without a device id get an IP+UA-derived one so device logic still works.
    deviceKey: DEVICE_KEY_RE.test(rawKey) ? rawKey : `anon_${sha256(`${req.ip}|${ua}`).slice(0, 24)}`,
    fingerprint: /^[a-f0-9]{16,128}$/i.test(fp) ? fp.toLowerCase() : null,
    label: deviceLabel(ua),
  };
}

export async function upsertDevice(
  db: DbOrTx,
  userId: string,
  client: ClientInfo,
): Promise<{ id: string; isNew: boolean }> {
  const existing = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.userId, userId), eq(devices.deviceKey, client.deviceKey)));
  if (existing[0]) {
    await db
      .update(devices)
      .set({
        lastSeenAt: new Date(),
        lastIp: client.ip,
        userAgent: client.userAgent,
        fingerprintHash: client.fingerprint,
      })
      .where(eq(devices.id, existing[0].id));
    return { id: existing[0].id, isNew: false };
  }
  const [row] = await db
    .insert(devices)
    .values({
      userId,
      deviceKey: client.deviceKey,
      fingerprintHash: client.fingerprint,
      label: client.label,
      userAgent: client.userAgent,
      lastIp: client.ip,
    })
    .returning({ id: devices.id });
  return { id: row!.id, isNew: true };
}

export async function createSession(
  db: DbOrTx,
  reply: FastifyReply,
  user: UserRow,
  client: ClientInfo,
  secureCookie: boolean,
): Promise<{ sessionId: string; newDevice: boolean }> {
  const device = await upsertDevice(db, user.id, client);
  const token = randomToken(32);
  const [session] = await db
    .insert(sessions)
    .values({
      userId: user.id,
      tokenHash: sha256(token),
      deviceId: device.id,
      label: client.label,
      ip: client.ip,
      userAgent: client.userAgent,
      expiresAt: new Date(Date.now() + SESSION_TTL),
    })
    .returning({ id: sessions.id });
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookie,
    path: '/',
    maxAge: SESSION_TTL / 1000,
  });
  await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, user.id));
  return { sessionId: session!.id, newDevice: device.isNew };
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure });
}

/** Fastify plugin: resolves the session cookie to `req.auth` on every request. */
export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('auth', null);
  app.decorateRequest('client', null as unknown as ClientInfo);

  app.addHook('onRequest', async (req) => {
    req.client = clientInfo(req);
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return;
    const now = new Date();
    const rows = await app.ctx.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, sha256(token)),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
          isNull(users.deletedAt),
        ),
      );
    const row = rows[0];
    if (!row) return;
    req.auth = { user: row.user, session: row.session };
    // Sliding expiry + activity tracking, throttled to one write per 5 minutes.
    if (now.getTime() - row.session.lastUsedAt.getTime() > 5 * MINUTE) {
      await app.ctx.db
        .update(sessions)
        .set({ lastUsedAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL), ip: req.client.ip })
        .where(eq(sessions.id, row.session.id));
      await app.ctx.db.update(users).set({ lastSeenAt: now }).where(eq(users.id, row.user.id));
    }
  });
});

/* ── guards ────────────────────────────────────────────────────────────────── */

export function requireUser(req: FastifyRequest): UserRow {
  if (!req.auth) throw unauthorized();
  return req.auth.user;
}

/** Earning and cash-out routes: the account must be in good standing. */
export function requireActiveUser(req: FastifyRequest): UserRow {
  const user = requireUser(req);
  if (user.status === 'banned' || user.status === 'restricted') {
    throw forbidden(
      user.status === 'banned'
        ? 'Your account is restricted. See the reason and appeal from your dashboard.'
        : 'Your account is under a short security review. Earning and cash-outs are paused until it completes.',
      'ACCOUNT_RESTRICTED',
    );
  }
  return user;
}

const ROLE_RANK: Record<Role, number> = { user: 0, support: 1, finance: 2, admin: 3 };

export function requireRole(req: FastifyRequest, ...roles: Role[]): UserRow {
  const user = requireUser(req);
  if (user.role === 'admin' || roles.includes(user.role)) return user;
  throw forbidden('Staff access required');
}

export function hasRole(user: UserRow, min: Role): boolean {
  return ROLE_RANK[user.role] >= ROLE_RANK[min];
}
