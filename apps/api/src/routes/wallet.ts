import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  type BalancesDTO,
  TXN_TYPES,
  type TxnType,
  destinationCreateSchema,
  nameEnquirySchema,
  paginationQuery,
  payoutCreateSchema,
  payoutQuoteSchema,
} from '@lucrum/shared';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { donations, payouts } from '../db/schema';
import { requireActiveUser, requireUser } from '../http/auth';
import { pendingMicros } from '../modules/offers/service';
import {
  buildQuote,
  cancelPayout,
  deleteDestination,
  getPayoutDTO,
  listDestinations,
  listPayouts,
  methodsForUser,
  nameEnquiry,
  requestPayout,
  saveDestination,
} from '../modules/payouts/service';
import { getUser } from '../modules/users/service';
import { getAvailableMicros, lifetimeEarnedMicros, listUserTransactions } from '../modules/wallet/ledger';
import { csvReply } from './util';

const GROUPS: Record<string, TxnType[]> = Object.entries(TXN_TYPES).reduce(
  (acc, [type, meta]) => {
    (acc[meta.group] ??= []).push(type as TxnType);
    return acc;
  },
  {} as Record<string, TxnType[]>,
);

export const walletRoutes: FastifyPluginAsyncZod = async (app) => {
  const ctx = app.ctx;
  const tags = ['wallet'];

  app.get(
    '/wallet',
    { schema: { tags, summary: 'Balances in real currency' } },
    async (req): Promise<BalancesDTO> => {
      const user = requireUser(req);
      const [available, pending, lifetime, paid, donated] = await Promise.all([
        getAvailableMicros(ctx.db, user.id),
        pendingMicros(ctx, user),
        lifetimeEarnedMicros(ctx.db, user.id),
        ctx.db
          .select({ total: sql<string>`coalesce(sum(${payouts.amountMicros}), 0)` })
          .from(payouts)
          .where(and(eq(payouts.userId, user.id), eq(payouts.status, 'completed'))),
        ctx.db
          .select({ total: sql<string>`coalesce(sum(${donations.amountMicros}), 0)` })
          .from(donations)
          .where(eq(donations.userId, user.id)),
      ]);
      return {
        availableMicros: available,
        pendingMicros: pending,
        lifetimeEarnedMicros: lifetime,
        lifetimePaidOutMicros: Number(paid[0]?.total ?? 0),
        donatedMicros: Number(donated[0]?.total ?? 0),
        displayCurrency: user.displayCurrency,
        fxRate: ctx.settings.get().fxRates[user.displayCurrency] ?? 1,
      };
    },
  );

  const txnQuery = paginationQuery.extend({
    group: z.enum(['earning', 'bonus', 'payout', 'donation', 'adjustment']).optional(),
  });

  app.get(
    '/wallet/transactions',
    { schema: { tags, summary: 'Transaction history (cursor paginated)', querystring: txnQuery } },
    async (req) => {
      const user = requireUser(req);
      return listUserTransactions(ctx.db, user.id, {
        limit: req.query.limit,
        cursor: req.query.cursor,
        types: req.query.group ? GROUPS[req.query.group] : undefined,
      });
    },
  );

  app.get(
    '/wallet/transactions.csv',
    { schema: { tags, summary: 'Export history as CSV' } },
    async (req, reply) => {
      const user = requireUser(req);
      const rows: string[] = ['date,type,description,amount_usd'];
      let cursor: string | undefined;
      for (let i = 0; i < 50; i++) {
        const page = await listUserTransactions(ctx.db, user.id, { limit: 100, cursor });
        for (const t of page.items) {
          rows.push(
            [
              t.createdAt,
              t.type,
              `"${t.description.replaceAll('"', '""')}"`,
              (t.amountMicros / 1_000_000).toFixed(6),
            ].join(','),
          );
        }
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      return csvReply(
        reply,
        `lucrum-transactions-${new Date().toISOString().slice(0, 10)}.csv`,
        `${rows.join('\n')}\n`,
      );
    },
  );

  /* payouts */
  app.get(
    '/payouts/methods',
    { schema: { tags, summary: 'Payout methods available in your country' } },
    async (req) => methodsForUser(ctx, requireUser(req)),
  );

  app.post(
    '/payouts/quote',
    { schema: { tags, summary: 'Fee, net amount, local amount and requirements', body: payoutQuoteSchema } },
    async (req) => {
      const user = await getUser(ctx.db, requireUser(req).id);
      return buildQuote(ctx, ctx.db, user, req.body.methodId, req.body.amountMicros);
    },
  );

  app.post(
    '/payouts/name-enquiry',
    {
      schema: { tags, summary: 'Resolve the account holder name before sending', body: nameEnquirySchema },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req) => nameEnquiry(ctx, requireUser(req), req.body.methodId, req.body.details),
  );

  app.get(
    '/payouts/destinations',
    { schema: { tags, summary: 'Saved payout destinations (masked)' } },
    async (req) => listDestinations(ctx, requireUser(req)),
  );

  app.post(
    '/payouts/destinations',
    { schema: { tags, summary: 'Save a payout destination', body: destinationCreateSchema } },
    async (req) => {
      const user = requireActiveUser(req);
      await saveDestination(ctx, ctx.db, user, req.body.methodId, req.body.details, req.body.label);
      return listDestinations(ctx, user);
    },
  );

  app.delete(
    '/payouts/destinations/:id',
    { schema: { tags, summary: 'Remove a saved destination', params: z.object({ id: z.uuid() }) } },
    async (req) => {
      await deleteDestination(ctx, requireUser(req), req.params.id);
      return { ok: true };
    },
  );

  app.post(
    '/payouts',
    {
      schema: { tags, summary: 'Request a cash-out (idempotent)', body: payoutCreateSchema },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const user = await getUser(ctx.db, requireActiveUser(req).id);
      return requestPayout(ctx, user, req.body);
    },
  );

  app.get('/payouts', { schema: { tags, summary: 'Your cash-outs' } }, async (req) =>
    listPayouts(ctx, requireUser(req).id),
  );

  app.get(
    '/payouts/:id',
    { schema: { tags, summary: 'Cash-out with status timeline', params: z.object({ id: z.uuid() }) } },
    async (req) => getPayoutDTO(ctx, req.params.id, requireUser(req).id),
  );

  app.post(
    '/payouts/:id/cancel',
    {
      schema: {
        tags,
        summary: 'Cancel a cash-out that hasn’t been sent',
        params: z.object({ id: z.uuid() }),
      },
    },
    async (req) => cancelPayout(ctx, requireUser(req), req.params.id),
  );
};
