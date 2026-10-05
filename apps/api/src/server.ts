import { buildApp } from './app';
import { loadConfig } from './config';
import { createDatabase } from './db/client';
import { startScheduler } from './jobs/handlers';
import { configureEncryption } from './lib/crypto';
import { ensureEncryptionKeyMatches } from './modules/platform/keycheck';
import { ensureSystemData, seedDemo } from './seed';

async function main(): Promise<void> {
  const config = loadConfig();
  configureEncryption(config.DATA_ENCRYPTION_KEY, !config.isProd);
  const database = await createDatabase({ url: config.DATABASE_URL, pgliteDir: config.PGLITE_DIR });
  await database.migrate();
  await ensureEncryptionKeyMatches(database.db);

  const { app, ctx } = await buildApp(config, database);
  await ctx.settings.load(ctx.db);
  await ensureSystemData(ctx);
  await ctx.settings.load(ctx.db);
  if (config.SANDBOX_MODE && config.SEED_DEMO) await seedDemo(ctx);

  let stopScheduler: (() => void) | null = null;
  if (config.WORKER_ENABLED) {
    ctx.jobs.start(ctx);
    stopScheduler = startScheduler(ctx);
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    stopScheduler?.();
    await ctx.jobs.stop();
    await app.close();
    await database.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.HOST, port: config.PORT });
  app.log.info(
    {
      db: database.engine,
      sandbox: config.SANDBOX_MODE,
      worker: config.WORKER_ENABLED,
      docs: config.API_DOCS ? `/api/docs` : 'disabled',
    },
    `CashAds API ready on http://${config.HOST}:${config.PORT}`,
  );
  if (config.SANDBOX_MODE && config.SEED_DEMO) {
    app.log.info(
      `Demo member: ${config.DEMO_EMAIL} / ${config.DEMO_PASSWORD} · Admin: ${config.ADMIN_EMAIL} / ${config.ADMIN_PASSWORD}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
