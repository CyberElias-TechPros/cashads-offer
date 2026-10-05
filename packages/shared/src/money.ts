/**
 * Money is NEVER a float in CashAds.
 *
 * Every amount is an integer number of **micro-dollars** (1 USD = 1,000,000 micros).
 * Rewarded-video ads pay fractions of a cent, so cents are too coarse; micros keep
 * full precision while staying far below Number.MAX_SAFE_INTEGER (≈ $9 billion).
 *
 * Users always see real currency ("$2.50", "≈ ₦3,825") — never points.
 */

export type Micros = number;

export const MICROS_PER_DOLLAR = 1_000_000;
export const MICROS_PER_CENT = 10_000;

/** Convert a dollar literal (e.g. 2.5) into micros. Use only for constants / seeds. */
export function usd(dollars: number): Micros {
  return Math.round(dollars * MICROS_PER_DOLLAR);
}

export function toDollars(micros: Micros): number {
  return micros / MICROS_PER_DOLLAR;
}

export function floorToCent(micros: Micros): Micros {
  return Math.floor(micros / MICROS_PER_CENT) * MICROS_PER_CENT;
}

export function ceilToCent(micros: Micros): Micros {
  return Math.ceil(micros / MICROS_PER_CENT) * MICROS_PER_CENT;
}

export function isWholeCents(micros: Micros): boolean {
  return micros % MICROS_PER_CENT === 0;
}

/**
 * Split `amount` by a percentage expressed in basis points (6000 = 60%).
 * The share is floored to a whole micro so `share + remainder === amount` exactly.
 */
export function splitByBps(amount: Micros, bps: number): { share: Micros; remainder: Micros } {
  if (!Number.isInteger(amount) || amount < 0) throw new Error(`Invalid amount: ${amount}`);
  if (bps < 0 || bps > 10_000) throw new Error(`Invalid bps: ${bps}`);
  const share = Math.floor((amount * bps) / 10_000);
  return { share, remainder: amount - share };
}

export function percentToBps(percent: number): number {
  return Math.round(percent * 100);
}

/** Real hourly rate for a task: what the user earns per hour of their time. */
export function hourlyRate(payout: Micros, minutes: number): Micros {
  if (minutes <= 0) return 0;
  return Math.round((payout * 60) / minutes);
}

export interface FeeModel {
  feeFixedMicros: number;
  feePercentBps: number;
  feeCapMicros?: number | undefined;
}

/** Provider fee for a payout, rounded UP to the cent (we never under-disclose a fee). */
export function computeFee(amount: Micros, model: FeeModel): Micros {
  let fee = model.feeFixedMicros + Math.ceil((amount * model.feePercentBps) / 10_000);
  if (model.feeCapMicros !== undefined) fee = Math.min(fee, model.feeCapMicros);
  return fee === 0 ? 0 : ceilToCent(fee);
}

export interface CurrencyInfo {
  code: string;
  symbol: string;
  name: string;
  /** Fraction digits to show for typical amounts in this currency. */
  digits: number;
}

export const CURRENCIES: Record<string, CurrencyInfo> = {
  USD: { code: 'USD', symbol: '$', name: 'US dollar', digits: 2 },
  NGN: { code: 'NGN', symbol: '₦', name: 'Nigerian naira', digits: 0 },
  GHS: { code: 'GHS', symbol: 'GH₵', name: 'Ghanaian cedi', digits: 2 },
  KES: { code: 'KES', symbol: 'KSh', name: 'Kenyan shilling', digits: 0 },
  ZAR: { code: 'ZAR', symbol: 'R', name: 'South African rand', digits: 2 },
  INR: { code: 'INR', symbol: '₹', name: 'Indian rupee', digits: 0 },
  PHP: { code: 'PHP', symbol: '₱', name: 'Philippine peso', digits: 2 },
  BRL: { code: 'BRL', symbol: 'R$', name: 'Brazilian real', digits: 2 },
  GBP: { code: 'GBP', symbol: '£', name: 'British pound', digits: 2 },
  EUR: { code: 'EUR', symbol: '€', name: 'Euro', digits: 2 },
  CAD: { code: 'CAD', symbol: 'CA$', name: 'Canadian dollar', digits: 2 },
  AUD: { code: 'AUD', symbol: 'A$', name: 'Australian dollar', digits: 2 },
};

/**
 * Indicative FX rates (local units per 1 USD) used for *display only*.
 * Admins can override them at runtime (Settings → FX rates); production should
 * feed these from a rates provider. Ledger amounts are always USD micros.
 */
export const DEFAULT_FX_RATES: Record<string, number> = {
  USD: 1,
  NGN: 1530,
  GHS: 11.8,
  KES: 129,
  ZAR: 17.6,
  INR: 88,
  PHP: 58,
  BRL: 5.4,
  GBP: 0.75,
  EUR: 0.86,
  CAD: 1.38,
  AUD: 1.52,
};

export interface FormatOptions {
  /** Show a leading + for positive amounts. */
  signed?: boolean;
  /**
   * 'auto' shows 3–4 decimals for sub-dime amounts that aren't whole cents
   * (e.g. a $0.0085 ad reward) so tiny rewards are shown honestly, otherwise 2.
   */
  precision?: 'auto' | number;
  /** Floor to the cent (use for balances: never display more than can be cashed out). */
  floor?: boolean;
  compact?: boolean;
}

export function formatUsd(micros: Micros, opts: FormatOptions = {}): string {
  const { signed = false, precision = 'auto', compact = false, floor = false } = opts;
  let abs = Math.abs(micros);
  if (floor) abs = floorToCent(abs);
  let digits = 2;
  if (precision !== 'auto') {
    digits = precision;
  } else if (abs !== 0 && abs < 100_000 && !isWholeCents(abs)) {
    digits = abs % 1_000 === 0 ? 3 : 4;
  }
  const value = abs / MICROS_PER_DOLLAR;
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: compact ? 0 : digits,
    maximumFractionDigits: compact ? 1 : digits,
    notation: compact ? 'compact' : 'standard',
  }).format(value);
  const sign = micros < 0 ? '−' : signed && micros > 0 ? '+' : '';
  return `${sign}${formatted}`;
}

/** Format a USD micros amount in a local currency using an FX rate (local per USD). */
export function formatLocal(
  micros: Micros,
  currency: string,
  rate: number,
  opts: { compact?: boolean } = {},
): string {
  const info = CURRENCIES[currency] ?? CURRENCIES.USD!;
  const value = (micros / MICROS_PER_DOLLAR) * rate;
  const digits = Math.abs(value) < 10 && info.digits === 0 ? 2 : info.digits;
  try {
    const parts = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: info.code,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: opts.compact ? 0 : digits,
      maximumFractionDigits: opts.compact ? 1 : digits,
      notation: opts.compact ? 'compact' : 'standard',
    }).formatToParts(value);
    // Some runtimes fall back to the ISO code (e.g. "KES 129"); prefer the local symbol ("KSh 129").
    return parts
      .map((p) => (p.type === 'currency' && p.value === info.code ? info.symbol : p.value))
      .join('');
  } catch {
    return `${info.symbol}${value.toFixed(digits)}`;
  }
}

/** Parse a user-typed dollar string ("2", "2.5", "$2.50") into whole-cent micros. */
export function parseDollarInput(input: string): Micros | null {
  const cleaned = input.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return cents * MICROS_PER_CENT;
}
