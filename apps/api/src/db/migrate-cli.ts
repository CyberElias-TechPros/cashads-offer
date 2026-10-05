import { loadConfig } from '../config';
import { createDatabase } from './client';

const config = loadConfig();
const db = await createDatabase({ url: config.DATABASE_URL, pgliteDir: config.PGLITE_DIR });
await db.migrate();
console.log(`Migrations applied (${db.engine}).`);
await db.close();
