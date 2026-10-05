import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  type AdminSettingsDTO,
  adminAdjustSchema,
  adminBanSchema,
  adminBatchSchema,
  adminClaimApproveSchema,
  adminClaimRejectSchema,
  adminFeatureStatusSchema,
  adminFlagResolveSchema,
  adminKycDecideSchema,
  adminNetworkPatchSchema,
  adminNoteSchema,
  adminOfferStatusSchema,
  adminOfferUpsertSchema,
  adminPayoutRejectSchema,
  adminReportResolveSchema,
  adminRoleSchema,
  adminTicketReplySchema,
  settingsPatchSchema,
} from '@cashads/shared';
import { z } from 'zod';
import { claims, kycSubmissions } from '../db/schema';
import { requireRole } from '../http/auth';
import { AppError, notFound } from '../lib/errors';
import {
  addNote,
  adjustBalance,
  analytics,
  banUser,
  listAudit,
  listClaimsAdmin,
  listFraudFlags,
  listJobs,
  listKyc,
  listNetworks,
  listOffersAdmin,
  listPayoutsAdmin,
  listPostbacks,
  listReports,
  listTicketsAdmin,
  listUsers,
  logoutEverywhere,
  overview,
  patchNetwork,
  payoutsCsv,
  resolveFraudFlag,
  resolveReport,
  retryJob,
  setOfferStatus,
  setRole,
  unbanUser,
  upsertOffer,
  userDetail,
} from '../modules/admin/service';
import { approve, getClaimDTO, rejectClaim } from '../modules/claims/service';
import { decideKyc } from '../modules/finance/service';
import { audit } from '../modules/platform/messaging';
import { approvePayout, getPayoutDTO, rejectPayout, retryNow } from '../modules/payouts/service';
import { replayPostback } from '../modules/postbacks/service';
import { getTicket, setFeatureStatus, staffReply } from '../modules/support/service';
import { listFeatureRequests } from '../modules/support/service';
import { invalidateStatsCache } from '../modules/transparency/service';
import { csvReply } from './util';

const id = z.object({ id: z.uuid() });

export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;
  const tags = ['admin'];

  app.get('/overview', { schema: { tags, summary: 'KPIs, queues and 14-day series' } }, async (req) => {
    requireRole(req, 'support', 'finance');
    return overview(ctx);
  });

  app.get(
    '/analytics',
    {
      schema: {
        tags,
        summary: 'Unit economics and retention cohorts',
        querystring: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }),
      },
    },
    async (req) => {
      requireRole(req, 'finance');
      return analytics(ctx, req.query.days);
    },
  );

  /* users */
  app.get(
    '/users',
    {
      schema: {
        tags,
        summary: 'Search members',
        querystring: z.object({
          q: z.string().max(100).optional(),
          status: z.string().max(20).optional(),
          page: z.coerce.number().int().min(1).default(1),
        }),
      },
    },
    async (req) => {
      requireRole(req, 'support');
      return listUsers(ctx, req.query);
    },
  );
  app.get('/users/:id', { schema: { tags, summary: 'Member 360° view', params: id } }, async (req) => {
    requireRole(req, 'support');
    return userDetail(ctx, req.params.id);
  });
  app.post(
    '/users/:id/ban',
    { schema: { tags, summary: 'Restrict with a specific reason', params: id, body: adminBanSchema } },
    async (req) => {
      const actor = requireRole(req, 'support');
      await banUser(ctx, actor, req.params.id, req.body.reasonCode, req.body.message, req.client.ip);
      return userDetail(ctx, req.params.id);
    },
  );
  app.post(
    '/users/:id/unban',
    { schema: { tags, summary: 'Lift a restriction', params: id } },
    async (req) => {
      const actor = requireRole(req, 'support');
      await unbanUser(ctx, actor, req.params.id, req.client.ip);
      return userDetail(ctx, req.params.id);
    },
  );
  app.post(
    '/users/:id/adjust',
    { schema: { tags, summary: 'Credit or debit a balance (audited)', params: id, body: adminAdjustSchema } },
    async (req) => {
      const actor = requireRole(req, 'finance');
      await adjustBalance(ctx, actor, req.params.id, req.body.amountMicros, req.body.reason, req.client.ip);
      return userDetail(ctx, req.params.id);
    },
  );
  app.post(
    '/users/:id/notes',
    { schema: { tags, summary: 'Internal note', params: id, body: adminNoteSchema } },
    async (req) => {
      const actor = requireRole(req, 'support');
      await addNote(ctx, actor, req.params.id, req.body.note);
      return userDetail(ctx, req.params.id);
    },
  );
  app.post(
    '/users/:id/role',
    { schema: { tags, summary: 'Change staff role', params: id, body: adminRoleSchema } },
    async (req) => {
      const actor = requireRole(req);
      await setRole(ctx, actor, req.params.id, req.body.role, req.client.ip);
      return userDetail(ctx, req.params.id);
    },
  );
  app.post(
    '/users/:id/logout-all',
    { schema: { tags, summary: 'Sign the member out everywhere', params: id } },
    async (req) => {
      const actor = requireRole(req, 'support');
      await logoutEverywhere(ctx, actor, req.params.id, req.client.ip);
      return { ok: true };
    },
  );

  /* payouts */
  app.get(
    '/payouts',
    {
      schema: {
        tags,
        summary: 'Payout queue',
        querystring: z.object({ status: z.string().max(20).optional() }),
      },
    },
    async (req) => {
      requireRole(req, 'finance', 'support');
      return listPayoutsAdmin(ctx, req.query.status);
    },
  );
  app.get(
    '/payouts.csv',
    {
      schema: {
        tags,
        summary: 'Export payouts',
        querystring: z.object({ status: z.string().max(20).optional() }),
      },
    },
    async (req, reply) => {
      requireRole(req, 'finance');
      return csvReply(
        reply,
        `payouts-${new Date().toISOString().slice(0, 10)}.csv`,
        await payoutsCsv(ctx, req.query.status),
      );
    },
  );
  app.post(
    '/payouts/:id/approve',
    { schema: { tags, summary: 'Approve a held payout', params: id } },
    async (req) => {
      const actor = requireRole(req, 'finance');
      await approvePayout(ctx, req.params.id, actor.id, req.client.ip);
      return getPayoutDTO(ctx, req.params.id);
    },
  );
  app.post(
    '/payouts/:id/reject',
    {
      schema: {
        tags,
        summary: 'Decline a payout (refund by default)',
        params: id,
        body: adminPayoutRejectSchema,
      },
    },
    async (req) => {
      const actor = requireRole(req, 'finance');
      await rejectPayout(ctx, req.params.id, req.body.reason, req.body.refund, actor.id, req.client.ip);
      return getPayoutDTO(ctx, req.params.id);
    },
  );
  app.post(
    '/payouts/batch-approve',
    { schema: { tags, summary: 'Approve several held payouts', body: adminBatchSchema } },
    async (req) => {
      const actor = requireRole(req, 'finance');
      const results: { id: string; ok: boolean; error?: string }[] = [];
      for (const pid of req.body.ids) {
        try {
          await approvePayout(ctx, pid, actor.id, req.client.ip);
          results.push({ id: pid, ok: true });
        } catch (err) {
          results.push({ id: pid, ok: false, error: err instanceof Error ? err.message : 'failed' });
        }
      }
      return { results };
    },
  );
  app.post(
    '/payouts/:id/retry',
    { schema: { tags, summary: 'Retry a payout waiting on a provider', params: id } },
    async (req) => {
      const actor = requireRole(req, 'finance');
      await retryNow(ctx, req.params.id, actor.id);
      return getPayoutDTO(ctx, req.params.id);
    },
  );

  /* fraud */
  app.get(
    '/fraud',
    {
      schema: {
        tags,
        summary: 'Fraud flags',
        querystring: z.object({ status: z.enum(['open', 'cleared', 'confirmed']).default('open') }),
      },
    },
    async (req) => {
      requireRole(req, 'support');
      return listFraudFlags(ctx, req.query.status);
    },
  );
  app.post(
    '/fraud/:id/resolve',
    {
      schema: {
        tags,
        summary: 'Clear, confirm, require KYC or ban',
        params: id,
        body: adminFlagResolveSchema,
      },
    },
    async (req) => {
      const actor = requireRole(req, 'support');
      await resolveFraudFlag(
        ctx,
        actor,
        req.params.id,
        req.body.action,
        req.body.note,
        req.body.reasonCode,
        req.client.ip,
      );
      return { ok: true };
    },
  );

  /* claims */
  app.get(
    '/claims',
    {
      schema: {
        tags,
        summary: 'Missing-credit claims',
        querystring: z.object({
          status: z.enum(['needs_review', 'checking', 'approved', 'rejected']).default('needs_review'),
        }),
      },
    },
    async (req) => {
      requireRole(req, 'support');
      return listClaimsAdmin(ctx, req.query.status);
    },
  );
  app.get('/claims/:id', { schema: { tags, summary: 'Claim detail', params: id } }, async (req) => {
    requireRole(req, 'support');
    return getClaimDTO(ctx, req.params.id);
  });
  app.post(
    '/claims/:id/approve',
    { schema: { tags, summary: 'Approve (paid as goodwill)', params: id, body: adminClaimApproveSchema } },
    async (req) => {
      const actor = requireRole(req, 'support');
      const claim = (await ctx.db.select().from(claims).where(eq(claims.id, req.params.id)))[0];
      if (!claim) throw notFound('Claim');
      await approve(
        ctx,
        claim.id,
        'goodwill_manual',
        req.body.amountMicros ?? claim.amountMicros,
        actor.id,
        req.body.note || 'Approved after review — paid by CashAds while we follow up with the network.',
      );
      await audit(ctx.db, {
        actorId: actor.id,
        action: 'claim.approve',
        targetType: 'claim',
        targetId: claim.id,
        ip: req.client.ip,
      });
      return getClaimDTO(ctx, claim.id);
    },
  );
  app.post(
    '/claims/:id/reject',
    { schema: { tags, summary: 'Reject with a reason', params: id, body: adminClaimRejectSchema } },
    async (req) => {
      const actor = requireRole(req, 'support');
      await rejectClaim(ctx, req.params.id, req.body.reason, actor.id);
      await audit(ctx.db, {
        actorId: actor.id,
        action: 'claim.reject',
        targetType: 'claim',
        targetId: req.params.id,
        after: { reason: req.body.reason },
        ip: req.client.ip,
      });
      return getClaimDTO(ctx, req.params.id);
    },
  );

  /* offers & reports */
  app.get('/offers', { schema: { tags, summary: 'All offers with stats' } }, async (req) => {
    requireRole(req, 'support');
    return listOffersAdmin(ctx);
  });
  app.post(
    '/offers',
    { schema: { tags, summary: 'Create an offer', body: adminOfferUpsertSchema } },
    async (req) => upsertOffer(ctx, requireRole(req), req.body, null, req.client.ip),
  );
  app.put(
    '/offers/:id',
    { schema: { tags, summary: 'Update an offer', params: id, body: adminOfferUpsertSchema } },
    async (req) => upsertOffer(ctx, requireRole(req), req.body, req.params.id, req.client.ip),
  );
  app.post(
    '/offers/:id/status',
    {
      schema: {
        tags,
        summary: 'Activate, pause, remove or mark as scam',
        params: id,
        body: adminOfferStatusSchema,
      },
    },
    async (req) => {
      await setOfferStatus(
        ctx,
        requireRole(req, 'support'),
        req.params.id,
        req.body.status,
        req.body.reason,
        req.client.ip,
      );
      invalidateStatsCache();
      return { ok: true };
    },
  );
  app.get(
    '/reports',
    {
      schema: {
        tags,
        summary: 'Offer reports',
        querystring: z.object({ status: z.enum(['open', 'actioned', 'dismissed']).default('open') }),
      },
    },
    async (req) => {
      requireRole(req, 'support');
      return listReports(ctx, req.query.status);
    },
  );
  app.post(
    '/reports/:id/resolve',
    { schema: { tags, summary: 'Resolve a report', params: id, body: adminReportResolveSchema } },
    async (req) => {
      await resolveReport(ctx, requireRole(req, 'support'), req.params.id, req.body.action);
      return { ok: true };
    },
  );

  /* postbacks */
  app.get(
    '/postbacks',
    {
      schema: {
        tags,
        summary: 'Postback logs',
        querystring: z.object({
          status: z.string().max(20).optional(),
          networkId: z.string().max(40).optional(),
        }),
      },
    },
    async (req) => {
      requireRole(req, 'support');
      return listPostbacks(ctx, req.query);
    },
  );
  app.post(
    '/postbacks/:id/replay',
    { schema: { tags, summary: 'Replay a stored postback (signature-checked, idempotent)', params: id } },
    async (req) => {
      const actor = requireRole(req);
      const res = await replayPostback(ctx, req.params.id);
      await audit(ctx.db, {
        actorId: actor.id,
        action: 'postback.replay',
        targetType: 'postback',
        targetId: req.params.id,
        after: { outcome: res.outcome, errorCode: res.errorCode },
        ip: req.client.ip,
      });
      return res;
    },
  );

  /* support */
  app.get(
    '/tickets',
    {
      schema: {
        tags,
        summary: 'Support queue',
        querystring: z.object({ status: z.string().max(20).optional() }),
      },
    },
    async (req) => {
      requireRole(req, 'support');
      return listTicketsAdmin(ctx, req.query.status);
    },
  );
  app.get('/tickets/:id', { schema: { tags, summary: 'Ticket thread', params: id } }, async (req) => {
    requireRole(req, 'support');
    return getTicket(ctx, req.params.id);
  });
  app.post(
    '/tickets/:id/reply',
    { schema: { tags, summary: 'Reply (and decide appeals)', params: id, body: adminTicketReplySchema } },
    async (req) => staffReply(ctx, requireRole(req, 'support'), req.params.id, req.body, req.client.ip),
  );

  /* kyc */
  app.get(
    '/kyc',
    {
      schema: {
        tags,
        summary: 'Identity submissions',
        querystring: z.object({ status: z.enum(['pending', 'verified', 'rejected']).default('pending') }),
      },
    },
    async (req) => {
      requireRole(req, 'support');
      return listKyc(ctx, req.query.status);
    },
  );
  app.post(
    '/kyc/:id/decide',
    { schema: { tags, summary: 'Verify or reject', params: id, body: adminKycDecideSchema } },
    async (req) => {
      const actor = requireRole(req, 'support');
      await decideKyc(ctx, req.params.id, req.body.decision, req.body.note, actor.id, req.client.ip);
      return { ok: true };
    },
  );
  /** Private files (KYC documents, claim screenshots) — staff only, never public. */
  app.get(
    '/files',
    {
      schema: {
        tags,
        summary: 'Download a private upload',
        querystring: z.object({ kind: z.enum(['kyc_document', 'kyc_selfie', 'claim']), id: z.uuid() }),
      },
    },
    async (req, reply) => {
      const actor = requireRole(req, 'support');
      let rel: string | null = null;
      if (req.query.kind === 'claim')
        rel =
          (
            await ctx.db.select({ p: claims.screenshotPath }).from(claims).where(eq(claims.id, req.query.id))
          )[0]?.p ?? null;
      else {
        const sub = (
          await ctx.db.select().from(kycSubmissions).where(eq(kycSubmissions.id, req.query.id))
        )[0];
        rel = req.query.kind === 'kyc_document' ? (sub?.documentPath ?? null) : (sub?.selfiePath ?? null);
      }
      if (!rel) throw notFound('File');
      const full = path.resolve(ctx.config.UPLOAD_DIR, rel);
      if (!full.startsWith(path.resolve(ctx.config.UPLOAD_DIR)) || !existsSync(full)) throw notFound('File');
      await audit(ctx.db, {
        actorId: actor.id,
        action: 'file.view',
        targetType: req.query.kind,
        targetId: req.query.id,
        ip: req.client.ip,
      });
      const ext = path.extname(full).slice(1);
      const types: Record<string, string> = {
        jpg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        pdf: 'application/pdf',
      };
      return reply
        .header('content-type', types[ext] ?? 'application/octet-stream')
        .header('cache-control', 'private, no-store')
        .send(createReadStream(full));
    },
  );

  /* community */
  app.get('/community', { schema: { tags, summary: 'Feature requests' } }, async (req) => {
    requireRole(req, 'support');
    return listFeatureRequests(ctx, null, 'top');
  });
  app.patch(
    '/community/:id',
    { schema: { tags, summary: 'Update an idea’s status', params: id, body: adminFeatureStatusSchema } },
    async (req) => {
      await setFeatureStatus(ctx, requireRole(req, 'support'), req.params.id, req.body.status, req.client.ip);
      return { ok: true };
    },
  );

  /* platform */
  app.get(
    '/settings',
    { schema: { tags, summary: 'Platform settings' } },
    async (req): Promise<AdminSettingsDTO> => {
      requireRole(req, 'finance');
      return { settings: ctx.settings.get(), defaults: ctx.settings.getDefaults() };
    },
  );
  app.patch(
    '/settings',
    { schema: { tags, summary: 'Update settings (audited)', body: settingsPatchSchema } },
    async (req): Promise<AdminSettingsDTO> => {
      const actor = requireRole(req);
      try {
        const { before, after } = await ctx.settings.update(ctx.db, req.body, actor.id);
        const changed = Object.keys(req.body);
        await audit(ctx.db, {
          actorId: actor.id,
          action: 'settings.update',
          targetType: 'settings',
          targetId: 'platform',
          before: Object.fromEntries(changed.map((k) => [k, before[k as keyof typeof before]])),
          after: Object.fromEntries(changed.map((k) => [k, after[k as keyof typeof after]])),
          ip: req.client.ip,
        });
        invalidateStatsCache();
        return { settings: after, defaults: ctx.settings.getDefaults() };
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError(400, 'INVALID_SETTINGS', err instanceof Error ? err.message : 'Invalid settings');
      }
    },
  );
  app.get(
    '/audit',
    {
      schema: {
        tags,
        summary: 'Audit log',
        querystring: z.object({ action: z.string().max(60).optional() }),
      },
    },
    async (req) => {
      requireRole(req);
      return listAudit(ctx, req.query);
    },
  );
  app.get('/networks', { schema: { tags, summary: 'Networks' } }, async (req) => {
    requireRole(req, 'support');
    return listNetworks(ctx);
  });
  app.patch(
    '/networks/:networkId',
    {
      schema: {
        tags,
        summary: 'Pause / allowlist a network',
        params: z.object({ networkId: z.string().max(40) }),
        body: adminNetworkPatchSchema,
      },
    },
    async (req) => {
      await patchNetwork(ctx, requireRole(req), req.params.networkId, req.body, req.client.ip);
      return listNetworks(ctx);
    },
  );
  app.get(
    '/jobs',
    {
      schema: {
        tags,
        summary: 'Job queue health',
        querystring: z.object({ status: z.enum(['queued', 'running', 'done', 'failed']).default('failed') }),
      },
    },
    async (req) => {
      requireRole(req);
      return listJobs(ctx, req.query.status);
    },
  );
  app.post(
    '/jobs/:jobId/retry',
    { schema: { tags, summary: 'Retry a failed job', params: z.object({ jobId: z.coerce.number().int() }) } },
    async (req) => {
      requireRole(req);
      await retryJob(ctx, req.params.jobId);
      return { ok: true };
    },
  );
};
