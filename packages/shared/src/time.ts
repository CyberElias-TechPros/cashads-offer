/** YYYY-MM-DD for a date in a given IANA timezone (falls back to UTC). */
export function dayKey(date: Date, timeZone = 'UTC'): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Add days to a YYYY-MM-DD key. */
export function addDaysToKey(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds)) return '—';
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

export function formatMinutes(minutes: number): string {
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))} sec`;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = minutes / 60;
  if (h < 48) return `${Math.round(h * 10) / 10} h`;
  return `${Math.round(h / 24)} days`;
}

export function timeAgo(iso: string | Date, now: Date = new Date()): string {
  const then = typeof iso === 'string' ? new Date(iso) : iso;
  const diff = Math.round((now.getTime() - then.getTime()) / 1000);
  if (diff < 10) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function timeUntil(iso: string | Date, now: Date = new Date()): string {
  const then = typeof iso === 'string' ? new Date(iso) : iso;
  const diff = Math.round((then.getTime() - now.getTime()) / 1000);
  if (diff <= 0) return 'now';
  return `in ${formatDuration(diff)}`;
}
