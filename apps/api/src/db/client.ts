import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema';

/**
 * One database interface, two engines:
 *  - Production / CI: real PostgreSQL via node-postgres (DATABASE_URL).
 *  - Local dev / tests / demos: PGlite — real Postgres compiled to WASM, in-process,
 *    zero setup. Same SQL, same migrations, same constraints.
 */
export type DB = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export type DbOrTx = DB | Tx;

export interface Database {
  db: DB;
  engine: 'postgres' | 'pglite';
  migrate(): Promise<void>;
  close(): Promise<void>;
}

/** Resolves `apps/api/drizzle` from both `src/db` (tsx) and `dist` (bundled build). */
function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../../drizzle'),
    path.resolve(here, '../drizzle'),
    path.resolve('drizzle'),
  ];
  return candidates.find((p) => existsSync(path.join(p, 'meta', '_journal.json'))) ?? candidates[0]!;
}

export async function createDatabase(opts: {
  url?: string;
  pgliteDir?: string;
  inMemory?: boolean;
}): Promise<Database> {
  const folder = migrationsFolder();
  if (opts.url) {
    const pool = new pg.Pool({ connectionString: opts.url, max: 10 });
    const db = drizzlePg(pool, { schema });
    return {
      db,
      engine: 'postgres',
      migrate: () => migratePg(db, { migrationsFolder: folder }),
      close: () => pool.end(),
    };
  }
  let client: PGlite;
  if (opts.inMemory) {
    client = new PGlite();
  } else {
    const dir = path.resolve(opts.pgliteDir ?? '.data/pglite');
    mkdirSync(dir, { recursive: true });
    client = new PGlite(dir);
  }
  await client.waitReady;
  // PGlite and node-postgres drizzle instances share the same PgDatabase surface.
  const db = drizzlePglite(client, { schema }) as unknown as DB;
  return {
    db,
    engine: 'pglite',
    migrate: () => migratePglite(db as never, { migrationsFolder: folder }),
    close: () => client.close(),
  };
}

export { schema };
