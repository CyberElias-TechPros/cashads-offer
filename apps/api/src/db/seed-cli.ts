import type { FastifyBaseLogger } from 'fastify';
import { loadConfig } from '../config';
import { guardDb, type AppContext } from '../context';
import { Vault } from '../lib/crypto';
import { EventBus } from '../lib/events';
import { SettingsStore } from '../modules/settings/store';
import { createDb, runMigrations } from './client';
import { DEMO_ACCOUNTS, seed } from './seed';

const config = loadConfig();
const handle = await createDb({ databaseUrl: config.DATABASE_URL, dataDir: config.DATA_DIR });
await runMigrations(handle);
const ctx: AppContext = {
  db: guardDb(handle.db),
  driver: handle.driver,
  config,
  bus: new EventBus(),
  vault: new Vault(config.appSecret),
  log: console as unknown as FastifyBaseLogger,
  settings: new SettingsStore(handle.db),
};
await ctx.settings.load();
const t = Date.now();
await seed(ctx);
console.log(`✔ Seeded in ${((Date.now() - t) / 1000).toFixed(1)}s`);
console.table(DEMO_ACCOUNTS);
await handle.close();
