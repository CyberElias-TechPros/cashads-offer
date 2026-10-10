import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { AppContext } from '../../context';
import type { DbOrTx } from '../../db/client';
import { devices, fraudFlags, ipRules, users } from '../../db/schema';
import { DISPOSABLE_EMAIL_DOMAINS, KNOWN_DATACENTER_CIDRS, ipInCidr, isPrivateIp } from '../../lib/net';
import { notify } from '../platform/messaging';
import { lookupIpReputation } from './iprep';

/**
 * Explainable fraud scoring (spec §10). Every point of a member's score comes from
 * a named, reviewable flag — which is what lets us give *specific* reasons when we
 * hold a payout or restrict an account, instead of "terms violation".
 *
 *   0–30  auto-approve · 31–60 manual review · 61–100 earning paused pending review
 */
export const FRAUD_SIGNALS = {
  disposable_email: { severity: 20, label: 'Disposable email domain', cumulative: false },
  shared_device: { severity: 25, label: 'Device shared with other accounts', cumulative: false },
  ip_velocity: { severity: 15, label: 'Many sign-ups from one IP address', cumulative: false },
  datacenter_ip: { severity: 20, label: 'Data-centre / VPN / proxy connection', cumulative: false },
  too_fast: { severity: 10, label: 'Tasks completed implausibly fast', cumulative: true, max: 40 },
  earning_velocity: { severity: 15, label: 'Unusual earning velocity', cumulative: false },
  referral_self_dealing: { severity: 30, label: 'Referral between linked accounts', cumulative: false },
  shared_payout_destination: {
    severity: 30,
    label: 'Payout details used by another account',
    cumulative: false,
  },
  claim_abuse: { severity: 10, label: 'Repeated rejected missing-credit claims', cumulative: true, max: 30 },
  poll_speed: { severity: 5, label: 'Answering faster than reading speed', cumulative: true, max: 20 },
  ad_tampering: { severity: 10, label: 'Rewarded-video events out of order', cumulative: true, max: 30 },
  manual: { severity: 0, label: 'Manual flag by staff', cumulative: false },
} as const;

export type FraudSignal = keyof typeof FRAUD_SIGNALS;

export async function recordSignal(
  ctx: AppContext,
  db: DbOrTx,
  userId: string,
  type: FraudSignal,
  details: Record<string, unknown> = {},
  opts: { severity?: number } = {},
): Promise<number> {
  const def = FRAUD_SIGNALS[type];
  const base = opts.severity ?? def.severity;
  const open = await db
    .select()
    .from(fraudFlags)
    .where(
      and(
        eq(fraudFlags.userId, userId),
        eq(fraudFlags.type, type),
        inArray(fraudFlags.status, ['open', 'confirmed']),
      ),
    );
  const existing = open[0];
  if (existing) {
    const max = 'max' in def ? def.max : base;
    await db
      .update(fraudFlags)
      .set({
        occurrences: existing.occurrences + 1,
        severity: def.cumulative ? Math.min(max, existing.severity + base) : existing.severity,
        details: { ...existing.details, ...details, lastAt: new Date().toISOString() },
        updatedAt: new Date(),
      })
      .where(eq(fraudFlags.id, existing.id));
  } else {
    await db.insert(fraudFlags).values({ userId, type, severity: base, details });
  }
  return recomputeScore(ctx, db, userId);
}

export async function recomputeScore(ctx: AppContext, db: DbOrTx, userId: string): Promise<number> {
  const res = await db
    .select({ total: sql<number>`coalesce(sum(${fraudFlags.severity}), 0)::int` })
    .from(fraudFlags)
    .where(and(eq(fraudFlags.userId, userId), inArray(fraudFlags.status, ['open', 'confirmed'])));
  const score = Math.min(100, res[0]?.total ?? 0);
  const [user] = await db
    .update(users)
    .set({ fraudScore: score, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  const settings = ctx.settings.get();
  if (user && user.status === 'active' && score >= settings.blockMinFraudScore) {
    // Automatic *pause*, never an automatic ban: a person makes the final call.
    await db
      .update(users)
      .set({ status: 'restricted', banReasonCode: null, bannedAt: new Date() })
      .where(eq(users.id, userId));
    await notify(ctx, db, userId, {
      type: 'security_review',
      title: 'Your account is under a short review',
      body: 'Our automated checks noticed unusual activity, so earning and cash-outs are paused while a person reviews it (usually within 24 hours). Your balance is safe.',
      link: '/app',
      email: { category: 'security' },
    });
  }
  return score;
}

/* ── signal collectors ─────────────────────────────────────────────────────── */

export function isDisposableEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return DISPOSABLE_EMAIL_DOMAINS.has(domain);
}

export async function ipKind(
  ctx: AppContext,
  db: DbOrTx,
  ip: string,
): Promise<'datacenter' | 'vpn' | 'shared_ok' | 'blocked' | null> {
  if (!ip || isPrivateIp(ip)) return null;
  const rules = (await db.select().from(ipRules)).filter(
    (r) => r.expiresAt === null || r.expiresAt > new Date(),
  );
  const hit = rules.find((r) => ipInCidr(ip, r.cidr));
  if (hit) return hit.kind;
  if (KNOWN_DATACENTER_CIDRS.some((c) => ipInCidr(ip, c))) return 'datacenter';
  // Local rules miss — ask the reputation provider (IPQS) when configured.
  const reputation = await lookupIpReputation(ctx, ip);
  if (reputation) return reputation;
  return null;
}

/** Other (non-deleted) accounts that have used this exact device key. */
export async function accountsSharingDevice(
  db: DbOrTx,
  userId: string,
  deviceKey: string,
): Promise<string[]> {
  if (deviceKey.startsWith('anon_')) return [];
  const rows = await db
    .select({ userId: devices.userId })
    .from(devices)
    .innerJoin(users, eq(users.id, devices.userId))
    .where(
      and(eq(devices.deviceKey, deviceKey), ne(devices.userId, userId), sql`${users.deletedAt} is null`),
    );
  return [...new Set(rows.map((r) => r.userId))];
}

export async function evaluateSignup(
  ctx: AppContext,
  db: DbOrTx,
  user: { id: string; email: string },
  client: { ip: string; deviceKey: string },
): Promise<void> {
  const settings = ctx.settings.get();
  if (isDisposableEmail(user.email))
    await recordSignal(ctx, db, user.id, 'disposable_email', { email: user.email.split('@')[1] });
  const shared = await accountsSharingDevice(db, user.id, client.deviceKey);
  if (shared.length > 0)
    await recordSignal(ctx, db, user.id, 'shared_device', { otherAccounts: shared.slice(0, 10) });
  if (settings.fraudIpSignals) {
    const kind = await ipKind(ctx, db, client.ip);
    if (kind === 'datacenter' || kind === 'vpn')
      await recordSignal(ctx, db, user.id, 'datacenter_ip', { ip: client.ip, kind });
    if (kind !== 'shared_ok' && !isPrivateIp(client.ip)) {
      const recent = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(users)
        .where(
          and(
            eq(users.signupIp, client.ip),
            sql`${users.createdAt} > now() - interval '24 hours'`,
            ne(users.id, user.id),
          ),
        );
      if ((recent[0]?.n ?? 0) >= 3)
        await recordSignal(ctx, db, user.id, 'ip_velocity', { ip: client.ip, signups24h: recent[0]!.n + 1 });
    }
  }
}

export async function resolveFlag(
  ctx: AppContext,
  db: DbOrTx,
  flagId: string,
  action: 'clear' | 'confirm',
  actorId: string,
  note: string,
): Promise<{ userId: string; score: number }> {
  const [flag] = await db
    .update(fraudFlags)
    .set({
      status: action === 'clear' ? 'cleared' : 'confirmed',
      resolvedBy: actorId,
      resolvedAt: new Date(),
      resolutionNote: note,
      updatedAt: new Date(),
    })
    .where(eq(fraudFlags.id, flagId))
    .returning();
  if (!flag) throw new Error('Flag not found');
  const score = await recomputeScore(ctx, db, flag.userId);
  if (action === 'clear') await maybeLiftAutomaticRestriction(ctx, db, flag.userId, score);
  return { userId: flag.userId, score };
}

/** If an account was paused automatically (no human ban reason) and its score is now below the block line, restore it. */
export async function maybeLiftAutomaticRestriction(
  ctx: AppContext,
  db: DbOrTx,
  userId: string,
  score: number,
): Promise<void> {
  const rows = await db.select().from(users).where(eq(users.id, userId));
  const user = rows[0];
  if (
    user &&
    user.status === 'restricted' &&
    !user.banReasonCode &&
    score < ctx.settings.get().blockMinFraudScore
  ) {
    await db.update(users).set({ status: 'active', bannedAt: null }).where(eq(users.id, userId));
    await notify(ctx, db, userId, {
      type: 'security_review_done',
      title: 'Review complete — you’re all set',
      body: 'Thanks for your patience. Earning and cash-outs are available again.',
      link: '/app',
      email: { category: 'security' },
    });
  }
}
