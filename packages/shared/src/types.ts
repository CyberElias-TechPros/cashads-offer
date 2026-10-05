import type {
  BanReasonCode,
  ClaimStatus,
  ClickStatus,
  OfferCategory,
  PaySpeed,
  PayoutMethod,
  PayoutStatus,
  TierDef,
  TxnType,
} from './catalog';
import type { AdEventType, Role, Settings, UserPrefs } from './schemas';

export type ISODate = string;
export type UserStatus = 'active' | 'restricted' | 'banned' | 'deleted';
export type KycStatus = 'none' | 'pending' | 'verified' | 'rejected';

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string>; requestId?: string };
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/* ── identity ──────────────────────────────────────────────────────────────── */

export interface RestrictionDTO {
  reasonCode: BanReasonCode;
  title: string;
  explanation: string;
  message: string | null;
  at: ISODate | null;
  balanceFrozen: boolean;
  appeal: { ticketId: string; status: string; updatedAt: ISODate } | null;
}

export interface MeDTO {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  fullName: string | null;
  country: string;
  timezone: string;
  language: string;
  displayCurrency: string;
  role: Role;
  status: UserStatus;
  restriction: RestrictionDTO | null;
  referralCode: string;
  kycStatus: KycStatus;
  phoneVerified: boolean;
  phoneLast4: string | null;
  totpEnabled: boolean;
  tier: TierDef['id'];
  accountHealth: 'good' | 'review' | 'restricted';
  prefs: UserPrefs;
  onboardingDone: boolean;
  createdAt: ISODate;
}

export interface SessionDTO {
  id: string;
  current: boolean;
  label: string;
  ip: string | null;
  createdAt: ISODate;
  lastUsedAt: ISODate;
}

export interface LoginEventDTO {
  id: string;
  success: boolean;
  reason: string | null;
  ip: string | null;
  label: string;
  createdAt: ISODate;
}

export interface LoginResultDTO {
  user?: MeDTO;
  mfaRequired?: boolean;
  mfaToken?: string;
}

/* ── wallet ────────────────────────────────────────────────────────────────── */

export interface BalancesDTO {
  availableMicros: number;
  pendingMicros: number;
  lifetimeEarnedMicros: number;
  lifetimePaidOutMicros: number;
  donatedMicros: number;
  displayCurrency: string;
  fxRate: number;
}

export interface TransactionDTO {
  id: string;
  type: TxnType;
  description: string;
  amountMicros: number;
  createdAt: ISODate;
  referenceType: string | null;
  referenceId: string | null;
}

/* ── offers ────────────────────────────────────────────────────────────────── */

export interface OfferQualityDTO {
  score: number | null;
  grade: 'A' | 'B' | 'C' | 'D' | 'F' | 'New';
  completionRate: number | null;
  creditReliability: number | null;
  rating: number | null;
  reports: number;
}

export interface OfferDTO {
  id: string;
  networkId: string;
  networkName: string;
  title: string;
  advertiser: string;
  description: string;
  category: OfferCategory;
  icon: string;
  color: string;
  userPayoutMicros: number;
  estMinutes: number;
  measuredMinutes: number | null;
  measuredSamples: number;
  effectiveMinutes: number;
  hourlyRateMicros: number;
  paySpeed: PaySpeed;
  dataMb: number;
  isLite: boolean;
  tags: string[];
  quality: OfferQualityDTO;
  myStatus: ClickStatus | null;
  myClickId: string | null;
  completedByMe: boolean;
  createdAt: ISODate;
}

export interface OfferDetailDTO extends OfferDTO {
  steps: string[];
  tips: string[];
  countries: string[];
  networkReliability: number | null;
  ratingCounts: { up: number; down: number };
  myRating: 1 | -1 | null;
  canRate: boolean;
}

export interface OfferStartDTO {
  clickId: string;
  redirectUrl: string;
  expiresAt: ISODate;
}

export interface ActivityItemDTO {
  clickId: string;
  offer: Pick<OfferDTO, 'id' | 'title' | 'icon' | 'color' | 'category' | 'userPayoutMicros' | 'networkName'>;
  status: ClickStatus;
  startedAt: ISODate;
  reportedAt: ISODate | null;
  creditedAt: ISODate | null;
  expiresAt: ISODate;
  creditedMicros: number | null;
  claim: { id: string; status: ClaimStatus } | null;
  canClaim: boolean;
  claimAvailableAt: ISODate | null;
}

/* ── claims ────────────────────────────────────────────────────────────────── */

export interface TimelineEventDTO {
  type: string;
  message: string;
  at: ISODate;
}

export interface ClaimDTO {
  id: string;
  clickId: string;
  offer: ActivityItemDTO['offer'];
  status: ClaimStatus;
  resolution: string | null;
  amountMicros: number;
  note: string;
  slaDueAt: ISODate;
  resolvedAt: ISODate | null;
  rejectionReason: string | null;
  hasScreenshot: boolean;
  createdAt: ISODate;
  events: TimelineEventDTO[];
}

/* ── payouts ───────────────────────────────────────────────────────────────── */

export interface PayoutMethodDTO extends PayoutMethod {
  fxRate: number;
}

export interface PayoutRequirementDTO {
  code: 'email' | 'phone' | 'kyc' | 'totp' | 'balance' | 'limits' | 'account';
  label: string;
  met: boolean;
  action?: string;
}

export interface PayoutQuoteDTO {
  methodId: string;
  amountMicros: number;
  feeMicros: number;
  netMicros: number;
  localCurrency: string;
  localAmount: number;
  fxRate: number;
  etaSeconds: number;
  speed: string;
  requirements: PayoutRequirementDTO[];
  blockers: string[];
  ok: boolean;
}

export interface PayoutDTO {
  id: string;
  methodId: string;
  methodName: string;
  methodIcon: string;
  destinationMasked: string;
  amountMicros: number;
  feeMicros: number;
  netMicros: number;
  localCurrency: string;
  localAmount: number;
  status: PayoutStatus;
  statusReason: string | null;
  attempts: number;
  nextAttemptAt: ISODate | null;
  providerReference: string | null;
  requestedAt: ISODate;
  completedAt: ISODate | null;
  durationSeconds: number | null;
  canCancel: boolean;
  events: { status: string; message: string; at: ISODate }[];
}

export interface DestinationDTO {
  id: string;
  methodId: string;
  label: string;
  masked: string;
  verifiedName: string | null;
  createdAt: ISODate;
  lastUsedAt: ISODate | null;
}

/* ── engagement ────────────────────────────────────────────────────────────── */

export interface NotificationDTO {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: ISODate | null;
  createdAt: ISODate;
}

export interface StreakDTO {
  current: number;
  longest: number;
  claimedToday: boolean;
  todayRewardMicros: number;
  upcoming: { day: number; rewardMicros: number }[];
  lastClaimDate: string | null;
}

export interface PlanItemDTO {
  offer: OfferDTO;
  done: boolean;
}

export interface PlanDTO {
  date: string;
  items: PlanItemDTO[];
  totalMicros: number;
  totalMinutes: number;
  completed: boolean;
  bonusMicros: number;
  bonusPaid: boolean;
}

export interface LeaderboardEntryDTO {
  rank: number;
  name: string;
  earnedMicros: number;
  isMe: boolean;
  tier: string;
}

export interface LeaderboardDTO {
  period: 'week';
  startsAt: ISODate;
  endsAt: ISODate;
  entries: LeaderboardEntryDTO[];
  me: { rank: number | null; earnedMicros: number; percentile: number | null; optedIn: boolean };
}

export interface AchievementDTO {
  code: string;
  title: string;
  description: string;
  icon: string;
  unlockedAt: ISODate | null;
}

export interface TierProgressDTO {
  current: TierDef;
  next: TierDef | null;
  lifetimeMicros: number;
  accountAgeDays: number;
  kycVerified: boolean;
}

export interface ReferralDTO {
  code: string;
  link: string;
  bonusMicros: number;
  residualPercent: number;
  stats: { invited: number; qualified: number; earnedMicros: number };
  referees: { id: string; label: string; status: string; joinedAt: ISODate; earnedForYouMicros: number }[];
}

/* ── native earning ────────────────────────────────────────────────────────── */

export interface AdCreativeDTO {
  id: string;
  advertiser: string;
  title: string;
  tagline: string;
  durationSeconds: number;
  lite: boolean;
  theme: { from: string; to: string; accent: string; emoji: string };
}

export interface AdNextDTO {
  creative: AdCreativeDTO | null;
  rewardMicros: number;
  comboLevel: number;
  comboMultiplierBps: number;
  remainingToday: number;
  dailyCap: number;
  offersPayMoreHint: string;
}

export interface AdSessionDTO {
  id: string;
  status: 'created' | 'playing' | 'verifying' | 'rewarded' | 'rejected' | 'expired' | 'abandoned';
  rewardMicros: number;
  bonusMicros: number;
  visibleMs: number;
  requiredMs: number;
  rejectionReason: string | null;
  lastEvent: AdEventType | null;
}

export interface PollDTO {
  id: string;
  question: string;
  options: string[];
  rewardMicros: number;
  sponsor: string;
  estSeconds: number;
  remaining: number;
}

export interface LessonSummaryDTO {
  id: string;
  title: string;
  summary: string;
  icon: string;
  minutes: number;
  rewardMicros: number;
  sponsor: string;
  passed: boolean;
}

export interface LessonDTO extends LessonSummaryDTO {
  sections: { heading: string; body: string }[];
  quiz: { question: string; options: string[] }[];
  passMark: number;
}

/* ── public / transparency ─────────────────────────────────────────────────── */

export interface PublicConfigDTO {
  sandbox: boolean;
  revenueSharePercent: number;
  fxRates: Record<string, number>;
  brand: { name: string; tagline: string; community: { discord: string; telegram: string } };
  referralBonusMicros: number;
  referralResidualPercent: number;
}

export interface PublicStatsDTO {
  sandbox: boolean;
  totalPaidOutMicros: number;
  payoutsCompleted: number;
  medianPayoutSeconds: number | null;
  usersCount: number;
  postbackSuccessRate: number | null;
  postbacksReceived30d: number;
  claimsTotal30d: number;
  claimsResolvedWithin24hRate: number | null;
  claimsApprovedRate: number | null;
  revenueShareBps: number;
  actualShareBps30d: number | null;
  networkRevenue30dMicros: number;
  userEarnings30dMicros: number;
  offersRemovedAfterReports: number;
  updatedAt: ISODate;
}

export interface FeedItemDTO {
  id: string;
  name: string;
  countryCode: string;
  flag: string;
  methodName: string;
  methodIcon: string;
  amountMicros: number;
  completedAt: ISODate;
  durationSeconds: number | null;
}

export interface NetworkReliabilityDTO {
  id: string;
  name: string;
  postbackSuccessRate: number | null;
  postbacks30d: number;
  status: string;
}

export interface WallOfShameDTO {
  id: string;
  title: string;
  advertiser: string;
  networkName: string;
  reason: string;
  reports: number;
  removedAt: ISODate;
}

export interface StatusComponentDTO {
  id: string;
  name: string;
  status: 'operational' | 'degraded' | 'outage';
  detail: string;
}

/* ── support, community, charity, tax, kyc ─────────────────────────────────── */

export interface TicketMessageDTO {
  id: string;
  authorType: 'user' | 'staff' | 'system';
  body: string;
  createdAt: ISODate;
}

export interface TicketDTO {
  id: string;
  subject: string;
  category: string;
  status: 'open' | 'pending_user' | 'resolved' | 'closed';
  priority: 'normal' | 'high';
  slaDueAt: ISODate;
  createdAt: ISODate;
  updatedAt: ISODate;
  messages?: TicketMessageDTO[];
}

export interface FeatureRequestDTO {
  id: string;
  title: string;
  body: string;
  status: 'open' | 'planned' | 'in_progress' | 'shipped' | 'declined';
  votes: number;
  votedByMe: boolean;
  authorLabel: string;
  createdAt: ISODate;
  shippedAt: ISODate | null;
}

export interface CharityDTO {
  id: string;
  name: string;
  description: string;
  icon: string;
  url: string;
  impactUnit: string;
  impactUnitMicros: number;
  totalDonatedMicros: number;
  myDonatedMicros: number;
}

export interface TaxSummaryDTO {
  year: number;
  country: string;
  totals: { earningsMicros: number; bonusesMicros: number; payoutsMicros: number; donationsMicros: number };
  byMonth: { month: number; earningsMicros: number; payoutsMicros: number }[];
  us1099: { applicable: boolean; thresholdMicros: number; reportableMicros: number; likely: boolean };
  notes: string[];
}

export interface KycDTO {
  status: KycStatus;
  idType: string | null;
  idNumberMasked: string | null;
  submittedAt: ISODate | null;
  reviewedAt: ISODate | null;
  reviewerNote: string | null;
}

/* ── admin ─────────────────────────────────────────────────────────────────── */

export interface AdminOverviewDTO {
  users: { total: number; new24h: number; active24h: number; restricted: number };
  money: {
    liabilitiesMicros: number;
    networkRevenue24hMicros: number;
    userEarnings24hMicros: number;
    paidOut24hMicros: number;
    platformRevenue30dMicros: number;
  };
  queues: {
    payoutsReview: number;
    payoutsProcessing: number;
    claimsReview: number;
    fraudOpen: number;
    ticketsOpen: number;
    kycPending: number;
    reportsOpen: number;
    jobsFailed: number;
  };
  postbacks: { last24h: number; failed24h: number; successRate24h: number | null };
  series: {
    date: string;
    signups: number;
    earningsMicros: number;
    payoutsMicros: number;
    revenueMicros: number;
  }[];
}

export interface AdminSettingsDTO {
  settings: Settings;
  defaults: Settings;
}
