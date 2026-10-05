import { EventEmitter } from 'node:events';

export type UserEvent =
  | { type: 'wallet'; wallet: { availableMicros: number; pendingMicros: number; lifetimeEarnedMicros: number; lifetimeWithdrawnMicros: number } }
  | { type: 'credit'; amountMicros: number; title: string; status: 'completed' | 'pending'; availableAt?: string | null; source: string }
  | { type: 'notification'; notification: { id: string; title: string; body: string; link: string | null; type: string } }
  | { type: 'payout'; payoutId: string; status: string }
  | { type: 'claim'; claimId: string; status: string }
  | { type: 'video'; status: 'session_taken_over' };

export type PublicEvent = {
  type: 'payout';
  item: { id: string; name: string; country: string; methodName: string; methodLogo: string; amountMicros: number; durationSeconds: number | null; at: string };
};

/**
 * In-process pub/sub that fans out to SSE connections.
 * For multi-instance deployments swap this for Redis pub/sub or Postgres
 * LISTEN/NOTIFY behind the same interface.
 */
export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publishToUser(userId: string, event: UserEvent) {
    this.emitter.emit(`user:${userId}`, event);
  }

  subscribeUser(userId: string, fn: (e: UserEvent) => void): () => void {
    const key = `user:${userId}`;
    this.emitter.on(key, fn);
    return () => this.emitter.off(key, fn);
  }

  publishPublic(event: PublicEvent) {
    this.emitter.emit('public', event);
  }

  subscribePublic(fn: (e: PublicEvent) => void): () => void {
    this.emitter.on('public', fn);
    return () => this.emitter.off('public', fn);
  }

  listenerCount(): number {
    return this.emitter.eventNames().reduce((n, e) => n + this.emitter.listenerCount(e), 0);
  }
}
