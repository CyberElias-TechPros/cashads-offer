/**
 * Device identity for "one device earns at a time" and fraud prevention.
 * A random ID in localStorage + a coarse, non-invasive characteristics hash
 * (disclosed in the privacy policy). No canvas/audio fingerprinting.
 */
const KEY = 'lucrum.device';
const FP_KEY = 'lucrum.device_fp';

export function deviceId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = `dev_${crypto.randomUUID().replaceAll('-', '')}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'dev_ephemeral_session';
  }
}

export function deviceFingerprint(): string {
  try {
    return localStorage.getItem(FP_KEY) ?? '';
  } catch {
    return '';
  }
}

export async function computeFingerprint(): Promise<void> {
  try {
    if (localStorage.getItem(FP_KEY)) return;
    const signals = [
      navigator.userAgent,
      navigator.language,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      `${screen.width}x${screen.height}x${screen.colorDepth}`,
      String(navigator.hardwareConcurrency ?? ''),
    ].join('|');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signals));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(FP_KEY, hex);
  } catch {
    /* non-secure context or storage disabled — fine */
  }
}

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

export function prefersDataSaver(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } })
    .connection;
  return Boolean(c?.saveData) || c?.effectiveType === '2g' || c?.effectiveType === 'slow-2g';
}
