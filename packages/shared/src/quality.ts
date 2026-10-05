import type { OfferQualityDTO } from './types';

/**
 * Offer quality score (spec pain point #10 — "am I being scammed by the offer?").
 *
 * Every component is only used once it has enough data to be meaningful, so a
 * brand-new offer shows "New" instead of a misleading grade.
 */
export interface QualityInputs {
  clicks: number;
  conversions: number;
  missingClaims: number;
  thumbsUp: number;
  thumbsDown: number;
  openReports: number;
  networkSuccessRate: number | null;
}

export const QUALITY_MIN_CLICKS = 10;
export const QUALITY_MIN_CREDIT_SAMPLES = 5;
export const QUALITY_MIN_RATINGS = 3;
/** A completion rate at or above this is considered excellent for incentivised traffic. */
export const QUALITY_GREAT_COMPLETION = 0.6;

export function computeOfferQuality(i: QualityInputs): OfferQualityDTO {
  const completionRate = i.clicks >= QUALITY_MIN_CLICKS ? Math.min(1, i.conversions / i.clicks) : null;
  const creditSamples = i.conversions + i.missingClaims;
  const creditReliability =
    creditSamples >= QUALITY_MIN_CREDIT_SAMPLES ? 1 - i.missingClaims / creditSamples : null;
  const ratingTotal = i.thumbsUp + i.thumbsDown;
  const rating = ratingTotal >= QUALITY_MIN_RATINGS ? i.thumbsUp / ratingTotal : null;

  const parts: { value: number; weight: number }[] = [];
  if (completionRate !== null)
    parts.push({ value: Math.min(1, completionRate / QUALITY_GREAT_COMPLETION), weight: 0.3 });
  if (creditReliability !== null) parts.push({ value: creditReliability, weight: 0.35 });
  if (rating !== null) parts.push({ value: rating, weight: 0.25 });
  if (i.networkSuccessRate !== null && parts.length > 0)
    parts.push({ value: i.networkSuccessRate, weight: 0.1 });

  const reportPenalty = Math.min(40, i.openReports * 8);

  if (parts.length === 0) {
    if (reportPenalty > 0) {
      const score = Math.max(0, 70 - reportPenalty);
      return {
        score,
        grade: gradeFor(score),
        completionRate,
        creditReliability,
        rating,
        reports: i.openReports,
      };
    }
    return { score: null, grade: 'New', completionRate, creditReliability, rating, reports: i.openReports };
  }

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  const raw = (parts.reduce((s, p) => s + p.value * p.weight, 0) / totalWeight) * 100;
  const score = Math.max(0, Math.round(raw - reportPenalty));
  return { score, grade: gradeFor(score), completionRate, creditReliability, rating, reports: i.openReports };
}

export function gradeFor(score: number): OfferQualityDTO['grade'] {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

/** Minimum completions before we trust the measured median over the advertiser's estimate. */
export const MEASURED_MIN_SAMPLES = 5;
