import { and, desc, eq, sql } from 'drizzle-orm';
import type { AppContext } from '../../context';
import { networks, offerClicks, offers, postbackLogs, users, wallSessions } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { ipInCidr } from '../../lib/net';
import {
  type ParsedPostback,
  type PostbackOutcome,
  type PostbackRequest,
  getAdapter,
  getNetworkSecret,
} from '../networks/adapters';
import { invalidateReliabilityCache } from '../offers/service';
import { creditConversion, reverseConversion } from '../rewards/service';

/**
 * Server-to-server conversion pipeline (spec §7.3):
 *
 *   network ──HTTP──▶ log raw request ─▶ IP allowlist ─▶ parse ─▶ verify signature
 *                     ─▶ replay window ─▶ resolve click/user ─▶ dedupe ─▶ credit (atomic)
 *                     ─▶ live push to the member's open tabs
 *
 * Every request is logged *before* processing, including failures, so support can
 * replay it and Missing Credit claims can find evidence that a network did report a
 * completion even if something went wrong.
 */

const REDACTED_HEADERS = new Set(['cookie', 'authorization', 'x-api-key']);

export interface PostbackResult {
  status: number;
  body: string | Record<string, unknown>;
  logId: string;
  outcome: 'processed' | 'duplicate' | 'rejected' | 'error';
  errorCode?: string;
}

export async function handlePostback(
  ctx: AppContext,
  networkId: string,
  req: PostbackRequest,
  opts: { replayOf?: string; skipFreshness?: boolean } = {},
): Promise<PostbackResult> {
  const started = Date.now();
  const headers = Object.fromEntries(
    Object.entries(req.headers).filter(([k]) => !REDACTED_HEADERS.has(k.toLowerCase())),
  );
  const [log] = await ctx.db
    .insert(postbackLogs)
    .values({
      networkId,
      method: req.method,
      url: req.url.slice(0, 4000),
      query: req.query,
      body: (req.body ?? null) as never,
      headers,
      ip: req.ip,
      replayOf: opts.replayOf ?? null,
    })
    .returning({ id: postbackLogs.id });
  const logId = log!.id;

  const networkRows = await ctx.db.select().from(networks).where(eq(networks.id, networkId));
  const network = networkRows[0];
  const adapter = network ? getAdapter(network.adapter) : undefined;

  const finish = async (
    status: 'processed' | 'duplicate' | 'rejected' | 'error',
    outcome: PostbackOutcome,
    patch: Partial<typeof postbackLogs.$inferInsert> = {},
  ): Promise<PostbackResult> => {
    await ctx.db
      .update(postbackLogs)
      .set({ status, processingMs: Date.now() - started, ...patch })
      .where(eq(postbackLogs.id, logId));
    invalidateReliabilityCache();
    const resp = adapter?.respond(outcome) ?? {
      status: outcome === 'error' ? 500 : 404,
      body: 'UNKNOWN_NETWORK',
    };
    return { ...resp, logId, outcome: status, errorCode: patch.errorCode ?? undefined };
  };

  if (!network || !adapter)
    return finish('rejected', 'rejected', {
      errorCode: 'unknown_network',
      errorMessage: `Unknown network ${networkId}`,
    });
  if (network.status === 'disabled') return finish('rejected', 'rejected', { errorCode: 'network_disabled' });
  if (network.ipAllowlist.length > 0 && !network.ipAllowlist.some((cidr) => ipInCidr(req.ip, cidr))) {
    return finish('rejected', 'invalid', {
      errorCode: 'ip_not_allowed',
      errorMessage: `IP ${req.ip} is not on the allowlist`,
    });
  }

  let parsed: ParsedPostback;
  try {
    parsed = adapter.parse(req);
  } catch (err) {
    return finish('rejected', 'rejected', {
      errorCode: 'malformed',
      errorMessage: err instanceof Error ? err.message : 'Malformed postback',
    });
  }
  const ids = { networkTxnId: parsed.networkTxnId, clickId: parsed.clickId, userId: parsed.userRef };

  const secret = await getNetworkSecret(ctx.db, network.id);
  const signatureValid = secret ? adapter.verify(req, secret, network) : false;
  if (!signatureValid) {
    return finish('rejected', 'invalid', {
      ...ids,
      signatureValid: false,
      errorCode: 'bad_signature',
      errorMessage: 'Signature verification failed',
    });
  }
  if (adapter.freshnessSeconds && parsed.timestamp && !opts.skipFreshness) {
    const age = Math.abs(Date.now() / 1000 - parsed.timestamp);
    if (age > adapter.freshnessSeconds) {
      return finish('rejected', 'rejected', {
        ...ids,
        signatureValid: true,
        errorCode: 'stale',
        errorMessage: `Timestamp is ${Math.round(age)}s old`,
      });
    }
  }

  try {
    const res = await processParsed(ctx, network.id, parsed, logId);
    if (res.outcome === 'duplicate')
      return finish('duplicate', 'duplicate', {
        ...ids,
        signatureValid: true,
        conversionId: res.conversionId ?? null,
      });
    if (res.outcome === 'rejected') {
      return finish('rejected', 'rejected', {
        ...ids,
        signatureValid: true,
        errorCode: res.errorCode,
        errorMessage: res.message ?? null,
      });
    }
    return finish('processed', 'ok', {
      ...ids,
      signatureValid: true,
      conversionId: res.conversionId ?? null,
    });
  } catch (err) {
    ctx.log.error({ err, networkId, logId }, 'postback processing failed');
    return finish('error', 'error', {
      ...ids,
      signatureValid: true,
      errorCode: 'internal',
      errorMessage: err instanceof Error ? err.message.slice(0, 500) : 'error',
    });
  }
}

interface ProcessResult {
  outcome: 'credited' | 'duplicate' | 'reversed' | 'rejected';
  conversionId?: string;
  errorCode?: string;
  message?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a postback's user reference. Click-tracked offers pass the user UUID as
 * subId; wall networks only ever see the opaque wall-session token, which maps
 * back to the user through `wall_sessions`.
 */
async function resolveUserRef(
  db: AppContext['db'],
  networkId: string,
  ref: string,
): Promise<{ userId: string; wallSession: typeof wallSessions.$inferSelect | null } | null> {
  if (UUID_RE.test(ref)) {
    const u = await db.select({ id: users.id }).from(users).where(eq(users.id, ref));
    return u[0] ? { userId: u[0].id, wallSession: null } : null;
  }
  const s = await db
    .select()
    .from(wallSessions)
    .where(and(eq(wallSessions.sessionToken, ref), eq(wallSessions.networkId, networkId)));
  return s[0] ? { userId: s[0].userId, wallSession: s[0] } : null;
}

async function processParsed(
  ctx: AppContext,
  networkId: string,
  p: ParsedPostback,
  logId: string,
): Promise<ProcessResult> {
  if (p.status === 'reversal') {
    const r = await reverseConversion(ctx, { networkId, networkTxnId: p.networkTxnId });
    if (r.outcome === 'unknown')
      return {
        outcome: 'rejected',
        errorCode: 'unknown_conversion',
        message: 'No conversion with this transaction id',
      };
    return { outcome: r.outcome === 'duplicate' ? 'duplicate' : 'reversed' };
  }

  let click: typeof offerClicks.$inferSelect | null = null;
  let offer: typeof offers.$inferSelect | null = null;
  let userId: string | null = null;
  let wallSession: typeof wallSessions.$inferSelect | null = null;

  if (p.clickId) {
    const rows = await ctx.db.select().from(offerClicks).where(eq(offerClicks.id, p.clickId));
    click = rows[0] ?? null;
    if (!click)
      return { outcome: 'rejected', errorCode: 'unknown_click', message: `Click ${p.clickId} not found` };
    if (p.userRef && UUID_RE.test(p.userRef) && p.userRef !== click.userId)
      return { outcome: 'rejected', errorCode: 'user_mismatch', message: 'Click belongs to another user' };
    userId = click.userId;
    offer = (await ctx.db.select().from(offers).where(eq(offers.id, click.offerId)))[0] ?? null;
  } else if (p.userRef) {
    // The ref is either a user UUID (click-tracked offers pass it as subId) or an
    // opaque wall-session token handed out by openWallSession.
    const resolved = await resolveUserRef(ctx.db, networkId, p.userRef);
    if (!resolved) return { outcome: 'rejected', errorCode: 'unknown_user', message: 'User not found' };
    userId = resolved.userId;
    wallSession = resolved.wallSession;
    if (p.networkOfferId) {
      offer =
        (
          await ctx.db
            .select()
            .from(offers)
            .where(and(eq(offers.networkId, networkId), eq(offers.networkOfferId, p.networkOfferId)))
        )[0] ?? null;
      if (offer) {
        click =
          (
            await ctx.db
              .select()
              .from(offerClicks)
              .where(and(eq(offerClicks.userId, userId), eq(offerClicks.offerId, offer.id)))
              .orderBy(desc(offerClicks.startedAt))
              .limit(1)
          )[0] ?? null;
      }
    }
  } else {
    return {
      outcome: 'rejected',
      errorCode: 'unresolvable',
      message: 'Postback has neither a click id nor a user id',
    };
  }

  const user = (
    await ctx.db.select({ id: users.id, deletedAt: users.deletedAt }).from(users).where(eq(users.id, userId!))
  )[0];
  if (!user || user.deletedAt)
    return { outcome: 'rejected', errorCode: 'unknown_user', message: 'User not found' };

  // Spec rule: postbacks must arrive within the click window (72h, or 30d for slow-confirming offers).
  // Already-credited clicks fall through to the idempotent duplicate check instead.
  if (click && click.status !== 'credited' && click.expiresAt < new Date()) {
    return {
      outcome: 'rejected',
      errorCode: 'click_expired',
      message: 'Postback arrived after the click window — eligible for a Missing Credit claim',
    };
  }

  const res = await creditConversion(ctx, {
    networkId,
    networkTxnId: p.networkTxnId,
    userId: user.id,
    offer,
    click,
    payoutMicros: p.payoutMicros,
    kind: p.status === 'screenout' ? 'screenout' : 'complete',
    source: 'postback',
    title: p.title,
    postbackLogId: logId,
  });
  if (wallSession && !res.duplicate) {
    await ctx.db
      .update(wallSessions)
      .set({ conversions: sql`${wallSessions.conversions} + 1` })
      .where(eq(wallSessions.id, wallSession.id));
  }
  return { outcome: res.duplicate ? 'duplicate' : 'credited', conversionId: res.conversionId };
}

/** Admin replay: re-run a stored postback through the full pipeline (still signature-checked, still idempotent). */
export async function replayPostback(ctx: AppContext, logId: string): Promise<PostbackResult> {
  const rows = await ctx.db.select().from(postbackLogs).where(eq(postbackLogs.id, logId));
  const log = rows[0];
  if (!log) throw new AppError(404, 'NOT_FOUND', 'Postback log not found');
  const query = Object.fromEntries(Object.entries(log.query).map(([k, v]) => [k, String(v)]));
  return handlePostback(
    ctx,
    log.networkId,
    {
      method: log.method,
      url: log.url,
      fullUrl: String((log.headers as Record<string, unknown>)['x-full-url'] ?? log.url),
      query,
      body: log.body,
      headers: log.headers as Record<string, string>,
      ip: log.ip ?? '',
    },
    { replayOf: log.id, skipFreshness: true },
  );
}
