import { z } from 'zod';
import {
  DATA_USAGE,
  OFFER_CATEGORIES,
  OFFER_REPORT_REASONS,
  OFFER_SORTS,
  PLATFORMS,
  TICKET_CATEGORIES,
  VIDEO_EVENTS,
} from './constants';
import { MICROS } from './money';

/* ----------------------------------------------------------------------------
 * Primitives
 * ------------------------------------------------------------------------- */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long')
  .pipe(z.email('Enter a valid email address'));

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwertyuiop', 'qwerty123',
  'iloveyou', 'abc12345', 'letmein1', 'welcome1', 'admin123', '11111111', '00000000', 'football', 'baseball',
]);

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128, 'Use at most 128 characters')
  .refine((p) => !COMMON_PASSWORDS.has(p.toLowerCase()), 'This password is too common — pick something unique');

export const countryCodeSchema = z
  .string()
  .trim()
  .length(2, 'Pick a country')
  .transform((s) => s.toUpperCase());

export const otpCodeSchema = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code');
export const e164PhoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, 'Use international format, e.g. +2348012345678');

export const microsSchema = z.number().int('Amounts must be whole micros').safe();
export const positiveMicros = microsSchema.positive('Amount must be greater than zero');

/* ----------------------------------------------------------------------------
 * Auth
 * ------------------------------------------------------------------------- */
export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(2, 'At least 2 characters').max(40, 'At most 40 characters'),
  country: countryCodeSchema,
  timezone: z.string().max(64).optional(),
  referralCode: z.string().trim().max(24).optional().or(z.literal('')),
  acceptTerms: z.literal(true, 'You must accept the terms to continue'),
  confirmAge: z.literal(true, 'You must be 18 or older'),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const login2faSchema = z.object({
  challengeId: z.string().min(10).max(200),
  code: otpCodeSchema,
});

export const tokenSchema = z.object({ token: z.string().min(16).max(200) });
export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({ token: z.string().min(16).max(200), password: passwordSchema });

/* ----------------------------------------------------------------------------
 * Account
 * ------------------------------------------------------------------------- */
export const preferencesSchema = z.object({
  dataSaver: z.boolean().optional(),
  theme: z.enum(['system', 'light', 'dark']).optional(),
  emailPayouts: z.boolean().optional(),
  emailCredits: z.boolean().optional(),
  emailStreak: z.boolean().optional(),
  emailProduct: z.boolean().optional(),
  leaderboardOptIn: z.boolean().optional(),
  showLocalCurrency: z.boolean().optional(),
  interests: z.array(z.enum(OFFER_CATEGORIES)).max(OFFER_CATEGORIES.length).optional(),
  dailyMinutes: z.number().int().min(1).max(240).optional(),
});
export type PreferencesInput = z.infer<typeof preferencesSchema>;

export const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(2).max(40).optional(),
  country: countryCodeSchema.optional(),
  timezone: z.string().max(64).optional(),
  preferences: preferencesSchema.optional(),
});
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

export const goalSchema = z.object({
  label: z.string().trim().min(2, 'Name your goal').max(60),
  targetMicros: z
    .number()
    .int()
    .min(MICROS / 2, 'Goals start at $0.50')
    .max(MICROS * 10_000, 'Goals max out at $10,000'),
});
export type GoalInput = z.infer<typeof goalSchema>;

export const onboardingSchema = z.object({
  country: countryCodeSchema,
  interests: z.array(z.enum(OFFER_CATEGORIES)).max(OFFER_CATEGORIES.length),
  dailyMinutes: z.number().int().min(1).max(240),
  dataSaver: z.boolean(),
  goal: goalSchema.optional().nullable(),
});
export type OnboardingInput = z.infer<typeof onboardingSchema>;

export const phoneStartSchema = z.object({ phone: e164PhoneSchema });
export const phoneVerifySchema = z.object({ code: otpCodeSchema });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema });
export const totpEnableSchema = z.object({ code: otpCodeSchema });
export const totpDisableSchema = z.object({ password: z.string().min(1).max(128), code: otpCodeSchema });
export const deleteAccountSchema = z.object({
  password: z.string().min(1).max(128),
  confirm: z.literal('DELETE', 'Type DELETE to confirm'),
});

export const kycSubmitSchema = z.object({
  documentType: z.enum(['passport', 'national_id', 'drivers_license']),
  documentCountry: countryCodeSchema,
  documentNumber: z.string().trim().min(4).max(40),
  legalName: z.string().trim().min(3).max(120),
  dateOfBirth: z.iso.date('Use YYYY-MM-DD'),
  documentUploadId: z.uuid(),
  selfieUploadId: z.uuid(),
});
export type KycSubmitInput = z.infer<typeof kycSubmitSchema>;

/* ----------------------------------------------------------------------------
 * Offers & video
 * ------------------------------------------------------------------------- */
export const offerListQuerySchema = z.object({
  category: z.enum([...OFFER_CATEGORIES, 'all']).optional(),
  sort: z.enum(OFFER_SORTS).optional(),
  maxMinutes: z.coerce.number().int().min(1).max(10_000).optional(),
  minHourlyMicros: z.coerce.number().int().min(0).optional(),
  dataUsage: z.enum(DATA_USAGE).optional(),
  q: z.string().trim().max(80).optional(),
  featured: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type OfferListQuery = z.infer<typeof offerListQuerySchema>;

export const offerReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});
export const offerReportSchema = z.object({
  reason: z.enum(OFFER_REPORT_REASONS),
  details: z.string().trim().max(1000).optional(),
});

export const videoEventSchema = z.object({
  type: z.enum(VIDEO_EVENTS),
  t: z.number().min(0).max(10 * 60 * 1000),
});

/* ----------------------------------------------------------------------------
 * Payouts
 * ------------------------------------------------------------------------- */
export const payoutQuoteSchema = z.object({
  methodId: z.string().min(2).max(60),
  amountMicros: positiveMicros,
});
export const payoutRequestSchema = z
  .object({
    methodId: z.string().min(2).max(60),
    amountMicros: positiveMicros,
    destinationId: z.uuid().optional(),
    destination: z.record(z.string(), z.string().max(200)).optional(),
    saveDestination: z.boolean().optional(),
    idempotencyKey: z.string().min(8).max(100),
  })
  .refine((v) => v.destinationId || v.destination, { message: 'Add where we should send the money', path: ['destination'] });
export type PayoutRequestInput = z.infer<typeof payoutRequestSchema>;

/* ----------------------------------------------------------------------------
 * Claims & support
 * ------------------------------------------------------------------------- */
export const claimCreateSchema = z.object({
  clickId: z.uuid('Pick the offer you completed'),
  completedAt: z.iso.datetime({ offset: true, error: 'When did you finish?' }),
  note: z.string().trim().max(1000).optional(),
  uploadId: z.uuid().optional(),
});
export type ClaimCreateInput = z.infer<typeof claimCreateSchema>;

export const ticketCreateSchema = z.object({
  subject: z.string().trim().min(3, 'Add a short subject').max(120),
  category: z.enum(TICKET_CATEGORIES),
  message: z.string().trim().min(10, 'Tell us a little more (10+ characters)').max(5000),
  relatedType: z.enum(['payout', 'claim', 'offer', 'transaction']).optional(),
  relatedId: z.string().max(64).optional(),
});
export type TicketCreateInput = z.infer<typeof ticketCreateSchema>;

export const ticketReplySchema = z.object({ message: z.string().trim().min(1).max(5000) });

export const contactSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: emailSchema,
  message: z.string().trim().min(10).max(5000),
});

/* ----------------------------------------------------------------------------
 * Admin
 * ------------------------------------------------------------------------- */
export const adminReasonSchema = z.object({ reason: z.string().trim().min(5, 'Give a clear reason (users will see it)').max(1000) });
export const adminUserStatusSchema = z.object({
  status: z.enum(['active', 'restricted', 'banned']),
  reason: z.string().trim().min(5).max(1000),
});
export const adminAdjustSchema = z.object({
  amountMicros: microsSchema.refine((v) => v !== 0, 'Amount cannot be zero'),
  reason: z.string().trim().min(5).max(500),
});
export const adminNoteSchema = z.object({ note: z.string().trim().min(2).max(2000) });
export const adminRoleSchema = z.object({ role: z.enum(['user', 'support', 'admin']) });
export const adminKycDecisionSchema = z.object({ decision: z.enum(['verified', 'rejected']), reason: z.string().trim().max(500).optional() });
export const adminClaimDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().min(5).max(1000),
  amountMicros: positiveMicros.optional(),
});
export const adminFraudResolveSchema = z.object({
  action: z.enum(['clear', 'restrict', 'ban']),
  note: z.string().trim().min(5).max(1000),
});

const goalDefSchema = z.object({
  id: z.string().trim().min(1).max(40),
  label: z.string().trim().min(2).max(120),
  partnerPayoutMicros: positiveMicros,
});

export const adminOfferSchema = z.object({
  networkId: z.string().min(2).max(40),
  externalId: z.string().trim().max(120).optional(),
  title: z.string().trim().min(3).max(120),
  advertiser: z.string().trim().min(2).max(80),
  shortDescription: z.string().trim().min(5).max(160),
  description: z.string().trim().max(4000).default(''),
  category: z.enum(OFFER_CATEGORIES),
  icon: z.string().trim().max(16).default('🎯'),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#10b981'),
  partnerPayoutMicros: positiveMicros,
  estimatedMinutes: z.number().min(0.25).max(60 * 24 * 30),
  dataUsage: z.enum(DATA_USAGE),
  steps: z.array(z.string().trim().min(2).max(200)).max(12).default([]),
  requirements: z.array(z.string().trim().min(2).max(200)).max(12).default([]),
  goals: z.array(goalDefSchema).max(20).default([]),
  countries: z.array(z.string().length(2)).max(250).default([]),
  platforms: z.array(z.enum(PLATFORMS)).min(1).default(['web']),
  holdHours: z.number().int().min(0).max(24 * 60).nullable().default(null),
  conversionWindowHours: z.number().int().min(1).max(24 * 90).default(72),
  featured: z.boolean().default(false),
  status: z.enum(['active', 'paused', 'archived']).default('active'),
  sandboxDropPostback: z.boolean().default(false),
  sandboxDelaySeconds: z.number().int().min(0).max(600).default(3),
});
export type AdminOfferInput = z.infer<typeof adminOfferSchema>;

export const adminNetworkUpdateSchema = z.object({
  status: z.enum(['active', 'disabled']).optional(),
  ipAllowlist: z.array(z.string().max(64)).max(100).optional(),
  revenueShareBps: z.number().int().min(0).max(10_000).nullable().optional(),
});

export const settingsSchema = z.object({
  revenueShareBps: z.number().int().min(1000).max(9500),
  welcomeBonusMicros: microsSchema.min(0),
  referralRefereeBonusMicros: microsSchema.min(0),
  referralReferrerBonusMicros: microsSchema.min(0),
  referralCommissionBps: z.number().int().min(0).max(5000),
  referralCommissionMonths: z.number().int().min(0).max(120),
  planBonusMicros: microsSchema.min(0),
  autoApprovePayoutMaxMicros: microsSchema.min(0),
  kycSinglePayoutMicros: microsSchema.min(0),
  kycLifetimeMicros: microsSchema.min(0),
  maxPayoutsPerDay: z.number().int().min(1).max(100),
  maxPayoutWeeklyMicros: microsSchema.min(0),
  requirePhoneForPayout: z.boolean(),
  holdThresholdMicros: microsSchema.min(0),
  holdHoursDefault: z.number().int().min(0).max(24 * 30),
  holdHoursHighValue: z.number().int().min(0).max(24 * 30),
  highValueThresholdMicros: microsSchema.min(0),
  claimSlaHours: z.number().int().min(1).max(24 * 14),
  ticketSlaHours: z.number().int().min(1).max(24 * 14),
  videoCooldownSeconds: z.number().int().min(0).max(600),
  sandboxPayoutFailureRate: z.number().min(0).max(1),
  maintenanceBanner: z.string().max(300),
});
export type SettingsInput = z.infer<typeof settingsSchema>;
