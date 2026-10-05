import { hmac, md5, safeEqual, sha256 } from '../../lib/crypto';
import type { networks } from '../../db/schema';

type NetworkRow = typeof networks.$inferSelect;

export interface CanonicalPostback {
  txId: string;
  kind: 'credit' | 'reversal';
  clickId?: string;
  userId?: string;
  offerExternalId?: string;
  goalId?: string;
  payoutMicros?: number;
  offerName?: string;
}

/** Canonical string for HMAC: sorted `key=value` pairs (RFC 3986 encoded), excluding the signature param. */
export function canonicalQuery(params: Record<string, string>, exclude: string[]): string {
  return Object.keys(params)
    .filter((k) => !exclude.includes(k))
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');
}

/** Used by the sandbox network (and by partners integrating with our default scheme). */
export function signHmacSorted(params: Record<string, string>, secret: string, sigParam = 'sig'): string {
  return hmac('sha256', secret, canonicalQuery(params, [sigParam]));
}

/**
 * Verify a postback against the network's configured scheme.
 *  - hmac_sha256_sorted : HMAC-SHA256(secret, sorted canonical query) — our default
 *  - md5_txid_secret    : md5("{txId}-{secret}")            — CPX-Research style
 *  - hmac_sha1_url      : HMAC-SHA1(secret, full URL w/o hash) — BitLabs style
 *  - sha256_secret_txid : sha256("{secret}:{txId}")          — rewarded-video SSV style (e.g. Pangle)
 *  - ip_only            : no signature; requires a non-empty IP allowlist
 * Exact formats differ per partner — always confirm against the partner's docs.
 */
export function verifySignature(
  network: NetworkRow,
  secret: string | null,
  params: Record<string, string>,
  ctx: { fullUrl: string; headers: Record<string, string | string[] | undefined>; ip: string | null },
): boolean {
  const map = network.paramMap;
  const scheme = network.signatureScheme;
  if (scheme === 'ip_only') {
    return network.ipAllowlist.length > 0 && !!ctx.ip && network.ipAllowlist.includes(ctx.ip);
  }
  if (!secret) return false;
  const headerSig = map.signatureHeader ? ctx.headers[map.signatureHeader.toLowerCase()] : undefined;
  const provided = (typeof headerSig === 'string' ? headerSig : undefined) ?? params[map.signature ?? defaultSigParam(scheme)];
  if (!provided) return false;
  const txId = params[map.txId] ?? '';
  switch (scheme) {
    case 'hmac_sha256_sorted':
      return safeEqual(signHmacSorted(params, secret, map.signature ?? 'sig'), provided.toLowerCase());
    case 'md5_txid_secret':
      return safeEqual(md5(`${txId}-${secret}`), provided.toLowerCase());
    case 'sha256_secret_txid':
      return safeEqual(sha256(`${secret}:${txId}`), provided.toLowerCase());
    case 'hmac_sha1_url': {
      const sigParam = map.signature ?? 'hash';
      const url = ctx.fullUrl.replace(new RegExp(`[?&]${sigParam}=[^&]*$`), '').replace(new RegExp(`([?&])${sigParam}=[^&]*&`), '$1');
      return safeEqual(hmac('sha1', secret, url), provided.toLowerCase());
    }
    default:
      return false;
  }
}

function defaultSigParam(scheme: NetworkRow['signatureScheme']): string {
  if (scheme === 'md5_txid_secret' || scheme === 'hmac_sha1_url') return 'hash';
  if (scheme === 'sha256_secret_txid') return 'sign';
  return 'sig';
}

export function parsePayout(raw: string | undefined, unit: 'usd' | 'cents' | 'micros' = 'usd'): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  if (unit === 'micros') return Math.round(n);
  if (unit === 'cents') return Math.round(n * 10_000);
  return Math.round(n * 1_000_000);
}

export function toCanonical(network: NetworkRow, params: Record<string, string>): CanonicalPostback | { error: string } {
  const map = network.paramMap;
  const txId = params[map.txId]?.trim();
  if (!txId) return { error: `missing ${map.txId}` };
  if (txId.length > 200) return { error: 'transaction id too long' };
  const payout = parsePayout(map.payout ? params[map.payout] : undefined, map.payoutUnit);
  let kind: 'credit' | 'reversal' = 'credit';
  if (map.status && params[map.status] !== undefined) {
    const mapped = map.statusValues?.[params[map.status]];
    if (mapped) kind = mapped;
    else if (/^(reversal|reversed|chargeback|rejected|2|-1)$/i.test(params[map.status])) kind = 'reversal';
  }
  if (payout !== undefined && payout < 0) kind = 'reversal';
  return {
    txId,
    kind,
    clickId: map.clickId ? params[map.clickId]?.trim() || undefined : undefined,
    userId: map.userId ? params[map.userId]?.trim() || undefined : undefined,
    offerExternalId: map.offerId ? params[map.offerId]?.trim() || undefined : undefined,
    goalId: map.goalId ? params[map.goalId]?.trim() || undefined : undefined,
    payoutMicros: payout !== undefined ? Math.abs(payout) : undefined,
    offerName: params.offer_name ?? params.offerName ?? undefined,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: string | undefined | null): v is string {
  return !!v && UUID_RE.test(v);
}
