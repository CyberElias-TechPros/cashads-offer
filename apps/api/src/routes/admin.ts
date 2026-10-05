import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  adminAdjustSchema,
  adminClaimDecisionSchema,
  adminFraudResolveSchema,
  adminKycDecisionSchema,
  adminNetworkUpdateSchema,
  adminNoteSchema,
  adminOfferSchema,
  adminReasonSchema,
  adminRoleSchema,
  adminUserStatusSchema,
  settingsSchema,
  ticketReplySchema,
  TICKET_STATUSES,
} from '@cashads/shared';
import type { AppContext } from '../context';
import { kycSubmissions } from '../db/schema';
import { clientMeta, parse, requireRole } from '../http/plumbing';
import { notFound } from '../lib/errors';
import * as admin from '../modules/admin/service';
import { decideKyc } from '../modules/account/service';
import { decideClaim } from '../modules/claims/service';
import { recomputeOfferStats } from '../modules/offers/service';
import { approvePayout, finalizeFailure, processPayout } from '../modules/payouts/service';
import { replayPostback } from '../modules/postbacks/service';
import { publicStats } from '../modules/public/service';
import { simulateReversal } from '../modules/sandbox/service';
import * as support from '../modules/support/service';

const idParam = z.object({ id: z.uuid() });
const STAFF = ['admin', 'support'] as const;

export async function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  const staff = (req: Parameters<typeof requireRole>[0]) => requireRole(req, [...STAFF]).user;
  const adminOnly = (req: Parameters<typeof requireRole>[0]) => requireRole(req, ['admin']).user;

  app.get('/api/admin/overview', async (req) => {
    staff(req);
    return admin.overview(ctx);
  });
  app.get('/api/admin/analytics', async (req) => {
    staff(req);
    return admin.analytics(ctx);
  });

  /* --------------------------------------------------------------- users */
  app.get('/api/admin/users', async (req) => {
    staff(req);
    const q = req.query as { q?: string; status?: string; risk?: string; page?: string };
    return admin.listUsers(ctx, { q: q.q, status: q.status, risk: q.risk, page: Number(q.page) || 1 });
  });
  app.get('/api/admin/users/:id', async (req) => {
    staff(req);
    return admin.userDetail(ctx, parse(idParam, req.params).id);
  });
  app.post('/api/admin/users/:id/status', async (req) => {
    const actor = staff(req);
    const input = parse(adminUserStatusSchema, req.body);
    await admin.setUserStatus(ctx, actor.id, parse(idParam, req.params).id, input.status, input.reason, req.ip);
    return { ok: true };
  });
  app.post('/api/admin/users/:id/adjust', async (req) => {
    const actor = adminOnly(req);
    const input = parse(adminAdjustSchema, req.body);
    await admin.adjustBalance(ctx, actor.id, parse(idParam, req.params).id, input.amountMicros, input.reason, req.ip);
    return { ok: true };
  });
  app.post('/api/admin/users/:id/notes', async (req) => {
    const actor = staff(req);
    await admin.addNote(ctx, actor.id, parse(idParam, req.params).id, parse(adminNoteSchema, req.body).note);
    return { ok: true };
  });
  app.post('/api/admin/users/:id/role', async (req) => {
    const actor = adminOnly(req);
    await admin.setRole(ctx, actor.id, parse(idParam, req.params).id, parse(adminRoleSchema, req.body).role, req.ip);
    return { ok: true };
  });
  app.post('/api/admin/users/:id/flag', async (req) => {
    const actor = staff(req);
    await admin.flagUser(ctx, actor.id, parse(idParam, req.params).id, parse(adminNoteSchema, req.body).note);
    return { ok: true };
  });
  app.post('/api/admin/users/:id/revoke-sessions', async (req) => {
    const actor = staff(req);
    await admin.revokeAllSessions(ctx, actor.id, parse(idParam, req.params).id);
    return { ok: true };
  });

  /* ------------------------------------------------------------- payouts */
  app.get('/api/admin/payouts', async (req) => {
    staff(req);
    return admin.listAdminPayouts(ctx, (req.query as { status?: string }).status || undefined);
  });
  app.post('/api/admin/payouts/:id/approve', async (req) => {
    const actor = staff(req);
    const { id } = parse(idParam, req.params);
    await approvePayout(ctx, id, actor.id);
    await admin.audit(ctx.db, actor.id, 'payout.approve', 'payout', id, {}, req.ip);
    return { ok: true };
  });
  app.post('/api/admin/payouts/bulk-approve', async (req) => {
    const actor = staff(req);
    const { ids } = parse(z.object({ ids: z.array(z.uuid()).min(1).max(100) }), req.body);
    const results = [];
    for (const id of ids) {
      try {
        await approvePayout(ctx, id, actor.id);
        results.push({ id, ok: true });
      } catch (err) {
        results.push({ id, ok: false, error: (err as Error).message });
      }
    }
    await admin.audit(ctx.db, actor.id, 'payout.bulk_approve', 'payout', null, { ids }, req.ip);
    return { results };
  });
  app.post('/api/admin/payouts/:id/reject', async (req) => {
    const actor = staff(req);
    const { id } = parse(idParam, req.params);
    const { reason } = parse(adminReasonSchema, req.body);
    await finalizeFailure(ctx, id, 'rejected', reason, actor.id);
    await admin.audit(ctx.db, actor.id, 'payout.reject', 'payout', id, { reason }, req.ip);
    return { ok: true };
  });
  app.post('/api/admin/payouts/:id/retry', async (req) => {
    const actor = staff(req);
    const { id } = parse(idParam, req.params);
    await processPayout(ctx, id).catch(() => undefined);
    await admin.audit(ctx.db, actor.id, 'payout.retry', 'payout', id, {}, req.ip);
    return { ok: true };
  });

  /* --------------------------------------------------------------- fraud */
  app.get('/api/admin/fraud', async (req) => {
    staff(req);
    return admin.listFraudCases(ctx, (req.query as { status?: string }).status || 'open');
  });
  app.post('/api/admin/fraud/:id/resolve', async (req) => {
    const actor = staff(req);
    const input = parse(adminFraudResolveSchema, req.body);
    await admin.resolveFraudCase(ctx, actor.id, parse(idParam, req.params).id, input.action, input.note, req.ip);
    return { ok: true };
  });

  /* -------------------------------------------------------------- claims */
  app.get('/api/admin/claims', async (req) => {
    staff(req);
    return admin.listAdminClaims(ctx, (req.query as { status?: string }).status || undefined);
  });
  app.post('/api/admin/claims/:id/decide', async (req) => {
    const actor = staff(req);
    const { id } = parse(idParam, req.params);
    const input = parse(adminClaimDecisionSchema, req.body);
    await decideClaim(ctx, id, actor.id, input);
    await admin.audit(ctx.db, actor.id, `claim.${input.decision}`, 'claim', id, { reason: input.reason, amountMicros: input.amountMicros }, req.ip);
    return { ok: true };
  });

  /* ----------------------------------------------------------------- KYC */
  app.get('/api/admin/kyc', async (req) => {
    staff(req);
    return admin.listKycQueue(ctx);
  });
  app.post('/api/admin/kyc/:id/decide', async (req) => {
    const actor = staff(req);
    const { id } = parse(idParam, req.params);
    const input = parse(adminKycDecisionSchema, req.body);
    const [sub] = await ctx.db.select().from(kycSubmissions).where(eq(kycSubmissions.id, id));
    if (!sub) throw notFound();
    await decideKyc(ctx, id, input.decision, input.reason ?? null, actor.id);
    await admin.audit(ctx.db, actor.id, `kyc.${input.decision}`, 'user', sub.userId, { submissionId: id, reason: input.reason }, req.ip);
    return { ok: true };
  });

  /* -------------------------------------------------------------- offers */
  app.get('/api/admin/offers', async (req) => {
    staff(req);
    return admin.listAdminOffers(ctx);
  });
  app.post('/api/admin/offers', async (req, reply) => {
    const actor = adminOnly(req);
    reply.code(201);
    return admin.createOffer(ctx, actor.id, parse(adminOfferSchema, req.body));
  });
  app.patch('/api/admin/offers/:id', async (req) => {
    const actor = adminOnly(req);
    return admin.updateOffer(ctx, actor.id, parse(idParam, req.params).id, parse(adminOfferSchema.partial(), req.body));
  });
  app.get('/api/admin/offers/:id/reports', async (req) => {
    staff(req);
    return admin.offerReportsList(ctx, parse(idParam, req.params).id);
  });
  app.post('/api/admin/offers/recompute-stats', async (req) => {
    adminOnly(req);
    await recomputeOfferStats(ctx);
    return { ok: true };
  });

  /* ------------------------------------------------------------ networks */
  app.get('/api/admin/networks', async (req) => {
    staff(req);
    return admin.listNetworks(ctx, clientMeta(req, ctx.config.PUBLIC_WEB_URL).baseUrl);
  });
  app.patch('/api/admin/networks/:id', async (req) => {
    const actor = adminOnly(req);
    await admin.updateNetwork(ctx, actor.id, (req.params as { id: string }).id, parse(adminNetworkUpdateSchema, req.body));
    return { ok: true };
  });
  app.post('/api/admin/networks/:id/rotate-secret', async (req) => {
    const actor = adminOnly(req);
    return { secret: await admin.rotateNetworkSecret(ctx, actor.id, (req.params as { id: string }).id) };
  });

  /* ----------------------------------------------------------- postbacks */
  app.get('/api/admin/postbacks', async (req) => {
    staff(req);
    const q = req.query as { status?: string; networkId?: string; q?: string };
    return admin.listPostbacks(ctx, { status: q.status || undefined, networkId: q.networkId || undefined, q: q.q || undefined });
  });
  app.post('/api/admin/postbacks/:id/replay', async (req) => {
    const actor = staff(req);
    const { id } = parse(idParam, req.params);
    const { force } = parse(z.object({ force: z.boolean().default(false) }), req.body ?? {});
    const result = await replayPostback(ctx, id, { force });
    await admin.audit(ctx.db, actor.id, 'postback.replay', 'postback', id, { force, result: result.status }, req.ip);
    return result;
  });
  app.post('/api/admin/postbacks/:id/simulate-reversal', async (req) => {
    const actor = adminOnly(req);
    const { id } = parse(idParam, req.params);
    await simulateReversal(ctx, id);
    await admin.audit(ctx.db, actor.id, 'sandbox.simulate_reversal', 'postback', id, {}, req.ip);
    return { ok: true };
  });

  /* ------------------------------------------------------------- tickets */
  app.get('/api/admin/tickets', async (req) => {
    staff(req);
    return admin.listAdminTickets(ctx, (req.query as { status?: string }).status || undefined);
  });
  app.get('/api/admin/tickets/:id', async (req) => {
    staff(req);
    return support.getTicket(ctx, null, parse(idParam, req.params).id);
  });
  app.post('/api/admin/tickets/:id/reply', async (req) => {
    const actor = staff(req);
    const body = parse(ticketReplySchema.extend({ status: z.enum(TICKET_STATUSES).default('awaiting_user') }), req.body);
    return support.staffReply(ctx, actor.id, parse(idParam, req.params).id, body.message, body.status);
  });
  app.post('/api/admin/tickets/:id/status', async (req) => {
    staff(req);
    const { status } = parse(z.object({ status: z.enum(TICKET_STATUSES) }), req.body);
    await support.setTicketStatus(ctx, parse(idParam, req.params).id, status);
    return { ok: true };
  });

  /* -------------------------------------------------------------- ledger */
  app.get('/api/admin/ledger/trial-balance', async (req) => {
    adminOnly(req);
    return admin.trialBalance(ctx);
  });
  app.get('/api/admin/ledger/reconcile', async (req) => {
    adminOnly(req);
    return admin.reconcile(ctx);
  });
  app.get('/api/admin/ledger/entries', async (req) => {
    adminOnly(req);
    return admin.recentEntries(ctx);
  });

  /* ------------------------------------------------------------ settings */
  app.get('/api/admin/settings', async (req) => {
    staff(req);
    return ctx.settings.get();
  });
  app.put('/api/admin/settings', async (req) => {
    const actor = adminOnly(req);
    const patch = parse(settingsSchema.partial(), req.body);
    const before = ctx.settings.get();
    const updated = await ctx.settings.update(patch, actor.id);
    const changes = Object.fromEntries(Object.keys(patch).map((k) => [k, { from: before[k as keyof typeof before], to: updated[k as keyof typeof updated] }]));
    await admin.audit(ctx.db, actor.id, 'settings.update', 'settings', null, changes, req.ip);
    await publicStats(ctx, true);
    return updated;
  });

  /* ---------------------------------------------------------------- misc */
  app.get('/api/admin/audit', async (req) => {
    adminOnly(req);
    return admin.listAudit(ctx);
  });
  app.get('/api/admin/jobs', async (req) => {
    adminOnly(req);
    return admin.listJobs(ctx, (req.query as { status?: string }).status || undefined);
  });
  app.post('/api/admin/jobs/:id/retry', async (req) => {
    const actor = adminOnly(req);
    await admin.retryJob(ctx, actor.id, parse(idParam, req.params).id);
    return { ok: true };
  });
  app.get('/api/admin/outbox', async (req) => {
    staff(req);
    return admin.listOutbox(ctx, 200);
  });
}
