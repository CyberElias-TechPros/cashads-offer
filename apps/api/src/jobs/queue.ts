import { sql } from 'drizzle-orm';
import type { AppContext } from '../context';
import { rowsOf, type Q } from '../db/client';
import { jobs } from '../db/schema';
import { clock } from '../lib/clock';

export interface JobRow {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

export type JobHandler = (ctx: AppContext, payload: Record<string, unknown>, job: JobRow) => Promise<void>;

/** Error type that tells the worker not to retry. */
export class PermanentJobError extends Error {}

export interface EnqueueOptions {
  runAt?: Date;
  delayMs?: number;
  dedupeKey?: string;
  maxAttempts?: number;
}

/**
 * Transactional job enqueue (outbox pattern): pass the open transaction so the
 * job is committed atomically with the business change that caused it.
 */
export async function enqueue(q: Q, type: string, payload: Record<string, unknown> = {}, opts: EnqueueOptions = {}): Promise<void> {
  const runAt = opts.runAt ?? new Date(clock.ms() + (opts.delayMs ?? 0));
  await q
    .insert(jobs)
    .values({ type, payload, runAt, dedupeKey: opts.dedupeKey ?? null, maxAttempts: opts.maxAttempts ?? 8 })
    .onConflictDoNothing({ target: jobs.dedupeKey });
}

function backoffMs(attempt: number): number {
  // 5s, 20s, 1m20s, 5m, 20m, ~1h20m … capped at 6h, with jitter
  const base = Math.min(5_000 * 4 ** (attempt - 1), 6 * 60 * 60 * 1000);
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

/**
 * Postgres-backed worker using FOR UPDATE SKIP LOCKED — safe to run on many
 * instances at once, survives restarts, needs no Redis.
 */
export class Worker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly ctx: AppContext,
    private readonly handlers: Record<string, JobHandler>,
    private readonly opts: { pollMs?: number; batch?: number } = {},
  ) {}

  start() {
    this.stopped = false;
    const loop = async () => {
      if (this.stopped) return;
      try {
        const n = await this.tick();
        this.timer = setTimeout(loop, n > 0 ? 50 : (this.opts.pollMs ?? 500));
      } catch (err) {
        this.ctx.log.error({ err }, 'worker tick failed');
        this.timer = setTimeout(loop, 2_000);
      }
    };
    this.timer = setTimeout(loop, 250);
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    while (this.running) await new Promise((r) => setTimeout(r, 20));
  }

  /** Claim and run due jobs once. Returns the number processed. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const now = clock.now();
      const staleBefore = new Date(now.getTime() - 5 * 60_000);
      // Recover jobs from crashed workers.
      await this.ctx.db.execute(
        sql`UPDATE jobs SET status = 'queued', locked_at = NULL WHERE status = 'running' AND locked_at < ${staleBefore}`,
      );
      const claimed = rowsOf<JobRow>(
        await this.ctx.db.execute(sql`
          UPDATE jobs SET status = 'running', locked_at = ${now}, attempts = attempts + 1, updated_at = ${now}
          WHERE id IN (
            SELECT id FROM jobs WHERE status = 'queued' AND run_at <= ${now}
            ORDER BY run_at ASC LIMIT ${this.opts.batch ?? 10}
            FOR UPDATE SKIP LOCKED
          )
          RETURNING id, type, payload, attempts, max_attempts
        `),
      );
      for (const job of claimed) await this.run(job);
      return claimed.length;
    } finally {
      this.running = false;
    }
  }

  private async run(job: JobRow) {
    const handler = this.handlers[job.type];
    const now = clock.now();
    if (!handler) {
      await this.ctx.db.execute(sql`UPDATE jobs SET status = 'dead', last_error = ${'No handler for ' + job.type}, updated_at = ${now} WHERE id = ${job.id}`);
      return;
    }
    try {
      await handler(this.ctx, job.payload ?? {}, job);
      await this.ctx.db.execute(sql`UPDATE jobs SET status = 'done', locked_at = NULL, last_error = NULL, updated_at = ${clock.now()} WHERE id = ${job.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const permanent = err instanceof PermanentJobError;
      if (permanent || job.attempts >= job.max_attempts) {
        this.ctx.log.error({ err, jobId: job.id, type: job.type }, 'job dead');
        await this.ctx.db.execute(sql`UPDATE jobs SET status = 'dead', locked_at = NULL, last_error = ${message}, updated_at = ${clock.now()} WHERE id = ${job.id}`);
      } else {
        const runAt = new Date(clock.ms() + backoffMs(job.attempts));
        this.ctx.log.warn({ jobId: job.id, type: job.type, attempt: job.attempts, message }, 'job failed, retrying');
        await this.ctx.db.execute(
          sql`UPDATE jobs SET status = 'queued', locked_at = NULL, last_error = ${message}, run_at = ${runAt}, updated_at = ${clock.now()} WHERE id = ${job.id}`,
        );
      }
    }
  }

  /** Test helper: run until no due jobs remain. */
  async drain(maxRounds = 50): Promise<number> {
    let total = 0;
    for (let i = 0; i < maxRounds; i++) {
      const n = await this.tick();
      total += n;
      if (n === 0) break;
    }
    return total;
  }
}
