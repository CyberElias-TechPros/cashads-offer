export interface WorkerRuntime {
  db: D1Database;
  storage: R2Bucket;
  now(): string;
}

export function runtime(env: { DB: D1Database; UPLOADS: R2Bucket }): WorkerRuntime {
  return { db: env.DB, storage: env.UPLOADS, now: () => new Date().toISOString() };
}

export async function one<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  return (
    (await db
      .prepare(sql)
      .bind(...params)
      .first<T>()) ?? null
  );
}

export async function many<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const result = await db
    .prepare(sql)
    .bind(...params)
    .all<T>();
  return result.results;
}

export async function execute(db: D1Database, sql: string, ...params: unknown[]): Promise<D1Result> {
  return db
    .prepare(sql)
    .bind(...params)
    .run();
}
