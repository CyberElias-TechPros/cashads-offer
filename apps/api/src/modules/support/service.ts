import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { type FeatureRequestDTO, type TicketDTO, getTier } from '@cashads/shared';
import type { AppContext } from '../../context';
import { featureRequests, featureVotes, ticketMessages, tickets, users } from '../../db/schema';
import type { UserRow } from '../../http/auth';
import { AppError, conflict, notFound } from '../../lib/errors';
import { maskEmail } from '../../lib/net';
import { HOUR } from '../../lib/time';
import { audit, notify, sendEmail } from '../platform/messaging';

type TicketRow = typeof tickets.$inferSelect;

function slaFor(user: UserRow | null, category: string): number {
  if (category === 'appeal') return 72 * HOUR;
  if (user && getTier(user.tier).id === 'gold') return 4 * HOUR;
  if (user && getTier(user.tier).id === 'platinum') return 2 * HOUR;
  return 24 * HOUR;
}

function toTicketDTO(t: TicketRow, messages?: (typeof ticketMessages.$inferSelect)[]): TicketDTO {
  return {
    id: t.id,
    subject: t.subject,
    category: t.category,
    status: t.status,
    priority: t.priority,
    slaDueAt: t.slaDueAt.toISOString(),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    ...(messages
      ? {
          messages: messages.map((m) => ({
            id: m.id,
            authorType: m.authorType,
            body: m.body,
            createdAt: m.createdAt.toISOString(),
          })),
        }
      : {}),
  };
}

export async function createTicket(
  ctx: AppContext,
  user: UserRow | null,
  input: { subject: string; category: string; message: string; email?: string | undefined },
): Promise<TicketDTO> {
  if (!user && !input.email) throw new AppError(400, 'EMAIL_REQUIRED', 'Add an email so we can reply');
  const ticket = await ctx.db.transaction(async (tx) => {
    const [t] = await tx
      .insert(tickets)
      .values({
        userId: user?.id ?? null,
        email: user?.email ?? input.email ?? null,
        subject: input.subject,
        category: input.category,
        priority: input.category === 'appeal' || input.category === 'payout' ? 'high' : 'normal',
        slaDueAt: new Date(Date.now() + slaFor(user, input.category)),
      })
      .returning();
    await tx
      .insert(ticketMessages)
      .values({ ticketId: t!.id, authorType: 'user', authorId: user?.id ?? null, body: input.message });
    await tx.insert(ticketMessages).values({
      ticketId: t!.id,
      authorType: 'system',
      body: `Thanks — a real person will reply by ${t!.slaDueAt.toUTCString()}. You’ll get an email and an in-app notification.`,
    });
    if (!user && input.email) {
      await sendEmail(tx, {
        to: input.email,
        subject: `We got your message: ${input.subject}`,
        body: `Thanks for contacting CashAds. A person will reply by ${t!.slaDueAt.toUTCString()}.`,
      });
    }
    return t!;
  });
  return toTicketDTO(ticket);
}

export async function listTickets(ctx: AppContext, userId: string): Promise<TicketDTO[]> {
  const rows = await ctx.db
    .select()
    .from(tickets)
    .where(eq(tickets.userId, userId))
    .orderBy(desc(tickets.updatedAt));
  return rows.map((t) => toTicketDTO(t));
}

export async function getTicket(ctx: AppContext, ticketId: string, userId?: string): Promise<TicketDTO> {
  const rows = await ctx.db
    .select()
    .from(tickets)
    .where(userId ? and(eq(tickets.id, ticketId), eq(tickets.userId, userId)) : eq(tickets.id, ticketId));
  if (!rows[0]) throw notFound('Ticket');
  const msgs = await ctx.db
    .select()
    .from(ticketMessages)
    .where(eq(ticketMessages.ticketId, ticketId))
    .orderBy(asc(ticketMessages.createdAt));
  return toTicketDTO(rows[0], msgs);
}

export async function replyAsUser(
  ctx: AppContext,
  user: UserRow,
  ticketId: string,
  message: string,
): Promise<TicketDTO> {
  const rows = await ctx.db
    .select()
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), eq(tickets.userId, user.id)));
  if (!rows[0]) throw notFound('Ticket');
  await ctx.db
    .insert(ticketMessages)
    .values({ ticketId, authorType: 'user', authorId: user.id, body: message });
  await ctx.db.update(tickets).set({ status: 'open', updatedAt: new Date() }).where(eq(tickets.id, ticketId));
  return getTicket(ctx, ticketId, user.id);
}

/** Appeals: every restricted member can appeal; a different person reviews it. */
export async function submitAppeal(ctx: AppContext, user: UserRow, message: string): Promise<TicketDTO> {
  if (user.status !== 'banned' && user.status !== 'restricted')
    throw new AppError(400, 'NOT_RESTRICTED', 'Your account isn’t restricted.');
  const open = await ctx.db
    .select()
    .from(tickets)
    .where(
      and(
        eq(tickets.userId, user.id),
        eq(tickets.category, 'appeal'),
        sql`${tickets.status} in ('open', 'pending_user')`,
      ),
    );
  if (open[0]) return replyAsUser(ctx, user, open[0].id, message);
  return createTicket(ctx, user, { subject: 'Account restriction appeal', category: 'appeal', message });
}

export async function staffReply(
  ctx: AppContext,
  staff: UserRow,
  ticketId: string,
  input: {
    message: string;
    status?: TicketRow['status'] | undefined;
    appealDecision?: 'uphold' | 'lift' | undefined;
  },
  ip: string,
): Promise<TicketDTO> {
  const rows = await ctx.db.select().from(tickets).where(eq(tickets.id, ticketId));
  const ticket = rows[0];
  if (!ticket) throw notFound('Ticket');
  await ctx.db.transaction(async (tx) => {
    await tx
      .insert(ticketMessages)
      .values({ ticketId, authorType: 'staff', authorId: staff.id, body: input.message });
    await tx
      .update(tickets)
      .set({ status: input.status ?? 'pending_user', assignedTo: staff.id, updatedAt: new Date() })
      .where(eq(tickets.id, ticketId));
    if (ticket.category === 'appeal' && ticket.userId && input.appealDecision === 'lift') {
      await tx
        .update(users)
        .set({
          status: 'active',
          banReasonCode: null,
          banMessage: null,
          bannedAt: null,
          balanceFrozen: false,
          updatedAt: new Date(),
        })
        .where(eq(users.id, ticket.userId));
      await audit(tx, {
        actorId: staff.id,
        action: 'user.appeal_lifted',
        targetType: 'user',
        targetId: ticket.userId,
        ip,
      });
    }
    if (ticket.category === 'appeal' && ticket.userId && input.appealDecision === 'uphold') {
      await audit(tx, {
        actorId: staff.id,
        action: 'user.appeal_upheld',
        targetType: 'user',
        targetId: ticket.userId,
        ip,
      });
    }
    if (ticket.userId) {
      await notify(ctx, tx, ticket.userId, {
        type: 'support_reply',
        title:
          input.appealDecision === 'lift'
            ? 'Appeal approved — account restored'
            : `Support replied: ${ticket.subject}`,
        body: input.message.slice(0, 280),
        link: `/app/support/${ticketId}`,
        email: { category: 'security' },
      });
    } else if (ticket.email) {
      await sendEmail(tx, { to: ticket.email, subject: `Re: ${ticket.subject}`, body: input.message });
    }
  });
  return getTicket(ctx, ticketId);
}

/* ── community: feature requests that actually ship ────────────────────────── */

export async function listFeatureRequests(
  ctx: AppContext,
  userId: string | null,
  sort: 'top' | 'new' = 'top',
): Promise<FeatureRequestDTO[]> {
  const rows = await ctx.db
    .select({ fr: featureRequests, email: users.email, displayName: users.displayName })
    .from(featureRequests)
    .innerJoin(users, eq(users.id, featureRequests.userId))
    .orderBy(sort === 'top' ? desc(featureRequests.votes) : desc(featureRequests.createdAt))
    .limit(200);
  const mine = userId
    ? await ctx.db
        .select({ requestId: featureVotes.requestId })
        .from(featureVotes)
        .where(eq(featureVotes.userId, userId))
    : [];
  const voted = new Set(mine.map((m) => m.requestId));
  return rows.map(({ fr, email, displayName }) => ({
    id: fr.id,
    title: fr.title,
    body: fr.body,
    status: fr.status,
    votes: fr.votes,
    votedByMe: voted.has(fr.id),
    authorLabel: displayName ?? maskEmail(email),
    createdAt: fr.createdAt.toISOString(),
    shippedAt: fr.shippedAt?.toISOString() ?? null,
  }));
}

export async function createFeatureRequest(
  ctx: AppContext,
  user: UserRow,
  title: string,
  body: string,
): Promise<void> {
  const recent = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(featureRequests)
    .where(
      and(eq(featureRequests.userId, user.id), sql`${featureRequests.createdAt} > now() - interval '1 day'`),
    );
  if ((recent[0]?.n ?? 0) >= 5)
    throw new AppError(429, 'RATE_LIMITED', 'You can post up to 5 ideas per day.');
  await ctx.db.transaction(async (tx) => {
    const [fr] = await tx
      .insert(featureRequests)
      .values({ userId: user.id, title, body, votes: 1 })
      .returning();
    await tx.insert(featureVotes).values({ userId: user.id, requestId: fr!.id });
  });
}

export async function toggleVote(
  ctx: AppContext,
  user: UserRow,
  requestId: string,
): Promise<{ voted: boolean; votes: number }> {
  return ctx.db.transaction(async (tx) => {
    const fr = (
      await tx.select().from(featureRequests).where(eq(featureRequests.id, requestId)).for('update')
    )[0];
    if (!fr) throw notFound('Idea');
    const existing = await tx
      .select()
      .from(featureVotes)
      .where(and(eq(featureVotes.userId, user.id), eq(featureVotes.requestId, requestId)));
    if (existing[0]) {
      await tx
        .delete(featureVotes)
        .where(and(eq(featureVotes.userId, user.id), eq(featureVotes.requestId, requestId)));
      await tx
        .update(featureRequests)
        .set({ votes: sql`${featureRequests.votes} - 1` })
        .where(eq(featureRequests.id, requestId));
      return { voted: false, votes: fr.votes - 1 };
    }
    await tx.insert(featureVotes).values({ userId: user.id, requestId });
    await tx
      .update(featureRequests)
      .set({ votes: sql`${featureRequests.votes} + 1` })
      .where(eq(featureRequests.id, requestId));
    return { voted: true, votes: fr.votes + 1 };
  });
}

export async function setFeatureStatus(
  ctx: AppContext,
  staff: UserRow,
  requestId: string,
  status: FeatureRequestDTO['status'],
  ip: string,
): Promise<void> {
  const [fr] = await ctx.db
    .update(featureRequests)
    .set({ status, shippedAt: status === 'shipped' ? new Date() : null })
    .where(eq(featureRequests.id, requestId))
    .returning();
  if (!fr) throw notFound('Idea');
  await audit(ctx.db, {
    actorId: staff.id,
    action: 'community.status',
    targetType: 'feature_request',
    targetId: requestId,
    after: { status },
    ip,
  });
  if (status === 'shipped') {
    const voters = await ctx.db
      .select({ userId: featureVotes.userId })
      .from(featureVotes)
      .where(eq(featureVotes.requestId, requestId));
    for (const v of voters) {
      await notify(ctx, ctx.db, v.userId, {
        type: 'feature_shipped',
        title: '🚀 An idea you voted for shipped',
        body: fr.title,
        link: '/app/community',
      });
    }
  }
}

export function assertTicketOpen(t: TicketDTO): void {
  if (t.status === 'closed')
    throw conflict('TICKET_CLOSED', 'This conversation is closed. Open a new ticket if you need more help.');
}
