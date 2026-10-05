'use client';

import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AccountHealthDTO,
  AchievementDTO,
  ClaimDTO,
  EngagementSummaryDTO,
  FaqItem,
  FeedItemDTO,
  LeaderboardDTO,
  MeResponse,
  NotificationDTO,
  OfferClickDTO,
  OfferDTO,
  OfferListQuery,
  Paginated,
  PayoutDestinationDTO,
  PayoutDTO,
  PayoutMethodDTO,
  PublicStatsDTO,
  ReferralSummaryDTO,
  SessionDTO,
  TaxSummaryDTO,
  TicketDTO,
  TransactionDTO,
  VideoStatusDTO,
} from '@cashads/shared';
import { api, ApiError } from './api';

export const qk = {
  me: ['me'] as const,
  offers: (q: object) => ['offers', q] as const,
  offer: (id: string) => ['offer', id] as const,
  clicks: ['clicks'] as const,
  video: ['video-status'] as const,
  transactions: (f: object) => ['transactions', f] as const,
  methods: ['payout-methods'] as const,
  payouts: ['payouts'] as const,
  payout: (id: string) => ['payout', id] as const,
  destinations: ['destinations'] as const,
  claims: ['claims'] as const,
  claim: (id: string) => ['claim', id] as const,
  referrals: ['referrals'] as const,
  engagement: ['engagement'] as const,
  achievements: ['achievements'] as const,
  leaderboard: (p: string) => ['leaderboard', p] as const,
  notifications: ['notifications'] as const,
  tickets: ['tickets'] as const,
  ticket: (id: string) => ['ticket', id] as const,
  sessions: ['sessions'] as const,
  devices: ['devices'] as const,
  logins: ['logins'] as const,
  health: ['health'] as const,
  kyc: ['kyc'] as const,
  tax: (y: number) => ['tax', y] as const,
  stats: ['public-stats'] as const,
  feed: ['public-feed'] as const,
  faq: ['faq'] as const,
};

function qs(params: object): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== 'all') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
}

/** Current member (null when signed out). */
export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: async () => {
      try {
        return await api<MeResponse>('/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 20_000,
  });
}

export const useOffers = (q: Partial<OfferListQuery>) => useQuery({ queryKey: qk.offers(q), queryFn: () => api<OfferDTO[]>(`/offers${qs(q)}`), placeholderData: (prev) => prev });
export const useOffer = (id: string) => useQuery({ queryKey: qk.offer(id), queryFn: () => api<OfferDTO>(`/offers/${id}`), enabled: !!id });
export const useClicks = () => useQuery({ queryKey: qk.clicks, queryFn: () => api<OfferClickDTO[]>('/offers/clicks') });
export const useVideoStatus = () => useQuery({ queryKey: qk.video, queryFn: () => api<VideoStatusDTO>('/video/status') });

export function useTransactions(filter: { group?: string; status?: string }) {
  return useInfiniteQuery({
    queryKey: qk.transactions(filter),
    queryFn: ({ pageParam }) => api<Paginated<TransactionDTO>>(`/wallet/transactions${qs({ ...filter, before: pageParam })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export const usePayoutMethods = () => useQuery({ queryKey: qk.methods, queryFn: () => api<PayoutMethodDTO[]>('/payouts/methods'), staleTime: 60_000 });
export const usePayouts = () => useQuery({ queryKey: qk.payouts, queryFn: () => api<PayoutDTO[]>('/payouts') });
export const usePayout = (id: string) =>
  useQuery({
    queryKey: qk.payout(id),
    queryFn: () => api<PayoutDTO>(`/payouts/${id}`),
    refetchInterval: (q) => (q.state.data && ['pending', 'processing', 'review'].includes(q.state.data.status) ? 4000 : false),
  });
export const useDestinations = () => useQuery({ queryKey: qk.destinations, queryFn: () => api<PayoutDestinationDTO[]>('/payouts/destinations') });
export const useClaims = () => useQuery({ queryKey: qk.claims, queryFn: () => api<ClaimDTO[]>('/claims') });
export const useClaim = (id: string) =>
  useQuery({ queryKey: qk.claim(id), queryFn: () => api<ClaimDTO>(`/claims/${id}`), refetchInterval: (q) => (q.state.data?.status === 'submitted' ? 2500 : false) });
export const useReferrals = () => useQuery({ queryKey: qk.referrals, queryFn: () => api<ReferralSummaryDTO>('/referrals') });
export const useEngagement = () => useQuery({ queryKey: qk.engagement, queryFn: () => api<EngagementSummaryDTO>('/engagement/summary') });
export const useAchievements = () => useQuery({ queryKey: qk.achievements, queryFn: () => api<AchievementDTO[]>('/engagement/achievements') });
export const useLeaderboard = (period: 'week' | 'month') => useQuery({ queryKey: qk.leaderboard(period), queryFn: () => api<LeaderboardDTO>(`/engagement/leaderboard?period=${period}`) });
export const useNotifications = () => useQuery({ queryKey: qk.notifications, queryFn: () => api<NotificationDTO[]>('/notifications') });
export const useTickets = () => useQuery({ queryKey: qk.tickets, queryFn: () => api<TicketDTO[]>('/support/tickets') });
export const useTicket = (id: string) => useQuery({ queryKey: qk.ticket(id), queryFn: () => api<TicketDTO>(`/support/tickets/${id}`), refetchInterval: 15_000 });
export const useSessions = () => useQuery({ queryKey: qk.sessions, queryFn: () => api<SessionDTO[]>('/me/sessions') });
export const useDevices = () => useQuery({ queryKey: qk.devices, queryFn: () => api<Array<{ id: string; label: string; lastIp: string | null; firstSeenAt: string; lastSeenAt: string }>>('/me/devices') });
export const useLoginHistory = () =>
  useQuery({ queryKey: qk.logins, queryFn: () => api<Array<{ id: string; ip: string | null; userAgent: string | null; success: boolean; reason: string | null; at: string }>>('/me/login-history') });
export const useHealth = () => useQuery({ queryKey: qk.health, queryFn: () => api<AccountHealthDTO>('/me/health') });
export const useKyc = () =>
  useQuery({
    queryKey: qk.kyc,
    queryFn: () => api<{ status: string; latest: { status: string; reason: string | null; submittedAt: string; documentType: string } | null }>('/me/kyc'),
    refetchInterval: (q) => (q.state.data?.status === 'pending' ? 4000 : false),
  });
export const useTax = (year: number) => useQuery({ queryKey: qk.tax(year), queryFn: () => api<TaxSummaryDTO>(`/me/tax?year=${year}`) });
export const usePublicStats = () => useQuery({ queryKey: qk.stats, queryFn: () => api<PublicStatsDTO>('/public/stats'), staleTime: 30_000 });
export const useFeed = (limit = 20) => useQuery({ queryKey: [...qk.feed, limit], queryFn: () => api<FeedItemDTO[]>(`/public/feed?limit=${limit}`), staleTime: 30_000 });
export const useFaq = () => useQuery({ queryKey: qk.faq, queryFn: () => api<FaqItem[]>('/support/faq'), staleTime: Infinity });

/** Admin queries share one helper — admin pages pass their own key/path. */
export function useAdmin<T>(key: readonly unknown[], path: string, opts: { refetchInterval?: number; enabled?: boolean } = {}) {
  return useQuery({ queryKey: ['admin', ...key], queryFn: () => api<T>(`/admin${path}`), ...opts });
}

export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: ReadonlyArray<readonly unknown[]>) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k })));
}
