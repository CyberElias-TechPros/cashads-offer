import { sql } from 'drizzle-orm';
import type { AppContext } from '../context';
import type { DbOrTx } from '../db/client';
import { jobs } from '../db/schema';

/**
 * Postgres-backed job queue (transactional outbox).
 *
 * - Jobs enqueued inside a business transaction commit atomically with it, so a
 *   credited conversion can never "forget" its notification/referral side effects.
 * - Workers claim jobs with `FOR UPDATE SKIP LOCKED`, so many workers can run safely.
 * - Failed jobs retry with exponential backoff, then park as `failed` for admins.
 */

export type JobRow = typeof jobs.$inferSelect;
export type JobHandler = (ctx: AppContext, payload: Record<string, unknown>, job: JobRow) => Promise<void>;

export class RetryLater extends Error {
  constructor(
    public readonly delayMs: number,
    message = 'retry later',
  ) {
    super(message);
  }
}

export interface EnqueueOptions {
  runAt?: Date;
  delayMs?: number;
  dedupeKey?: string;
  maxAttempts?: number;
}

export class JobQueue {
  private handlers = new Map<string, JobHandler>();
  private timer: NodeJS.Timeout | null = null;
  private running = 0;
  private stopping = false;
  private wake: (() => void) | null = null;

  register(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  registeredTypes(): string[] {
    return [...this.handlers.keys()];
  }

  async enqueue(
    db: DbOrTx,
    type: string,
    payload: Record<string, unknown> = {},
    opts: EnqueueOptions = {},
  ): Promise<void> {
    const runAt = opts.runAt ?? new Date(Date.now() + (opts.delayMs ?? 0));
    await db
      .insert(jobs)
      .values({ type, payload, runAt, maxAttempts: opts.maxAttempts ?? 5, dedupeKey: opts.dedupeKey ?? null })
      .onConflictDoNothing();
    this.wake?.();
  }

  private async claimNext(ctx: AppContext, now: Date): Promise<JobRow | null> {
    const res = await ctx.db.execute<Record<string, unknown>>(sql`
      update jobs set status = 'running', locked_at = now(), attempts = attempts + 1
      where id = (
        select id from jobs
        where status = 'queued' and run_at <= ${now}
        order by run_at, id
        limit 1
        for update skip locked
      )
      returning *`);
    const row = res.rows[0];
    if (!row) return null;
    return {
      id: Number(row.id),
      type: String(row.type),
      payload: (row.payload ?? {}) as Record<string, unknown>,
      status: 'running',
      runAt: new Date(row.run_at as string),
      attempts: Number(row.attempts),
      maxAttempts: Number(row.max_attempts),
      lastError: (row.last_error as string) ?? null,
      dedupeKey: (row.dedupe_key as string) ?? null,
      lockedAt: new Date(),
      completedAt: null,
      createdAt: new Date(row.created_at as string),
    };
  }

  private async execute(ctx: AppContext, job: JobRow): Promise<void> {
    const handler = this.handlers.get(job.type);
    try {
      if (!handler) throw new Error(`No handler for job type ${job.type}`);
      await handler(ctx, job.payload, job);
      await ctx.db.execute(
        sql`update jobs set status = 'done', completed_at = now(), last_error = null where id = ${job.id}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const explicit = err instanceof RetryLater ? err.delayMs : null;
      if (job.attempts < job.maxAttempts || explicit !== null) {
        const delay = explicit ?? Math.min(2 ** job.attempts * 5_000, 3_600_000);
        await ctx.db.execute(
          sql`update jobs set status = 'queued', run_at = ${new Date(Date.now() + delay)}, last_error = ${message.slice(0, 2000)} where id = ${job.id}`,
        );
        if (!(err instanceof RetryLater))
          ctx.log.warn({ jobId: job.id, type: job.type, err: message }, 'job failed — will retry');
      } else {
        await ctx.db.execute(
          sql`update jobs set status = 'failed', last_error = ${message.slice(0, 2000)} where id = ${job.id}`,
        );
        ctx.log.error({ jobId: job.id, type: job.type, err: message }, 'job failed permanently');
      }
    }
  }

  /** Process all currently-due jobs (deterministic; used by tests and the worker loop). */
  async runDue(ctx: AppContext, opts: { max?: number; now?: Date } = {}): Promise<number> {
    let processed = 0;
    const max = opts.max ?? 500;
    while (processed < max) {
      const job = await this.claimNext(ctx, opts.now ?? new Date());
      if (!job) break;
      await this.execute(ctx, job);
      processed++;
    }
    return processed;
  }

  /** Requeue jobs left `running` by a crashed worker. */
  async recoverStuck(ctx: AppContext): Promise<void> {
    await ctx.db.execute(
      sql`update jobs set status = 'queued' where status = 'running' and locked_at < now() - interval '5 minutes'`,
    );
  }

  start(ctx: AppContext, pollMs = 250): void {
    this.stopping = false;
    const loop = async () => {
      if (this.stopping) return;
      this.running++;
      try {
        await this.runDue(ctx, { max: 50 });
      } catch (err) {
        ctx.log.error({ err }, 'job loop error');
      } finally {
        this.running--;
      }
      if (this.stopping) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
        this.timer = setTimeout(resolve, pollMs);
      });
      this.wake = null;
      void loop();
    };
    void this.recoverStuck(ctx).finally(() => void loop());
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.wake?.();
    const started = Date.now();
    while (this.running > 0 && Date.now() - started < 10_000) await new Promise((r) => setTimeout(r, 25));
  }
}
