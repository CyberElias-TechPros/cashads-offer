import { eq } from 'drizzle-orm';
import type { DB } from '../../db/client';
import { settings } from '../../db/schema';
import { decrypt, encrypt } from '../../lib/crypto';

const KEY = 'encryption_canary';
const PLAINTEXT = 'lucrum-encryption-canary-v1';

/**
 * Fail fast if DATA_ENCRYPTION_KEY doesn't match the key that encrypted existing data.
 * Without this, a mistyped or rotated key silently makes payout details, phone numbers,
 * network secrets and TOTP secrets unreadable at runtime.
 */
export async function ensureEncryptionKeyMatches(db: DB): Promise<void> {
  const rows = await db.select().from(settings).where(eq(settings.key, KEY));
  const stored = rows[0]?.value as { ciphertext?: string } | undefined;
  if (!stored?.ciphertext) {
    await db
      .insert(settings)
      .values({ key: KEY, value: { ciphertext: encrypt(PLAINTEXT) } })
      .onConflictDoNothing();
    return;
  }
  let ok = false;
  try {
    ok = decrypt(stored.ciphertext) === PLAINTEXT;
  } catch {
    ok = false;
  }
  if (!ok) {
    throw new Error(
      'DATA_ENCRYPTION_KEY does not match the key used to encrypt this database. Refusing to start: ' +
        'restore the original key (or run a key-rotation migration) before booting.',
    );
  }
}
