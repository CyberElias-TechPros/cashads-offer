import { rm } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import { createDatabase } from '../db/client';
import { configureEncryption } from '../lib/crypto';
import { ensureEncryptionKeyMatches } from '../modules/platform/keycheck';
import { ensureSystemData, seedDemo } from './index';

/** `npm run db:seed` — seed demo data · `npm run db:reset` — wipe local data and reseed. */
const reset = process.argv.includes('--reset');
const config = loadConfig({ WORKER_ENABLED: 'false', LOG_LEVEL: 'warn' });
configureEncryption(config.DATA_ENCRYPTION_KEY, !config.isProd);

if (reset) {
  if (config.isProd) throw new Error('Refusing to reset a production database');
  if (config.DATABASE_URL) {
    const tmp = await createDatabase({ url: config.DATABASE_URL });
    await tmp.db.execute(
      sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`,
    );
    await tmp.close();
  } else {
    await rm(path.resolve(config.PGLITE_DIR), { recursive: true, force: true });
  }
  console.log('Local database wiped.');
}

const database = await createDatabase({ url: config.DATABASE_URL, pgliteDir: config.PGLITE_DIR });
await database.migrate();
await ensureEncryptionKeyMatches(database.db);
const { app, ctx } = await buildApp(config, database);
await ensureSystemData(ctx);
await ctx.settings.load(ctx.db);
const created = await seedDemo(ctx);
console.log(created ? 'Demo data seeded.' : 'Demo data already present — nothing to do.');
await app.close();
await database.close();
