export { CATEGORY_META, formatMoney, type OfferCategory } from '@cashads/shared';

export function formatHoursSafe(h: number | null | undefined): string {
  if (h === null || h === undefined) return '—';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} days`;
}
