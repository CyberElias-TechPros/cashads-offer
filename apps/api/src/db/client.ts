import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export type Schema = typeof schema;
export type DB = PgDatabase<PgQueryResultHKT, Schema>;
export type Tx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
/** Anything that can run queries — the root db or an open transaction. */
export type Q = DB | Tx;

export interface DbHandle {
  db: DB;
  driver: 'pglite' | 'postgres';
  close: () => Promise<void>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
/** drizzle/ lives next to src/ in dev and next to dist/ when bundled. */
export function migrationsFolder(): string {
  const candidates = [path.resolve(here, '../../drizzle'), path.resolve(here, '../drizzle'), path.resolve(process.cwd(), 'drizzle')];
  const found = candidates.find((p) => fs.existsSync(path.join(p, 'meta', '_journal.json')));
  if (!found) throw new Error(`Could not locate migrations folder (looked in: ${candidates.join(', ')})`);
  return found;
}

/**
 * Create a database handle.
 * - DATABASE_URL set → node-postgres pool (production / docker-compose).
 * - otherwise → embedded PGlite (real Postgres compiled to WASM): persistent under dataDir,
 *   or fully in-memory when dataDir === ':memory:' (tests).
 */
export async function createDb(opts: { databaseUrl?: string; dataDir: string }): Promise<DbHandle> {
  if (opts.databaseUrl) {
    const pg = (await import('pg')).default;
    const { drizzle } = await import('drizzle-orm/node-postgres');
    // BIGINT (int8) → JS number. Safe: all our bigint columns are micros/counters well below 2^53.
    pg.types.setTypeParser(20, (v: string) => Number(v));
    const pool = new pg.Pool({ connectionString: opts.databaseUrl, max: 10 });
    const db = drizzle(pool, { schema }) as unknown as DB;
    return { db, driver: 'postgres', close: () => pool.end() };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  let client: InstanceType<typeof PGlite>;
  if (opts.dataDir === ':memory:') {
    client = new PGlite();
  } else {
    const dir = path.resolve(opts.dataDir, 'pglite');
    fs.mkdirSync(dir, { recursive: true });
    client = new PGlite(dir);
  }
  await client.waitReady;
  const db = drizzle(client, { schema }) as unknown as DB;
  return { db, driver: 'pglite', close: () => client.close() };
}

export async function runMigrations(handle: DbHandle): Promise<void> {
  const folder = migrationsFolder();
  if (handle.driver === 'postgres') {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    await migrate(handle.db as never, { migrationsFolder: folder });
  } else {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    await migrate(handle.db as never, { migrationsFolder: folder });
  }
}

/** Normalise `db.execute()` results across drivers. */
export function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const r = result as { rows?: T[] };
  return r?.rows ?? [];
}
