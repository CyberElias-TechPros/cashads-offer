import { usd, type FeeModel } from './money';

/* ────────────────────────────────────────────────────────────────────────────
 * Countries — region-first design (spec pain point #18).
 * ──────────────────────────────────────────────────────────────────────────── */

export interface Country {
  code: string;
  name: string;
  flag: string;
  currency: string;
  timezone: string;
  phonePrefix: string;
}

export const COUNTRIES: Country[] = [
  { code: 'NG', name: 'Nigeria', flag: '🇳🇬', currency: 'NGN', timezone: 'Africa/Lagos', phonePrefix: '+234' },
  { code: 'GH', name: 'Ghana', flag: '🇬🇭', currency: 'GHS', timezone: 'Africa/Accra', phonePrefix: '+233' },
  { code: 'KE', name: 'Kenya', flag: '🇰🇪', currency: 'KES', timezone: 'Africa/Nairobi', phonePrefix: '+254' },
  {
    code: 'ZA',
    name: 'South Africa',
    flag: '🇿🇦',
    currency: 'ZAR',
    timezone: 'Africa/Johannesburg',
    phonePrefix: '+27',
  },
  { code: 'IN', name: 'India', flag: '🇮🇳', currency: 'INR', timezone: 'Asia/Kolkata', phonePrefix: '+91' },
  {
    code: 'PH',
    name: 'Philippines',
    flag: '🇵🇭',
    currency: 'PHP',
    timezone: 'Asia/Manila',
    phonePrefix: '+63',
  },
  {
    code: 'BR',
    name: 'Brazil',
    flag: '🇧🇷',
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    phonePrefix: '+55',
  },
  {
    code: 'US',
    name: 'United States',
    flag: '🇺🇸',
    currency: 'USD',
    timezone: 'America/New_York',
    phonePrefix: '+1',
  },
  {
    code: 'GB',
    name: 'United Kingdom',
    flag: '🇬🇧',
    currency: 'GBP',
    timezone: 'Europe/London',
    phonePrefix: '+44',
  },
  { code: 'CA', name: 'Canada', flag: '🇨🇦', currency: 'CAD', timezone: 'America/Toronto', phonePrefix: '+1' },
  {
    code: 'AU',
    name: 'Australia',
    flag: '🇦🇺',
    currency: 'AUD',
    timezone: 'Australia/Sydney',
    phonePrefix: '+61',
  },
  { code: 'DE', name: 'Germany', flag: '🇩🇪', currency: 'EUR', timezone: 'Europe/Berlin', phonePrefix: '+49' },
];

export const COUNTRY_CODES = COUNTRIES.map((c) => c.code) as [string, ...string[]];

export function getCountry(code: string | null | undefined): Country {
  return COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[0]!;
}

/** Best-effort country guess from a browser timezone (used to prefill signup). */
export function guessCountryFromTimezone(tz: string | undefined): string {
  if (!tz) return 'NG';
  const exact = COUNTRIES.find((c) => c.timezone === tz);
  if (exact) return exact.code;
  if (tz.startsWith('America/')) return 'US';
  if (tz.startsWith('Australia/')) return 'AU';
  if (tz.startsWith('Europe/')) return 'GB';
  if (tz.startsWith('Africa/')) return 'NG';
  return 'US';
}

/* ────────────────────────────────────────────────────────────────────────────
 * Payout methods — local rails everywhere (spec pain point #7).
 * "No minimum" from CashAds: `minMicros` is ONLY a provider-imposed floor.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface PayoutField {
  key: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'select';
  placeholder?: string;
  pattern?: string;
  patternMessage?: string;
  options?: { value: string; label: string }[];
  help?: string;
}

export interface PayoutMethod extends FeeModel {
  id: string;
  name: string;
  provider: string;
  kind: 'bank' | 'mobile_money' | 'wallet' | 'crypto' | 'gift_card' | 'airtime';
  icon: string;
  countries: string[] | 'global';
  currency: string;
  minMicros: number;
  maxMicros: number;
  speed: string;
  etaSeconds: number;
  description: string;
  fields: PayoutField[];
  /** Whether the destination name can be resolved before sending (e.g. NUBAN name enquiry). */
  supportsNameEnquiry?: boolean;
}

export const NG_BANKS = [
  { value: '058', label: 'GTBank' },
  { value: '044', label: 'Access Bank' },
  { value: '057', label: 'Zenith Bank' },
  { value: '011', label: 'First Bank' },
  { value: '033', label: 'UBA' },
  { value: '999992', label: 'OPay' },
  { value: '50515', label: 'Moniepoint MFB' },
  { value: '999991', label: 'PalmPay' },
  { value: '50211', label: 'Kuda Bank' },
  { value: '035', label: 'Wema Bank (ALAT)' },
];

const NG_NETWORKS = [
  { value: 'mtn', label: 'MTN' },
  { value: 'airtel', label: 'Airtel' },
  { value: 'glo', label: 'Glo' },
  { value: '9mobile', label: '9mobile' },
];

export const PAYOUT_METHODS: PayoutMethod[] = [
  {
    id: 'ng_bank',
    name: 'Bank transfer',
    provider: 'Paystack',
    kind: 'bank',
    icon: '🏦',
    countries: ['NG'],
    currency: 'NGN',
    feeFixedMicros: usd(0.007),
    feePercentBps: 0,
    minMicros: usd(0.07),
    maxMicros: usd(2000),
    speed: 'Instant · usually under 2 minutes',
    etaSeconds: 120,
    description: 'Straight to any Nigerian bank or fintech account (GTBank, OPay, Moniepoint, Kuda…).',
    supportsNameEnquiry: true,
    fields: [
      { key: 'bankCode', label: 'Bank', type: 'select', options: NG_BANKS },
      {
        key: 'accountNumber',
        label: 'Account number (NUBAN)',
        type: 'text',
        placeholder: '0123456789',
        pattern: '^\\d{10}$',
        patternMessage: 'Enter your 10-digit account number',
      },
    ],
  },
  {
    id: 'ng_airtime',
    name: 'Airtime & data',
    provider: 'VTU aggregator',
    kind: 'airtime',
    icon: '📶',
    countries: ['NG'],
    currency: 'NGN',
    feeFixedMicros: 0,
    feePercentBps: 0,
    minMicros: usd(0.04),
    maxMicros: usd(100),
    speed: 'Instant',
    etaSeconds: 30,
    description: 'Top up any MTN, Airtel, Glo or 9mobile line — perfect for tiny cash-outs.',
    fields: [
      { key: 'network', label: 'Network', type: 'select', options: NG_NETWORKS },
      {
        key: 'phone',
        label: 'Phone number',
        type: 'tel',
        placeholder: '08012345678',
        pattern: '^(?:\\+?234|0)[789][01]\\d{8}$',
        patternMessage: 'Enter a valid Nigerian phone number',
      },
    ],
  },
  {
    id: 'gh_momo',
    name: 'Mobile Money',
    provider: 'Flutterwave',
    kind: 'mobile_money',
    icon: '📱',
    countries: ['GH'],
    currency: 'GHS',
    feeFixedMicros: 0,
    feePercentBps: 100,
    minMicros: usd(0.1),
    maxMicros: usd(1000),
    speed: 'Instant',
    etaSeconds: 90,
    description: 'MTN MoMo, Telecel Cash or AirtelTigo Money.',
    fields: [
      {
        key: 'provider',
        label: 'Wallet',
        type: 'select',
        options: [
          { value: 'mtn', label: 'MTN MoMo' },
          { value: 'telecel', label: 'Telecel Cash' },
          { value: 'at', label: 'AirtelTigo Money' },
        ],
      },
      {
        key: 'phone',
        label: 'Wallet number',
        type: 'tel',
        placeholder: '0241234567',
        pattern: '^(?:\\+?233|0)\\d{9}$',
        patternMessage: 'Enter a valid Ghanaian number',
      },
    ],
  },
  {
    id: 'ke_mpesa',
    name: 'M-Pesa',
    provider: 'Safaricom B2C',
    kind: 'mobile_money',
    icon: '📲',
    countries: ['KE'],
    currency: 'KES',
    feeFixedMicros: usd(0.05),
    feePercentBps: 0,
    minMicros: usd(0.08),
    maxMicros: usd(1000),
    speed: 'Instant',
    etaSeconds: 60,
    description: 'Directly to your M-Pesa wallet.',
    fields: [
      {
        key: 'phone',
        label: 'M-Pesa number',
        type: 'tel',
        placeholder: '0712345678',
        pattern: '^(?:\\+?254|0)[71]\\d{8}$',
        patternMessage: 'Enter a valid Safaricom number',
      },
    ],
  },
  {
    id: 'za_payshap',
    name: 'Instant bank (PayShap)',
    provider: 'PayShap',
    kind: 'bank',
    icon: '🏦',
    countries: ['ZA'],
    currency: 'ZAR',
    feeFixedMicros: usd(0.05),
    feePercentBps: 0,
    minMicros: usd(0.06),
    maxMicros: usd(1500),
    speed: 'Instant',
    etaSeconds: 60,
    description: 'Real-time payment to your South African bank using your ShapID or phone.',
    fields: [{ key: 'shapId', label: 'ShapID or phone', type: 'text', placeholder: '0821234567@bank' }],
  },
  {
    id: 'in_upi',
    name: 'UPI',
    provider: 'UPI payouts',
    kind: 'bank',
    icon: '🇮🇳',
    countries: ['IN'],
    currency: 'INR',
    feeFixedMicros: 0,
    feePercentBps: 0,
    minMicros: usd(0.01),
    maxMicros: usd(1000),
    speed: 'Instant',
    etaSeconds: 45,
    description: 'Any UPI ID — Google Pay, PhonePe, Paytm, BHIM.',
    fields: [
      {
        key: 'vpa',
        label: 'UPI ID',
        type: 'text',
        placeholder: 'name@okaxis',
        pattern: '^[\\w.\\-]{2,256}@[a-zA-Z]{2,64}$',
        patternMessage: 'Enter a valid UPI ID like name@bank',
      },
    ],
  },
  {
    id: 'ph_gcash',
    name: 'GCash',
    provider: 'GCash',
    kind: 'mobile_money',
    icon: '💙',
    countries: ['PH'],
    currency: 'PHP',
    feeFixedMicros: usd(0.02),
    feePercentBps: 0,
    minMicros: usd(0.03),
    maxMicros: usd(1000),
    speed: 'Instant',
    etaSeconds: 60,
    description: 'Straight to your GCash wallet.',
    fields: [
      {
        key: 'phone',
        label: 'GCash number',
        type: 'tel',
        placeholder: '09171234567',
        pattern: '^(?:\\+?63|0)9\\d{9}$',
        patternMessage: 'Enter a valid PH mobile number',
      },
    ],
  },
  {
    id: 'br_pix',
    name: 'Pix',
    provider: 'Pix',
    kind: 'bank',
    icon: '💠',
    countries: ['BR'],
    currency: 'BRL',
    feeFixedMicros: 0,
    feePercentBps: 0,
    minMicros: usd(0.01),
    maxMicros: usd(1000),
    speed: 'Instant',
    etaSeconds: 30,
    description: 'Instant transfer to any Pix key (CPF, email, phone or random key).',
    fields: [
      { key: 'pixKey', label: 'Pix key', type: 'text', placeholder: 'email, phone, CPF or random key' },
    ],
  },
  {
    id: 'gb_fps',
    name: 'UK bank (Faster Payments)',
    provider: 'Faster Payments',
    kind: 'bank',
    icon: '🏦',
    countries: ['GB'],
    currency: 'GBP',
    feeFixedMicros: 0,
    feePercentBps: 0,
    minMicros: usd(0.02),
    maxMicros: usd(2000),
    speed: 'Instant · up to 2 hours',
    etaSeconds: 300,
    description: 'Sort code + account number.',
    fields: [
      {
        key: 'sortCode',
        label: 'Sort code',
        type: 'text',
        placeholder: '12-34-56',
        pattern: '^\\d{2}-?\\d{2}-?\\d{2}$',
        patternMessage: 'Enter a 6-digit sort code',
      },
      {
        key: 'accountNumber',
        label: 'Account number',
        type: 'text',
        placeholder: '12345678',
        pattern: '^\\d{8}$',
        patternMessage: 'Enter your 8-digit account number',
      },
    ],
  },
  {
    id: 'us_ach',
    name: 'US bank (ACH)',
    provider: 'ACH',
    kind: 'bank',
    icon: '🏦',
    countries: ['US'],
    currency: 'USD',
    feeFixedMicros: 0,
    feePercentBps: 0,
    minMicros: usd(1),
    maxMicros: usd(2500),
    speed: '1–3 business days',
    etaSeconds: 2 * 24 * 3600,
    description: 'Free transfer to a US checking or savings account.',
    fields: [
      {
        key: 'routingNumber',
        label: 'Routing number',
        type: 'text',
        placeholder: '021000021',
        pattern: '^\\d{9}$',
        patternMessage: 'Routing numbers are 9 digits',
      },
      {
        key: 'accountNumber',
        label: 'Account number',
        type: 'text',
        placeholder: '000123456789',
        pattern: '^\\d{4,17}$',
        patternMessage: 'Enter a valid account number',
      },
      {
        key: 'accountType',
        label: 'Account type',
        type: 'select',
        options: [
          { value: 'checking', label: 'Checking' },
          { value: 'savings', label: 'Savings' },
        ],
      },
    ],
  },
  {
    id: 'paypal',
    name: 'PayPal',
    provider: 'PayPal Payouts',
    kind: 'wallet',
    icon: '🅿️',
    countries: ['US', 'GB', 'CA', 'AU', 'DE', 'ZA', 'PH', 'BR', 'KE'],
    currency: 'USD',
    feeFixedMicros: 0,
    feePercentBps: 200,
    feeCapMicros: usd(1),
    minMicros: usd(0.02),
    maxMicros: usd(2500),
    speed: 'Minutes · first payout can take up to 24h',
    etaSeconds: 600,
    description: 'Sent to your PayPal email. 2% PayPal fee, capped at $1.',
    fields: [{ key: 'email', label: 'PayPal email', type: 'email', placeholder: 'you@example.com' }],
  },
  {
    id: 'amazon_gc',
    name: 'Amazon gift card',
    provider: 'Gift card partner',
    kind: 'gift_card',
    icon: '🎁',
    countries: ['US', 'GB', 'CA', 'DE', 'AU'],
    currency: 'USD',
    feeFixedMicros: 0,
    feePercentBps: 0,
    minMicros: usd(1),
    maxMicros: usd(500),
    speed: 'Instant by email',
    etaSeconds: 60,
    description: 'Delivered by email. No fee.',
    fields: [{ key: 'email', label: 'Delivery email', type: 'email', placeholder: 'you@example.com' }],
  },
  {
    id: 'btc_lightning',
    name: 'Bitcoin (Lightning)',
    provider: 'Lightning Network',
    kind: 'crypto',
    icon: '⚡',
    countries: 'global',
    currency: 'USD',
    feeFixedMicros: usd(0.001),
    feePercentBps: 0,
    minMicros: usd(0.01),
    maxMicros: usd(500),
    speed: 'Seconds',
    etaSeconds: 15,
    description: 'Tiny payouts that actually make sense — send to any Lightning address.',
    fields: [
      {
        key: 'address',
        label: 'Lightning address',
        type: 'text',
        placeholder: 'you@walletofsatoshi.com',
        pattern: '^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
        patternMessage: 'Enter a Lightning address like name@wallet.com',
      },
    ],
  },
  {
    id: 'usdt_polygon',
    name: 'USDT (Polygon)',
    provider: 'Polygon network',
    kind: 'crypto',
    icon: '🪙',
    countries: 'global',
    currency: 'USD',
    feeFixedMicros: usd(0.02),
    feePercentBps: 0,
    minMicros: usd(0.05),
    maxMicros: usd(2000),
    speed: '1–5 minutes',
    etaSeconds: 180,
    description: 'Stablecoin to any Polygon wallet. Network fee shown upfront.',
    fields: [
      {
        key: 'address',
        label: 'Polygon wallet address',
        type: 'text',
        placeholder: '0x…',
        pattern: '^0x[a-fA-F0-9]{40}$',
        patternMessage: 'Enter a valid 0x… address (42 characters)',
      },
    ],
  },
  {
    id: 'wise',
    name: 'Wise',
    provider: 'Wise',
    kind: 'bank',
    icon: '🌍',
    countries: 'global',
    currency: 'USD',
    feeFixedMicros: usd(0.3),
    feePercentBps: 100,
    minMicros: usd(1),
    maxMicros: usd(2500),
    speed: '1–2 days',
    etaSeconds: 36 * 3600,
    description: 'Receive in 40+ currencies via your Wise account.',
    fields: [{ key: 'email', label: 'Wise email', type: 'email', placeholder: 'you@example.com' }],
  },
];

export function getPayoutMethod(id: string): PayoutMethod | undefined {
  return PAYOUT_METHODS.find((m) => m.id === id);
}

export function payoutMethodsForCountry(country: string): PayoutMethod[] {
  const local = PAYOUT_METHODS.filter((m) => m.countries !== 'global' && m.countries.includes(country));
  const global = PAYOUT_METHODS.filter((m) => m.countries === 'global');
  return [...local, ...global];
}

/* ────────────────────────────────────────────────────────────────────────────
 * Offers
 * ──────────────────────────────────────────────────────────────────────────── */

export const OFFER_CATEGORIES = [
  { id: 'quick', label: 'Quick tasks', icon: '⚡', blurb: 'Under 2 minutes' },
  { id: 'survey', label: 'Surveys', icon: '📝', blurb: 'Share your opinion' },
  { id: 'app', label: 'App trials', icon: '📱', blurb: 'Install & try' },
  { id: 'signup', label: 'Sign-ups', icon: '✍️', blurb: 'Create an account' },
  { id: 'financial', label: 'Financial', icon: '💳', blurb: 'Highest payouts' },
  { id: 'learn', label: 'Earn + learn', icon: '🎓', blurb: 'Get paid to learn' },
  { id: 'video', label: 'Videos', icon: '▶️', blurb: 'Rewarded ads' },
] as const;

export type OfferCategory = (typeof OFFER_CATEGORIES)[number]['id'];
export const OFFER_CATEGORY_IDS = OFFER_CATEGORIES.map((c) => c.id) as [OfferCategory, ...OfferCategory[]];

export const PAY_SPEEDS = {
  instant: 'Credited instantly',
  hours: 'Credited within 24h',
  days: 'Credited in 1–3 days',
} as const;
export type PaySpeed = keyof typeof PAY_SPEEDS;

export const OFFER_REPORT_REASONS = [
  { id: 'scam', label: 'Scam or misleading promise' },
  { id: 'not_credited', label: 'Completed but never credited' },
  { id: 'hidden_charges', label: 'Hidden charges / surprise subscription' },
  { id: 'spam', label: 'Started spamming me' },
  { id: 'malware', label: 'Suspicious download / malware' },
  { id: 'broken', label: 'Broken or impossible to complete' },
  { id: 'other', label: 'Something else' },
] as const;
export type OfferReportReason = (typeof OFFER_REPORT_REASONS)[number]['id'];

/* ────────────────────────────────────────────────────────────────────────────
 * Statuses with human copy (shown verbatim in the UI)
 * ──────────────────────────────────────────────────────────────────────────── */

export const PAYOUT_STATUS = {
  pending: { label: 'Requested', tone: 'info', description: 'We received your request.' },
  review: {
    label: 'Under review',
    tone: 'warning',
    description: 'A quick safety review — we aim to finish within 24 hours and will tell you the outcome.',
  },
  processing: { label: 'Sending', tone: 'info', description: 'Handed to the payment provider.' },
  completed: { label: 'Paid', tone: 'success', description: 'The money has been sent.' },
  failed: {
    label: 'Failed — refunded',
    tone: 'danger',
    description: 'The provider could not complete it. The full amount is back in your balance.',
  },
  reversed: {
    label: 'Reversed',
    tone: 'danger',
    description: 'Cancelled after review. See the reason below.',
  },
  cancelled: {
    label: 'Cancelled',
    tone: 'neutral',
    description: 'You cancelled this payout. Funds returned.',
  },
} as const;
export type PayoutStatus = keyof typeof PAYOUT_STATUS;

export const CLAIM_STATUS = {
  submitted: { label: 'Submitted', tone: 'info' },
  checking: { label: 'Checking network logs', tone: 'info' },
  needs_review: { label: 'Human review (≤ 24h)', tone: 'warning' },
  approved: { label: 'Approved — paid', tone: 'success' },
  rejected: { label: 'Not approved', tone: 'danger' },
} as const;
export type ClaimStatus = keyof typeof CLAIM_STATUS;

export const CLICK_STATUS = {
  started: { label: 'In progress', tone: 'info' },
  reported: { label: 'Awaiting confirmation', tone: 'warning' },
  credited: { label: 'Credited', tone: 'success' },
  claimed: { label: 'Claim filed', tone: 'warning' },
  expired: { label: 'Expired', tone: 'neutral' },
  rejected: { label: 'Not credited', tone: 'danger' },
} as const;
export type ClickStatus = keyof typeof CLICK_STATUS;

/* ────────────────────────────────────────────────────────────────────────────
 * Account restrictions — always a specific reason + appeal (spec §7, §12).
 * ──────────────────────────────────────────────────────────────────────────── */

export const BAN_REASONS = {
  multi_account: {
    title: 'Multiple accounts',
    explanation:
      'CashAds allows one account per person. This account shares devices, payout details or sign-up patterns with other accounts.',
  },
  location_masking: {
    title: 'Location masking (VPN / proxy)',
    explanation:
      'Tasks were completed through a VPN, proxy or data-centre connection. Advertisers reject these completions, so we cannot pay for them.',
  },
  fake_completions: {
    title: 'Invalid task completions',
    explanation:
      'Tasks were completed faster than is possible for a person, or with answers the advertiser flagged as fake.',
  },
  referral_abuse: {
    title: 'Referral abuse',
    explanation: 'Referral bonuses were earned from accounts controlled by the same person.',
  },
  payment_fraud: {
    title: 'Payout details problem',
    explanation: 'The payout details used belong to someone else or have been linked to fraud reports.',
  },
  abuse: {
    title: 'Abusive behaviour',
    explanation: 'Harassment or threats toward our team or community members.',
  },
  underage: {
    title: 'Age requirement',
    explanation: 'CashAds is only available to people aged 18 and over.',
  },
  other: {
    title: 'Policy violation',
    explanation: 'See the message from our team below for the specific details.',
  },
} as const;
export type BanReasonCode = keyof typeof BAN_REASONS;
export const BAN_REASON_CODES = Object.keys(BAN_REASONS) as [BanReasonCode, ...BanReasonCode[]];

/** Member-facing wording for fraud signals — shown when a payout is held, so reasons are specific. */
export const FRAUD_SIGNAL_LABELS: Record<string, string> = {
  disposable_email: 'Your sign-up email is from a disposable email provider',
  shared_device: 'This device has also been used by another account',
  ip_velocity: 'Several accounts signed up from the same network recently',
  datacenter_ip: 'Your connection looks like a VPN, proxy or data centre',
  too_fast: 'Some tasks were completed unusually fast',
  earning_velocity: 'Unusually high earnings in a short time',
  referral_self_dealing: 'A referral between accounts that appear linked',
  shared_payout_destination: 'These payout details are also used by another account',
  claim_abuse: 'Several missing-credit claims were not approved',
  poll_speed: 'Quick tasks were answered faster than reading speed',
  ad_tampering: 'Video playback events arrived out of order',
  manual: 'Our team flagged the account for a manual check',
};

/* ────────────────────────────────────────────────────────────────────────────
 * Tiers & achievements (retention without cringe — spec §3.4, pain point #20)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface TierDef {
  id: 'bronze' | 'silver' | 'gold' | 'platinum';
  name: string;
  minLifetimeMicros: number;
  minAccountAgeDays: number;
  requiresKyc: boolean;
  /** Missing-credit claims up to this amount are paid instantly (goodwill) for members of this tier. */
  autoGoodwillMaxMicros: number;
  weeklyPayoutLimitMicros: number;
  perks: string[];
  color: string;
}

export const TIERS: TierDef[] = [
  {
    id: 'bronze',
    name: 'Bronze',
    minLifetimeMicros: 0,
    minAccountAgeDays: 0,
    requiresKyc: false,
    autoGoodwillMaxMicros: 0,
    weeklyPayoutLimitMicros: usd(500),
    perks: ['Instant payouts', 'Missing-credit claims reviewed within 24h', 'No minimum cash-out'],
    color: '#b45309',
  },
  {
    id: 'silver',
    name: 'Silver',
    minLifetimeMicros: usd(5),
    minAccountAgeDays: 7,
    requiresKyc: false,
    autoGoodwillMaxMicros: usd(2),
    weeklyPayoutLimitMicros: usd(500),
    perks: ['Missing-credit claims up to $2 paid instantly', 'Everything in Bronze'],
    color: '#64748b',
  },
  {
    id: 'gold',
    name: 'Gold',
    minLifetimeMicros: usd(25),
    minAccountAgeDays: 30,
    requiresKyc: false,
    autoGoodwillMaxMicros: usd(5),
    weeklyPayoutLimitMicros: usd(750),
    perks: ['Missing-credit claims up to $5 paid instantly', 'Priority support (4h)', 'Higher weekly limit'],
    color: '#ca8a04',
  },
  {
    id: 'platinum',
    name: 'Platinum',
    minLifetimeMicros: usd(100),
    minAccountAgeDays: 90,
    requiresKyc: true,
    autoGoodwillMaxMicros: usd(10),
    weeklyPayoutLimitMicros: usd(1500),
    perks: ['Missing-credit claims up to $10 paid instantly', 'Dedicated support', '$1,500 weekly limit'],
    color: '#7c3aed',
  },
];

export function getTier(id: string): TierDef {
  return TIERS.find((t) => t.id === id) ?? TIERS[0]!;
}

export interface AchievementDef {
  code: string;
  title: string;
  description: string;
  icon: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { code: 'first_task', title: 'First dollar energy', description: 'Complete your first task', icon: '🌱' },
  { code: 'first_payout', title: 'It’s real', description: 'Cash out for the first time', icon: '💸' },
  { code: 'tasks_10', title: 'Getting serious', description: 'Complete 10 tasks', icon: '🔟' },
  { code: 'tasks_50', title: 'Machine', description: 'Complete 50 tasks', icon: '⚙️' },
  { code: 'earned_1', title: 'First $1', description: 'Earn $1 in total', icon: '🥉' },
  { code: 'earned_10', title: '$10 club', description: 'Earn $10 in total', icon: '🥈' },
  { code: 'earned_50', title: '$50 club', description: 'Earn $50 in total', icon: '🥇' },
  { code: 'streak_3', title: 'Warming up', description: 'Reach a 3-day streak', icon: '🔥' },
  { code: 'streak_7', title: 'One full week', description: 'Reach a 7-day streak', icon: '📅' },
  { code: 'streak_30', title: 'Habit formed', description: 'Reach a 30-day streak', icon: '🏆' },
  { code: 'plan_complete', title: 'Plan executed', description: 'Finish a daily plan', icon: '✅' },
  {
    code: 'referral_1',
    title: 'Better together',
    description: 'Invite a friend who completes a task',
    icon: '🤝',
  },
  { code: 'learner', title: 'Lifelong learner', description: 'Pass 3 lessons', icon: '🎓' },
  { code: 'giver', title: 'Giver', description: 'Donate to a cause', icon: '💚' },
  {
    code: 'protector',
    title: 'Community protector',
    description: 'Report an offer that gets removed',
    icon: '🛡️',
  },
  { code: 'verified', title: 'Verified', description: 'Verify your phone number', icon: '📞' },
];

/* ────────────────────────────────────────────────────────────────────────────
 * Ledger transaction types (user-facing labels)
 * ──────────────────────────────────────────────────────────────────────────── */

export const TXN_TYPES = {
  conversion: { label: 'Task completed', group: 'earning', icon: '✅' },
  conversion_reversal: { label: 'Task reversed by advertiser', group: 'earning', icon: '↩️' },
  ad_reward: { label: 'Rewarded video', group: 'earning', icon: '▶️' },
  poll_reward: { label: 'Quick task', group: 'earning', icon: '⚡' },
  lesson_reward: { label: 'Lesson passed', group: 'earning', icon: '🎓' },
  goodwill: { label: 'Missing credit — paid by CashAds', group: 'earning', icon: '🤝' },
  bonus_streak: { label: 'Daily streak bonus', group: 'bonus', icon: '🔥' },
  bonus_first_task: { label: 'First-task bonus', group: 'bonus', icon: '🌱' },
  bonus_plan: { label: 'Daily plan bonus', group: 'bonus', icon: '✅' },
  bonus_combo: { label: 'Video combo bonus', group: 'bonus', icon: '⚡' },
  bonus_referral: { label: 'Referral bonus', group: 'bonus', icon: '🤝' },
  referral_residual: { label: 'Referral earnings (10%)', group: 'bonus', icon: '🌳' },
  payout_request: { label: 'Cash-out', group: 'payout', icon: '💸' },
  payout_refund: { label: 'Cash-out refunded', group: 'payout', icon: '↩️' },
  payout_complete: { label: 'Cash-out settled', group: 'payout', icon: '🏁' },
  charity_donation: { label: 'Donation', group: 'donation', icon: '💚' },
  admin_adjustment: { label: 'Adjustment by support', group: 'adjustment', icon: '🛠️' },
  clawback: { label: 'Fraud clawback', group: 'adjustment', icon: '⛔' },
} as const;
export type TxnType = keyof typeof TXN_TYPES;
export type TxnGroup = (typeof TXN_TYPES)[TxnType]['group'];

/* ────────────────────────────────────────────────────────────────────────────
 * US tax reporting thresholds (Form 1099-MISC/NEC) — year-aware.
 * OBBBA (P.L. 119-21) raised the threshold from $600 to $2,000 for payments
 * made after Dec 31, 2025 (inflation-indexed from 2027).
 * ──────────────────────────────────────────────────────────────────────────── */

export function us1099ThresholdMicros(year: number): number {
  return year <= 2025 ? usd(600) : usd(2000);
}
