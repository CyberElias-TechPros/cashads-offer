import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from './config';
import type { DB, Tx } from './db/client';
import type { EventBus } from './lib/events';
import type { Vault } from './lib/crypto';
import type { SettingsStore } from './modules/settings/store';

export interface AppContext {
  db: DB;
  driver: 'pglite' | 'postgres';
  config: Config;
  bus: EventBus;
  vault: Vault;
  log: FastifyBaseLogger;
  settings: SettingsStore;
}

/**
 * A unit of work = one DB transaction + side effects that must only run after
 * it commits (SSE pushes, cache busts). Emails/jobs are written to tables inside
 * the transaction instead (transactional outbox), so they're never lost.
 */
export interface Uow {
  tx: Tx;
  ctx: AppContext;
  afterCommit(fn: () => void | Promise<void>): void;
}

const txScope = new AsyncLocalStorage<boolean>();

export async function withUow<T>(ctx: AppContext, fn: (uow: Uow) => Promise<T>): Promise<T> {
  const after: Array<() => void | Promise<void>> = [];
  const result = await ctx.db.transaction(async (tx) => txScope.run(true, () => fn({ tx, ctx, afterCommit: (f) => after.push(f) })));
  for (const f of after) {
    try {
      await f();
    } catch (err) {
      ctx.log.error({ err }, 'afterCommit hook failed');
    }
  }
  return result;
}

const GUARDED = new Set(['select', 'selectDistinct', 'insert', 'update', 'delete', 'execute', 'transaction']);

/**
 * Wraps the root db so that using it *inside* a unit of work throws immediately.
 * Such code would escape the transaction (non-atomic on Postgres) and deadlock
 * on PGlite's single connection — this turns a silent hang into a clear error.
 */
export function guardDb(db: DB): DB {
  return new Proxy(db, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop === 'string' && GUARDED.has(prop) && txScope.getStore()) {
        throw new Error(`ctx.db.${prop}() used inside a unit of work — use uow.tx instead`);
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
