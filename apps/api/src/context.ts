import type { FastifyBaseLogger } from 'fastify';
import type { Config } from './config';
import type { DB } from './db/client';
import type { EventBus } from './lib/events';
import type { JobQueue } from './jobs/queue';
import type { SettingsStore } from './modules/platform/settings';

/** Simulated "outside world" HTTP call into our own API (used by the sandbox networks). */
export type SelfRequest = (opts: {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  payload?: unknown;
}) => Promise<{ statusCode: number; body: string }>;

/**
 * Everything a service needs, passed explicitly (no globals, trivially testable).
 */
export interface AppContext {
  config: Config;
  db: DB;
  engine: 'pglite' | 'postgres';
  log: FastifyBaseLogger;
  events: EventBus;
  settings: SettingsStore;
  jobs: JobQueue;
  now: () => Date;
  selfRequest: SelfRequest;
}
