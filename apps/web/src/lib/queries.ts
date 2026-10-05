import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  type BalancesDTO,
  type FeedItemDTO,
  type MeDTO,
  type PublicConfigDTO,
  formatLocal,
  formatUsd,
  type FormatOptions,
} from '@cashads/shared';
import { useUI } from '../store/ui';
import { get } from './api';

export const qk = {
  me: ['me'] as const,
  config: ['config'] as const,
  wallet: ['wallet'] as const,
  notifications: ['notifications'] as const,
};

export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: () => get<{ user: MeDTO | null }>('/auth/me').then((r) => r.user),
    staleTime: 30_000,
  });
}

export function useConfig() {
  return useQuery({
    queryKey: qk.config,
    queryFn: () => get<PublicConfigDTO>('/public/config'),
    staleTime: 5 * 60_000,
  });
}

export function useWallet(enabled = true) {
  return useQuery({
    queryKey: qk.wallet,
    queryFn: () => get<BalancesDTO>('/wallet'),
    enabled,
    refetchInterval: 60_000,
  });
}

export function useUnreadCount(enabled = true) {
  return useQuery({
    queryKey: qk.notifications,
    queryFn: () => get<{ unread: number; items: unknown[] }>('/notifications?limit=30'),
    enabled,
    refetchInterval: 120_000,
    select: (d) => d.unread,
  });
}

/** Real money, everywhere: USD (ledger currency) + the member's local currency. */
export function useMoney() {
  const { data: me } = useMe();
  const { data: config } = useConfig();
  const currency = me?.displayCurrency ?? 'USD';
  const rate = config?.fxRates?.[currency] ?? 1;
  return useMemo(
    () => ({
      currency,
      rate,
      usd: (micros: number, opts?: FormatOptions) => formatUsd(micros, opts),
      local: (micros: number, opts?: { compact?: boolean }) =>
        currency === 'USD' ? '' : formatLocal(micros, currency, rate, opts),
      localFor: (micros: number, cur: string) => formatLocal(micros, cur, config?.fxRates?.[cur] ?? 1),
    }),
    [currency, rate, config?.fxRates],
  );
}

const TOAST_NOTIFICATION_TYPES = new Set([
  'payout_completed',
  'payout_failed',
  'payout_delayed',
  'payout_rejected',
  'claim_approved',
  'claim_rejected',
  'claim_review',
  'referral_bonus',
  'achievement',
  'tier_up',
  'plan_complete',
  'first_task_bonus',
  'credited_after_check',
  'reversal_absorbed',
  'security_review',
  'kyc',
  'support_reply',
]);

/**
 * Live updates over Server-Sent Events: balance changes, rewards, payout and claim
 * status. Rewards trigger the celebration (respecting reduced-motion/data-saver).
 */
export function useRealtime(enabled: boolean) {
  const qc = useQueryClient();
  const celebrate = useUI((s) => s.celebrate);
  const pushToast = useUI((s) => s.toast);
  const lastReward = useRef(0);

  const invalidate = useCallback(
    (...keys: (readonly unknown[])[]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: k })),
    [qc],
  );

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/events/stream');
    const parse = (e: MessageEvent) => {
      try {
        return JSON.parse(e.data) as Record<string, unknown>;
      } catch {
        return {};
      }
    };
    es.addEventListener('reward', (e) => {
      const d = parse(e as MessageEvent);
      lastReward.current = Date.now();
      const amount = Number(d.amountMicros ?? 0);
      // Quick tasks and videos show their own inline reward animation.
      if (amount > 0 && d.kind !== 'poll' && d.kind !== 'ad')
        celebrate({ amountMicros: amount, title: String(d.title ?? 'Reward') });
      invalidate(
        qk.wallet,
        ['activity'],
        ['offers'],
        ['plan'],
        ['transactions'],
        ['ads'],
        ['claims'],
        ['streak'],
      );
    });
    es.addEventListener('balance', () => invalidate(qk.wallet, ['transactions']));
    es.addEventListener('payout', (e) => {
      const d = parse(e as MessageEvent);
      invalidate(['payouts'], ['payout', d.payoutId], qk.wallet, ['transactions']);
    });
    es.addEventListener('claim', (e) => {
      const d = parse(e as MessageEvent);
      invalidate(['claims'], ['claim', d.claimId], ['activity'], qk.wallet);
    });
    es.addEventListener('notification', (e) => {
      const d = parse(e as MessageEvent);
      invalidate(qk.notifications);
      if (
        d.type === 'account_restricted' ||
        d.type === 'security_review' ||
        d.type === 'account_restored' ||
        d.type === 'security_review_done'
      )
        invalidate(qk.me);
      // Rewards already celebrate; avoid a duplicate toast right after one.
      if (TOAST_NOTIFICATION_TYPES.has(String(d.type)) && Date.now() - lastReward.current > 1500) {
        pushToast({
          tone: String(d.type).includes('fail') || String(d.type).includes('rejected') ? 'error' : 'info',
          title: String(d.title ?? ''),
          body: String(d.body ?? ''),
        });
      }
    });
    return () => es.close();
  }, [enabled, celebrate, invalidate, pushToast]);
}

/** Public payout feed with live updates (landing + transparency pages). */
export function usePublicFeed(limit = 20) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['feed', limit],
    queryFn: () => get<FeedItemDTO[]>(`/public/feed?limit=${limit}`),
    refetchInterval: 60_000,
  });
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/public/feed/stream');
    es.addEventListener('feed.payout', (e) => {
      try {
        const item = JSON.parse((e as MessageEvent).data) as FeedItemDTO;
        qc.setQueryData<FeedItemDTO[]>(['feed', limit], (prev) =>
          [item, ...(prev ?? []).filter((p) => p.id !== item.id)].slice(0, limit),
        );
      } catch {
        /* ignore */
      }
    });
    return () => es.close();
  }, [qc, limit]);
  return query;
}
