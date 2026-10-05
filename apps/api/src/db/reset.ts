import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config';

/** Deletes the embedded database + uploads. The next `npm run dev` re-migrates and re-seeds. */
const config = loadConfig();
if (config.DATABASE_URL) {
  console.error('DATABASE_URL is set — refusing to wipe an external Postgres. Drop the database manually.');
  process.exit(1);
}
for (const dir of ['pglite', 'uploads']) {
  const p = path.resolve(config.DATA_DIR, dir);
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
    console.log(`✔ removed ${p}`);
  }
}
console.log('Done. Start the API to re-create and re-seed the database.');
