import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  ClaimStatus,
  DataUsage,
  KycStatus,
  NotificationType,
  OfferCategory,
  PayoutKind,
  PayoutStatus,
  PayoutFieldDef,
  Platform,
  RiskLevel,
  Role,
  TicketCategory,
  TicketStatus,
  TierId,
  TransactionType,
  TxStatus,
  UserPreferences,
  UserStatus,
} from '@cashads/shared';

/* helpers ------------------------------------------------------------------ */
const id = () => uuid('id').primaryKey().defaultRandom();
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow();
/** Money: integer micros (1 USD = 1,000,000). */
const micros = (name: string) => bigint(name, { mode: 'number' });

/* ============================================================================
 * Identity
 * ========================================================================== */
export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    emailVerifiedAt: ts('email_verified_at'),
    passwordHash: text('password_hash'),
    googleSub: text('google_sub'),
    phone: text('phone'),
    phoneVerifiedAt: ts('phone_verified_at'),
    displayName: text('display_name').notNull(),
    country: text('country').notNull().default('US'),
    timezone: text('timezone').notNull().default('UTC'),
    role: text('role').$type<Role>().notNull().default('user'),
    status: text('status').$type<UserStatus>().notNull().default('active'),
    statusReason: text('status_reason'),
    tier: text('tier').$type<TierId>().notNull().default('bronze'),
    kycStatus: text('kyc_status').$type<KycStatus>().notNull().default('none'),
    referralCode: text('referral_code').notNull(),
    referredById: uuid('referred_by_id'),
    riskScore: integer('risk_score').notNull().default(0),
    riskLevel: text('risk_level').$type<RiskLevel>().notNull().default('low'),
    totpSecretEnc: text('totp_secret_enc'),
    totpEnabledAt: ts('totp_enabled_at'),
    totpLastStep: bigint('totp_last_step', { mode: 'number' }),
    preferences: jsonb('preferences').$type<Partial<UserPreferences>>().notNull().default({}),
    goalLabel: text('goal_label'),
    goalTargetMicros: micros('goal_target_micros'),
    streakCurrent: integer('streak_current').notNull().default(0),
    streakBest: integer('streak_best').notNull().default(0),
    lastCheckinDay: text('last_checkin_day'),
    onboardingCompletedAt: ts('onboarding_completed_at'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: ts('locked_until'),
    signupIp: text('signup_ip'),
    ipCountry: text('ip_country'),
    isSeed: boolean('is_seed').notNull().default(false),
    lastSeenAt: ts('last_seen_at'),
    deletedAt: ts('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(t.email),
    uniqueIndex('users_referral_code_uq').on(t.referralCode),
    uniqueIndex('users_google_sub_uq').on(t.googleSub),
    index('users_referred_by_idx').on(t.referredById),
    index('users_risk_idx').on(t.riskLevel),
    index('users_created_idx').on(t.createdAt),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id),
    tokenHash: text('token_hash').notNull(),
    deviceId: uuid('device_id'),
    deviceLabel: text('device_label'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
  },
  (t) => [uniqueIndex('sessions_token_uq').on(t.tokenHash), index('sessions_user_idx').on(t.userId)],
);

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    id: id(),
    userId: uuid('user_id'),
    kind: text('kind').$type<'email_verify' | 'password_reset' | 'phone_otp' | 'login_2fa' | 'oauth_state' | 'totp_setup'>().notNull(),
    tokenHash: text('token_hash').notNull(),
    codeHash: text('code_hash'),
    target: text('target'),
    attempts: integer('attempts').notNull().default(0),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    expiresAt: ts('expires_at').notNull(),
    consumedAt: ts('consumed_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('verification_tokens_hash_uq').on(t.tokenHash), index('verification_tokens_user_idx').on(t.userId, t.kind)],
);

export const devices = pgTable(
  'devices',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id),
    deviceKey: text('device_key').notNull(),
    fingerprint: text('fingerprint'),
    label: text('label'),
    userAgent: text('user_agent'),
    firstIp: text('first_ip'),
    lastIp: text('last_ip'),
    firstSeenAt: ts('first_seen_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('devices_user_key_uq').on(t.userId, t.deviceKey),
    index('devices_key_idx').on(t.deviceKey),
    index('devices_fp_idx').on(t.fingerprint),
  ],
);

export const loginEvents = pgTable(
  'login_events',
  {
    id: id(),
    userId: uuid('user_id'),
    email: text('email'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    success: boolean('success').notNull(),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [index('login_events_user_idx').on(t.userId, t.createdAt), index('login_events_ip_idx').on(t.ip, t.createdAt)],
);

export const userActivityDays = pgTable(
  'user_activity_days',
  { userId: uuid('user_id').notNull(), day: text('day').notNull() },
  (t) => [primaryKey({ columns: [t.userId, t.day] }), index('activity_day_idx').on(t.day)],
);

/* ============================================================================
 * Money: wallets, user-facing transactions, double-entry ledger
 * ========================================================================== */
export const wallets = pgTable('wallets', {
  userId: uuid('user_id').primaryKey().references(() => users.id),
  availableMicros: micros('available_micros').notNull().default(0),
  pendingMicros: micros('pending_micros').notNull().default(0),
  lifetimeEarnedMicros: micros('lifetime_earned_micros').notNull().default(0),
  lifetimeWithdrawnMicros: micros('lifetime_withdrawn_micros').notNull().default(0),
  updatedAt: updatedAt(),
});

export const transactions = pgTable(
  'transactions',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id),
    type: text('type').$type<TransactionType>().notNull(),
    status: text('status').$type<TxStatus>().notNull(),
    amountMicros: micros('amount_micros').notNull(),
    description: text('description').notNull(),
    referenceType: text('reference_type'),
    referenceId: text('reference_id'),
    availableAt: ts('available_at'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    settledAt: ts('settled_at'),
  },
  (t) => [
    index('transactions_user_idx').on(t.userId, t.createdAt),
    index('transactions_pending_idx').on(t.status, t.availableAt),
    index('transactions_ref_idx').on(t.referenceType, t.referenceId),
    index('transactions_type_idx').on(t.type, t.createdAt),
  ],
);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: id(),
    kind: text('kind').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    transactionId: uuid('transaction_id'),
    memo: text('memo'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('ledger_entries_idem_uq').on(t.idempotencyKey), index('ledger_entries_created_idx').on(t.createdAt)],
);

export const ledgerPostings = pgTable(
  'ledger_postings',
  {
    id: id(),
    entryId: uuid('entry_id').notNull().references(() => ledgerEntries.id),
    account: text('account').notNull(),
    amountMicros: micros('amount_micros').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('ledger_postings_account_idx').on(t.account), index('ledger_postings_entry_idx').on(t.entryId)],
);

/* ============================================================================
 * Offers, networks, clicks, postbacks
 * ========================================================================== */
export interface NetworkParamMap {
  userId?: string;
  clickId?: string;
  txId: string;
  payout?: string;
  /** How the payout param is expressed. */
  payoutUnit?: 'usd' | 'cents' | 'micros';
  offerId?: string;
  goalId?: string;
  status?: string;
  /** Map raw status values to credit/reversal, e.g. {"1":"credit","2":"reversal"} */
  statusValues?: Record<string, 'credit' | 'reversal'>;
  signature?: string;
  signatureHeader?: string;
}

export const networks = pgTable('networks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').$type<'offerwall' | 'survey' | 'video' | 'sandbox'>().notNull(),
  status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
  signatureScheme: text('signature_scheme')
    .$type<'hmac_sha256_sorted' | 'md5_txid_secret' | 'hmac_sha1_url' | 'sha256_secret_txid' | 'ip_only'>()
    .notNull(),
  secretEnc: text('secret_enc'),
  paramMap: jsonb('param_map').$type<NetworkParamMap>().notNull(),
  ipAllowlist: text('ip_allowlist').array().notNull().default([]),
  revenueShareBps: integer('revenue_share_bps'),
  docsUrl: text('docs_url'),
  notes: text('notes'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export interface OfferGoalDef {
  id: string;
  label: string;
  partnerPayoutMicros: number;
}

export interface PartnerContent {
  questions?: Array<{ id: string; text: string; options: string[] }>;
  lesson?: { title: string; paragraphs: string[]; quiz: Array<{ q: string; options: string[]; answer: number }> };
  appSteps?: string[];
  formFields?: string[];
}

export const offers = pgTable(
  'offers',
  {
    id: id(),
    networkId: text('network_id').notNull().references(() => networks.id),
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    advertiser: text('advertiser').notNull(),
    shortDescription: text('short_description').notNull(),
    description: text('description').notNull().default(''),
    category: text('category').$type<OfferCategory>().notNull(),
    icon: text('icon').notNull().default('🎯'),
    brandColor: text('brand_color').notNull().default('#10b981'),
    partnerPayoutMicros: micros('partner_payout_micros').notNull(),
    estimatedMinutes: doublePrecision('estimated_minutes').notNull(),
    dataUsage: text('data_usage').$type<DataUsage>().notNull().default('light'),
    steps: jsonb('steps').$type<string[]>().notNull().default([]),
    requirements: jsonb('requirements').$type<string[]>().notNull().default([]),
    goals: jsonb('goals').$type<OfferGoalDef[]>().notNull().default([]),
    countries: text('countries').array().notNull().default([]),
    platforms: text('platforms').array().$type<Platform[]>().notNull().default(['web']),
    holdHours: integer('hold_hours'),
    conversionWindowHours: integer('conversion_window_hours').notNull().default(72),
    featured: boolean('featured').notNull().default(false),
    status: text('status').$type<'active' | 'paused' | 'archived'>().notNull().default('active'),
    qualityScore: integer('quality_score').notNull().default(80),
    trackingReliability: doublePrecision('tracking_reliability'),
    medianCreditSeconds: integer('median_credit_seconds'),
    medianMinutes: doublePrecision('median_minutes'),
    ratingSum: integer('rating_sum').notNull().default(0),
    ratingCount: integer('rating_count').notNull().default(0),
    completions: integer('completions').notNull().default(0),
    reportsOpen: integer('reports_open').notNull().default(0),
    /** Partner tracking link template. Macros: {click_id} {user_id} {offer_id}. Null → built-in sandbox partner page. */
    trackingUrl: text('tracking_url'),
    sandboxDropPostback: boolean('sandbox_drop_postback').notNull().default(false),
    sandboxDelaySeconds: integer('sandbox_delay_seconds').notNull().default(3),
    partnerContent: jsonb('partner_content').$type<PartnerContent>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('offers_network_ext_uq').on(t.networkId, t.externalId), index('offers_status_cat_idx').on(t.status, t.category)],
);

export const offerClicks = pgTable(
  'offer_clicks',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id),
    offerId: uuid('offer_id').notNull().references(() => offers.id),
    deviceId: uuid('device_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    status: text('status').$type<'started' | 'completed' | 'credited' | 'reversed'>().notNull().default('started'),
    partnerPayoutMicros: micros('partner_payout_micros').notNull(),
    baseUserPayoutMicros: micros('base_user_payout_micros').notNull(),
    tierBonusMicros: micros('tier_bonus_micros').notNull().default(0),
    userPayoutMicros: micros('user_payout_micros').notNull(),
    goalsSnapshot: jsonb('goals_snapshot').$type<Array<OfferGoalDef & { baseMicros: number; bonusMicros: number; userPayoutMicros: number }>>().notNull().default([]),
    startedAt: ts('started_at').notNull(),
    returnedAt: ts('returned_at'),
    creditedAt: ts('credited_at'),
    /** When we proactively told the member their credit hadn't arrived yet. */
    nudgedAt: ts('nudged_at'),
    createdAt: createdAt(),
  },
  (t) => [index('offer_clicks_user_offer_idx').on(t.userId, t.offerId), index('offer_clicks_offer_idx').on(t.offerId, t.startedAt)],
);

export const postbacks = pgTable(
  'postbacks',
  {
    id: id(),
    networkId: text('network_id').notNull(),
    externalTxId: text('external_tx_id'),
    /** Set only for authentic postbacks — forged requests can't squat a tx id. */
    dedupeKey: text('dedupe_key'),
    kind: text('kind').$type<'credit' | 'reversal'>().notNull().default('credit'),
    clickId: uuid('click_id'),
    userId: uuid('user_id'),
    offerId: uuid('offer_id'),
    goalId: text('goal_id'),
    payoutMicros: micros('payout_micros'),
    userAmountMicros: micros('user_amount_micros'),
    signatureValid: boolean('signature_valid').notNull().default(false),
    status: text('status')
      .$type<'received' | 'credited' | 'held' | 'duplicate' | 'rejected' | 'reversed' | 'error' | 'needs_review'>()
      .notNull()
      .default('received'),
    statusReason: text('status_reason'),
    transactionId: uuid('transaction_id'),
    ip: text('ip'),
    method: text('method'),
    raw: jsonb('raw').$type<Record<string, unknown>>().notNull().default({}),
    replays: integer('replays').notNull().default(0),
    processedAt: ts('processed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('postbacks_dedupe_uq').on(t.dedupeKey),
    index('postbacks_status_idx').on(t.status, t.createdAt),
    index('postbacks_user_idx').on(t.userId),
    index('postbacks_click_idx').on(t.clickId),
    index('postbacks_created_idx').on(t.createdAt),
  ],
);

export const offerReviews = pgTable(
  'offer_reviews',
  {
    userId: uuid('user_id').notNull(),
    offerId: uuid('offer_id').notNull(),
    rating: integer('rating').notNull(),
    comment: text('comment'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.offerId] })],
);

export const offerReports = pgTable(
  'offer_reports',
  {
    id: id(),
    userId: uuid('user_id').notNull(),
    offerId: uuid('offer_id').notNull(),
    reason: text('reason').notNull(),
    details: text('details'),
    status: text('status').$type<'open' | 'resolved'>().notNull().default('open'),
    createdAt: createdAt(),
  },
  (t) => [index('offer_reports_offer_idx').on(t.offerId, t.status)],
);

/** Partner-side record kept by the built-in sandbox network (simulates the partner's own database). */
export const sandboxConversions = pgTable(
  'sandbox_conversions',
  {
    id: id(),
    clickId: uuid('click_id').notNull(),
    offerId: uuid('offer_id').notNull(),
    goalId: text('goal_id').notNull().default(''),
    txId: text('tx_id').notNull(),
    postbackSent: boolean('postback_sent').notNull().default(false),
    reversed: boolean('reversed').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('sandbox_conv_click_goal_uq').on(t.clickId, t.goalId)],
);

/* ============================================================================
 * Rewarded video
 * ========================================================================== */
export const videoAds = pgTable('video_ads', {
  id: id(),
  advertiser: text('advertiser').notNull(),
  headline: text('headline').notNull(),
  tagline: text('tagline').notNull(),
  cta: text('cta').notNull(),
  brandColor: text('brand_color').notNull(),
  accentColor: text('accent_color').notNull(),
  emoji: text('emoji').notNull(),
  durationSeconds: integer('duration_seconds').notNull(),
  partnerPayoutMicros: micros('partner_payout_micros').notNull(),
  countries: text('countries').array().notNull().default([]),
  status: text('status').$type<'active' | 'paused'>().notNull().default('active'),
  impressions: integer('impressions').notNull().default(0),
  completions: integer('completions').notNull().default(0),
  createdAt: createdAt(),
});

export interface VideoEventRecord {
  type: string;
  t: number;
  at: string;
}

export const videoSessions = pgTable(
  'video_sessions',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id),
    adId: uuid('ad_id').notNull(),
    deviceId: uuid('device_id'),
    deviceLabel: text('device_label'),
    status: text('status').$type<'active' | 'completed' | 'rejected' | 'abandoned' | 'failed'>().notNull().default('active'),
    rewardMicros: micros('reward_micros').notNull(),
    partnerPayoutMicros: micros('partner_payout_micros').notNull(),
    comboIndex: integer('combo_index').notNull().default(0),
    comboBonusBps: integer('combo_bonus_bps').notNull().default(0),
    events: jsonb('events').$type<VideoEventRecord[]>().notNull().default([]),
    hiddenMs: integer('hidden_ms').notNull().default(0),
    startedAt: ts('started_at'),
    completedAt: ts('completed_at'),
    expiresAt: ts('expires_at').notNull(),
    rejectionReason: text('rejection_reason'),
    ip: text('ip'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('video_sessions_user_status_idx').on(t.userId, t.status), index('video_sessions_user_created_idx').on(t.userId, t.createdAt)],
);

/* ============================================================================
 * Payouts
 * ========================================================================== */
export const payoutMethods = pgTable('payout_methods', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').$type<PayoutKind>().notNull(),
  description: text('description').notNull(),
  logo: text('logo').notNull(),
  provider: text('provider').notNull().default('sandbox'),
  status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
  minMicros: micros('min_micros').notNull(),
  maxMicros: micros('max_micros').notNull(),
  feeFixedMicros: micros('fee_fixed_micros').notNull().default(0),
  feeBps: integer('fee_bps').notNull().default(0),
  etaLabel: text('eta_label').notNull(),
  countries: text('countries').array().notNull().default([]),
  currency: text('currency'),
  fields: jsonb('fields').$type<PayoutFieldDef[]>().notNull().default([]),
  sortOrder: integer('sort_order').notNull().default(100),
  createdAt: createdAt(),
});

export const payoutDestinations = pgTable(
  'payout_destinations',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id),
    methodId: text('method_id').notNull(),
    label: text('label'),
    masked: text('masked').notNull(),
    hash: text('hash').notNull(),
    dataEnc: text('data_enc').notNull(),
    lastUsedAt: ts('last_used_at'),
    deletedAt: ts('deleted_at'),
    createdAt: createdAt(),
  },
  (t) => [index('payout_dest_user_idx').on(t.userId), index('payout_dest_hash_idx').on(t.hash)],
);

export const payouts = pgTable(
  'payouts',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id),
    methodId: text('method_id').notNull(),
    destinationId: uuid('destination_id'),
    destinationMasked: text('destination_masked').notNull(),
    destinationHash: text('destination_hash').notNull(),
    destinationEnc: text('destination_enc').notNull(),
    amountMicros: micros('amount_micros').notNull(),
    feeMicros: micros('fee_micros').notNull(),
    netMicros: micros('net_micros').notNull(),
    localCurrency: text('local_currency'),
    localAmount: doublePrecision('local_amount'),
    fxRate: doublePrecision('fx_rate'),
    status: text('status').$type<PayoutStatus>().notNull(),
    statusReason: text('status_reason'),
    riskScoreAtRequest: integer('risk_score_at_request').notNull().default(0),
    idempotencyKey: text('idempotency_key').notNull(),
    providerReference: text('provider_reference'),
    attempts: integer('attempts').notNull().default(0),
    reviewedById: uuid('reviewed_by_id'),
    createdAt: ts('created_at').notNull(),
    updatedAt: updatedAt(),
    processingAt: ts('processing_at'),
    completedAt: ts('completed_at'),
    failedAt: ts('failed_at'),
  },
  (t) => [
    uniqueIndex('payouts_idem_uq').on(t.userId, t.idempotencyKey),
    index('payouts_status_idx').on(t.status, t.createdAt),
    index('payouts_user_idx').on(t.userId, t.createdAt),
    index('payouts_dest_hash_idx').on(t.destinationHash),
  ],
);

export const payoutEvents = pgTable(
  'payout_events',
  {
    id: id(),
    payoutId: uuid('payout_id').notNull(),
    status: text('status').notNull(),
    message: text('message').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [index('payout_events_payout_idx').on(t.payoutId, t.createdAt)],
);

export const fxRates = pgTable('fx_rates', {
  currency: text('currency').primaryKey(),
  ratePerUsd: doublePrecision('rate_per_usd').notNull(),
  updatedAt: updatedAt(),
});

/* ============================================================================
 * Missing-credit claims, KYC, uploads
 * ========================================================================== */
export const claims = pgTable(
  'claims',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id),
    offerId: uuid('offer_id').notNull(),
    clickId: uuid('click_id').notNull(),
    status: text('status').$type<ClaimStatus>().notNull().default('submitted'),
    amountMicros: micros('amount_micros').notNull(),
    completedAtClaimed: ts('completed_at_claimed').notNull(),
    note: text('note'),
    uploadId: uuid('upload_id'),
    resolution: text('resolution'),
    resolvedById: uuid('resolved_by_id'),
    transactionId: uuid('transaction_id'),
    timeline: jsonb('timeline').$type<Array<{ label: string; at: string }>>().notNull().default([]),
    slaDueAt: ts('sla_due_at').notNull(),
    resolvedAt: ts('resolved_at'),
    createdAt: ts('created_at').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('claims_click_uq').on(t.clickId), index('claims_status_idx').on(t.status, t.slaDueAt), index('claims_user_idx').on(t.userId)],
);

export const uploads = pgTable('uploads', {
  id: id(),
  userId: uuid('user_id').notNull(),
  purpose: text('purpose').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  path: text('path').notNull(),
  createdAt: createdAt(),
});

export const kycSubmissions = pgTable(
  'kyc_submissions',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id),
    documentType: text('document_type').notNull(),
    documentCountry: text('document_country').notNull(),
    documentNumberLast4: text('document_number_last4').notNull(),
    documentNumberHash: text('document_number_hash').notNull(),
    legalName: text('legal_name').notNull(),
    dateOfBirth: text('date_of_birth').notNull(),
    documentUploadId: uuid('document_upload_id').notNull(),
    selfieUploadId: uuid('selfie_upload_id').notNull(),
    status: text('status').$type<'pending' | 'verified' | 'rejected'>().notNull().default('pending'),
    reason: text('reason'),
    reviewedById: uuid('reviewed_by_id'),
    createdAt: createdAt(),
    decidedAt: ts('decided_at'),
  },
  (t) => [index('kyc_status_idx').on(t.status), index('kyc_doc_hash_idx').on(t.documentNumberHash)],
);

/* ============================================================================
 * Risk & fraud
 * ========================================================================== */
export const riskSignals = pgTable(
  'risk_signals',
  {
    id: id(),
    userId: uuid('user_id').notNull(),
    code: text('code').notNull(),
    weight: integer('weight').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    clearedAt: ts('cleared_at'),
    createdAt: createdAt(),
  },
  (t) => [index('risk_signals_user_idx').on(t.userId, t.createdAt), index('risk_signals_code_idx').on(t.code)],
);

export const fraudCases = pgTable(
  'fraud_cases',
  {
    id: id(),
    userId: uuid('user_id').notNull(),
    status: text('status').$type<'open' | 'cleared' | 'actioned'>().notNull().default('open'),
    score: integer('score').notNull(),
    level: text('level').$type<RiskLevel>().notNull(),
    summary: text('summary').notNull(),
    resolution: text('resolution'),
    resolvedById: uuid('resolved_by_id'),
    openedAt: createdAt(),
    resolvedAt: ts('resolved_at'),
  },
  (t) => [index('fraud_cases_status_idx').on(t.status, t.openedAt), index('fraud_cases_user_idx').on(t.userId)],
);

/* ============================================================================
 * Growth & engagement
 * ========================================================================== */
export const referrals = pgTable(
  'referrals',
  {
    id: id(),
    referrerId: uuid('referrer_id').notNull().references(() => users.id),
    refereeId: uuid('referee_id').notNull().references(() => users.id),
    status: text('status').$type<'pending' | 'qualified' | 'rejected'>().notNull().default('pending'),
    rejectReason: text('reject_reason'),
    qualifiedAt: ts('qualified_at'),
    commissionUntil: ts('commission_until'),
    /** Commission earned for the referrer, all time (settled). */
    earnedMicros: micros('earned_micros').notNull().default(0),
    /** Commission accrued but not yet settled into the referrer's wallet (batched hourly). */
    accruedMicros: micros('accrued_micros').notNull().default(0),
    accruedCount: integer('accrued_count').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('referrals_referee_uq').on(t.refereeId), index('referrals_referrer_idx').on(t.referrerId)],
);

export const checkins = pgTable(
  'checkins',
  {
    userId: uuid('user_id').notNull(),
    day: text('day').notNull(),
    streak: integer('streak').notNull(),
    bonusMicros: micros('bonus_micros').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

export const planClaims = pgTable(
  'plan_claims',
  {
    userId: uuid('user_id').notNull(),
    day: text('day').notNull(),
    bonusMicros: micros('bonus_micros').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

export const userAchievements = pgTable(
  'user_achievements',
  {
    userId: uuid('user_id').notNull(),
    achievementId: text('achievement_id').notNull(),
    unlockedAt: ts('unlocked_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.achievementId] })],
);

/* ============================================================================
 * Communication
 * ========================================================================== */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id').notNull(),
    type: text('type').$type<NotificationType>().notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    link: text('link'),
    readAt: ts('read_at'),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);

export const outboundMessages = pgTable(
  'outbound_messages',
  {
    id: id(),
    userId: uuid('user_id'),
    channel: text('channel').$type<'email' | 'sms'>().notNull(),
    to: text('to').notNull(),
    subject: text('subject'),
    text: text('text').notNull(),
    html: text('html'),
    template: text('template').notNull(),
    status: text('status').$type<'queued' | 'sent' | 'failed'>().notNull().default('queued'),
    error: text('error'),
    providerId: text('provider_id'),
    createdAt: createdAt(),
    sentAt: ts('sent_at'),
  },
  (t) => [index('outbound_created_idx').on(t.createdAt)],
);

export const supportTickets = pgTable(
  'support_tickets',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id),
    subject: text('subject').notNull(),
    category: text('category').$type<TicketCategory>().notNull(),
    status: text('status').$type<TicketStatus>().notNull().default('open'),
    priority: text('priority').$type<'normal' | 'high'>().notNull().default('normal'),
    relatedType: text('related_type'),
    relatedId: text('related_id'),
    assignedToId: uuid('assigned_to_id'),
    slaDueAt: ts('sla_due_at').notNull(),
    firstResponseAt: ts('first_response_at'),
    lastMessageAt: ts('last_message_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('tickets_status_idx').on(t.status, t.slaDueAt), index('tickets_user_idx').on(t.userId)],
);

export const ticketMessages = pgTable(
  'ticket_messages',
  {
    id: id(),
    ticketId: uuid('ticket_id').notNull(),
    authorId: uuid('author_id'),
    authorRole: text('author_role').$type<'user' | 'staff' | 'system'>().notNull(),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('ticket_messages_ticket_idx').on(t.ticketId, t.createdAt)],
);

export const contactMessages = pgTable('contact_messages', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  message: text('message').notNull(),
  ip: text('ip'),
  createdAt: createdAt(),
});

/* ============================================================================
 * Operations
 * ========================================================================== */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_created_idx').on(t.createdAt), index('audit_target_idx').on(t.targetType, t.targetId)],
);

export const userNotes = pgTable(
  'user_notes',
  {
    id: id(),
    userId: uuid('user_id').notNull(),
    authorId: uuid('author_id').notNull(),
    note: text('note').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('user_notes_user_idx').on(t.userId)],
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedById: uuid('updated_by_id'),
  updatedAt: updatedAt(),
});

export const jobs = pgTable(
  'jobs',
  {
    id: id(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status').$type<'queued' | 'running' | 'done' | 'dead'>().notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(8),
    runAt: ts('run_at').notNull(),
    lockedAt: ts('locked_at'),
    lastError: text('last_error'),
    dedupeKey: text('dedupe_key'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('jobs_status_run_idx').on(t.status, t.runAt), uniqueIndex('jobs_dedupe_uq').on(t.dedupeKey)],
);
