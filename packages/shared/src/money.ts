/**
 * Money is ALWAYS represented as integer "micros" (1 USD = 1,000,000 micros).
 *
 * Why micros and not cents? Rewarded video views and revenue-share splits
 * routinely produce sub-cent amounts (e.g. 60% of $0.037). Integer micros keep
 * the ledger exact (no floating point drift) while still allowing sub-cent
 * precision. Max safe integer in JS = 9e15 micros = $9 billion — plenty.
 */
export const MICROS = 1_000_000;
export type Micros = number;

/** Convert a dollar amount (e.g. 2.5) to micros. Use only for constants / user input. */
export function usd(dollars: number): Micros {
  return Math.round(dollars * MICROS);
}

export function toUnits(micros: Micros): number {
  return micros / MICROS;
}

/** Apply basis points (1 bps = 0.01%) rounding DOWN so we never over-promise. */
export function applyBps(micros: Micros, bps: number): Micros {
  return Math.floor((micros * bps) / 10_000);
}

/** Fee = fixed + percentage (rounded UP — fees are always disclosed before confirming). */
export function computeFee(amount: Micros, fixed: Micros, bps: number): Micros {
  if (amount <= 0) return 0;
  return fixed + Math.ceil((amount * bps) / 10_000);
}

/** Effective hourly rate for an offer — the single most useful number for users. */
export function hourlyRate(payout: Micros, minutes: number): Micros {
  const m = Math.max(minutes, 0.25);
  return Math.round((payout * 60) / m);
}

/** How many decimals a value needs to be displayed honestly. */
export function moneyDecimals(micros: Micros): number {
  const abs = Math.abs(Math.round(micros));
  if (abs === 0 || abs >= MICROS) return 2;
  if (abs % 10_000 === 0) return 2;
  if (abs % 1_000 === 0) return 3;
  return 4;
}

const formatterCache = new Map<string, Intl.NumberFormat>();
function formatter(locale: string, currency: string, digits: number): Intl.NumberFormat {
  const key = `${locale}|${currency}|${digits}`;
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    formatterCache.set(key, f);
  }
  return f;
}

export interface FormatMoneyOptions {
  currency?: string;
  locale?: string;
  /** Force an exact number of decimals. */
  decimals?: number;
  /** Prefix + for positive values (− is always shown for negatives). */
  signed?: boolean;
  /** Show full sub-cent precision even for amounts >= $1. */
  precise?: boolean;
}

/**
 * Format micros as real currency. Amounts under $1 keep their sub-cent digits
 * (e.g. $0.018) — we never round a user's earnings away.
 */
export function formatMoney(micros: Micros, opts: FormatMoneyOptions = {}): string {
  const currency = opts.currency ?? 'USD';
  const locale = opts.locale ?? 'en-US';
  const value = Math.round(micros);
  let decimals = opts.decimals;
  if (decimals === undefined) {
    if (opts.precise) decimals = Math.max(2, preciseDecimals(value));
    else decimals = Math.abs(value) < MICROS ? moneyDecimals(value) : 2;
  }
  const text = formatter(locale, currency, decimals).format(Math.abs(value) / MICROS);
  if (value < 0) return `−${text}`;
  if (opts.signed && value > 0) return `+${text}`;
  return text;
}

function preciseDecimals(micros: Micros): number {
  const abs = Math.abs(micros);
  if (abs % 10_000 === 0) return 2;
  if (abs % 1_000 === 0) return 3;
  return 4;
}

/** Compact money for dashboards: $1.2K, $3.4M. */
export function formatMoneyCompact(micros: Micros, currency = 'USD'): string {
  const value = micros / MICROS;
  if (Math.abs(value) < 10_000) return formatMoney(micros, { currency, decimals: Math.abs(value) >= 1000 ? 0 : 2 });
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

/** Format an amount in a local currency given a USD→local rate. */
export function formatLocal(micros: Micros, rate: number, currency: string, locale = 'en-US'): string {
  const value = (micros / MICROS) * rate;
  const digits = new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

/** Parse a user-typed dollar string ("4.73", "$4.73", "4,73") to micros. Returns null if invalid. */
export function parseMoneyInput(input: string): Micros | null {
  const cleaned = input.replace(/[$\s,]/g, '').trim();
  if (!/^\d*(\.\d{0,4})?$/.test(cleaned) || cleaned === '' || cleaned === '.') return null;
  return Math.round(Number(cleaned) * MICROS);
}

/** Round down to whole cents — used when paying out to rails that only support cents. */
export function floorToCents(micros: Micros): Micros {
  return Math.floor(micros / 10_000) * 10_000;
}
