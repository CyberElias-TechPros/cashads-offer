import { describe, expect, it } from 'vitest';
import { PAYOUT_METHODS, getPayoutMethod, payoutMethodsForCountry, us1099ThresholdMicros } from './catalog';
import {
  ceilToCent,
  computeFee,
  floorToCent,
  formatLocal,
  formatUsd,
  hourlyRate,
  parseDollarInput,
  splitByBps,
  usd,
} from './money';
import { computeOfferQuality, gradeFor } from './quality';

describe('money', () => {
  it('converts dollar literals to integer micros without float drift', () => {
    expect(usd(0.1) + usd(0.2)).toBe(usd(0.3));
    expect(usd(2.5)).toBe(2_500_000);
    expect(usd(0.0085)).toBe(8_500);
  });

  it('splits revenue so share + remainder always equals the total', () => {
    for (const amount of [1, 7, 999_999, 1_250_000, 123_456_789]) {
      const { share, remainder } = splitByBps(amount, 6_000);
      expect(share + remainder).toBe(amount);
      expect(share).toBe(Math.floor((amount * 6_000) / 10_000));
    }
    expect(() => splitByBps(-1, 6000)).toThrow();
    expect(() => splitByBps(100, 10_001)).toThrow();
  });

  it('rounds cents in the right direction', () => {
    expect(floorToCent(1_239_999)).toBe(1_230_000);
    expect(ceilToCent(1_230_001)).toBe(1_240_000);
  });

  it('formats honestly: sub-cent rewards keep their precision, balances floor', () => {
    expect(formatUsd(2_500_000)).toBe('$2.50');
    expect(formatUsd(8_000)).toBe('$0.008');
    expect(formatUsd(8_500)).toBe('$0.0085');
    expect(formatUsd(1_239_999, { floor: true })).toBe('$1.23');
    expect(formatUsd(250_000, { signed: true })).toBe('+$0.25');
    expect(formatUsd(-250_000)).toBe('−$0.25');
  });

  it('formats local currency with an FX rate', () => {
    expect(formatLocal(usd(2), 'NGN', 1530)).toBe('₦3,060');
    expect(formatLocal(usd(1), 'INR', 88)).toBe('₹88');
    expect(formatLocal(usd(1), 'KES', 129)).toMatch(/^KSh\s?129$/);
  });

  it('computes the real hourly rate', () => {
    expect(hourlyRate(usd(2.5), 5)).toBe(usd(30));
    expect(hourlyRate(usd(1), 0)).toBe(0);
  });

  it('parses user-typed dollar amounts into whole cents', () => {
    expect(parseDollarInput('2')).toBe(usd(2));
    expect(parseDollarInput('$2.5')).toBe(usd(2.5));
    expect(parseDollarInput('0.05')).toBe(usd(0.05));
    expect(parseDollarInput('1.234')).toBeNull();
    expect(parseDollarInput('abc')).toBeNull();
  });

  it('computes provider fees rounded up to the cent, respecting caps', () => {
    const paypal = getPayoutMethod('paypal')!;
    expect(computeFee(usd(10), paypal)).toBe(usd(0.2));
    expect(computeFee(usd(0.05), paypal)).toBe(usd(0.01)); // 2% of 5¢ rounds UP — never under-disclosed
    expect(computeFee(usd(500), paypal)).toBe(usd(1)); // capped at $1
    expect(computeFee(usd(5), getPayoutMethod('ng_airtime')!)).toBe(0);
  });
});

describe('payout catalogue', () => {
  it('only offers methods that work in the member’s country (PayPal not in Nigeria)', () => {
    const ng = payoutMethodsForCountry('NG').map((m) => m.id);
    expect(ng).toContain('ng_bank');
    expect(ng).toContain('ng_airtime');
    expect(ng).not.toContain('paypal');
    expect(payoutMethodsForCountry('KE').map((m) => m.id)).toContain('ke_mpesa');
    expect(payoutMethodsForCountry('US').map((m) => m.id)).toEqual(
      expect.arrayContaining(['paypal', 'us_ach', 'amazon_gc']),
    );
  });

  it('has valid field patterns for every method', () => {
    for (const m of PAYOUT_METHODS)
      for (const f of m.fields) if (f.pattern) expect(() => new RegExp(f.pattern!)).not.toThrow();
  });

  it('uses year-aware US 1099 thresholds (OBBBA: $2,000 from 2026)', () => {
    expect(us1099ThresholdMicros(2025)).toBe(usd(600));
    expect(us1099ThresholdMicros(2026)).toBe(usd(2000));
  });
});

describe('offer quality', () => {
  it('shows "New" until there is enough data', () => {
    expect(
      computeOfferQuality({
        clicks: 2,
        conversions: 1,
        missingClaims: 0,
        thumbsUp: 1,
        thumbsDown: 0,
        openReports: 0,
        networkSuccessRate: 0.99,
      }).grade,
    ).toBe('New');
  });

  it('rewards reliable, well-rated offers and penalises reports', () => {
    const good = computeOfferQuality({
      clicks: 100,
      conversions: 70,
      missingClaims: 1,
      thumbsUp: 40,
      thumbsDown: 2,
      openReports: 0,
      networkSuccessRate: 0.99,
    });
    expect(good.grade).toBe('A');
    const reported = computeOfferQuality({
      clicks: 100,
      conversions: 70,
      missingClaims: 1,
      thumbsUp: 40,
      thumbsDown: 2,
      openReports: 5,
      networkSuccessRate: 0.99,
    });
    expect(reported.score!).toBeLessThan(good.score!);
    expect(gradeFor(39)).toBe('F');
  });
});
