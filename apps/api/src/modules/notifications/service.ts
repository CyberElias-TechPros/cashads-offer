import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { NotificationDTO, NotificationType, UserPreferences } from '@cashads/shared';
import type { AppContext, Uow } from '../../context';
import type { Q } from '../../db/client';
import { notifications, outboundMessages, users } from '../../db/schema';
import { enqueue } from '../../jobs/queue';
import { clock } from '../../lib/clock';
import type { EmailContent } from './templates';

export type EmailCategory = 'payouts' | 'credits' | 'streak' | 'product' | 'security' | 'transactional';

function wantsEmail(prefs: Partial<UserPreferences>, category: EmailCategory): boolean {
  switch (category) {
    case 'payouts':
      return prefs.emailPayouts !== false;
    case 'credits':
      return prefs.emailCredits === true;
    case 'streak':
      return prefs.emailStreak === true;
    case 'product':
      return prefs.emailProduct === true;
    default:
      return true; // security + transactional are always sent
  }
}

export async function queueEmail(q: Q, msg: { userId?: string | null; to: string; template: string; content: EmailContent }) {
  const [row] = await q
    .insert(outboundMessages)
    .values({
      userId: msg.userId ?? null,
      channel: 'email',
      to: msg.to,
      subject: msg.content.subject,
      text: msg.content.text,
      html: msg.content.html,
      template: msg.template,
    })
    .returning({ id: outboundMessages.id });
  await enqueue(q, 'message.deliver', { messageId: row.id }, { maxAttempts: 6 });
}

export async function queueSms(q: Q, msg: { userId?: string | null; to: string; text: string; template: string }) {
  const [row] = await q
    .insert(outboundMessages)
    .values({ userId: msg.userId ?? null, channel: 'sms', to: msg.to, text: msg.text, template: msg.template })
    .returning({ id: outboundMessages.id });
  await enqueue(q, 'message.deliver', { messageId: row.id }, { maxAttempts: 6 });
}

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
  email?: { category: EmailCategory; template: string; content: EmailContent };
}

/** In-app notification (+ optional email) — pushed live over SSE after commit. */
export async function notify(uow: Uow, userId: string, input: NotifyInput): Promise<void> {
  const [row] = await uow.tx
    .insert(notifications)
    .values({ userId, type: input.type, title: input.title, body: input.body, link: input.link ?? null, createdAt: clock.now() })
    .returning();
  if (input.email) {
    const [u] = await uow.tx
      .select({ email: users.email, preferences: users.preferences, status: users.status })
      .from(users)
      .where(eq(users.id, userId));
    if (u && u.status !== 'deleted' && wantsEmail(u.preferences ?? {}, input.email.category)) {
      await queueEmail(uow.tx, { userId, to: u.email, template: input.email.template, content: input.email.content });
    }
  }
  uow.afterCommit(() =>
    uow.ctx.bus.publishToUser(userId, {
      type: 'notification',
      notification: { id: row.id, title: row.title, body: row.body, link: row.link, type: row.type },
    }),
  );
}

export function toNotificationDTO(n: typeof notifications.$inferSelect): NotificationDTO {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

export async function listNotifications(ctx: AppContext, userId: string, limit = 50): Promise<NotificationDTO[]> {
  const rows = await ctx.db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt)).limit(limit);
  return rows.map(toNotificationDTO);
}

export async function unreadCount(q: Q, userId: string): Promise<number> {
  const [row] = await q
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return Number(row?.n ?? 0);
}

export async function markRead(ctx: AppContext, userId: string, ids: string[] | 'all'): Promise<void> {
  const where =
    ids === 'all'
      ? and(eq(notifications.userId, userId), isNull(notifications.readAt))
      : and(eq(notifications.userId, userId), inArray(notifications.id, ids.length ? ids : ['00000000-0000-0000-0000-000000000000']));
  await ctx.db.update(notifications).set({ readAt: clock.now() }).where(where);
}

/** Delivery job: Resend when configured, otherwise kept in the dev mailbox (/dev/mailbox). */
export async function deliverMessage(ctx: AppContext, messageId: string): Promise<void> {
  const [msg] = await ctx.db.select().from(outboundMessages).where(eq(outboundMessages.id, messageId));
  if (!msg || msg.status === 'sent') return;
  if (msg.channel === 'email' && ctx.config.RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.config.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: ctx.config.EMAIL_FROM, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
    });
    if (!res.ok) {
      const body = await res.text();
      await ctx.db.update(outboundMessages).set({ error: `${res.status}: ${body.slice(0, 300)}` }).where(eq(outboundMessages.id, messageId));
      throw new Error(`Email provider error ${res.status}`);
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    await ctx.db.update(outboundMessages).set({ status: 'sent', sentAt: clock.now(), providerId: data.id ?? null }).where(eq(outboundMessages.id, messageId));
    return;
  }
  if (ctx.config.NODE_ENV === 'production' && !ctx.config.DEMO_MODE) {
    ctx.log.warn({ messageId, channel: msg.channel }, 'No delivery provider configured — message kept in outbox only');
  }
  await ctx.db.update(outboundMessages).set({ status: 'sent', sentAt: clock.now(), providerId: 'dev-outbox' }).where(eq(outboundMessages.id, messageId));
}
