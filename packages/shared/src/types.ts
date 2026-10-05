import type {
  ClaimStatus,
  DataUsage,
  KycStatus,
  NotificationType,
  OfferCategory,
  PayoutKind,
  PayoutStatus,
  Platform,
  RiskLevel,
  Role,
  TicketCategory,
  TicketStatus,
  TierId,
  TransactionType,
  TxStatus,
  UserStatus,
} from './constants';
import type { Micros } from './money';

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

/* ------------------------------------------------------------------ users */
export interface UserPreferences {
  dataSaver: boolean;
  theme: 'system' | 'light' | 'dark';
  emailPayouts: boolean;
  emailCredits: boolean;
  emailStreak: boolean;
  emailProduct: boolean;
  leaderboardOptIn: boolean;
  showLocalCurrency: boolean;
  interests: OfferCategory[];
  dailyMinutes: number;
}

export interface UserDTO {
  id: string;
  email: string;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  displayName: string;
  country: string;
  timezone: string;
  role: Role;
  status: UserStatus;
  statusReason: string | null;
  tier: TierId;
  kycStatus: KycStatus;
  referralCode: string;
  twoFactorEnabled: boolean;
  onboardingCompleted: boolean;
  hasPassword: boolean;
  createdAt: string;
  preferences: UserPreferences;
  goal: { label: string; targetMicros: Micros } | null;
}

export interface WalletDTO {
  availableMicros: Micros;
  pendingMicros: Micros;
  lifetimeEarnedMicros: Micros;
  lifetimeWithdrawnMicros: Micros;
  nextRelease: { amountMicros: Micros; at: string } | null;
}

export interface MeResponse {
  user: UserDTO;
  wallet: WalletDTO;
  unreadNotifications: number;
  localCurrency: { code: string; rate: number } | null;
  flags: { demoMode: boolean; maintenanceBanner: string | null; googleAuth: boolean };
}

/* ----------------------------------------------------------------- offers */
export interface OfferGoalDTO {
  id: string;
  label: string;
  userPayoutMicros: Micros;
  credited?: boolean;
}

export type MyOfferStatus = 'not_started' | 'started' | 'pending' | 'credited' | 'claimed' | 'reversed';

export interface OfferDTO {
  id: string;
  networkId: string;
  networkName: string;
  title: string;
  advertiser: string;
  shortDescription: string;
  description: string;
  category: OfferCategory;
  icon: string;
  brandColor: string;
  /** What the partner pays us. Shown on purpose — radical transparency. */
  partnerPayoutMicros: Micros;
  /** What you get (includes your tier bonus). */
  userPayoutMicros: Micros;
  baseUserPayoutMicros: Micros;
  tierBonusMicros: Micros;
  revenueShareBps: number;
  estimatedMinutes: number;
  medianMinutes: number | null;
  hourlyRateMicros: Micros;
  dataUsage: DataUsage;
  steps: string[];
  requirements: string[];
  goals: OfferGoalDTO[];
  platforms: Platform[];
  /** Effective safety hold for YOU, in hours (0 = instant). */
  holdHours: number;
  trackingReliability: number | null;
  medianCreditSeconds: number | null;
  qualityScore: number;
  ratingAvg: number | null;
  ratingCount: number;
  completions: number;
  featured: boolean;
  isNew: boolean;
  myStatus: MyOfferStatus;
  myClickId: string | null;
  myRating: number | null;
}

export interface OfferClickDTO {
  id: string;
  offerId: string;
  offerTitle: string;
  offerIcon: string;
  category: OfferCategory;
  status: 'started' | 'completed' | 'credited' | 'reversed';
  userPayoutMicros: Micros;
  startedAt: string;
  creditedAt: string | null;
  claimable: boolean;
  claimId: string | null;
}

export interface StartOfferResponse {
  clickId: string;
  redirectUrl: string;
}

/* ------------------------------------------------------------------ video */
export interface VideoCreativeDTO {
  id: string;
  advertiser: string;
  headline: string;
  tagline: string;
  cta: string;
  brandColor: string;
  accentColor: string;
  emoji: string;
  durationSeconds: number;
}

export interface VideoStatusDTO {
  dailyCap: number;
  watchedToday: number;
  remainingToday: number;
  comboIndex: number;
  comboBonusBps: number;
  nextRewardMicros: Micros;
  cooldownUntil: string | null;
  activeSession: { id: string; deviceLabel: string; sameDevice: boolean } | null;
  earnedTodayMicros: Micros;
}

export interface VideoSessionDTO {
  id: string;
  creative: VideoCreativeDTO;
  rewardMicros: Micros;
  comboIndex: number;
  comboBonusBps: number;
  expiresAt: string;
}

export interface VideoCompleteResponse {
  rewarded: boolean;
  amountMicros: Micros;
  reason?: string;
  status: VideoStatusDTO;
}

/* ----------------------------------------------------------------- wallet */
export interface TransactionDTO {
  id: string;
  type: TransactionType;
  status: TxStatus;
  amountMicros: Micros;
  description: string;
  createdAt: string;
  availableAt: string | null;
  referenceType: string | null;
  referenceId: string | null;
  meta: Record<string, unknown>;
}

/* ---------------------------------------------------------------- payouts */
export interface PayoutFieldDef {
  key: string;
  label: string;
  type: 'email' | 'text' | 'tel' | 'select';
  placeholder?: string;
  pattern?: string;
  hint?: string;
  options?: Array<{ value: string; label: string }>;
}

export interface PayoutMethodDTO {
  id: string;
  name: string;
  kind: PayoutKind;
  description: string;
  minMicros: Micros;
  maxMicros: Micros;
  feeFixedMicros: Micros;
  feeBps: number;
  etaLabel: string;
  medianSeconds: number | null;
  fields: PayoutFieldDef[];
  localCurrency: string | null;
  fxRate: number | null;
  countries: string[];
  logo: string;
}

export interface PayoutRequirement {
  id: 'email_verified' | 'phone_verified' | 'kyc' | 'account_active' | 'risk_review';
  label: string;
  met: boolean;
  action?: string;
}

export interface PayoutQuoteDTO {
  methodId: string;
  amountMicros: Micros;
  feeMicros: Micros;
  netMicros: Micros;
  localCurrency: string | null;
  localAmount: number | null;
  fxRate: number | null;
  requirements: PayoutRequirement[];
  canSubmit: boolean;
  problems: string[];
  willAutoApprove: boolean;
  etaLabel: string;
}

export interface PayoutTimelineItem {
  status: PayoutStatus | 'requested' | 'retrying';
  message: string;
  at: string;
}

export interface PayoutDTO {
  id: string;
  methodId: string;
  methodName: string;
  methodLogo: string;
  kind: PayoutKind;
  amountMicros: Micros;
  feeMicros: Micros;
  netMicros: Micros;
  localCurrency: string | null;
  localAmount: number | null;
  destinationMasked: string;
  status: PayoutStatus;
  statusReason: string | null;
  providerReference: string | null;
  createdAt: string;
  completedAt: string | null;
  durationSeconds: number | null;
  timeline: PayoutTimelineItem[];
  canCancel: boolean;
}

export interface PayoutDestinationDTO {
  id: string;
  methodId: string;
  masked: string;
  label: string | null;
  lastUsedAt: string | null;
}

/* ----------------------------------------------------------------- claims */
export interface ClaimDTO {
  id: string;
  offerId: string;
  offerTitle: string;
  offerIcon: string;
  clickId: string;
  status: ClaimStatus;
  amountMicros: Micros;
  note: string | null;
  resolution: string | null;
  slaDueAt: string;
  createdAt: string;
  resolvedAt: string | null;
  timeline: Array<{ label: string; at: string }>;
}

/* -------------------------------------------------------- notifications */
export interface NotificationDTO {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------ engagement */
export interface DailyPlanItemDTO {
  offerId: string;
  title: string;
  icon: string;
  category: OfferCategory;
  userPayoutMicros: Micros;
  estimatedMinutes: number;
  done: boolean;
}

export interface DailyPlanDTO {
  day: string;
  items: DailyPlanItemDTO[];
  totalMicros: Micros;
  totalMinutes: number;
  completed: number;
  bonusMicros: Micros;
  bonusClaimed: boolean;
}

export interface StreakDTO {
  current: number;
  best: number;
  checkedInToday: boolean;
  todayBonusMicros: Micros;
  nextBonusMicros: Micros;
  last7: Array<{ day: string; checked: boolean }>;
}

export interface TierProgressDTO {
  current: TierId;
  next: TierId | null;
  lifetimeMicros: Micros;
  nextThresholdMicros: Micros | null;
  missing: string[];
}

export interface EngagementSummaryDTO {
  streak: StreakDTO;
  tier: TierProgressDTO;
  plan: DailyPlanDTO;
  achievementsUnlocked: number;
  achievementsTotal: number;
  earnedTodayMicros: Micros;
  earnedWeekMicros: Micros;
  weekRankPercentile: number | null;
}

export interface AchievementDTO {
  id: string;
  title: string;
  description: string;
  emoji: string;
  rewardMicros: Micros;
  threshold: number;
  progress: number;
  unlockedAt: string | null;
}

export interface LeaderboardEntryDTO {
  rank: number;
  name: string;
  country: string;
  tier: TierId;
  earnedMicros: Micros;
  isMe: boolean;
}

export interface LeaderboardDTO {
  period: 'week' | 'month';
  startsAt: string;
  endsAt: string;
  entries: LeaderboardEntryDTO[];
  me: { rank: number | null; earnedMicros: Micros; percentile: number | null; optedIn: boolean };
  participants: number;
}

/* ------------------------------------------------------------- referrals */
export interface ReferralSummaryDTO {
  code: string;
  link: string;
  refereeBonusMicros: Micros;
  referrerBonusMicros: Micros;
  commissionBps: number;
  commissionMonths: number;
  totals: { invited: number; qualified: number; earnedMicros: Micros };
  referrals: Array<{ id: string; name: string; joinedAt: string; status: 'pending' | 'qualified' | 'rejected'; earnedForYouMicros: Micros }>;
}

/* --------------------------------------------------------------- support */
export interface TicketDTO {
  id: string;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  slaDueAt: string;
  createdAt: string;
  updatedAt: string;
  lastMessagePreview: string;
  messages?: Array<{ id: string; author: 'user' | 'staff' | 'system'; authorName: string; body: string; createdAt: string }>;
}

/* ---------------------------------------------------------------- public */
export interface FeedItemDTO {
  id: string;
  name: string;
  country: string;
  methodName: string;
  methodLogo: string;
  amountMicros: Micros;
  durationSeconds: number | null;
  at: string;
}

export interface PublicStatsDTO {
  totalPaidMicros: Micros;
  payoutsCount: number;
  usersPaid: number;
  paidLast24hMicros: Micros;
  medianPayoutSeconds: number | null;
  p90PayoutSeconds: number | null;
  trackingSuccessRate: number | null;
  claimsApprovedRate: number | null;
  medianClaimHours: number | null;
  revenueShareBps: number;
  activeOffers: number;
  largestPayoutMicros: Micros;
  methods: Array<{ name: string; logo: string; count: number }>;
  updatedAt: string;
}

/* --------------------------------------------------------------- account */
export interface SessionDTO {
  id: string;
  deviceLabel: string;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export interface AccountHealthDTO {
  level: 'good' | 'attention' | 'restricted';
  title: string;
  description: string;
  tips: string[];
  riskLevel: RiskLevel;
}

export interface TaxSummaryDTO {
  year: number;
  years: number[];
  totals: { earnedMicros: Micros; bonusesMicros: Micros; withdrawnMicros: Micros; feesMicros: Micros };
  byType: Array<{ type: TransactionType; amountMicros: Micros; count: number }>;
  byMonth: Array<{ month: number; earnedMicros: Micros; withdrawnMicros: Micros }>;
  country: string;
  guidance: string[];
}
