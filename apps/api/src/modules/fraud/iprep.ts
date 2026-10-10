import { eq } from 'drizzle-orm';
import type { AppContext } from '../../context';
import { ipRules } from '../../db/schema';
import { ipInCidr, isPrivateIp } from '../../lib/net';

/**
 * IP reputation lookups (IP Quality Score) — the "IP & proxy filtering" layer for
 * web reward platforms. Bots, VPNs, Tor exits and residential proxies are the
 * main way task apps get defrauded, and our built-in datacenter CIDR list only
 * covers the obvious ranges.
 *
 * Design rules:
 *  • Opt-in: does nothing until IPQS_API_KEY is configured.
 *  • Fail-open: if the provider is down or slow, we never block earning.
 *  • Cached: results (positive AND negative) are stored in ip_rules as /32 rows
 *    with a 24h expiry, so repeat traffic from one IP costs one API call per day.
 */

const IPQS_URL = 'https://ipqualityscore.com/api/json/ip';
const CACHE_MS = 24 * 3_600_000;
const TIMEOUT_MS = 4_000;

interface IpqsResponse {
  success?: boolean;
  vpn?: boolean;
  proxy?: boolean;
  tor?: boolean;
  hosting?: boolean;
  fraud_score?: number;
}

/** All non-expired manual + cached rules (expired cache rows are ignored). */
export async function activeIpRules(ctx: AppContext) {
  const rows = await ctx.db.select().from(ipRules);
  const now = new Date();
  return rows.filter((r) => r.expiresAt === null || r.expiresAt > now);
}

export function ruleKindForIp(rules: (typeof ipRules.$inferSelect)[], ip: string) {
  const hit = rules.find((r) => ipInCidr(ip, r.cidr));
  return hit?.kind ?? null;
}

/**
 * Returns 'vpn' | 'datacenter' | null for an IP, consulting the reputation
 * provider when local rules miss. Null means "no opinion" (fail-open).
 */
export async function lookupIpReputation(ctx: AppContext, ip: string): Promise<'datacenter' | 'vpn' | null> {
  const key = ctx.config.IPQS_API_KEY;
  if (!key || !ip || isPrivateIp(ip)) return null;

  const cached = await ctx.db
    .select()
    .from(ipRules)
    .where(eq(ipRules.cidr, `${ip}/32`));
  const hit = cached[0];
  if (hit && (hit.expiresAt === null || hit.expiresAt > new Date())) {
    return hit.kind === 'shared_ok' || hit.kind === 'blocked' ? null : hit.kind;
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(
      `${IPQS_URL}/${key}/${encodeURIComponent(ip)}?strictness=1&lighter_penalties=false`,
      {
        signal: ctrl.signal,
        headers: { accept: 'application/json' },
      },
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as IpqsResponse;
    if (data.success === false) return null;
    const fraud = typeof data.fraud_score === 'number' ? data.fraud_score : 0;
    let kind: 'datacenter' | 'vpn' | null = null;
    if (data.vpn || data.proxy || data.tor || fraud >= 85) kind = 'vpn';
    else if (data.hosting || fraud >= 75) kind = 'datacenter';
    await ctx.db
      .insert(ipRules)
      .values({
        cidr: `${ip}/32`,
        kind: kind ?? 'shared_ok',
        note: `IPQS cache (fraud_score=${fraud}, vpn=${data.vpn ?? false}, proxy=${data.proxy ?? false}, tor=${data.tor ?? false}, hosting=${data.hosting ?? false})`,
        expiresAt: new Date(Date.now() + CACHE_MS),
      })
      .onConflictDoNothing();
    return kind;
  } catch {
    return null; // provider unreachable — fail open
  }
}
