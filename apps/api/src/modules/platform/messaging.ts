import { eq } from 'drizzle-orm';
import type { AppContext } from '../../context';
import type { DbOrTx } from '../../db/client';
import { auditLogs, notifications, outboundMessages, users } from '../../db/schema';

/**
 * Outbound email/SMS. In sandbox mode messages are stored and shown in the
 * developer inbox (/dev/inbox); in production plug a provider (SES, Postmark,
 * Termii/Africa's Talking for SMS) into `deliver()` — callers don't change.
 */
export async function sendEmail(
  db: DbOrTx,
  msg: { userId?: string | null; to: string; subject: string; body: string; meta?: Record<string, unknown> },
): Promise<void> {
  await db.insert(outboundMessages).values({
    userId: msg.userId ?? null,
    channel: 'email',
    to: msg.to,
    subject: msg.subject,
    body: msg.body,
    meta: msg.meta ?? null,
  });
}

export async function sendSms(
  db: DbOrTx,
  msg: { userId?: string | null; to: string; body: string },
): Promise<void> {
  await db
    .insert(outboundMessages)
    .values({ userId: msg.userId ?? null, channel: 'sms', to: msg.to, body: msg.body });
}

export type EmailCategory = 'payouts' | 'claims' | 'streaks' | 'offers' | 'security';

export interface NotifyInput {
  type: string;
  title: string;
  body: string;
  link?: string | null;
  email?: { category: EmailCategory; subject?: string; extra?: string };
}

/** In-app notification + optional email (respecting the member's preferences) + live push. */
export async function notify(ctx: AppContext, db: DbOrTx, userId: string, n: NotifyInput): Promise<void> {
  const [row] = await db
    .insert(notifications)
    .values({ userId, type: n.type, title: n.title, body: n.body, link: n.link ?? null })
    .returning();
  if (n.email) {
    const u = await db
      .select({ email: users.email, prefs: users.prefs, status: users.status })
      .from(users)
      .where(eq(users.id, userId));
    const user = u[0];
    if (user && user.status !== 'deleted' && user.prefs?.notifyEmail?.[n.email.category] !== false) {
      await sendEmail(db, {
        userId,
        to: user.email,
        subject: n.email.subject ?? n.title,
        body: `${n.body}${n.email.extra ? `\n\n${n.email.extra}` : ''}\n\n— CashAds`,
        meta: { notificationType: n.type, link: n.link ?? null },
      });
    }
  }
  // A hint to refetch; harmless even if the surrounding transaction rolls back.
  ctx.events.toUser(userId, 'notification', {
    id: row?.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link ?? null,
  });
}

export async function audit(
  db: DbOrTx,
  entry: {
    actorId: string | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    before?: unknown;
    after?: unknown;
    ip?: string | null;
  },
): Promise<void> {
  await db.insert(auditLogs).values({
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: entry.ip ?? null,
  });
}
