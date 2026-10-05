import { usd, type Micros } from './money';

export const BRAND = {
  name: 'CashAds',
  tagline: 'Real cash for your spare minutes.',
  promise: 'Real money, instantly, with no minimum, no points — and we pay you even when tracking fails.',
  supportEmail: 'support@cashads.app',
} as const;

/* ----------------------------------------------------------------------------
 * Offers
 * ------------------------------------------------------------------------- */
export const OFFER_CATEGORIES = ['survey', 'poll', 'app', 'game', 'signup', 'financial', 'learn', 'shopping'] as const;
export type OfferCategory = (typeof OFFER_CATEGORIES)[number];

export const CATEGORY_META: Record<OfferCategory, { label: string; plural: string; blurb: string; emoji: string }> = {
  survey: { label: 'Survey', plural: 'Surveys', blurb: 'Share your opinion with brands', emoji: '📝' },
  poll: { label: 'Quick poll', plural: 'Quick polls', blurb: 'One tap, under a minute', emoji: '⚡' },
  app: { label: 'App trial', plural: 'App trials', blurb: 'Try a new app, get paid', emoji: '📱' },
  game: { label: 'Game', plural: 'Games', blurb: 'Get paid at every milestone', emoji: '🎮' },
  signup: { label: 'Sign-up', plural: 'Sign-ups', blurb: 'Create a free account', emoji: '✍️' },
  financial: { label: 'Finance', plural: 'Finance', blurb: 'Highest payouts — banks & fintech', emoji: '🏦' },
  learn: { label: 'Learn', plural: 'Earn + learn', blurb: 'Micro-lessons that pay you', emoji: '🎓' },
  shopping: { label: 'Cashback', plural: 'Cashback', blurb: 'Money back on things you buy', emoji: '🛍️' },
};

export const DATA_USAGE = ['light', 'medium', 'heavy'] as const;
export type DataUsage = (typeof DATA_USAGE)[number];
export const DATA_USAGE_META: Record<DataUsage, { label: string; approx: string }> = {
  light: { label: 'Light data', approx: '< 2 MB' },
  medium: { label: 'Medium data', approx: '2–20 MB' },
  heavy: { label: 'Heavy data', approx: '20 MB+' },
};

export const OFFER_SORTS = ['hourly', 'payout', 'quickest', 'quality', 'newest'] as const;
export type OfferSort = (typeof OFFER_SORTS)[number];

export const OFFER_REPORT_REASONS = ['scam', 'not_as_described', 'tracking', 'spam', 'malware', 'other'] as const;
export type OfferReportReason = (typeof OFFER_REPORT_REASONS)[number];
export const OFFER_REPORT_LABELS: Record<OfferReportReason, string> = {
  scam: 'Looks like a scam',
  not_as_described: 'Not as described',
  tracking: 'Did not track',
  spam: 'Led to spam',
  malware: 'Malware / unsafe download',
  other: 'Something else',
};

export const PLATFORMS = ['web', 'ios', 'android'] as const;
export type Platform = (typeof PLATFORMS)[number];

/* ----------------------------------------------------------------------------
 * Wallet / ledger
 * ------------------------------------------------------------------------- */
export const TRANSACTION_TYPES = [
  'offer',
  'video',
  'welcome_bonus',
  'streak_bonus',
  'plan_bonus',
  'achievement_bonus',
  'referral_bonus',
  'referral_commission',
  'goodwill',
  'payout',
  'payout_refund',
  'reversal',
  'adjustment',
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_TYPE_META: Record<TransactionType, { label: string; group: 'earning' | 'bonus' | 'payout' | 'adjustment' }> = {
  offer: { label: 'Offer', group: 'earning' },
  video: { label: 'Video', group: 'earning' },
  welcome_bonus: { label: 'Welcome bonus', group: 'bonus' },
  streak_bonus: { label: 'Streak bonus', group: 'bonus' },
  plan_bonus: { label: 'Daily plan bonus', group: 'bonus' },
  achievement_bonus: { label: 'Achievement', group: 'bonus' },
  referral_bonus: { label: 'Referral bonus', group: 'bonus' },
  referral_commission: { label: 'Referral commission', group: 'bonus' },
  goodwill: { label: 'Missing-credit payout', group: 'earning' },
  payout: { label: 'Cash out', group: 'payout' },
  payout_refund: { label: 'Cash out refund', group: 'payout' },
  reversal: { label: 'Partner reversal', group: 'adjustment' },
  adjustment: { label: 'Adjustment', group: 'adjustment' },
};

export const TX_STATUSES = ['pending', 'completed', 'reversed', 'canceled'] as const;
export type TxStatus = (typeof TX_STATUSES)[number];

/* ----------------------------------------------------------------------------
 * Payouts
 * ------------------------------------------------------------------------- */
export const PAYOUT_STATUSES = ['pending', 'review', 'processing', 'completed', 'failed', 'rejected', 'canceled'] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];
export const PAYOUT_STATUS_META: Record<PayoutStatus, { label: string; tone: Tone; final: boolean }> = {
  pending: { label: 'Queued', tone: 'info', final: false },
  review: { label: 'Safety review', tone: 'warning', final: false },
  processing: { label: 'Sending', tone: 'info', final: false },
  completed: { label: 'Paid', tone: 'success', final: true },
  failed: { label: 'Failed — refunded', tone: 'danger', final: true },
  rejected: { label: 'Rejected — refunded', tone: 'danger', final: true },
  canceled: { label: 'Canceled — refunded', tone: 'neutral', final: true },
};

export const PAYOUT_KINDS = ['paypal', 'crypto', 'giftcard', 'bank', 'mobile_money', 'wise', 'charity'] as const;
export type PayoutKind = (typeof PAYOUT_KINDS)[number];

/* ----------------------------------------------------------------------------
 * Claims, tickets, users
 * ------------------------------------------------------------------------- */
export const CLAIM_STATUSES = ['submitted', 'auto_approved', 'in_review', 'approved', 'rejected'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export const CLAIM_STATUS_META: Record<ClaimStatus, { label: string; tone: Tone }> = {
  submitted: { label: 'Checking with partner', tone: 'info' },
  auto_approved: { label: 'Credited automatically', tone: 'success' },
  in_review: { label: 'Human review', tone: 'warning' },
  approved: { label: 'Approved & credited', tone: 'success' },
  rejected: { label: 'Not approved', tone: 'danger' },
};

export const TICKET_STATUSES = ['open', 'awaiting_user', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_CATEGORIES = ['missing_credit', 'payout', 'account', 'appeal', 'offer', 'bug', 'other'] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];
export const TICKET_CATEGORY_LABELS: Record<TicketCategory, string> = {
  missing_credit: 'Missing credit',
  payout: 'Cash out',
  account: 'Account & security',
  appeal: 'Appeal a decision',
  offer: 'Offer problem',
  bug: 'Bug report',
  other: 'Something else',
};

export const KYC_STATUSES = ['none', 'pending', 'verified', 'rejected'] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

export const USER_STATUSES = ['active', 'restricted', 'banned', 'deleted'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const ROLES = ['user', 'support', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand';

/* ----------------------------------------------------------------------------
 * Engagement: tiers, achievements, streaks
 * ------------------------------------------------------------------------- */
export const TIER_IDS = ['bronze', 'silver', 'gold', 'platinum'] as const;
export type TierId = (typeof TIER_IDS)[number];

export interface TierDef {
  id: TierId;
  label: string;
  minLifetimeMicros: Micros;
  minAccountAgeDays: number;
  requires: Array<'email' | 'phone' | 'kyc'>;
  /** Extra % on top of the revenue share, paid by us (bps). */
  bonusBps: number;
  /** Multiplier applied to safety holds (0 = no holds). */
  holdMultiplier: number;
  videoDailyCap: number;
  /** Missing-credit claims up to this amount are approved instantly. */
  instantClaimMicros: Micros;
  perks: string[];
}

export const TIERS: TierDef[] = [
  {
    id: 'bronze',
    label: 'Bronze',
    minLifetimeMicros: 0,
    minAccountAgeDays: 0,
    requires: [],
    bonusBps: 0,
    holdMultiplier: 1,
    videoDailyCap: 20,
    instantClaimMicros: 0,
    perks: ['Instant cash outs, no minimum', 'Missing-credit protection', '20 rewarded videos / day'],
  },
  {
    id: 'silver',
    label: 'Silver',
    minLifetimeMicros: usd(5),
    minAccountAgeDays: 3,
    requires: ['email'],
    bonusBps: 200,
    holdMultiplier: 0.5,
    videoDailyCap: 30,
    instantClaimMicros: 0,
    perks: ['+2% on every offer', 'Safety holds cut in half', '30 rewarded videos / day'],
  },
  {
    id: 'gold',
    label: 'Gold',
    minLifetimeMicros: usd(25),
    minAccountAgeDays: 14,
    requires: ['email', 'phone'],
    bonusBps: 400,
    holdMultiplier: 0.25,
    videoDailyCap: 40,
    instantClaimMicros: usd(2),
    perks: ['+4% on every offer', 'Safety holds cut by 75%', 'Instant missing-credit approvals up to $2', 'Priority support'],
  },
  {
    id: 'platinum',
    label: 'Platinum',
    minLifetimeMicros: usd(100),
    minAccountAgeDays: 45,
    requires: ['email', 'phone', 'kyc'],
    bonusBps: 600,
    holdMultiplier: 0,
    videoDailyCap: 50,
    instantClaimMicros: usd(5),
    perks: ['+6% on every offer', 'No safety holds', 'Instant missing-credit approvals up to $5', '4-hour support SLA'],
  },
];
export const TIER_BY_ID: Record<TierId, TierDef> = Object.fromEntries(TIERS.map((t) => [t.id, t])) as Record<TierId, TierDef>;

export type AchievementMetric = 'offers' | 'payouts' | 'earned' | 'streak' | 'referrals' | 'videos' | 'learn';
export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  metric: AchievementMetric;
  threshold: number;
  rewardMicros: Micros;
  emoji: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_offer', title: 'First win', description: 'Complete your first offer', metric: 'offers', threshold: 1, rewardMicros: usd(0.1), emoji: '✨' },
  { id: 'offers_10', title: 'Getting serious', description: 'Complete 10 offers', metric: 'offers', threshold: 10, rewardMicros: usd(0.25), emoji: '🔥' },
  { id: 'offers_50', title: 'Pro earner', description: 'Complete 50 offers', metric: 'offers', threshold: 50, rewardMicros: usd(1), emoji: '🏆' },
  { id: 'first_payout', title: 'Money in hand', description: 'Cash out for the first time', metric: 'payouts', threshold: 1, rewardMicros: usd(0.1), emoji: '💸' },
  { id: 'earned_10', title: '$10 club', description: 'Earn $10 in total', metric: 'earned', threshold: usd(10), rewardMicros: usd(0.25), emoji: '💵' },
  { id: 'earned_100', title: '$100 club', description: 'Earn $100 in total', metric: 'earned', threshold: usd(100), rewardMicros: usd(2), emoji: '💰' },
  { id: 'streak_7', title: 'Week warrior', description: 'Check in 7 days in a row', metric: 'streak', threshold: 7, rewardMicros: usd(0.25), emoji: '📅' },
  { id: 'streak_30', title: 'Habit formed', description: 'Check in 30 days in a row', metric: 'streak', threshold: 30, rewardMicros: usd(1), emoji: '🗓️' },
  { id: 'videos_25', title: 'Screen time', description: 'Watch 25 rewarded videos', metric: 'videos', threshold: 25, rewardMicros: usd(0.1), emoji: '🎬' },
  { id: 'learn_3', title: 'Lifelong learner', description: 'Finish 3 earn + learn lessons', metric: 'learn', threshold: 3, rewardMicros: usd(0.15), emoji: '🎓' },
  { id: 'referral_1', title: 'Better together', description: 'Refer a friend who earns', metric: 'referrals', threshold: 1, rewardMicros: usd(0.25), emoji: '🤝' },
  { id: 'referral_5', title: 'Community builder', description: 'Refer 5 friends who earn', metric: 'referrals', threshold: 5, rewardMicros: usd(1), emoji: '🌍' },
];

/** Daily check-in ladder: day 1 → $0.01 ... day 7+ → $0.10. */
export const STREAK_LADDER_MICROS: Micros[] = [usd(0.01), usd(0.02), usd(0.03), usd(0.04), usd(0.05), usd(0.07), usd(0.1)];
export function streakBonusFor(day: number): Micros {
  return STREAK_LADDER_MICROS[Math.min(Math.max(day, 1), STREAK_LADDER_MICROS.length) - 1];
}

export const NOTIFICATION_TYPES = [
  'credit',
  'pending_released',
  'payout',
  'claim',
  'referral',
  'achievement',
  'tier',
  'security',
  'support',
  'reversal',
  'system',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/* ----------------------------------------------------------------------------
 * Video
 * ------------------------------------------------------------------------- */
export const VIDEO_EVENTS = ['loaded', 'started', 'q1', 'mid', 'q3', 'completed', 'paused', 'resumed', 'hidden', 'visible', 'error'] as const;
export type VideoEvent = (typeof VIDEO_EVENTS)[number];
/** Required, in order, before a view can be rewarded. */
export const VIDEO_REQUIRED_SEQUENCE: VideoEvent[] = ['loaded', 'started', 'q1', 'mid', 'q3', 'completed'];
/** Consecutive-view combo: +5% per view in a row, capped at +25%. */
export const VIDEO_COMBO_STEP_BPS = 500;
export const VIDEO_COMBO_MAX_BPS = 2500;
