import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  appealSchema,
  donateSchema,
  featureRequestCreateSchema,
  kycSubmitSchema,
  ticketCreateSchema,
  ticketReplySchema,
} from '@cashads/shared';
import { z } from 'zod';
import { requireActiveUser, requireUser } from '../http/auth';
import { badRequest } from '../lib/errors';
import {
  donate,
  getKyc,
  listCharities,
  storeUpload,
  submitKyc,
  taxSummary,
  taxCsv,
} from '../modules/finance/service';
import {
  createFeatureRequest,
  createTicket,
  getTicket,
  listFeatureRequests,
  listTickets,
  replyAsUser,
  submitAppeal,
  toggleVote,
} from '../modules/support/service';
import { getUser } from '../modules/users/service';
import { csvReply } from './util';

export const supportRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;

  /* support */
  app.get('/support/tickets', { schema: { tags: ['support'], summary: 'Your tickets' } }, async (req) =>
    listTickets(ctx, requireUser(req).id),
  );
  app.post(
    '/support/tickets',
    {
      schema: { tags: ['support'], summary: 'Open a ticket', body: ticketCreateSchema },
      config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
    },
    async (req) => createTicket(ctx, requireUser(req), req.body),
  );
  app.get(
    '/support/tickets/:id',
    { schema: { tags: ['support'], summary: 'Ticket thread', params: z.object({ id: z.uuid() }) } },
    async (req) => getTicket(ctx, req.params.id, requireUser(req).id),
  );
  app.post(
    '/support/tickets/:id/messages',
    {
      schema: {
        tags: ['support'],
        summary: 'Reply',
        params: z.object({ id: z.uuid() }),
        body: ticketReplySchema,
      },
    },
    async (req) => replyAsUser(ctx, requireUser(req), req.params.id, req.body.message),
  );
  app.post(
    '/support/appeal',
    { schema: { tags: ['support'], summary: 'Appeal an account restriction', body: appealSchema } },
    async (req) => submitAppeal(ctx, requireUser(req), req.body.message),
  );

  /* community */
  app.get(
    '/community/requests',
    {
      schema: {
        tags: ['community'],
        summary: 'Feature requests',
        querystring: z.object({ sort: z.enum(['top', 'new']).default('top') }),
      },
    },
    async (req) => listFeatureRequests(ctx, req.auth?.user.id ?? null, req.query.sort),
  );
  app.post(
    '/community/requests',
    { schema: { tags: ['community'], summary: 'Suggest a feature', body: featureRequestCreateSchema } },
    async (req) => {
      await createFeatureRequest(ctx, requireUser(req), req.body.title, req.body.body);
      return listFeatureRequests(ctx, requireUser(req).id, 'new');
    },
  );
  app.post(
    '/community/requests/:id/vote',
    { schema: { tags: ['community'], summary: 'Toggle your vote', params: z.object({ id: z.uuid() }) } },
    async (req) => toggleVote(ctx, requireUser(req), req.params.id),
  );

  /* charity */
  app.get('/charity', { schema: { tags: ['charity'], summary: 'Causes and your impact' } }, async (req) =>
    listCharities(ctx, requireUser(req).id),
  );
  app.post(
    '/charity/donate',
    { schema: { tags: ['charity'], summary: 'Donate from your balance', body: donateSchema } },
    async (req) => {
      await donate(ctx, requireActiveUser(req), req.body.charityId, req.body.amountMicros);
      return listCharities(ctx, requireUser(req).id);
    },
  );

  /* tax centre */
  const yearQuery = z.object({
    year: z.coerce.number().int().min(2024).max(2100).default(new Date().getUTCFullYear()),
  });
  app.get(
    '/tax/summary',
    { schema: { tags: ['tax'], summary: 'Yearly earnings summary', querystring: yearQuery } },
    async (req) => taxSummary(ctx, requireUser(req), req.query.year),
  );
  app.get(
    '/tax/summary.csv',
    { schema: { tags: ['tax'], summary: 'Yearly earnings summary (CSV)', querystring: yearQuery } },
    async (req, reply) => {
      const summary = await taxSummary(ctx, requireUser(req), req.query.year);
      return csvReply(reply, `cashads-earnings-${req.query.year}.csv`, taxCsv(summary));
    },
  );

  /* identity verification (multipart: fields + document + selfie) */
  app.get('/kyc', { schema: { tags: ['kyc'], summary: 'Verification status' } }, async (req) =>
    getKyc(ctx, await getUser(ctx.db, requireUser(req).id)),
  );
  app.post(
    '/kyc',
    { schema: { tags: ['kyc'], summary: 'Submit identity verification (multipart)' } },
    async (req) => {
      const user = await getUser(ctx.db, requireUser(req).id);
      const fields: Record<string, string> = {};
      const files: { document?: string; selfie?: string } = {};
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          if (part.fieldname !== 'document' && part.fieldname !== 'selfie') continue;
          files[part.fieldname] = await storeUpload(ctx, await part.toBuffer(), part.mimetype, 'kyc');
        } else {
          fields[part.fieldname] = String(part.value ?? '');
        }
      }
      const parsed = kycSubmitSchema.safeParse(fields);
      if (!parsed.success) {
        const map: Record<string, string> = {};
        for (const i of parsed.error.issues) map[i.path.join('.')] = i.message;
        throw badRequest('VALIDATION', Object.values(map)[0] ?? 'Check the form', map);
      }
      if (!files.document)
        throw badRequest('DOCUMENT_REQUIRED', 'Upload a photo of your ID document', { document: 'Required' });
      return submitKyc(ctx, user, parsed.data, files);
    },
  );
};
