import { and, eq, sql } from 'drizzle-orm';
import {
  splitByBps,
  type AdsNetworkDTO,
  type InterruptedSessionReportDTO,
  type NetworkCategory,
  type NetworkDTO,
  type NetworkKind,
  type NetworkWallDTO,
} from '@lucrum/shared';
import type { AppContext } from '../../context';
import { adCreatives, networks, users, wallSessions } from '../../db/schema';
import type { ClientInfo } from '../../http/auth';
import { decrypt, encrypt, randomToken } from '../../lib/crypto';
import { AppError, badRequest, notFound } from '../../lib/errors';
import { ipKind, recordSignal } from '../fraud/service';
import { networkReliability } from '../offers/service';
import { NETWORK_CATALOG, WALL_KINDS, catalogById } from './catalog';

type UserRow = typeof users.$inferSelect;

const DAY_MS = 86_400_000;
/**
 * Wall sessions stay resolvable for 30 days: milestone tasks ("reach level 20")
 * legitimately take weeks, and late postbacks must still find their user.
 */
const WALL_SESSION_TTL_MS = 30 * DAY_MS;

/** Default estimated network revenue per rewarded impression ($0.05 → ~$0.03 to the member at 60%). */
const DEFAULT_EST_REVENUE_MICROS = 50_000;

const INTERRUPTED_GUIDANCE =
  'Logged. If your balance doesn’t update within 2 hours, open Activity → Missing credit and we’ll trace it with the network.';

/* ── catalog sync (boot) ───────────────────────────────────────────────────── */

/**
 * Turns the static network catalog into `networks` rows. Runs on every boot:
 *
 *   • no row yet            → create (active when the env secret is set, else paused
 *                             with an `unconfigured` marker)
 *   • catalog-managed row   → refresh config + rotate the secret from env; a row that
 *                             is paused *because it was never configured* activates as
 *                             soon as credentials appear. A row an admin paused on
 *                             purpose stays paused (never auto-deactivated either —
 *                             status changes beyond first-time activation are an
 *                             admin decision).
 *   • admin-created row     → left untouched
 */
export async function syncNetworkCatalog(
  ctx: AppContext,
): Promise<{ created: number; activated: number; updated: number }> {
  const db = ctx.db;
  let created = 0;
  let activated = 0;
  let updated = 0;
  for (const entry of NETWORK_CATALOG) {
    const secret = entry.env.secret ? process.env[entry.env.secret] : undefined;
    const appToken = entry.env.appToken ? process.env[entry.env.appToken] : undefined;
    const appId = entry.env.appId ? process.env[entry.env.appId] : undefined;
    const sdkKey = entry.env.sdkKey ? process.env[entry.env.sdkKey] : undefined;
    const adUnitId = entry.env.adUnitId ? process.env[entry.env.adUnitId] : undefined;
    const revenueMicros = entry.env.revenueMicros ? Number(process.env[entry.env.revenueMicros]) : NaN;
    const config: Record<string, unknown> = {
      catalog: true,
      categories: entry.categories,
      regions: entry.regions,
      signupUrl: entry.signupUrl,
      docsUrl: entry.docsUrl,
      signatureNote: entry.signatureNote,
      ...(entry.policyNote ? { policyNote: entry.policyNote } : {}),
      ...(entry.policyRestricted ? { policyRestricted: true } : {}),
      notes: entry.notes,
      // Rewarded-video networks verify completions through our SSV endpoint.
      ...(entry.kind === 'ads' ? { ssv: true } : {}),
      // Estimated per-impression network revenue for the partner video creative.
      ...(entry.kind === 'ads'
        ? { estRevenueMicros: Number.isFinite(revenueMicros) ? revenueMicros : DEFAULT_EST_REVENUE_MICROS }
        : {}),
      ...(entry.clickUrlTemplate ? { clickUrlTemplate: entry.clickUrlTemplate } : {}),
      ...(entry.iframeUrlTemplate ? { iframeUrlTemplate: entry.iframeUrlTemplate } : {}),
      ...(entry.frameHost ? { frameHost: entry.frameHost } : {}),
      // App tokens / SDK keys are credentials — keep them encrypted at rest, like the secret.
      ...(appToken ? { appTokenEnc: encrypt(appToken) } : {}),
      ...(sdkKey ? { sdkKeyEnc: encrypt(sdkKey) } : {}),
      ...(adUnitId ? { adUnitIdEnc: encrypt(adUnitId) } : {}),
      ...(appId ? { appId } : {}),
      ...(entry.adapterConfig ?? {}),
    };
    const rows = await db.select().from(networks).where(eq(networks.id, entry.id));
    const existing = rows[0];
    let status: 'active' | 'paused' | 'disabled';
    if (!existing) {
      status = secret ? 'active' : 'paused';
      await db.insert(networks).values({
        id: entry.id,
        name: entry.name,
        adapter: entry.adapter,
        kind: entry.kind,
        status,
        secretEnc: secret ? encrypt(secret) : null,
        config: secret ? config : { ...config, unconfigured: true },
      });
      if (secret) activated++;
      else created++;
    } else {
      const managed = Boolean((existing.config as Record<string, unknown>).catalog);
      if (!managed) continue;
      const wasUnconfigured = Boolean((existing.config as Record<string, unknown>).unconfigured);
      const patch: Partial<typeof networks.$inferInsert> = {
        name: entry.name,
        config: { ...existing.config, ...config, unconfigured: secret ? false : wasUnconfigured },
      };
      if (secret) {
        patch.secretEnc = encrypt(secret);
        if (existing.status === 'paused' && wasUnconfigured) {
          patch.status = 'active';
          activated++;
        }
      }
      await db.update(networks).set(patch).where(eq(networks.id, entry.id));
      updated++;
      status = patch.status ?? existing.status;
    }
    // Rewarded-video networks get a partner creative so members can earn through
    // the native Android SDKs (served via POST /api/ads/partner-sessions).
    if (entry.kind === 'ads' && !entry.policyRestricted) {
      await syncPartnerCreative(db, entry.id, entry.name, status, Number(config.estRevenueMicros));
    }
  }
  return { created, activated, updated };
}

/** Creative id for a network's native-SDK rewarded video. Excluded from the web video pool. */
export function partnerCreativeId(networkId: string): string {
  return `partner-${networkId}`;
}

async function syncPartnerCreative(
  db: AppContext['db'],
  networkId: string,
  networkName: string,
  status: 'active' | 'paused' | 'disabled',
  revenueMicros: number,
): Promise<void> {
  const values = {
    id: partnerCreativeId(networkId),
    networkId,
    advertiser: networkName,
    title: `${networkName} video`,
    tagline: 'Watch a short video and earn — paid even if the network’s callback is late.',
    durationSeconds: 30,
    revenueMicros:
      Number.isFinite(revenueMicros) && revenueMicros > 0 ? revenueMicros : DEFAULT_EST_REVENUE_MICROS,
    lite: true,
    theme: { from: '#0f172a', to: '#020617', accent: '#10b981', emoji: '▶️' },
    status: status === 'active' ? ('active' as const) : ('paused' as const),
  };
  await db
    .insert(adCreatives)
    .values(values)
    .onConflictDoUpdate({
      target: adCreatives.id,
      set: {
        advertiser: values.advertiser,
        title: values.title,
        tagline: values.tagline,
        revenueMicros: values.revenueMicros,
        status: values.status,
      },
    });
}

/* ── member-facing listing ─────────────────────────────────────────────────── */

function configStringArray(cfg: Record<string, unknown>, key: string): string[] | null {
  const v = cfg[key];
  return Array.isArray(v) ? (v as string[]) : null;
}

/** Active wall networks available to this member (geo-filtered, with reliability). */
export async function listNetworksForUser(ctx: AppContext, user: UserRow): Promise<NetworkDTO[]> {
  const rows = await ctx.db.select().from(networks).where(eq(networks.status, 'active'));
  const reliability = await networkReliability(ctx.db);
  const out: NetworkDTO[] = [];
  for (const row of rows) {
    const kind = row.kind as NetworkKind;
    if (!WALL_KINDS.includes(kind)) continue;
    if (row.adapter === 'sandboxnet') continue; // simulated — surfaced through offers
    const cfg = row.config as Record<string, unknown>;
    const catalog = catalogById.get(row.id);
    const regions = configStringArray(cfg, 'regions') ?? catalog?.regions ?? [];
    if (regions.length > 0 && user.country && !regions.includes(user.country)) continue;
    const categories = (configStringArray(cfg, 'categories') ??
      catalog?.categories ??
      []) as NetworkCategory[];
    const rel = reliability.get(row.id);
    out.push({
      id: row.id,
      name: row.name,
      kind,
      categories,
      regions,
      embeddable: kind === 'iframe_wall' || kind === 'survey_wall',
      postbackSuccessRate: rel?.rate ?? null,
      postbacks30d: rel?.total ?? 0,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/* ── partner rewarded video (native SDK networks) ──────────────────────────── */

function decryptOptional(cfg: Record<string, unknown>, key: string): string | null {
  const v = cfg[key];
  if (typeof v !== 'string' || v === '') return null;
  try {
    return decrypt(v);
  } catch {
    return null;
  }
}

/**
 * Active rewarded-video networks the member can watch on this device, with their
 * (public-by-design) mobile SDK credentials and an honest reward estimate.
 * Policy-restricted networks (e.g. AdMob for cash rewards) are excluded.
 */
export async function listAdsNetworksForUser(ctx: AppContext, user: UserRow): Promise<AdsNetworkDTO[]> {
  const rows = await ctx.db.select().from(networks).where(eq(networks.status, 'active'));
  const creatives = await ctx.db.select().from(adCreatives).where(eq(adCreatives.status, 'active'));
  const creativeById = new Map(creatives.map((c) => [c.id, c]));
  const share = ctx.settings.get().revenueShareBps;
  const out: AdsNetworkDTO[] = [];
  for (const row of rows) {
    if (row.kind !== 'ads') continue;
    const cfg = row.config as Record<string, unknown>;
    if (cfg.policyRestricted) continue;
    const regions = configStringArray(cfg, 'regions') ?? catalogById.get(row.id)?.regions ?? [];
    if (regions.length > 0 && user.country && !regions.includes(user.country)) continue;
    const creative = creativeById.get(partnerCreativeId(row.id));
    if (!creative) continue; // no partner creative → not wired for native video
    out.push({
      id: row.id,
      name: row.name,
      categories: (configStringArray(cfg, 'categories') ??
        catalogById.get(row.id)?.categories ??
        []) as NetworkCategory[],
      regions,
      rewardMicros: splitByBps(creative.revenueMicros, share).share,
      sdk: {
        appId: typeof cfg.appId === 'string' ? cfg.appId : null,
        sdkKey: decryptOptional(cfg, 'sdkKeyEnc'),
        adUnitId: decryptOptional(cfg, 'adUnitIdEnc'),
      },
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/* ── wall sessions ─────────────────────────────────────────────────────────── */

function appTokenFromConfig(cfg: Record<string, unknown>): string | undefined {
  if (cfg.appTokenEnc) {
    try {
      return decrypt(String(cfg.appTokenEnc));
    } catch {
      return undefined;
    }
  }
  return typeof cfg.appToken === 'string' ? cfg.appToken : undefined;
}

/**
 * Opens a tracked wall session. The network only ever receives an opaque session
 * token as its user id; postbacks carrying that token resolve back to the user
 * through `wall_sessions` (see modules/postbacks/service.ts).
 */
export async function openWallSession(
  ctx: AppContext,
  user: UserRow,
  networkId: string,
  client: ClientInfo,
): Promise<NetworkWallDTO> {
  const rows = await ctx.db.select().from(networks).where(eq(networks.id, networkId));
  const network = rows[0];
  if (!network) throw notFound('Network');
  if (network.status !== 'active')
    throw new AppError(410, 'NETWORK_UNAVAILABLE', 'This task wall is not available right now.');
  const kind = network.kind as NetworkKind;
  if (!WALL_KINDS.includes(kind)) throw badRequest('NOT_A_WALL', 'This network is not a task wall.');

  const cfg = network.config as Record<string, unknown>;
  const regions = configStringArray(cfg, 'regions') ?? catalogById.get(networkId)?.regions ?? [];
  if (regions.length > 0 && user.country && !regions.includes(user.country))
    throw new AppError(403, 'NETWORK_GEO', 'This task wall isn’t available in your country.');

  // Fraud gate at the earning entry point: VPN/proxy/datacenter traffic is flagged
  // (explainably) before the member starts a task.
  if (ctx.settings.get().fraudIpSignals) {
    const kind2 = await ipKind(ctx, ctx.db, client.ip);
    if (kind2 === 'datacenter' || kind2 === 'vpn')
      await recordSignal(ctx, ctx.db, user.id, 'datacenter_ip', {
        ip: client.ip,
        kind: kind2,
        context: 'wall_open',
      });
  }

  const embeddable = (kind === 'iframe_wall' || kind === 'survey_wall') && Boolean(cfg.iframeUrlTemplate);
  const template = String((embeddable ? cfg.iframeUrlTemplate : cfg.clickUrlTemplate) ?? '');
  if (!template)
    throw badRequest(
      'NETWORK_MISCONFIGURED',
      'This network has no wall URL configured — an admin needs to finish setup.',
    );

  const [session] = await ctx.db
    .insert(wallSessions)
    .values({
      userId: user.id,
      networkId: network.id,
      sessionToken: randomToken(24),
      deviceKey: client.deviceKey,
      ip: client.ip,
      userAgent: client.userAgent,
      expiresAt: new Date(Date.now() + WALL_SESSION_TTL_MS),
    })
    .returning();

  const url = template
    .replaceAll('{user_id}', session!.sessionToken)
    .replaceAll('{click_id}', session!.id)
    .replaceAll('{session_id}', session!.id)
    .replaceAll('{app_token}', appTokenFromConfig(cfg) ?? '')
    .replaceAll('{app_id}', String(cfg.appId ?? ''));

  return {
    networkId: network.id,
    networkName: network.name,
    sessionId: session!.id,
    url,
    mode: embeddable ? 'iframe' : 'external',
    expiresAt: session!.expiresAt.toISOString(),
  };
}

/**
 * Connection-resilience log: the member's connection dropped mid-task. We record
 * the interrupted session (proof of activity at drop time) and tell the member
 * how to claim if the postback never arrives.
 */
export async function logInterruptedSession(
  ctx: AppContext,
  user: UserRow,
  input: { sessionId?: string; networkId: string; startedAt: string; networkType?: string; reason?: string },
): Promise<InterruptedSessionReportDTO> {
  const network = (
    await ctx.db.select({ id: networks.id }).from(networks).where(eq(networks.id, input.networkId))
  )[0];
  if (!network) throw notFound('Network');
  const interruption = {
    startedAt: input.startedAt,
    networkType: input.networkType ?? null,
    reason: input.reason ?? 'connection_lost',
    reportedAt: new Date().toISOString(),
  };
  if (input.sessionId) {
    const [row] = await ctx.db
      .update(wallSessions)
      .set({ status: 'interrupted', interruptedAt: new Date(), interruption })
      .where(and(eq(wallSessions.id, input.sessionId), eq(wallSessions.userId, user.id)))
      .returning();
    if (row) return { ok: true, logged: true, guidance: INTERRUPTED_GUIDANCE };
  }
  // Unknown session id (e.g. the tab died before we could read it) — still log a
  // bare record so support has the evidence trail.
  await ctx.db.insert(wallSessions).values({
    userId: user.id,
    networkId: input.networkId,
    sessionToken: `lost-${randomToken(16)}`,
    status: 'interrupted',
    interruptedAt: new Date(),
    interruption,
    expiresAt: new Date(Date.now() + WALL_SESSION_TTL_MS),
  });
  return { ok: true, logged: true, guidance: INTERRUPTED_GUIDANCE };
}

/** Count of a user's interrupted wall sessions (support tooling). */
export async function countInterruptedSessions(ctx: AppContext, userId: string): Promise<number> {
  const res = await ctx.db.execute<{ n: number | string }>(sql`
    select count(*)::int as n from wall_sessions
    where user_id = ${userId} and status = 'interrupted'`);
  return Number(res.rows[0]?.n ?? 0);
}
