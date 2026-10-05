import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { TicketCreateInput, TicketDTO, TicketStatus } from '@cashads/shared';
import { withUow, type AppContext } from '../../context';
import type { Q } from '../../db/client';
import { supportTickets, ticketMessages, users } from '../../db/schema';
import { conflict, notFound, tooMany } from '../../lib/errors';
import { clock, DAY, HOUR } from '../../lib/clock';
import { notify } from '../notifications/service';
import { templates } from '../notifications/templates';

type TicketRow = typeof supportTickets.$inferSelect;

/** SLA: appeals 48h; Gold halves the default; Platinum gets 4h. */
function slaHours(base: number, category: string, tier: string): number {
  if (category === 'appeal') return 48;
  if (tier === 'platinum') return 4;
  if (tier === 'gold') return Math.max(4, Math.round(base / 2));
  return base;
}

async function toDTO(q: Q, t: TicketRow, withMessages: boolean): Promise<TicketDTO> {
  const msgs = await q.select().from(ticketMessages).where(eq(ticketMessages.ticketId, t.id)).orderBy(asc(ticketMessages.createdAt));
  const authorIds = [...new Set(msgs.map((m) => m.authorId).filter((x): x is string => !!x))];
  const names = authorIds.length ? await q.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, authorIds)) : [];
  const nameMap = new Map(names.map((n) => [n.id, n.name]));
  const last = msgs[msgs.length - 1];
  return {
    id: t.id,
    subject: t.subject,
    category: t.category,
    status: t.status,
    slaDueAt: t.slaDueAt.toISOString(),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    lastMessagePreview: last?.body.slice(0, 140) ?? '',
    messages: withMessages
      ? msgs.map((m) => ({
          id: m.id,
          author: m.authorRole,
          authorName: m.authorRole === 'system' ? 'CashAds' : m.authorRole === 'staff' ? `${(nameMap.get(m.authorId ?? '') ?? 'Support').split(' ')[0]} · CashAds team` : 'You',
          body: m.body,
          createdAt: m.createdAt.toISOString(),
        }))
      : undefined,
  };
}

export async function createTicket(ctx: AppContext, user: typeof users.$inferSelect, input: TicketCreateInput): Promise<TicketDTO> {
  const open = await ctx.db
    .select({ id: supportTickets.id })
    .from(supportTickets)
    .where(and(eq(supportTickets.userId, user.id), inArray(supportTickets.status, ['open', 'awaiting_user'])));
  if (open.length >= 5) throw tooMany('You have 5 open tickets — we’ll get to them soon. Reply to an existing one if it’s related.');
  const hours = slaHours(ctx.settings.get().ticketSlaHours, input.category, user.tier);
  const now = clock.now();
  const due = new Date(now.getTime() + hours * HOUR);
  const t = await withUow(ctx, async ({ tx }) => {
    const [ticket] = await tx
      .insert(supportTickets)
      .values({
        userId: user.id,
        subject: input.subject,
        category: input.category,
        priority: input.category === 'appeal' || input.category === 'payout' ? 'high' : 'normal',
        relatedType: input.relatedType ?? null,
        relatedId: input.relatedId ?? null,
        slaDueAt: due,
        lastMessageAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await tx.insert(ticketMessages).values({ ticketId: ticket.id, authorId: user.id, authorRole: 'user', body: input.message, createdAt: now });
    await tx.insert(ticketMessages).values({
      ticketId: ticket.id,
      authorId: null,
      authorRole: 'system',
      body: `Thanks — a real person will reply within ${hours} hours (by ${due.toUTCString().slice(0, 22)} UTC). You’ll get an email and an in-app notification.`,
      createdAt: new Date(now.getTime() + 1000),
    });
    return ticket;
  });
  return toDTO(ctx.db, t, true);
}

export async function listTickets(ctx: AppContext, userId: string): Promise<TicketDTO[]> {
  const rows = await ctx.db.select().from(supportTickets).where(eq(supportTickets.userId, userId)).orderBy(desc(supportTickets.lastMessageAt));
  return Promise.all(rows.map((t) => toDTO(ctx.db, t, false)));
}

export async function getTicket(ctx: AppContext, userId: string | null, id: string): Promise<TicketDTO> {
  const conds = [eq(supportTickets.id, id)];
  if (userId) conds.push(eq(supportTickets.userId, userId));
  const [t] = await ctx.db.select().from(supportTickets).where(and(...conds));
  if (!t) throw notFound('Ticket not found');
  return toDTO(ctx.db, t, true);
}

export async function userReply(ctx: AppContext, userId: string, id: string, message: string): Promise<TicketDTO> {
  const [t] = await ctx.db.select().from(supportTickets).where(and(eq(supportTickets.id, id), eq(supportTickets.userId, userId)));
  if (!t) throw notFound('Ticket not found');
  if (t.status === 'closed') throw conflict('This ticket is closed — open a new one and reference it', 'ticket_closed');
  const now = clock.now();
  const reopened = t.status === 'resolved' || t.status === 'awaiting_user';
  await ctx.db.insert(ticketMessages).values({ ticketId: id, authorId: userId, authorRole: 'user', body: message, createdAt: now });
  const [updated] = await ctx.db
    .update(supportTickets)
    .set({
      status: 'open',
      lastMessageAt: now,
      updatedAt: now,
      slaDueAt: reopened ? new Date(now.getTime() + ctx.settings.get().ticketSlaHours * HOUR) : t.slaDueAt,
    })
    .where(eq(supportTickets.id, id))
    .returning();
  return toDTO(ctx.db, updated, true);
}

export async function closeTicket(ctx: AppContext, userId: string, id: string) {
  await ctx.db
    .update(supportTickets)
    .set({ status: 'closed', updatedAt: clock.now() })
    .where(and(eq(supportTickets.id, id), eq(supportTickets.userId, userId)));
}

export async function staffReply(ctx: AppContext, staffId: string, id: string, message: string, status: TicketStatus) {
  await withUow(ctx, async (uow) => {
    const [t] = await uow.tx.select().from(supportTickets).where(eq(supportTickets.id, id)).for('update');
    if (!t) throw notFound('Ticket not found');
    const now = clock.now();
    await uow.tx.insert(ticketMessages).values({ ticketId: id, authorId: staffId, authorRole: 'staff', body: message, createdAt: now });
    await uow.tx
      .update(supportTickets)
      .set({ status, lastMessageAt: now, updatedAt: now, firstResponseAt: t.firstResponseAt ?? now, assignedToId: t.assignedToId ?? staffId })
      .where(eq(supportTickets.id, id));
    const [u] = await uow.tx.select().from(users).where(eq(users.id, t.userId));
    await notify(uow, t.userId, {
      type: 'support',
      title: 'Support replied to your ticket',
      body: `“${t.subject}” — ${message.slice(0, 120)}${message.length > 120 ? '…' : ''}`,
      link: `/app/support/${t.id}`,
      email: { category: 'transactional', template: 'ticket_reply', content: templates.ticketReply(u.displayName, t.subject, `${ctx.config.PUBLIC_WEB_URL}/app/support/${t.id}`) },
    });
  });
  return getTicket(ctx, null, id);
}

export async function setTicketStatus(ctx: AppContext, id: string, status: TicketStatus) {
  await ctx.db.update(supportTickets).set({ status, updatedAt: clock.now() }).where(eq(supportTickets.id, id));
}

export function slaBreached(t: TicketRow): boolean {
  return (t.status === 'open') && t.slaDueAt.getTime() < clock.ms();
}

export const TICKET_AUTOCLOSE_MS = 7 * DAY;
