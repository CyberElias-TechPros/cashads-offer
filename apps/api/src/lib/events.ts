import { EventEmitter } from 'node:events';

/**
 * In-process real-time bus feeding Server-Sent Events.
 *
 * Single-instance deployments use this directly. To scale horizontally, back it
 * with Postgres LISTEN/NOTIFY or Redis pub/sub — the interface stays the same.
 */
export interface RealtimeEvent {
  type: string;
  data: unknown;
}

export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  toUser(userId: string, type: string, data: unknown = {}): void {
    this.emitter.emit(`user:${userId}`, { type, data } satisfies RealtimeEvent);
  }

  broadcast(type: string, data: unknown = {}): void {
    this.emitter.emit('public', { type, data } satisfies RealtimeEvent);
  }

  subscribeUser(userId: string, fn: (e: RealtimeEvent) => void): () => void {
    const ch = `user:${userId}`;
    this.emitter.on(ch, fn);
    return () => this.emitter.off(ch, fn);
  }

  subscribePublic(fn: (e: RealtimeEvent) => void): () => void {
    this.emitter.on('public', fn);
    return () => this.emitter.off('public', fn);
  }

  listenerCount(): number {
    return this.emitter.eventNames().reduce((n, e) => n + this.emitter.listenerCount(e), 0);
  }
}
