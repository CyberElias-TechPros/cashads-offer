'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatMoney, type FeedItemDTO, type MeResponse } from '@cashads/shared';
import { qk } from './queries';
import { toast, useUi } from './store';

/**
 * Live member updates over Server-Sent Events: balance changes, credit
 * celebrations, notifications, payout & claim status. Falls back to polling
 * if the stream can't be held open (some proxies buffer SSE).
 */
export function useLiveUpdates(enabled: boolean) {
  const qc = useQueryClient();
  const celebrate = useUi((s) => s.celebrate);
  const setTakenOver = useUi((s) => s.setVideoTakenOver);

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    let es: EventSource | null = null;
    let failures = 0;
    let poll: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    const startPolling = () => {
      if (poll) return;
      poll = setInterval(() => {
        void qc.invalidateQueries({ queryKey: qk.me });
      }, 15_000);
    };

    const connect = () => {
      if (closed) return;
      es = new EventSource('/api/me/stream');
      es.addEventListener('ready', () => {
        failures = 0;
      });
      es.addEventListener('wallet', (e) => {
        const { wallet } = JSON.parse((e as MessageEvent).data);
        qc.setQueryData<MeResponse | null>(qk.me, (m) => (m ? { ...m, wallet: { ...m.wallet, ...wallet } } : m));
        void qc.invalidateQueries({ queryKey: ['transactions'] });
      });
      es.addEventListener('credit', (e) => {
        const d = JSON.parse((e as MessageEvent).data);
        celebrate({ amountMicros: d.amountMicros, title: d.title, status: d.status, availableAt: d.availableAt, source: d.source });
        void qc.invalidateQueries({ queryKey: qk.engagement });
        void qc.invalidateQueries({ queryKey: qk.clicks });
        void qc.invalidateQueries({ queryKey: ['offers'] });
        void qc.invalidateQueries({ queryKey: ['offer'] });
        void qc.invalidateQueries({ queryKey: qk.me });
      });
      es.addEventListener('notification', (e) => {
        const { notification } = JSON.parse((e as MessageEvent).data);
        void qc.invalidateQueries({ queryKey: qk.notifications });
        qc.setQueryData<MeResponse | null>(qk.me, (m) => (m ? { ...m, unreadNotifications: m.unreadNotifications + 1 } : m));
        if (notification.type !== 'credit') {
          toast({ title: notification.title, description: notification.body, tone: notification.type === 'security' ? 'warning' : 'brand', action: notification.link ? { label: 'View', href: notification.link } : undefined });
        }
      });
      es.addEventListener('payout', (e) => {
        const { payoutId } = JSON.parse((e as MessageEvent).data);
        void qc.invalidateQueries({ queryKey: qk.payouts });
        void qc.invalidateQueries({ queryKey: qk.payout(payoutId) });
        void qc.invalidateQueries({ queryKey: qk.me });
      });
      es.addEventListener('claim', (e) => {
        const { claimId } = JSON.parse((e as MessageEvent).data);
        void qc.invalidateQueries({ queryKey: qk.claims });
        void qc.invalidateQueries({ queryKey: qk.claim(claimId) });
      });
      es.addEventListener('video', () => setTakenOver(true));
      es.onerror = () => {
        es?.close();
        failures++;
        if (failures >= 3) startPolling();
        setTimeout(connect, Math.min(30_000, 2000 * failures));
      };
    };
    connect();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void qc.invalidateQueries({ queryKey: qk.me });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      closed = true;
      es?.close();
      if (poll) clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, qc, celebrate, setTakenOver]);
}

/** Public payout feed: initial list + live additions. */
export function useLiveFeed(initial: FeedItemDTO[] | undefined, max = 12) {
  const [items, setItems] = useState<FeedItemDTO[]>(initial ?? []);
  const [fresh, setFresh] = useState<string | null>(null);
  const seeded = useRef(false);
  useEffect(() => {
    if (initial && !seeded.current) {
      setItems(initial.slice(0, max));
      seeded.current = true;
    }
  }, [initial, max]);
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/public/feed/stream');
    es.addEventListener('payout', (e) => {
      const item = JSON.parse((e as MessageEvent).data) as FeedItemDTO;
      setItems((prev) => [item, ...prev.filter((p) => p.id !== item.id)].slice(0, max));
      setFresh(item.id);
    });
    return () => es.close();
  }, [max]);
  return { items, fresh };
}

export function moneyToast(amountMicros: number, title: string) {
  toast({ title: `+${formatMoney(amountMicros)}`, description: title, tone: 'success' });
}
