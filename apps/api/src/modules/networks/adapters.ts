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
 *                 (AdGate Media, Primewall/Elitewall style):
 *                 md5(subId + transId + reward + secret), status 1 = credit, 2 = chargeback.
 *  • cpx        — CPX Research: md5(`${trans_id}-${user_id}-${amount}-${secret}`),
 *                 status 1 = credit, 2 = reversal.
 *  • hmacq      — generic HMAC-SHA256 over the sorted query string (minus `sig`);
 *                 the Tapjoy-style family used by most modern offerwalls.
 *  • hmacurl    — HMAC over the full callback URL minus the signature param
 *                 (BitLabs-style; hash algo + param name configurable per network,
 *                 used for AdMob SSV with sha256).
 *  • pangle_ssv — rewarded-video server-side verification as in the spec:
 *                 sign = sha256(appSecurityKey:transId) → respond {"isValid": true}.
 *  • unsigned   — no signature: a static shared token (query param or bearer) plus
 *                 a mandatory IP allowlist. Weakest dialect — only for networks
 *                 that offer no signing; see docs/networks.md.
 *
 * Adding a network = one object here + an entry in the catalog
 * (modules/networks/catalog.ts); rows land in `networks` via syncNetworkCatalog.
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

export type NetworkRow = typeof networks.$inferSelect;

export interface NetworkAdapter {
  id: string;
  verify(req: PostbackRequest, secret: string, network?: NetworkRow): boolean;
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

/** First present, non-empty parameter among `keys` (throws when none is present). */
function firstOf(q: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = q[k];
    if (v !== undefined && v !== '') return v;
  }
  throw badRequest('MALFORMED', `Missing parameter (expected one of: ${keys.join(', ')})`);
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
      // Raw ref: a user UUID for click-tracked offers, or an opaque wall-session
      // token for wall networks — processParsed resolves either.
      userRef: q.user_id ?? null,
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
      userRef: q.uid ?? null,
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

/* ── md5 offerwall family (AdGate Media & friends) ─────────────────────────── */

const md5wall: NetworkAdapter = {
  id: 'md5wall',
  verify(req, secret) {
    const q = req.query;
    const reward = q.reward ?? q.payout ?? q.amount ?? '';
    const expected = md5(`${q.subId ?? ''}${q.transId ?? ''}${reward}${secret}`);
    return safeEqual((q.signature ?? '').toLowerCase(), expected);
  },
  parse(req) {
    const q = req.query;
    return {
      networkTxnId: firstOf(q, ['transId', 'trans_id', 'transaction_id']),
      clickId: asUuid(q.click_id ?? q.subId2),
      userRef: q.subId ?? null,
      networkOfferId: q.campaign_id ?? null,
      payoutMicros: Math.abs(decimalToMicros(firstOf(q, ['payout', 'reward', 'amount']))),
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

/* ── CPX Research ──────────────────────────────────────────────────────────── */

const cpx: NetworkAdapter = {
  id: 'cpx',
  verify(req, secret) {
    const q = req.query;
    const expected = md5(`${q.trans_id ?? ''}-${q.user_id ?? ''}-${q.amount ?? ''}-${secret}`);
    return safeEqual((q.hash ?? '').toLowerCase(), expected);
  },
  parse(req) {
    const q = req.query;
    return {
      networkTxnId: required(q, 'trans_id'),
      clickId: asUuid(q.click_id),
      userRef: q.user_id ?? null,
      networkOfferId: q.offer_id ?? null,
      payoutMicros: Math.abs(decimalToMicros(required(q, 'amount'))),
      status: q.status === '2' ? 'reversal' : 'credit',
      title: q.survey_name ? `CPX survey (${q.survey_name})` : 'CPX Research survey',
    };
  },
  respond(outcome) {
    return outcome === 'error'
      ? { status: 500, body: '0' }
      : { status: outcome === 'invalid' ? 403 : 200, body: outcome === 'invalid' ? '0' : '1' };
  },
};

/* ── generic HMAC-SHA256 over sorted query (Tapjoy-style) ──────────────────── */

export function hmacqCanonical(params: Record<string, string>, sigParam = 'sig'): string {
  return Object.keys(params)
    .filter((k) => k !== sigParam)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
}

/** Parse a `ts` param that may be seconds or milliseconds into unix seconds. */
function tsSeconds(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n < 1e12 ? n : Math.round(n / 1000);
}

const hmacq: NetworkAdapter = {
  id: 'hmacq',
  freshnessSeconds: 600,
  verify(req, secret) {
    const sig = req.query.sig ?? req.query.signature ?? '';
    return safeEqual(sig.toLowerCase(), hmacHex('sha256', secret, hmacqCanonical(req.query)).toLowerCase());
  },
  parse(req) {
    const q = req.query;
    return {
      networkTxnId: firstOf(q, ['txn_id', 'trans_id', 'transId', 'transaction_id']),
      clickId: asUuid(q.click_id ?? q.clickId ?? q.sub_id2),
      userRef: q.user_id ?? q.userId ?? q.subId ?? null,
      networkOfferId: q.offer_id ?? q.campaign_id ?? null,
      payoutMicros: Math.abs(decimalToMicros(firstOf(q, ['payout', 'amount', 'reward']))),
      status: q.status === '2' ? 'reversal' : 'credit',
      timestamp: tsSeconds(q.ts ?? q.timestamp),
      title: q.offer_name ? decodeURIComponent(q.offer_name) : 'Partner task',
    };
  },
  respond(outcome) {
    return outcome === 'error'
      ? { status: 500, body: '0' }
      : { status: outcome === 'invalid' ? 403 : 200, body: outcome === 'invalid' ? '0' : '1' };
  },
};

/* ── HMAC over the full callback URL (BitLabs-style; AdMob SSV) ────────────── */

const hmacurl: NetworkAdapter = {
  id: 'hmacurl',
  verify(req, secret, network) {
    const cfg = (network?.config ?? {}) as Record<string, unknown>;
    const sigParam = String(cfg.sigParam ?? 'signature');
    const algo: 'sha1' | 'sha256' = cfg.hashAlgo === 'sha1' ? 'sha1' : 'sha256';
    const given = req.query[sigParam] ?? '';
    if (!given) return false;
    // Remove the signature parameter (and its separator) from the URL, then HMAC the rest.
    const ampMarker = `&${sigParam}=`;
    const qMarker = `?${sigParam}=`;
    let base = req.fullUrl;
    const ampIdx = base.lastIndexOf(ampMarker);
    const qIdx = base.indexOf(qMarker);
    if (ampIdx !== -1) {
      const rest = base.slice(ampIdx + ampMarker.length);
      const amp = rest.indexOf('&');
      base = base.slice(0, ampIdx) + (amp === -1 ? '' : rest.slice(amp));
    } else if (qIdx !== -1) {
      const rest = base.slice(qIdx + qMarker.length);
      const amp = rest.indexOf('&');
      base = base.slice(0, qIdx) + (amp === -1 ? '' : rest.slice(amp));
    } else {
      return false;
    }
    return safeEqual(given.toLowerCase(), hmacHex(algo, secret, base).toLowerCase());
  },
  parse(req) {
    const q = req.query;
    return {
      networkTxnId: firstOf(q, ['transaction_id', 'trans_id', 'txn_id', 'tx']),
      clickId: asUuid(q.click_id ?? q.custom_data),
      userRef: q.user_id ?? q.uid ?? null,
      networkOfferId: q.reward_name ?? q.offer_id ?? null,
      payoutMicros: Math.abs(decimalToMicros(firstOf(q, ['reward_amount', 'reward', 'payout', 'amount']))),
      status: 'credit',
      title: q.reward_type ? `Rewarded video (${q.reward_type})` : 'Rewarded video',
    };
  },
  respond(outcome) {
    if (outcome === 'error') return { status: 500, body: 'RETRY' };
    if (outcome === 'invalid') return { status: 403, body: 'INVALID' };
    return { status: 200, body: '' };
  },
};

/* ── unsigned: static token + IP allowlist only (weakest dialect) ──────────── */

const unsigned: NetworkAdapter = {
  id: 'unsigned',
  verify(req, secret) {
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
    const token = req.query.token ?? req.query.secret ?? bearer;
    if (!token) return false;
    return safeEqual(token, secret);
  },
  parse(req) {
    const q = req.query;
    return {
      networkTxnId: firstOf(q, ['transId', 'trans_id', 'txn_id', 'tx']),
      clickId: asUuid(q.click_id ?? q.subId2),
      userRef: q.subId ?? q.sub_id ?? q.user_id ?? null,
      networkOfferId: q.campaign_id ?? q.offer_id ?? null,
      payoutMicros: Math.abs(decimalToMicros(firstOf(q, ['reward', 'payout', 'amount']))),
      status: q.status === '2' ? 'reversal' : 'credit',
      title: q.offerName ? decodeURIComponent(q.offerName) : 'Partner task',
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
      userRef: required(q, 'user_id'),
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
  cpx,
  hmacq,
  hmacurl,
  pangle_ssv: pangleSsv,
  unsigned,
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
