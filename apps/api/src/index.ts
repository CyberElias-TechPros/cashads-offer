import { sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { buildApp } from './app';
import { loadConfig } from './config';
import { guardDb, type AppContext } from './context';
import { createDb, rowsOf, runMigrations } from './db/client';
import { seed } from './db/seed';
import { jobHandlers, startScheduler } from './jobs/handlers';
import { Worker } from './jobs/queue';
import { Vault } from './lib/crypto';
import { EventBus } from './lib/events';
import { SettingsStore } from './modules/settings/store';

async function main() {
  const config = loadConfig();
  const handle = await createDb({ databaseUrl: config.DATABASE_URL, dataDir: config.DATA_DIR });
  await runMigrations(handle);

  const bootLog = console as unknown as FastifyBaseLogger;
  const ctx: AppContext = {
    db: guardDb(handle.db),
    driver: handle.driver,
    config,
    bus: new EventBus(),
    vault: new Vault(config.appSecret),
    log: bootLog,
    settings: new SettingsStore(handle.db),
  };
  await ctx.settings.load();

  const pretty = config.NODE_ENV !== 'production';
  const app = await buildApp(ctx, {
    logger: {
      level: config.LOG_LEVEL,
      ...(pretty ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname,reqId', singleLine: true } } } : {}),
    },
  });
  ctx.log = app.log;

  const [{ n }] = rowsOf<{ n: number }>(await handle.db.execute(sql`select count(*)::int as n from users`));
  if (Number(n) === 0 && config.SEED_ON_START) {
    app.log.info('Empty database — seeding demo data (first run only)…');
    const started = Date.now();
    await seed(ctx);
    app.log.info(`Seed complete in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }

  const worker = new Worker(ctx, jobHandlers());
  let stopScheduler = () => {};
  if (config.WORKER_ENABLED) {
    worker.start();
    stopScheduler = startScheduler(ctx);
  }

  await app.listen({ host: config.API_HOST, port: config.API_PORT });
  app.log.info(`CashAds API ready on http://${config.API_HOST}:${config.API_PORT} (db: ${handle.driver}, demo: ${config.DEMO_MODE})`);

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received — shutting down gracefully`);
    stopScheduler();
    await worker.stop();
    await app.close();
    await handle.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
