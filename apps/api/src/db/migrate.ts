import { loadConfig } from '../config';
import { createDb, runMigrations } from './client';

const config = loadConfig();
const handle = await createDb({ databaseUrl: config.DATABASE_URL, dataDir: config.DATA_DIR });
await runMigrations(handle);
console.log(`✔ Migrations applied (${handle.driver})`);
await handle.close();
