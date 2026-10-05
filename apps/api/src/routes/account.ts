import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  changePasswordSchema,
  claimCreateSchema,
  deleteAccountSchema,
  FAQ,
  goalSchema,
  kycSubmitSchema,
  onboardingSchema,
  phoneStartSchema,
  phoneVerifySchema,
  profileUpdateSchema,
  ticketCreateSchema,
  ticketReplySchema,
  totpDisableSchema,
  totpEnableSchema,
  TRANSACTION_TYPE_META,
  TRANSACTION_TYPES,
  TX_STATUSES,
  type TransactionDTO,
} from '@cashads/shared';
import { withUow, type AppContext } from '../context';
import { transactions, uploads } from '../db/schema';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { clientMeta, parse, requireActiveUser, requireUser } from '../http/plumbing';
import { openSse } from '../http/sse';
import * as account from '../modules/account/service';
import * as auth from '../modules/auth/service';
import * as claimsSvc from '../modules/claims/service';
import * as engagement from '../modules/engagement/service';
import * as notifications from '../modules/notifications/service';
import { referralSummary } from '../modules/referrals/service';
import * as support from '../modules/support/service';

function txDTO(t: typeof transactions.$inferSelect): TransactionDTO {
  const meta = { ...(t.meta ?? {}) } as Record<string, unknown>;
  delete meta.sourceAccount;
  delete meta.postbackId;
  return {
    id: t.id,
    type: t.type,
    status: t.status,
    amountMicros: t.amountMicros,
    description: t.description,
    createdAt: t.createdAt.toISOString(),
    availableAt: t.availableAt?.toISOString() ?? null,
    referenceType: t.referenceType,
    referenceId: t.referenceId,
    meta,
  };
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const txQuerySchema = z.object({
  type: z.enum(TRANSACTION_TYPES).optional(),
  group: z.enum(['earning', 'bonus', 'payout', 'adjustment']).optional(),
  status: z.enum(TX_STATUSES).optional(),
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const IMAGE_SIGNATURES: Array<{ mime: string; ext: string; test: (b: Buffer) => boolean }> = [
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
];

export async function accountRoutes(app: FastifyInstance, ctx: AppContext) {
  const fallback = ctx.config.PUBLIC_WEB_URL;

  /* ------------------------------------------------------------------ me */
  app.get('/api/me', async (req) => account.me(ctx, requireUser(req).user, auth.googleEnabled(ctx)));

  app.patch('/api/me', async (req) => {
    const { user } = requireUser(req);
    return account.updateProfile(ctx, user, parse(profileUpdateSchema, req.body));
  });

  app.post('/api/me/onboarding', async (req) => account.completeOnboarding(ctx, requireUser(req).user, parse(onboardingSchema, req.body)));
  app.put('/api/me/goal', async (req) => account.setGoal(ctx, requireUser(req).user, parse(goalSchema, req.body)));
  app.delete('/api/me/goal', async (req) => account.setGoal(ctx, requireUser(req).user, null));
  app.get('/api/me/health', async (req) => account.accountHealth(requireUser(req).user));

  app.post('/api/me/phone/start', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req) => {
    const { user } = requireUser(req);
    await auth.startPhoneVerification(ctx, user, parse(phoneStartSchema, req.body).phone);
    return { ok: true };
  });
  app.post('/api/me/phone/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { user } = requireUser(req);
    await auth.verifyPhone(ctx, user, parse(phoneVerifySchema, req.body).code);
    return { ok: true };
  });

  app.post('/api/me/password', { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (req) => {
    const { user, session } = requireUser(req);
    const input = parse(changePasswordSchema, req.body);
    await auth.changePassword(ctx, user, input.currentPassword, input.newPassword, session.id);
    return { ok: true };
  });

  app.get('/api/me/sessions', async (req) => {
    const { user, session } = requireUser(req);
    return account.listSessions(ctx, user.id, session.id);
  });
  app.delete('/api/me/sessions/:id', async (req) => {
    const { user } = requireUser(req);
    await account.revokeUserSession(ctx, user.id, (req.params as { id: string }).id);
    return { ok: true };
  });
  app.post('/api/me/sessions/revoke-others', async (req) => {
    const { user, session } = requireUser(req);
    await auth.revokeOtherSessions(ctx.db, user.id, session.id);
    return { ok: true };
  });
  app.get('/api/me/login-history', async (req) => account.loginHistory(ctx, requireUser(req).user.id));
  app.get('/api/me/devices', async (req) => account.listDevices(ctx, requireUser(req).user.id));

  app.post('/api/me/2fa/setup', async (req) => auth.totpSetup(ctx, requireUser(req).user));
  app.post('/api/me/2fa/enable', async (req) => {
    await auth.totpEnable(ctx, requireUser(req).user, parse(totpEnableSchema, req.body).code);
    return { ok: true };
  });
  app.post('/api/me/2fa/disable', async (req) => {
    const input = parse(totpDisableSchema, req.body);
    await auth.totpDisable(ctx, requireUser(req).user, input.password, input.code);
    return { ok: true };
  });

  app.get('/api/me/export', async (req, reply) => {
    const { user } = requireUser(req);
    const data = await account.exportData(ctx, user);
    reply.header('Content-Disposition', `attachment; filename="cashads-data-${new Date().toISOString().slice(0, 10)}.json"`);
    return data;
  });
  app.post('/api/me/delete', async (req, reply) => {
    const { user } = requireUser(req);
    const input = parse(deleteAccountSchema, req.body);
    await account.deleteAccount(ctx, user, input.password);
    reply.clearCookie(auth.SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me/kyc', async (req) => ({ status: requireUser(req).user.kycStatus, latest: await account.latestKyc(ctx, requireUser(req).user.id) }));
  app.post('/api/me/kyc', async (req) => {
    await account.submitKyc(ctx, requireActiveUser(req).user, parse(kycSubmitSchema, req.body));
    return { ok: true, status: 'pending' };
  });

  app.get('/api/me/tax', async (req) => {
    const year = Number((req.query as { year?: string }).year) || new Date().getUTCFullYear();
    return account.taxSummary(ctx, requireUser(req).user, year);
  });

  /* ----------------------------------------------------- live updates */
  app.get('/api/me/stream', async (req, reply) => {
    const { user } = requireUser(req);
    openSse(req, reply, (send) => ctx.bus.subscribeUser(user.id, (e) => send(e.type, e)));
  });

  /* ------------------------------------------------------------ wallet */
  app.get('/api/wallet', async (req) => account.walletDTO(ctx.db, requireUser(req).user.id));

  app.get('/api/wallet/transactions', async (req) => {
    const { user } = requireUser(req);
    const q = parse(txQuerySchema, req.query);
    const conds = [eq(transactions.userId, user.id)];
    if (q.type) conds.push(eq(transactions.type, q.type));
    if (q.group) conds.push(inArray(transactions.type, TRANSACTION_TYPES.filter((t) => TRANSACTION_TYPE_META[t].group === q.group)));
    if (q.status) conds.push(eq(transactions.status, q.status));
    if (q.before) conds.push(lt(transactions.createdAt, new Date(q.before)));
    const rows = await ctx.db.select().from(transactions).where(and(...conds)).orderBy(desc(transactions.createdAt)).limit(q.limit + 1);
    const items = rows.slice(0, q.limit).map(txDTO);
    return { items, nextCursor: rows.length > q.limit ? items[items.length - 1].createdAt : null };
  });

  app.get('/api/wallet/transactions.csv', async (req, reply) => {
    const { user } = requireUser(req);
    const year = Number((req.query as { year?: string }).year) || null;
    const conds = [eq(transactions.userId, user.id)];
    if (year) conds.push(sql`extract(year from ${transactions.createdAt}) = ${year}`);
    const rows = await ctx.db.select().from(transactions).where(and(...conds)).orderBy(desc(transactions.createdAt));
    const lines = [['date', 'type', 'description', 'status', 'amount_usd'].join(',')];
    for (const t of rows) {
      lines.push([t.createdAt.toISOString(), TRANSACTION_TYPE_META[t.type].label, t.description, t.status, (t.amountMicros / 1_000_000).toFixed(6)].map(csvCell).join(','));
    }
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="cashads-transactions${year ? `-${year}` : ''}.csv"`);
    return lines.join('\n');
  });

  /* -------------------------------------------------------- engagement */
  app.get('/api/engagement/summary', async (req) => engagement.engagementSummary(ctx, requireUser(req).user));
  app.post('/api/engagement/checkin', async (req) => {
    const { user } = requireActiveUser(req);
    return withUow(ctx, (uow) => engagement.checkin(uow, user.id));
  });
  app.post('/api/engagement/plan/claim', async (req) => {
    const { user } = requireActiveUser(req);
    const bonus = await withUow(ctx, (uow) => engagement.claimPlanBonus(uow, user));
    return { ok: true, bonusMicros: bonus };
  });
  app.get('/api/engagement/achievements', async (req) => engagement.listAchievements(ctx, requireUser(req).user.id));
  app.get('/api/engagement/leaderboard', async (req) => {
    const period = (req.query as { period?: string }).period === 'month' ? 'month' : 'week';
    return engagement.leaderboard(ctx, req.auth?.user ?? null, period);
  });

  /* --------------------------------------------------------- referrals */
  app.get('/api/referrals', async (req) => referralSummary(ctx, requireUser(req).user, clientMeta(req, fallback).baseUrl));

  /* ----------------------------------------------------- notifications */
  app.get('/api/notifications', async (req) => notifications.listNotifications(ctx, requireUser(req).user.id));
  app.post('/api/notifications/read', async (req) => {
    const { user } = requireUser(req);
    const body = parse(z.object({ ids: z.array(z.uuid()).max(200).optional(), all: z.boolean().optional() }), req.body ?? {});
    await notifications.markRead(ctx, user.id, body.all ? 'all' : (body.ids ?? []));
    return { ok: true, unread: await notifications.unreadCount(ctx.db, user.id) };
  });

  /* ----------------------------------------------------------- support */
  app.get('/api/support/faq', async () => FAQ);
  app.get('/api/support/tickets', async (req) => support.listTickets(ctx, requireUser(req).user.id));
  app.post('/api/support/tickets', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    reply.code(201);
    return support.createTicket(ctx, requireUser(req).user, parse(ticketCreateSchema, req.body));
  });
  app.get('/api/support/tickets/:id', async (req) => support.getTicket(ctx, requireUser(req).user.id, (req.params as { id: string }).id));
  app.post('/api/support/tickets/:id/messages', async (req) =>
    support.userReply(ctx, requireUser(req).user.id, (req.params as { id: string }).id, parse(ticketReplySchema, req.body).message),
  );
  app.post('/api/support/tickets/:id/close', async (req) => {
    await support.closeTicket(ctx, requireUser(req).user.id, (req.params as { id: string }).id);
    return { ok: true };
  });

  /* ------------------------------------------------------------ claims */
  app.get('/api/claims', async (req) => claimsSvc.listClaims(ctx, requireUser(req).user.id));
  app.get('/api/claims/:id', async (req) => claimsSvc.getClaim(ctx, requireUser(req).user.id, (req.params as { id: string }).id));
  app.post('/api/claims', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { user } = requireActiveUser(req);
    reply.code(201);
    return claimsSvc.createClaim(ctx, user.id, parse(claimCreateSchema, req.body));
  });

  /* ----------------------------------------------------------- uploads */
  app.post('/api/uploads', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { user } = requireUser(req);
    const file = await req.file();
    if (!file) throw badRequest('Attach an image');
    const buf = await file.toBuffer();
    const kind = IMAGE_SIGNATURES.find((s) => s.test(buf));
    if (!kind) throw badRequest('Only PNG, JPEG or WebP images are accepted', 'invalid_file');
    const purposeField = file.fields.purpose as { value?: string } | undefined;
    const purpose = ['claim_evidence', 'kyc_document', 'kyc_selfie', 'ticket'].includes(purposeField?.value ?? '') ? purposeField!.value! : 'other';
    const id = crypto.randomUUID();
    const dir = path.resolve(ctx.config.DATA_DIR, 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${id}.${kind.ext}`);
    fs.writeFileSync(filePath, buf, { mode: 0o600 });
    await ctx.db.insert(uploads).values({ id, userId: user.id, purpose, mime: kind.mime, size: buf.length, path: filePath });
    reply.code(201);
    return { id, mime: kind.mime, size: buf.length };
  });

  app.get('/api/uploads/:id', async (req, reply) => {
    const { user } = requireUser(req);
    const [up] = await ctx.db.select().from(uploads).where(eq(uploads.id, (req.params as { id: string }).id));
    if (!up) throw notFound();
    if (up.userId !== user.id && user.role === 'user') throw forbidden();
    reply.header('Content-Type', up.mime);
    reply.header('Cache-Control', 'private, max-age=300');
    return reply.send(fs.createReadStream(up.path));
  });

}
