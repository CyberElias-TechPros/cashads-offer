import type { WorkerRuntime } from './runtime';

/**
 * Durable, bounded job storage used by both Cron and an eventual Queue
 * consumer. Keeping jobs in D1 makes retries explicit and avoids relying on
 * isolate memory.
 */
export async function enqueue(runtime: WorkerRuntime, kind: string, payload: unknown): Promise<string> {
  const id = crypto.randomUUID();
  await runtime.db
    .prepare(
      `INSERT INTO worker_jobs (id, kind, payload, status, attempts, run_after, created_at)
       VALUES (?, ?, ?, 'pending', 0, datetime('now'), datetime('now'))`,
    )
    .bind(id, kind, JSON.stringify(payload))
    .run();
  return id;
}

export async function claimBatch(
  runtime: WorkerRuntime,
  limit = 25,
): Promise<Array<{ id: string; kind: string; payload: string }>> {
  const rows = await runtime.db
    .prepare(
      `SELECT id, kind, payload FROM worker_jobs
       WHERE status = 'pending' AND run_after <= datetime('now')
       ORDER BY created_at LIMIT ?`,
    )
    .bind(limit)
    .all<{ id: string; kind: string; payload: string }>();
  for (const row of rows.results) {
    await runtime.db
      .prepare(
        `UPDATE worker_jobs SET status = 'running', attempts = attempts + 1 WHERE id = ? AND status = 'pending'`,
      )
      .bind(row.id)
      .run();
  }
  return rows.results;
}

export async function complete(runtime: WorkerRuntime, id: string): Promise<void> {
  await runtime.db
    .prepare(`UPDATE worker_jobs SET status = 'complete', completed_at = datetime('now') WHERE id = ?`)
    .bind(id)
    .run();
}

export async function retry(runtime: WorkerRuntime, id: string, message: string): Promise<void> {
  await runtime.db
    .prepare(
      `UPDATE worker_jobs SET status = 'pending', last_error = ?, run_after = datetime('now', '+5 minutes') WHERE id = ?`,
    )
    .bind(message.slice(0, 1000), id)
    .run();
}
