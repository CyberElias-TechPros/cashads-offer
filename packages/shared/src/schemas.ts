import { z } from 'zod';
import { BAN_REASON_CODES, COUNTRY_CODES, OFFER_CATEGORY_IDS, OFFER_REPORT_REASONS } from './catalog';

/* ── primitives ─────────────────────────────────────────────────────────────── */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ error: 'Enter a valid email address' }));

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200, 'That password is too long')
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Use letters and at least one number');

export const microsSchema = z.number().int().safe();
export const positiveMicrosSchema = z.number().int().positive().safe();
export const uuidSchema = z.uuid();
export const countrySchema = z.enum(COUNTRY_CODES);

/** Query-string boolean ("true" / "1" / true). `z.coerce.boolean()` would treat "false" as true. */
export const queryBool = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

export const paginationQuery = z.object({
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/* ── auth ───────────────────────────────────────────────────────────────────── */

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  country: countrySchema,
  timezone: z.string().max(64).optional(),
  referralCode: z.string().trim().toUpperCase().max(20).optional(),
  acceptTerms: z.literal(true, { error: 'You need to accept the terms to continue' }),
  confirmAdult: z.literal(true, { error: 'Lucrum is for people aged 18+' }),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const mfaLoginSchema = z.object({
  mfaToken: z.string().min(10).max(200),
  code: z.string().trim().min(6).max(20),
});

export const tokenSchema = z.object({ token: z.string().min(10).max(200) });
export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({ token: z.string().min(10).max(200), password: passwordSchema });
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export const phoneStartSchema = z.object({
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9\s-]{8,20}$/, 'Enter a valid phone number with country code'),
});
export const otpSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

/* ── profile & preferences ──────────────────────────────────────────────────── */

export const updateProfileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, 'At least 2 characters')
    .max(24, 'At most 24 characters')
    .regex(/^[\p{L}\p{N} _.-]+$/u, 'Letters, numbers, spaces, dots, dashes and underscores only')
    .nullable()
    .optional(),
  fullName: z.string().trim().max(100).nullable().optional(),
  country: countrySchema.optional(),
  timezone: z.string().max(64).optional(),
  language: z.enum(['en']).optional(),
  displayCurrency: z.string().length(3).optional(),
});

export const userPrefsSchema = z.object({
  dataSaver: z.boolean(),
  privacyMode: z.boolean(),
  leaderboardOptIn: z.boolean(),
  showOnPayoutWall: z.boolean(),
  theme: z.enum(['system', 'light', 'dark']),
  reduceMotion: z.boolean(),
  notifyEmail: z.object({
    payouts: z.boolean(),
    claims: z.boolean(),
    streaks: z.boolean(),
    offers: z.boolean(),
    security: z.boolean(),
  }),
  charityPercent: z.number().int().min(0).max(100),
  charityId: z.string().max(40).nullable(),
  savingsGoalMicros: microsSchema.nullable(),
  savingsGoalLabel: z.string().max(60).nullable(),
});
export type UserPrefs = z.infer<typeof userPrefsSchema>;
export const updatePrefsSchema = userPrefsSchema.partial().extend({
  notifyEmail: userPrefsSchema.shape.notifyEmail.partial().optional(),
});

export const DEFAULT_PREFS: UserPrefs = {
  dataSaver: false,
  privacyMode: false,
  leaderboardOptIn: false,
  showOnPayoutWall: false,
  theme: 'system',
  reduceMotion: false,
  notifyEmail: { payouts: true, claims: true, streaks: false, offers: false, security: true },
  charityPercent: 0,
  charityId: null,
  savingsGoalMicros: null,
  savingsGoalLabel: null,
};

export const deleteAccountSchema = z.object({
  password: z.string().min(1).max(200),
  confirm: z.literal('DELETE', { error: 'Type DELETE to confirm' }),
});

/* ── offers ─────────────────────────────────────────────────────────────────── */

export const offerSortSchema = z.enum(['hourly', 'payout', 'quick', 'new', 'quality']);
export type OfferSort = z.infer<typeof offerSortSchema>;

export const offersQuerySchema = z.object({
  category: z.enum(OFFER_CATEGORY_IDS).optional(),
  q: z.string().trim().max(80).optional(),
  sort: offerSortSchema.default('hourly'),
  minHourlyMicros: z.coerce.number().int().min(0).optional(),
  maxMinutes: z.coerce.number().min(0).max(240).optional(),
  lite: queryBool.optional(),
  hideCompleted: queryBool.optional(),
});
export type OffersQuery = z.infer<typeof offersQuerySchema>;

export const offerRateSchema = z.object({ value: z.union([z.literal(1), z.literal(-1)]) });
export const offerReportSchema = z.object({
  reason: z.enum(OFFER_REPORT_REASONS.map((r) => r.id) as [string, ...string[]]),
  details: z.string().trim().max(1000).optional(),
});

/* ── rewarded video ─────────────────────────────────────────────────────────── */

export const adSessionCreateSchema = z.object({
  creativeId: z.string().min(1).max(64),
  takeover: z.boolean().optional(),
});
export const AD_EVENT_TYPES = [
  'loaded',
  'started',
  'quartile',
  'paused',
  'resumed',
  'hidden',
  'visible',
  'completed',
  'closed',
  'error',
] as const;
export type AdEventType = (typeof AD_EVENT_TYPES)[number];
export const adEventSchema = z.object({
  type: z.enum(AD_EVENT_TYPES),
  mediaTime: z.number().min(0).max(600),
  quartile: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
});

/* ── quick tasks & lessons ──────────────────────────────────────────────────── */

export const pollAnswerSchema = z.object({ optionIndex: z.number().int().min(0).max(20) });
export const lessonSubmitSchema = z.object({ answers: z.array(z.number().int().min(0).max(10)).max(20) });

/* ── missing credit claims ──────────────────────────────────────────────────── */

export const claimCreateSchema = z.object({
  clickId: uuidSchema,
  completedAt: z.iso.datetime({ offset: true }).optional(),
  note: z.string().trim().min(5, 'Tell us briefly what happened').max(1000),
});

/* ── payouts ────────────────────────────────────────────────────────────────── */

export const payoutDetailsSchema = z.record(z.string().max(40), z.string().trim().max(200));

export const payoutQuoteSchema = z.object({
  methodId: z.string().max(40),
  amountMicros: positiveMicrosSchema,
});

export const payoutCreateSchema = z.object({
  methodId: z.string().max(40),
  amountMicros: positiveMicrosSchema,
  destinationId: uuidSchema.optional(),
  details: payoutDetailsSchema.optional(),
  saveDestination: z.boolean().optional(),
  idempotencyKey: z.string().min(8).max(80),
  totpCode: z.string().trim().max(20).optional(),
});
export type PayoutCreateInput = z.infer<typeof payoutCreateSchema>;

export const destinationCreateSchema = z.object({
  methodId: z.string().max(40),
  details: payoutDetailsSchema,
  label: z.string().trim().max(40).optional(),
});

export const nameEnquirySchema = z.object({
  methodId: z.string().max(40),
  details: payoutDetailsSchema,
});

/* ── support, community, charity, kyc ───────────────────────────────────────── */

export const TICKET_CATEGORIES = ['missing_credit', 'payout', 'account', 'offer', 'appeal', 'other'] as const;
export const ticketCreateSchema = z.object({
  subject: z.string().trim().min(4, 'Add a short subject').max(120),
  category: z.enum(TICKET_CATEGORIES),
  message: z.string().trim().min(10, 'Tell us a little more (10+ characters)').max(4000),
  email: emailSchema.optional(),
});
export const ticketReplySchema = z.object({ message: z.string().trim().min(1).max(4000) });
export const appealSchema = z.object({
  message: z.string().trim().min(20, 'Please explain in at least 20 characters').max(4000),
});

export const featureRequestCreateSchema = z.object({
  title: z.string().trim().min(5, 'At least 5 characters').max(120),
  body: z.string().trim().max(2000).default(''),
});

export const donateSchema = z.object({ charityId: z.string().max(40), amountMicros: positiveMicrosSchema });

export const KYC_ID_TYPES = ['nin', 'passport', 'drivers_license', 'voters_card', 'national_id'] as const;
export const kycSubmitSchema = z.object({
  idType: z.enum(KYC_ID_TYPES),
  idNumber: z.string().trim().min(4).max(40),
  fullName: z.string().trim().min(3).max(100),
  dateOfBirth: z.iso.date(),
});

/* ── platform settings (admin-editable, typed) ──────────────────────────────── */

export const settingsSchema = z.object({
  revenueShareBps: z.number().int().min(0).max(10_000),
  firstTaskBonusMicros: microsSchema.min(0),
  streakBaseMicros: microsSchema.min(0),
  streakStepMicros: microsSchema.min(0),
  streakMaxMicros: microsSchema.min(0),
  planBonusMicros: microsSchema.min(0),
  referralBonusMicros: microsSchema.min(0),
  referralResidualBps: z.number().int().min(0).max(5_000),
  adDailyCap: z.number().int().min(0).max(500),
  adComboBps: z.array(z.number().int().min(10_000).max(30_000)).min(1).max(10),
  adComboWindowMinutes: z.number().int().min(1).max(120),
  payoutMaxPerDay: z.number().int().min(1).max(100),
  kycThresholdMicros: microsSchema.min(0),
  phoneRequiredAboveMicros: microsSchema.min(0),
  autoApproveMaxFraudScore: z.number().int().min(0).max(100),
  blockMinFraudScore: z.number().int().min(0).max(100),
  claimMinWaitMinutes: z.number().int().min(0).max(1440),
  claimSlaHours: z.number().int().min(1).max(168),
  claimAutoGoodwillPerMonth: z.number().int().min(0).max(50),
  reversalPolicy: z.enum(['absorb', 'clawback']),
  claimSlaAutoApproveMaxMicros: microsSchema.min(0),
  offerAutoPauseReports: z.number().int().min(1).max(100),
  fraudIpSignals: z.boolean(),
  postbackMaxAgeHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30),
  maintenanceMode: z.boolean(),
  fxRates: z.record(z.string().length(3), z.number().positive()),
  sandboxPostbackDelayMs: z.number().int().min(0).max(120_000),
  sandboxProviderOutages: z.record(z.string(), z.boolean()),
});
export type Settings = z.infer<typeof settingsSchema>;
export const settingsPatchSchema = settingsSchema.partial();

/* ── admin ──────────────────────────────────────────────────────────────────── */

export const ROLES = ['user', 'support', 'finance', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const adminBanSchema = z.object({
  reasonCode: z.enum(BAN_REASON_CODES),
  message: z.string().trim().min(10, 'Explain the specific reason (10+ characters)').max(2000),
});
export const adminAdjustSchema = z.object({
  amountMicros: microsSchema.refine((v) => v !== 0, 'Amount cannot be zero'),
  reason: z.string().trim().min(5).max(500),
});
export const adminNoteSchema = z.object({ note: z.string().trim().min(1).max(2000) });
export const adminRoleSchema = z.object({ role: z.enum(ROLES) });
export const adminPayoutRejectSchema = z.object({
  reason: z.string().trim().min(5).max(500),
  refund: z.boolean().default(true),
});
export const adminBatchSchema = z.object({ ids: z.array(uuidSchema).min(1).max(200) });
export const adminFlagResolveSchema = z.object({
  action: z.enum(['clear', 'confirm', 'require_kyc', 'ban']),
  note: z.string().trim().min(3).max(1000),
  reasonCode: z.enum(BAN_REASON_CODES).optional(),
});
export const adminClaimApproveSchema = z.object({
  note: z.string().trim().max(1000).optional(),
  amountMicros: positiveMicrosSchema.optional(),
});
export const adminClaimRejectSchema = z.object({ reason: z.string().trim().min(5).max(1000) });
export const adminOfferUpsertSchema = z.object({
  networkId: z.string().max(40),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(2000),
  advertiser: z.string().trim().min(2).max(80),
  category: z.enum(OFFER_CATEGORY_IDS),
  payoutMicros: positiveMicrosSchema,
  userPayoutOverrideMicros: positiveMicrosSchema.nullable().optional(),
  estMinutes: z.number().positive().max(600),
  dataMb: z.number().min(0).max(2000),
  paySpeed: z.enum(['instant', 'hours', 'days']),
  countries: z.array(countrySchema).max(50),
  steps: z.array(z.string().trim().min(2).max(200)).max(10),
  icon: z.string().max(8),
  color: z.string().max(20),
  tags: z.array(z.string().max(30)).max(10),
  isLite: z.boolean(),
});
export const adminOfferStatusSchema = z.object({
  status: z.enum(['active', 'paused', 'removed', 'scam']),
  reason: z.string().trim().max(500).optional(),
});
export const adminReportResolveSchema = z.object({
  action: z.enum(['actioned', 'dismissed']),
  note: z.string().trim().max(500).optional(),
});
export const adminTicketReplySchema = z.object({
  message: z.string().trim().min(1).max(4000),
  status: z.enum(['open', 'pending_user', 'resolved', 'closed']).optional(),
  appealDecision: z.enum(['uphold', 'lift']).optional(),
});
export const adminKycDecideSchema = z.object({
  decision: z.enum(['verified', 'rejected']),
  note: z.string().trim().max(500).optional(),
});
export const adminFeatureStatusSchema = z.object({
  status: z.enum(['open', 'planned', 'in_progress', 'shipped', 'declined']),
});
export const adminNetworkPatchSchema = z.object({
  status: z.enum(['active', 'paused']).optional(),
  ipAllowlist: z.array(z.string().max(64)).max(50).optional(),
});
