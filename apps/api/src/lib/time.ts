export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const addMs = (d: Date, ms: number) => new Date(d.getTime() + ms);

/** YYYY-MM-DD in the member's own timezone (streaks reset at *their* midnight). */
export function localDate(timezone: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

export function localHour(timezone: string, at: Date = new Date()): number {
  try {
    return (
      Number(
        new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hour12: false }).format(at),
      ) % 24
    );
  } catch {
    return at.getUTCHours();
  }
}

export function previousDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Monday 00:00 UTC of the week containing `at`. */
export function startOfWeekUtc(at: Date = new Date()): Date {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d;
}

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
