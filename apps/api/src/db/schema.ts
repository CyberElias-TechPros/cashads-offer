import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  date,
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
import type { KycStatus, Role, UserPrefs, UserStatus } from '@lucrum/shared';

/* helpers */
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => bigint(name, { mode: 'number' });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow();
const id = () => uuid('id').primaryKey().defaultRandom();

/* ════════════════════════════════════════════════════════════════════════════
 * Identity & security
 * ════════════════════════════════════════════════════════════════════════════ */

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    emailVerifiedAt: ts('email_verified_at'),
    passwordHash: text('password_hash'),
    displayName: text('display_name'),
    fullName: text('full_name'),
    phoneEnc: text('phone_enc'),
    phoneHash: text('phone_hash'),
    phoneLast4: text('phone_last4'),
    phoneVerifiedAt: ts('phone_verified_at'),
    country: text('country').notNull(),
    timezone: text('timezone').notNull().default('UTC'),
    language: text('language').notNull().default('en'),
    displayCurrency: text('display_currency').notNull().default('USD'),
    role: text('role').$type<Role>().notNull().default('user'),
    status: text('status').$type<UserStatus>().notNull().default('active'),
    banReasonCode: text('ban_reason_code'),
    banMessage: text('ban_message'),
    bannedAt: ts('banned_at'),
    balanceFrozen: boolean('balance_frozen').notNull().default(false),
    referralCode: text('referral_code').notNull(),
    referredBy: uuid('referred_by').references((): AnyPgColumn => users.id),
    kycStatus: text('kyc_status').$type<KycStatus>().notNull().default('none'),
    fraudScore: integer('fraud_score').notNull().default(0),
    tier: text('tier').notNull().default('bronze'),
    totpSecretEnc: text('totp_secret_enc'),
    totpEnabledAt: ts('totp_enabled_at'),
    totpLastStep: bigint('totp_last_step', { mode: 'number' }),
    recoveryCodes: jsonb('recovery_codes').$type<string[]>(),
    prefs: jsonb('prefs').$type<UserPrefs>().notNull(),
    onboardingDoneAt: ts('onboarding_done_at'),
    termsVersion: text('terms_version'),
    termsAcceptedAt: ts('terms_accepted_at'),
    signupIp: text('signup_ip'),
    isDemo: boolean('is_demo').notNull().default(false),
    lastSeenAt: ts('last_seen_at'),
    deletedAt: ts('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(t.email),
    uniqueIndex('users_referral_code_uq').on(t.referralCode),
    uniqueIndex('users_phone_hash_uq')
      .on(t.phoneHash)
      .where(sql`${t.phoneHash} is not null and ${t.deletedAt} is null`),
    index('users_referred_by_idx').on(t.referredBy),
    index('users_created_idx').on(t.createdAt),
    index('users_status_idx').on(t.status),
  ],
);

export const adminNotes = pgTable(
  'admin_notes',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    authorId: uuid('author_id').references(() => users.id),
    note: text('note').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('admin_notes_user_idx').on(t.userId)],
);

export const devices = pgTable(
  'devices',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    deviceKey: text('device_key').notNull(),
    fingerprintHash: text('fingerprint_hash'),
    label: text('label').notNull(),
    userAgent: text('user_agent'),
    lastIp: text('last_ip'),
    firstSeenAt: createdAt(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('devices_user_key_uq').on(t.userId, t.deviceKey),
    index('devices_key_idx').on(t.deviceKey),
    index('devices_fp_idx').on(t.fingerprintHash),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull(),
    deviceId: uuid('device_id').references(() => devices.id),
    label: text('label').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastUsedAt: ts('last_used_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
  },
  (t) => [uniqueIndex('sessions_token_uq').on(t.tokenHash), index('sessions_user_idx').on(t.userId)],
);

export const loginEvents = pgTable(
  'login_events',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id),
    email: text('email').notNull(),
    success: boolean('success').notNull(),
    reason: text('reason'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [
    index('login_events_user_idx').on(t.userId, t.createdAt),
    index('login_events_email_idx').on(t.email, t.createdAt),
  ],
);

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    type: text('type').$type<'email_verify' | 'password_reset' | 'phone_otp' | 'login_mfa'>().notNull(),
    tokenHash: text('token_hash').notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('verification_tokens_hash_uq').on(t.tokenHash),
    index('verification_tokens_user_idx').on(t.userId, t.type),
  ],
);

/** Outbound email / SMS. In sandbox mode this doubles as the developer inbox. */
export const outboundMessages = pgTable(
  'outbound_messages',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id),
    channel: text('channel').$type<'email' | 'sms'>().notNull(),
    to: text('to').notNull(),
    subject: text('subject'),
    body: text('body').notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index('outbound_created_idx').on(t.createdAt)],
);

/* ════════════════════════════════════════════════════════════════════════════
 * Double-entry ledger (integer micro-dollars). Balances are cached on the
 * account row and updated in the same DB transaction as the entries; a CHECK
 * constraint makes negative member balances physically impossible.
 * ════════════════════════════════════════════════════════════════════════════ */

export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    id: id(),
    code: text('code').notNull(),
    userId: uuid('user_id').references(() => users.id),
    kind: text('kind').$type<'user_available' | 'system'>().notNull(),
    normalSide: text('normal_side').$type<'debit' | 'credit'>().notNull(),
    currency: text('currency').notNull().default('USD'),
    balanceMicros: money('balance_micros').notNull().default(0),
    allowNegative: boolean('allow_negative').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ledger_accounts_code_uq').on(t.code),
    index('ledger_accounts_user_idx').on(t.userId),
    check('ledger_accounts_non_negative', sql`${t.allowNegative} or ${t.balanceMicros} >= 0`),
  ],
);

export const ledgerTransactions = pgTable(
  'ledger_transactions',
  {
    id: id(),
    type: text('type').notNull(),
    userId: uuid('user_id').references(() => users.id),
    idempotencyKey: text('idempotency_key').notNull(),
    description: text('description').notNull(),
    referenceType: text('reference_type'),
    referenceId: text('reference_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ledger_txn_idem_uq').on(t.idempotencyKey),
    index('ledger_txn_user_idx').on(t.userId, t.createdAt),
    index('ledger_txn_type_idx').on(t.type, t.createdAt),
    index('ledger_txn_ref_idx').on(t.referenceType, t.referenceId),
  ],
);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => ledgerTransactions.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccounts.id),
    direction: text('direction').$type<'debit' | 'credit'>().notNull(),
    amountMicros: money('amount_micros').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('ledger_entries_account_idx').on(t.accountId, t.createdAt),
    index('ledger_entries_txn_idx').on(t.transactionId),
    check('ledger_entries_positive', sql`${t.amountMicros} > 0`),
  ],
);

/* ════════════════════════════════════════════════════════════════════════════
 * Networks, offers, clicks, conversions, postbacks
 * ════════════════════════════════════════════════════════════════════════════ */

export const networks = pgTable('networks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  adapter: text('adapter').$type<'sandboxnet' | 'bitlabs' | 'md5wall' | 'pangle_ssv' | 'native'>().notNull(),
  kind: text('kind').$type<'offerwall' | 'ads' | 'native' | 'iframe_wall'>().notNull(),
  secretEnc: text('secret_enc'),
  ipAllowlist: jsonb('ip_allowlist').$type<string[]>().notNull().default([]),
  status: text('status').$type<'active' | 'paused' | 'disabled'>().notNull().default('active'),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

export const offers = pgTable(
  'offers',
  {
    id: id(),
    networkId: text('network_id')
      .notNull()
      .references(() => networks.id),
    networkOfferId: text('network_offer_id').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    advertiser: text('advertiser').notNull(),
    category: text('category').notNull(),
    steps: jsonb('steps').$type<string[]>().notNull().default([]),
    payoutMicros: money('payout_micros').notNull(),
    userPayoutOverrideMicros: money('user_payout_override_micros'),
    estMinutes: doublePrecision('est_minutes').notNull(),
    dataMb: doublePrecision('data_mb').notNull().default(1),
    paySpeed: text('pay_speed').$type<'instant' | 'hours' | 'days'>().notNull().default('instant'),
    countries: jsonb('countries').$type<string[]>().notNull().default([]),
    icon: text('icon').notNull().default('🎯'),
    color: text('color').notNull().default('#10b981'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    isLite: boolean('is_lite').notNull().default(false),
    maxPerUser: integer('max_per_user').notNull().default(1),
    status: text('status').$type<'active' | 'paused' | 'removed' | 'scam'>().notNull().default('active'),
    statusReason: text('status_reason'),
    statusChangedAt: ts('status_changed_at'),
    /* cached stats (refreshed by jobs) */
    statClicks: integer('stat_clicks').notNull().default(0),
    statConversions: integer('stat_conversions').notNull().default(0),
    statMissingClaims: integer('stat_missing_claims').notNull().default(0),
    statThumbsUp: integer('stat_thumbs_up').notNull().default(0),
    statThumbsDown: integer('stat_thumbs_down').notNull().default(0),
    statReportsOpen: integer('stat_reports_open').notNull().default(0),
    statMedianSeconds: integer('stat_median_seconds'),
    statSamples: integer('stat_samples').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('offers_network_offer_uq').on(t.networkId, t.networkOfferId),
    index('offers_status_idx').on(t.status),
    index('offers_category_idx').on(t.category),
  ],
);

export const offerClicks = pgTable(
  'offer_clicks',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => offers.id),
    deviceKey: text('device_key'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    status: text('status')
      .$type<'started' | 'reported' | 'credited' | 'claimed' | 'expired' | 'rejected'>()
      .notNull()
      .default('started'),
    startedAt: ts('started_at').notNull().defaultNow(),
    reportedAt: ts('reported_at'),
    creditedAt: ts('credited_at'),
    expiresAt: ts('expires_at').notNull(),
    conversionId: uuid('conversion_id'),
    checkCount: integer('check_count').notNull().default(0),
  },
  (t) => [
    index('clicks_user_idx').on(t.userId, t.startedAt),
    index('clicks_offer_idx').on(t.offerId),
    index('clicks_status_idx').on(t.status),
  ],
);

export const conversions = pgTable(
  'conversions',
  {
    id: id(),
    networkId: text('network_id')
      .notNull()
      .references(() => networks.id),
    networkTxnId: text('network_txn_id').notNull(),
    clickId: uuid('click_id').references(() => offerClicks.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    offerId: uuid('offer_id').references(() => offers.id),
    title: text('title').notNull(),
    kind: text('kind').$type<'complete' | 'screenout'>().notNull().default('complete'),
    payoutMicros: money('payout_micros').notNull(),
    userAmountMicros: money('user_amount_micros').notNull(),
    platformAmountMicros: money('platform_amount_micros').notNull(),
    status: text('status').$type<'credited' | 'reversed'>().notNull().default('credited'),
    source: text('source')
      .$type<'postback' | 'network_api' | 'claim' | 'replay'>()
      .notNull()
      .default('postback'),
    durationSeconds: integer('duration_seconds'),
    postbackLogId: uuid('postback_log_id'),
    ledgerTxnId: uuid('ledger_txn_id'),
    creditedAt: ts('credited_at').notNull().defaultNow(),
    reversedAt: ts('reversed_at'),
  },
  (t) => [
    uniqueIndex('conversions_network_txn_uq').on(t.networkId, t.networkTxnId),
    index('conversions_user_idx').on(t.userId, t.creditedAt),
    index('conversions_offer_idx').on(t.offerId),
    index('conversions_click_idx').on(t.clickId),
    index('conversions_credited_idx').on(t.creditedAt),
  ],
);

export const postbackLogs = pgTable(
  'postback_logs',
  {
    id: id(),
    networkId: text('network_id').notNull(),
    method: text('method').notNull(),
    url: text('url').notNull(),
    query: jsonb('query').$type<Record<string, unknown>>().notNull().default({}),
    body: jsonb('body').$type<unknown>(),
    headers: jsonb('headers').$type<Record<string, unknown>>().notNull().default({}),
    ip: text('ip'),
    signatureValid: boolean('signature_valid'),
    status: text('status')
      .$type<'received' | 'processed' | 'duplicate' | 'rejected' | 'error'>()
      .notNull()
      .default('received'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    networkTxnId: text('network_txn_id'),
    clickId: text('click_id'),
    userId: text('user_id'),
    conversionId: uuid('conversion_id'),
    processingMs: integer('processing_ms'),
    replayOf: uuid('replay_of'),
    createdAt: createdAt(),
  },
  (t) => [
    index('postback_logs_created_idx').on(t.createdAt),
    index('postback_logs_click_idx').on(t.clickId),
    index('postback_logs_status_idx').on(t.status, t.createdAt),
  ],
);

export const offerRatings = pgTable(
  'offer_ratings',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => offers.id),
    value: integer('value').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.offerId] })],
);

export const offerReports = pgTable(
  'offer_reports',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => offers.id),
    reason: text('reason').notNull(),
    details: text('details'),
    status: text('status').$type<'open' | 'actioned' | 'dismissed'>().notNull().default('open'),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    resolvedAt: ts('resolved_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('offer_reports_user_offer_uq').on(t.userId, t.offerId),
    index('offer_reports_status_idx').on(t.status),
  ],
);

/* ════════════════════════════════════════════════════════════════════════════
 * Native earning: rewarded video, quick polls, lessons
 * ════════════════════════════════════════════════════════════════════════════ */

export const adCreatives = pgTable('ad_creatives', {
  id: text('id').primaryKey(),
  networkId: text('network_id')
    .notNull()
    .references(() => networks.id),
  advertiser: text('advertiser').notNull(),
  title: text('title').notNull(),
  tagline: text('tagline').notNull(),
  durationSeconds: integer('duration_seconds').notNull(),
  revenueMicros: money('revenue_micros').notNull(),
  lite: boolean('lite').notNull().default(true),
  theme: jsonb('theme').$type<{ from: string; to: string; accent: string; emoji: string }>().notNull(),
  status: text('status').$type<'active' | 'paused'>().notNull().default('active'),
  createdAt: createdAt(),
});

export const adSessions = pgTable(
  'ad_sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    creativeId: text('creative_id')
      .notNull()
      .references(() => adCreatives.id),
    deviceKey: text('device_key').notNull(),
    transId: text('trans_id').notNull(),
    status: text('status')
      .$type<'created' | 'playing' | 'verifying' | 'rewarded' | 'rejected' | 'expired' | 'abandoned'>()
      .notNull()
      .default('created'),
    events: jsonb('events')
      .$type<{ type: string; at: number; mediaTime: number; quartile?: number }[]>()
      .notNull()
      .default([]),
    visibleMs: integer('visible_ms').notNull().default(0),
    rewardMicros: money('reward_micros').notNull().default(0),
    bonusMicros: money('bonus_micros').notNull().default(0),
    comboLevel: integer('combo_level').notNull().default(0),
    rejectionReason: text('rejection_reason'),
    ledgerTxnId: uuid('ledger_txn_id'),
    createdAt: createdAt(),
    completedAt: ts('completed_at'),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [
    uniqueIndex('ad_sessions_trans_uq').on(t.transId),
    index('ad_sessions_user_idx').on(t.userId, t.createdAt),
  ],
);

/** One device earns at a time (spec §7 "multi-device login"). */
export const earningLocks = pgTable('earning_locks', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id),
  deviceKey: text('device_key').notNull(),
  deviceLabel: text('device_label').notNull(),
  expiresAt: ts('expires_at').notNull(),
});

export const pollResponses = pgTable(
  'poll_responses',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    pollId: text('poll_id').notNull(),
    optionIndex: integer('option_index').notNull(),
    rewardMicros: money('reward_micros').notNull(),
    ledgerTxnId: uuid('ledger_txn_id'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.pollId] }), index('poll_responses_poll_idx').on(t.pollId)],
);

export const lessonAttempts = pgTable(
  'lesson_attempts',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    lessonId: text('lesson_id').notNull(),
    score: doublePrecision('score').notNull(),
    passed: boolean('passed').notNull(),
    rewardMicros: money('reward_micros').notNull().default(0),
    ledgerTxnId: uuid('ledger_txn_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('lesson_attempts_user_idx').on(t.userId, t.lessonId),
    uniqueIndex('lesson_attempts_passed_uq')
      .on(t.userId, t.lessonId)
      .where(sql`${t.passed}`),
  ],
);

/* ════════════════════════════════════════════════════════════════════════════
 * Payouts
 * ════════════════════════════════════════════════════════════════════════════ */

export const payoutDestinations = pgTable(
  'payout_destinations',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    methodId: text('method_id').notNull(),
    label: text('label').notNull(),
    detailsEnc: text('details_enc').notNull(),
    detailsHash: text('details_hash').notNull(),
    masked: text('masked').notNull(),
    verifiedName: text('verified_name'),
    createdAt: createdAt(),
    lastUsedAt: ts('last_used_at'),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('payout_dest_user_idx').on(t.userId), index('payout_dest_hash_idx').on(t.detailsHash)],
);

export const payouts = pgTable(
  'payouts',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    methodId: text('method_id').notNull(),
    destinationId: uuid('destination_id').references(() => payoutDestinations.id),
    detailsEnc: text('details_enc').notNull(),
    detailsHash: text('details_hash').notNull(),
    destinationMasked: text('destination_masked').notNull(),
    amountMicros: money('amount_micros').notNull(),
    feeMicros: money('fee_micros').notNull(),
    netMicros: money('net_micros').notNull(),
    localCurrency: text('local_currency').notNull(),
    fxRate: doublePrecision('fx_rate').notNull(),
    status: text('status')
      .$type<'pending' | 'review' | 'processing' | 'completed' | 'failed' | 'reversed' | 'cancelled'>()
      .notNull()
      .default('pending'),
    statusReason: text('status_reason'),
    reviewReasons: jsonb('review_reasons').$type<string[]>().notNull().default([]),
    providerReference: text('provider_reference'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: ts('next_attempt_at'),
    idempotencyKey: text('idempotency_key').notNull(),
    requestTxnId: uuid('request_txn_id'),
    finalTxnId: uuid('final_txn_id'),
    requestedAt: ts('requested_at').notNull().defaultNow(),
    processingAt: ts('processing_at'),
    completedAt: ts('completed_at'),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('payouts_idem_uq').on(t.userId, t.idempotencyKey),
    index('payouts_user_idx').on(t.userId, t.requestedAt),
    index('payouts_status_idx').on(t.status, t.requestedAt),
    index('payouts_completed_idx').on(t.completedAt),
  ],
);

export const payoutEvents = pgTable(
  'payout_events',
  {
    id: id(),
    payoutId: uuid('payout_id')
      .notNull()
      .references(() => payouts.id),
    status: text('status').notNull(),
    message: text('message').notNull(),
    actor: text('actor').notNull().default('system'),
    createdAt: createdAt(),
  },
  (t) => [index('payout_events_payout_idx').on(t.payoutId, t.createdAt)],
);

/* ════════════════════════════════════════════════════════════════════════════
 * Missing-credit claims
 * ════════════════════════════════════════════════════════════════════════════ */

export const claims = pgTable(
  'claims',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    clickId: uuid('click_id')
      .notNull()
      .references(() => offerClicks.id),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => offers.id),
    status: text('status')
      .$type<'submitted' | 'checking' | 'needs_review' | 'approved' | 'rejected'>()
      .notNull()
      .default('submitted'),
    resolution: text('resolution').$type<
      'postback_found' | 'network_confirmed' | 'goodwill_auto' | 'goodwill_manual' | 'sla_auto' | 'rejected'
    >(),
    amountMicros: money('amount_micros').notNull(),
    note: text('note').notNull(),
    completedAtEstimate: ts('completed_at_estimate'),
    screenshotPath: text('screenshot_path'),
    autoFiled: boolean('auto_filed').notNull().default(false),
    slaDueAt: ts('sla_due_at').notNull(),
    resolvedAt: ts('resolved_at'),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    rejectionReason: text('rejection_reason'),
    chaseNetwork: boolean('chase_network').notNull().default(false),
    ledgerTxnId: uuid('ledger_txn_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('claims_click_uq').on(t.clickId),
    index('claims_status_idx').on(t.status, t.slaDueAt),
    index('claims_user_idx').on(t.userId, t.createdAt),
  ],
);

export const claimEvents = pgTable(
  'claim_events',
  {
    id: id(),
    claimId: uuid('claim_id')
      .notNull()
      .references(() => claims.id),
    type: text('type').notNull(),
    message: text('message').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('claim_events_claim_idx').on(t.claimId, t.createdAt)],
);

/* ════════════════════════════════════════════════════════════════════════════
 * Fraud, KYC, referrals
 * ════════════════════════════════════════════════════════════════════════════ */

export const fraudFlags = pgTable(
  'fraud_flags',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    type: text('type').notNull(),
    severity: integer('severity').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    occurrences: integer('occurrences').notNull().default(1),
    status: text('status').$type<'open' | 'cleared' | 'confirmed'>().notNull().default('open'),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    resolvedAt: ts('resolved_at'),
    resolutionNote: text('resolution_note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('fraud_flags_user_idx').on(t.userId),
    index('fraud_flags_status_idx').on(t.status, t.createdAt),
  ],
);

export const ipRules = pgTable('ip_rules', {
  id: id(),
  cidr: text('cidr').notNull(),
  kind: text('kind').$type<'datacenter' | 'vpn' | 'shared_ok' | 'blocked'>().notNull(),
  note: text('note'),
  createdAt: createdAt(),
});

export const kycSubmissions = pgTable(
  'kyc_submissions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    idType: text('id_type').notNull(),
    idNumberEnc: text('id_number_enc').notNull(),
    idNumberMasked: text('id_number_masked').notNull(),
    fullName: text('full_name').notNull(),
    dateOfBirth: date('date_of_birth').notNull(),
    documentPath: text('document_path'),
    selfiePath: text('selfie_path'),
    status: text('status').$type<'pending' | 'verified' | 'rejected'>().notNull().default('pending'),
    reviewerNote: text('reviewer_note'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: ts('reviewed_at'),
    createdAt: createdAt(),
  },
  (t) => [index('kyc_user_idx').on(t.userId), index('kyc_status_idx').on(t.status)],
);

export const referrals = pgTable(
  'referrals',
  {
    id: id(),
    referrerId: uuid('referrer_id')
      .notNull()
      .references(() => users.id),
    refereeId: uuid('referee_id')
      .notNull()
      .references(() => users.id),
    status: text('status').$type<'pending' | 'qualified' | 'rejected'>().notNull().default('pending'),
    rejectionReason: text('rejection_reason'),
    qualifiedAt: ts('qualified_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('referrals_referee_uq').on(t.refereeId),
    index('referrals_referrer_idx').on(t.referrerId),
  ],
);

/* ════════════════════════════════════════════════════════════════════════════
 * Engagement
 * ════════════════════════════════════════════════════════════════════════════ */

export const streaks = pgTable('streaks', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id),
  current: integer('current').notNull().default(0),
  longest: integer('longest').notNull().default(0),
  lastClaimDate: date('last_claim_date'),
  updatedAt: updatedAt(),
});

export const achievements = pgTable(
  'achievements',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    code: text('code').notNull(),
    unlockedAt: ts('unlocked_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.code] })],
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    link: text('link'),
    readAt: ts('read_at'),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);

export const dailyPlans = pgTable(
  'daily_plans',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    planDate: date('plan_date').notNull(),
    offerIds: jsonb('offer_ids').$type<string[]>().notNull(),
    bonusPaid: boolean('bonus_paid').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.planDate] })],
);

/* ════════════════════════════════════════════════════════════════════════════
 * Support & community & charity
 * ════════════════════════════════════════════════════════════════════════════ */

export const tickets = pgTable(
  'tickets',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id),
    email: text('email'),
    subject: text('subject').notNull(),
    category: text('category').notNull(),
    status: text('status').$type<'open' | 'pending_user' | 'resolved' | 'closed'>().notNull().default('open'),
    priority: text('priority').$type<'normal' | 'high'>().notNull().default('normal'),
    slaDueAt: ts('sla_due_at').notNull(),
    assignedTo: uuid('assigned_to').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('tickets_status_idx').on(t.status, t.slaDueAt), index('tickets_user_idx').on(t.userId)],
);

export const ticketMessages = pgTable(
  'ticket_messages',
  {
    id: id(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id),
    authorType: text('author_type').$type<'user' | 'staff' | 'system'>().notNull(),
    authorId: uuid('author_id').references(() => users.id),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('ticket_messages_ticket_idx').on(t.ticketId, t.createdAt)],
);

export const featureRequests = pgTable(
  'feature_requests',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    status: text('status')
      .$type<'open' | 'planned' | 'in_progress' | 'shipped' | 'declined'>()
      .notNull()
      .default('open'),
    votes: integer('votes').notNull().default(0),
    shippedAt: ts('shipped_at'),
    createdAt: createdAt(),
  },
  (t) => [index('feature_requests_votes_idx').on(t.votes)],
);

export const featureVotes = pgTable(
  'feature_votes',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    requestId: uuid('request_id')
      .notNull()
      .references(() => featureRequests.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.requestId] })],
);

export const charities = pgTable('charities', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  icon: text('icon').notNull(),
  url: text('url').notNull(),
  impactUnit: text('impact_unit').notNull(),
  impactUnitMicros: money('impact_unit_micros').notNull(),
  active: boolean('active').notNull().default(true),
});

export const donations = pgTable(
  'donations',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    charityId: text('charity_id')
      .notNull()
      .references(() => charities.id),
    amountMicros: money('amount_micros').notNull(),
    source: text('source').$type<'auto' | 'manual'>().notNull(),
    ledgerTxnId: uuid('ledger_txn_id'),
    createdAt: createdAt(),
  },
  (t) => [index('donations_user_idx').on(t.userId), index('donations_charity_idx').on(t.charityId)],
);

/* ════════════════════════════════════════════════════════════════════════════
 * Platform: settings, audit log, job queue, sandbox network state
 * ════════════════════════════════════════════════════════════════════════════ */

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  updatedAt: updatedAt(),
  updatedBy: uuid('updated_by').references(() => users.id),
});

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    actorId: uuid('actor_id').references(() => users.id),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    before: jsonb('before').$type<unknown>(),
    after: jsonb('after').$type<unknown>(),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_created_idx').on(t.createdAt), index('audit_target_idx').on(t.targetType, t.targetId)],
);

export const jobs = pgTable(
  'jobs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    status: text('status').$type<'queued' | 'running' | 'done' | 'failed'>().notNull().default('queued'),
    runAt: ts('run_at').notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    lastError: text('last_error'),
    dedupeKey: text('dedupe_key'),
    lockedAt: ts('locked_at'),
    completedAt: ts('completed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('jobs_due_idx').on(t.status, t.runAt),
    uniqueIndex('jobs_dedupe_uq')
      .on(t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
  ],
);

/** The simulated network's *own* records (what a real network would store on their side). */
export const sandboxNetworkConversions = pgTable(
  'sandbox_network_conversions',
  {
    id: id(),
    networkId: text('network_id').notNull(),
    clickId: uuid('click_id').notNull(),
    networkTxnId: text('network_txn_id').notNull(),
    userRef: text('user_ref').notNull(),
    networkOfferId: text('network_offer_id').notNull(),
    payoutMicros: money('payout_micros').notNull(),
    kind: text('kind').$type<'complete' | 'screenout'>().notNull().default('complete'),
    deliveryMode: text('delivery_mode').notNull(),
    status: text('status').$type<'converted' | 'reversed'>().notNull().default('converted'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('sandbox_conv_click_uq').on(t.networkId, t.clickId),
    uniqueIndex('sandbox_conv_txn_uq').on(t.networkTxnId),
  ],
);
