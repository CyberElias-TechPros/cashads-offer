import { and, eq } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client';
import { networks, sandboxNetworkConversions } from '../../db/schema';
import { decrypt, hmacHex, md5, safeEqual, sha256 } from '../../lib/crypto';
import { badRequest } from '../../lib/errors';

/**
 * Network adapters translate each offerwall's postback dialect into one shape.
 *
 * Implemented dialects:
 *  • sandboxnet — our simulated network: HMAC-SHA256 over sorted params + timestamp.
 *  • bitlabs    — HEX HMAC-SHA1 of the full callback URL, appended as &hash=
 *                 (developer.bitlabs.ai "Securing callbacks through hashing").
 *  • md5wall    — the common "subId/transId/reward/signature/status" family
 *                 (Primewall/Elitewall style): md5(subId + transId + reward + secret),
 *                 status 1 = credit, 2 = chargeback.
 *  • pangle_ssv — rewarded-video server-side verification as in the spec:
 *                 sign = sha256(appSecurityKey:transId) → respond {"isValid": true}.
 *
 * Adding a network = one object here + a row in `networks`.
 */

export interface PostbackRequest {
  method: string;
  /** Path + query exactly as received. */
  url: string;
  /** Reconstructed public URL (scheme://host/path?query) — needed for URL-hashing schemes. */
  fullUrl: string;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string | undefined>;
  ip: string;
}

export interface ParsedPostback {
  networkTxnId: string;
  clickId: string | null;
  userRef: string | null;
  networkOfferId: string | null;
  payoutMicros: number;
  status: 'credit' | 'reversal' | 'screenout';
  title?: string;
  /** Unix seconds, when the dialect provides one (used for replay protection). */
  timestamp?: number;
}

export type PostbackOutcome = 'ok' | 'duplicate' | 'rejected' | 'invalid' | 'error';

export interface ConversionCheck {
  supported: boolean;
  converted: boolean;
  networkTxnId?: string;
  payoutMicros?: number;
  kind?: 'complete' | 'screenout';
}

export interface NetworkAdapter {
  id: string;
  verify(req: PostbackRequest, secret: string): boolean;
  parse(req: PostbackRequest): ParsedPostback;
  respond(outcome: PostbackOutcome): { status: number; body: string | Record<string, unknown> };
  /** Max age (seconds) of a signed timestamp before we treat it as a replay. */
  freshnessSeconds?: number;
  checkConversion?(db: DbOrTx, networkId: string, clickId: string): Promise<ConversionCheck>;
}

/** Parse a decimal string ("2.5", "0.012345") into integer micros without float error. */
export function decimalToMicros(value: string | undefined): number {
  if (value === undefined || value === '') throw badRequest('MALFORMED', 'Missing payout');
  const s = value.trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw badRequest('MALFORMED', `Invalid amount "${value}"`);
  const [, neg, whole, frac = ''] = m;
  const micros = Number(whole) * 1_000_000 + Number(frac.padEnd(6, '0').slice(0, 6));
  return neg ? -micros : micros;
}

export function microsToDecimal(micros: number): string {
  const sign = micros < 0 ? '-' : '';
  const abs = Math.abs(micros);
  return `${sign}${Math.floor(abs / 1_000_000)}.${String(abs % 1_000_000).padStart(6, '0')}`;
}

function required(q: Record<string, string>, key: string): string {
  const v = q[key];
  if (v === undefined || v === '') throw badRequest('MALFORMED', `Missing parameter "${key}"`);
  return v;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v: string | undefined) => (v && UUID_RE.test(v) ? v.toLowerCase() : null);

/* ── sandboxnet ────────────────────────────────────────────────────────────── */

export function sandboxCanonical(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((k) => k !== 'sig')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
}

export function sandboxSign(params: Record<string, string>, secret: string): string {
  return hmacHex('sha256', secret, sandboxCanonical(params));
}

const sandboxnet: NetworkAdapter = {
  id: 'sandboxnet',
  freshnessSeconds: 600,
  verify(req, secret) {
    const sig = req.query.sig ?? '';
    return safeEqual(sig, sandboxSign(req.query, secret));
  },
  parse(req) {
    const q = req.query;
    const status = required(q, 'status');
    return {
      networkTxnId: required(q, 'txn_id'),
      clickId: asUuid(q.click_id),
      userRef: asUuid(q.user_id),
      networkOfferId: q.offer_id ?? null,
      payoutMicros: Math.abs(decimalToMicros(required(q, 'payout'))),
      status: status === '2' ? 'reversal' : status === '3' ? 'screenout' : 'credit',
      timestamp: q.ts ? Number(q.ts) : undefined,
    };
  },
  respond(outcome) {
    if (outcome === 'ok' || outcome === 'duplicate') return { status: 200, body: 'OK' };
    if (outcome === 'invalid') return { status: 403, body: 'INVALID_SIGNATURE' };
    if (outcome === 'error') return { status: 500, body: 'RETRY' };
    return { status: 400, body: 'REJECTED' };
  },
  async checkConversion(db, networkId, clickId) {
    const rows = await db
      .select()
      .from(sandboxNetworkConversions)
      .where(
        and(
          eq(sandboxNetworkConversions.networkId, networkId),
          eq(sandboxNetworkConversions.clickId, clickId),
        ),
      );
    const row = rows[0];
    if (!row || row.status !== 'converted') return { supported: true, converted: false };
    return {
      supported: true,
      converted: true,
      networkTxnId: row.networkTxnId,
      payoutMicros: row.payoutMicros,
      kind: row.kind,
    };
  },
};

/* ── BitLabs ───────────────────────────────────────────────────────────────── */

const bitlabs: NetworkAdapter = {
  id: 'bitlabs',
  verify(req, secret) {
    const idx = req.fullUrl.lastIndexOf('&hash=');
    if (idx === -1) return false;
    const base = req.fullUrl.slice(0, idx);
    const given = req.fullUrl.slice(idx + 6);
    return safeEqual(given.toLowerCase(), hmacHex('sha1', secret, base));
  },
  parse(req) {
    const q = req.query;
    const type = (q.type ?? 'COMPLETE').toUpperCase();
    const raw = decimalToMicros(required(q, 'raw'));
    return {
      networkTxnId: required(q, 'tx'),
      clickId: asUuid(q.click_id),
      userRef: asUuid(required(q, 'uid')),
      networkOfferId: q.offer_id ?? null,
      payoutMicros: Math.abs(raw),
      status:
        type === 'RECONCILIATION' || raw < 0 ? 'reversal' : type === 'SCREENOUT' ? 'screenout' : 'credit',
      title: q.cat ? `BitLabs survey (${q.cat})` : 'BitLabs survey',
    };
  },
  respond(outcome) {
    return outcome === 'error'
      ? { status: 500, body: 'RETRY' }
      : { status: outcome === 'invalid' ? 403 : 200, body: 'OK' };
  },
};

/* ── md5 offerwall family ──────────────────────────────────────────────────── */

const md5wall: NetworkAdapter = {
  id: 'md5wall',
  verify(req, secret) {
    const q = req.query;
    const expected = md5(`${q.subId ?? ''}${q.transId ?? ''}${q.reward ?? ''}${secret}`);
    return safeEqual((q.signature ?? '').toLowerCase(), expected);
  },
  parse(req) {
    const q = req.query;
    return {
      networkTxnId: required(q, 'transId'),
      clickId: asUuid(q.click_id ?? q.subId2),
      userRef: asUuid(required(q, 'subId')),
      networkOfferId: q.campaign_id ?? null,
      payoutMicros: Math.abs(decimalToMicros(required(q, 'payout'))),
      status: q.status === '2' ? 'reversal' : 'credit',
      title: q.offerName ? decodeURIComponent(q.offerName) : 'Partner offer',
    };
  },
  respond(outcome) {
    return outcome === 'error'
      ? { status: 500, body: '0' }
      : { status: outcome === 'invalid' ? 403 : 200, body: outcome === 'invalid' ? '0' : '1' };
  },
};

/* ── rewarded video SSV (Pangle-style) ─────────────────────────────────────── */

export function ssvSign(secret: string, transId: string): string {
  return sha256(`${secret}:${transId}`);
}

const pangleSsv: NetworkAdapter = {
  id: 'pangle_ssv',
  verify(req, secret) {
    const q = req.query;
    return safeEqual((q.sign ?? '').toLowerCase(), ssvSign(secret, q.trans_id ?? ''));
  },
  parse(req) {
    const q = req.query;
    return {
      networkTxnId: required(q, 'trans_id'),
      clickId: asUuid(q.extra),
      userRef: asUuid(required(q, 'user_id')),
      networkOfferId: q.reward_name ?? null,
      payoutMicros: 0,
      status: 'credit',
    };
  },
  respond(outcome) {
    return {
      status: outcome === 'error' ? 500 : 200,
      body: { isValid: outcome === 'ok' || outcome === 'duplicate' },
    };
  },
};

export const ADAPTERS: Record<string, NetworkAdapter> = {
  sandboxnet,
  bitlabs,
  md5wall,
  pangle_ssv: pangleSsv,
};

export function getAdapter(id: string): NetworkAdapter | undefined {
  return ADAPTERS[id];
}

export async function getNetworkSecret(db: DbOrTx, networkId: string): Promise<string | null> {
  const rows = await db
    .select({ secretEnc: networks.secretEnc })
    .from(networks)
    .where(eq(networks.id, networkId));
  const enc = rows[0]?.secretEnc;
  return enc ? decrypt(enc) : null;
}
