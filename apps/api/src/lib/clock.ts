/**
 * Single source of "now" for business logic, so tests can travel through time
 * (streaks, holds, video timing, SLAs) deterministically.
 */
let offsetMs = 0;
let frozen: number | null = null;

export const clock = {
  now(): Date {
    return new Date(clock.ms());
  },
  ms(): number {
    return frozen ?? Date.now() + offsetMs;
  },
  /** Test helpers */
  advance(ms: number) {
    if (frozen !== null) frozen += ms;
    else offsetMs += ms;
  },
  freeze(at: Date | number = Date.now()) {
    frozen = typeof at === 'number' ? at : at.getTime();
  },
  reset() {
    offsetMs = 0;
    frozen = null;
  },
};

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}
