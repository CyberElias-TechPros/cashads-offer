import { and, desc, eq, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { RiskLevel } from '@cashads/shared';
import type { Uow } from '../../context';
import { devices, fraudCases, payoutDestinations, payouts, riskSignals, users } from '../../db/schema';
import { clock, DAY } from '../../lib/clock';

/**
 * Explainable risk scoring. Each signal has a weight; the score is the clamped
 * sum of active (uncleared) signals. Bands:
 *   0–30  low     → everything automatic
 *   31–60 medium  → payouts go to a human review, holds extended
 *   61+   high    → earnings held, payouts blocked until reviewed
 * We never auto-ban: a human always decides, and the member always sees a reason.
 */
export const SIGNALS = {
  disposable_email: { weight: 25, kind: 'state', label: 'Signed up with a disposable email domain' },
  shared_device: { weight: 30, kind: 'state', label: 'Device is shared with other accounts' },
  shared_payout_destination: { weight: 35, kind: 'state', label: 'Payout destination used by another account' },
  ip_signup_velocity: { weight: 15, kind: 'state', label: 'Many sign-ups from the same IP in 24h' },
  fast_completion: { weight: 8, kind: 'event', label: 'Offer completed implausibly fast' },
  video_tampering: { weight: 15, kind: 'event', label: 'Rewarded video events looked automated' },
  high_reversal_rate: { weight: 20, kind: 'state', label: 'High share of partner reversals' },
  referral_self: { weight: 40, kind: 'state', label: 'Referred account shares device/IP with referrer' },
  bot_user_agent: { weight: 20, kind: 'state', label: 'Automated client user agent' },
  country_mismatch: { weight: 10, kind: 'state', label: 'IP country differs from profile country' },
  phone_verified: { weight: -10, kind: 'state', label: 'Verified phone number' },
  kyc_verified: { weight: -20, kind: 'state', label: 'Verified identity' },
  manual_flag: { weight: 35, kind: 'event', label: 'Flagged manually by staff' },
} as const;

export type SignalCode = keyof typeof SIGNALS;
const MAX_EVENTS_COUNTED = 3;

export function levelFor(score: number): RiskLevel {
  if (score > 60) return 'high';
  if (score > 30) return 'medium';
  return 'low';
}

export async function addSignal(uow: Uow, userId: string, code: SignalCode, details: Record<string, unknown> = {}): Promise<void> {
  const def = SIGNALS[code];
  if (def.kind === 'state') {
    const [existing] = await uow.tx
      .select({ id: riskSignals.id })
      .from(riskSignals)
      .where(and(eq(riskSignals.userId, userId), eq(riskSignals.code, code), isNull(riskSignals.clearedAt)))
      .limit(1);
    if (existing) return;
  }
  await uow.tx.insert(riskSignals).values({ userId, code, weight: def.weight, details, createdAt: clock.now() });
  await recomputeRisk(uow, userId);
}

export async function recomputeRisk(uow: Uow, userId: string): Promise<{ score: number; level: RiskLevel; escalated: boolean }> {
  const signals = await uow.tx
    .select()
    .from(riskSignals)
    .where(and(eq(riskSignals.userId, userId), isNull(riskSignals.clearedAt)))
    .orderBy(desc(riskSignals.createdAt));
  const counted = new Map<string, number>();
  let score = 0;
  for (const s of signals) {
    const def = SIGNALS[s.code as SignalCode];
    const n = counted.get(s.code) ?? 0;
    const limit = def?.kind === 'event' ? MAX_EVENTS_COUNTED : 1;
    if (n >= limit) continue;
    counted.set(s.code, n + 1);
    score += s.weight;
  }
  score = Math.max(0, Math.min(100, score));
  const level = levelFor(score);
  const [before] = await uow.tx.select({ level: users.riskLevel }).from(users).where(eq(users.id, userId));
  await uow.tx.update(users).set({ riskScore: score, riskLevel: level, updatedAt: clock.now() }).where(eq(users.id, userId));

  const rank = { low: 0, medium: 1, high: 2 } as const;
  const escalated = !!before && rank[level] > rank[before.level];
  if (level !== 'low') {
    const [open] = await uow.tx
      .select({ id: fraudCases.id })
      .from(fraudCases)
      .where(and(eq(fraudCases.userId, userId), eq(fraudCases.status, 'open')))
      .limit(1);
    const summary = [...counted.keys()]
      .filter((c) => (SIGNALS[c as SignalCode]?.weight ?? 0) > 0)
      .map((c) => SIGNALS[c as SignalCode]?.label ?? c)
      .join(' · ');
    if (!open) {
      await uow.tx.insert(fraudCases).values({ userId, score, level, summary: summary || 'Elevated risk score', openedAt: clock.now() });
    } else {
      await uow.tx.update(fraudCases).set({ score, level, summary: summary || 'Elevated risk score' }).where(eq(fraudCases.id, open.id));
    }
    if (escalated) {
      // Pull any queued cash outs into review — they haven't been sent yet.
      await uow.tx
        .update(payouts)
        .set({ status: 'review', statusReason: 'Held for a quick safety review', updatedAt: clock.now() })
        .where(and(eq(payouts.userId, userId), eq(payouts.status, 'pending')));
    }
  }
  return { score, level, escalated };
}

/** Called on sign-up / login with the client's persistent device key + fingerprint. */
export async function checkDeviceSharing(uow: Uow, userId: string, device: { deviceKey?: string | null; fingerprint?: string | null }) {
  const conds = [];
  if (device.deviceKey) conds.push(eq(devices.deviceKey, device.deviceKey));
  if (device.fingerprint && device.fingerprint.length >= 16) conds.push(eq(devices.fingerprint, device.fingerprint));
  if (!conds.length) return;
  const others = await uow.tx
    .selectDistinct({ userId: devices.userId })
    .from(devices)
    .innerJoin(users, eq(users.id, devices.userId))
    .where(and(or(...conds), ne(devices.userId, userId), ne(users.status, 'deleted')))
    .limit(10);
  if (others.length > 0) {
    await addSignal(uow, userId, 'shared_device', { otherUserIds: others.map((o) => o.userId) });
  }
}

export async function checkSignupVelocity(uow: Uow, userId: string, ip: string | null) {
  if (!ip || ip === '127.0.0.1' || ip === '::1') return;
  const since = new Date(clock.ms() - DAY);
  const [row] = await uow.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.signupIp, ip), gte(users.createdAt, since), ne(users.id, userId)));
  if (Number(row?.n ?? 0) >= 3) await addSignal(uow, userId, 'ip_signup_velocity', { ip, count: Number(row?.n) });
}

/** Same PayPal/wallet/bank used by another account is the strongest multi-accounting signal there is. */
export async function checkPayoutDestination(uow: Uow, userId: string, hash: string): Promise<boolean> {
  const fromDest = await uow.tx
    .selectDistinct({ userId: payoutDestinations.userId })
    .from(payoutDestinations)
    .where(and(eq(payoutDestinations.hash, hash), ne(payoutDestinations.userId, userId)))
    .limit(5);
  const fromPayouts = await uow.tx
    .selectDistinct({ userId: payouts.userId })
    .from(payouts)
    .where(and(eq(payouts.destinationHash, hash), ne(payouts.userId, userId)))
    .limit(5);
  const ids = [...new Set([...fromDest, ...fromPayouts].map((r) => r.userId))];
  if (ids.length) {
    await addSignal(uow, userId, 'shared_payout_destination', { otherUserIds: ids });
    return true;
  }
  return false;
}

export async function clearSignals(uow: Uow, userId: string) {
  await uow.tx
    .update(riskSignals)
    .set({ clearedAt: clock.now() })
    .where(and(eq(riskSignals.userId, userId), isNull(riskSignals.clearedAt), sql`${riskSignals.weight} > 0`));
  await recomputeRisk(uow, userId);
}

export async function linkedAccounts(uow: Uow, userId: string) {
  const mine = await uow.tx.select({ key: devices.deviceKey, fp: devices.fingerprint }).from(devices).where(eq(devices.userId, userId));
  const keys = mine.map((d) => d.key).filter(Boolean) as string[];
  const fps = mine.map((d) => d.fp).filter((f): f is string => !!f && f.length >= 16);
  if (!keys.length && !fps.length) return [];
  const conds = [];
  if (keys.length) conds.push(inArray(devices.deviceKey, keys));
  if (fps.length) conds.push(inArray(devices.fingerprint, fps));
  return uow.tx
    .selectDistinct({ id: users.id, email: users.email, displayName: users.displayName, status: users.status, riskLevel: users.riskLevel })
    .from(devices)
    .innerJoin(users, eq(users.id, devices.userId))
    .where(and(or(...conds), ne(devices.userId, userId)))
    .limit(20);
}
