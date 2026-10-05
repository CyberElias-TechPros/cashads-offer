import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

/** URL-safe random token (default 32 bytes = 256 bits). */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function md5(input: string): string {
  return crypto.createHash('md5').update(input).digest('hex');
}

export function hmac(algorithm: 'sha256' | 'sha1', secret: string, data: string): string {
  return crypto.createHmac(algorithm, secret).update(data).digest('hex');
}

/** Constant-time string comparison (prevents timing attacks on signatures/tokens). */
export function safeEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still burn comparable time.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

/* ----------------------------------------------------------------- passwords
 * scrypt (memory-hard, built into Node — no native deps). Format:
 *   scrypt$N$r$p$saltB64$hashB64
 */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scryptAsync(password.normalize('NFKC'), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 64 * 1024 * 1024,
  });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) {
    // Equalise timing for unknown users.
    await scryptAsync('x', 'saltsaltsaltsalt', 64, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
    return false;
  }
  const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return crypto.timingSafeEqual(actual, expected);
}

/* -------------------------------------------------------- encryption at rest
 * AES-256-GCM. Used for TOTP secrets, payout destinations and partner secrets.
 * Format: v1.ivB64.tagB64.cipherB64
 */
export class Vault {
  private readonly key: Buffer;
  private readonly macKey: Buffer;

  constructor(secret: string) {
    this.key = Buffer.from(crypto.hkdfSync('sha256', secret, 'cashads-vault', 'aes-256-gcm', 32));
    this.macKey = Buffer.from(crypto.hkdfSync('sha256', secret, 'cashads-vault', 'fingerprint-hmac', 32));
  }

  encrypt(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
  }

  decrypt(payload: string): string {
    const [v, ivB64, tagB64, encB64] = payload.split('.');
    if (v !== 'v1') throw new Error('Unsupported vault payload');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]).toString('utf8');
  }

  /** Keyed, deterministic fingerprint — lets us detect the same PayPal email across accounts without storing it in clear. */
  fingerprint(value: string): string {
    return crypto.createHmac('sha256', this.macKey).update(value.trim().toLowerCase()).digest('hex');
  }
}

/** Human-friendly referral code: 8 chars, no ambiguous characters. */
export function referralCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function numericCode(digits = 6): string {
  const max = 10 ** digits;
  return crypto.randomInt(0, max).toString().padStart(digits, '0');
}
