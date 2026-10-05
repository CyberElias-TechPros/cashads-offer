import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';

/* ── tokens & hashing ──────────────────────────────────────────────────────── */

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function md5(input: string): string {
  return createHash('md5').update(input).digest('hex');
}

export function hmacHex(algo: 'sha1' | 'sha256' | 'sha512', secret: string, data: string): string {
  return createHmac(algo, secret).update(data).digest('hex');
}

/** Constant-time string comparison (prevents timing attacks on signatures). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/* ── passwords: argon2id with OWASP-recommended minimum parameters ─────────── */

const ARGON_OPTS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON_OPTS);
}

export async function verifyPassword(hash: string | null | undefined, password: string): Promise<boolean> {
  if (!hash) {
    // Burn comparable time so missing accounts aren't distinguishable by latency.
    await argonHash(password, ARGON_OPTS);
    return false;
  }
  try {
    return await argonVerify(hash, password);
  } catch {
    return false;
  }
}

/* ── human-friendly codes ──────────────────────────────────────────────────── */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export function referralCode(length = 8): string {
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

export function numericCode(digits = 6): string {
  return String(randomInt(0, 10 ** digits)).padStart(digits, '0');
}

/* ── field-level encryption for PII at rest (AES-256-GCM) ──────────────────── */

let encryptionKey: Buffer | null = null;

export function configureEncryption(rawKey: string | undefined, allowDevKey: boolean): void {
  if (rawKey) {
    const key = /^[0-9a-f]{64}$/i.test(rawKey) ? Buffer.from(rawKey, 'hex') : Buffer.from(rawKey, 'base64');
    if (key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)');
    encryptionKey = key;
    return;
  }
  if (!allowDevKey) throw new Error('DATA_ENCRYPTION_KEY is required');
  // Deterministic, clearly-non-production key for local development and tests.
  encryptionKey = scryptSync('cashads-development-only-key', 'cashads-dev-salt', 32);
}

function key(): Buffer {
  if (!encryptionKey) configureEncryption(undefined, true);
  return encryptionKey!;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${Buffer.concat([iv, tag, ct]).toString('base64url')}`;
}

export function decrypt(payload: string): string {
  if (!payload.startsWith('v1.')) throw new Error('Unknown ciphertext version');
  const buf = Buffer.from(payload.slice(3), 'base64url');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Keyed hash for equality lookups on encrypted values (phone numbers, payout details). */
export function blindIndex(value: string): string {
  return createHmac('sha256', key()).update(value.trim().toLowerCase()).digest('hex');
}
