'use client';

/**
 * Device identity for fraud prevention:
 *  - deviceKey: random, persisted id (survives sessions on this browser)
 *  - fingerprint: hash of stable browser traits (catches the same device across cleared storage)
 * Neither contains personal data; both are explained in the privacy policy.
 */
let fpPromise: Promise<string> | null = null;
let fpValue: string | null = null;

export function deviceKey(): string {
  if (typeof window === 'undefined') return '';
  try {
    let key = localStorage.getItem('ca_device');
    if (!key) {
      key = crypto.randomUUID();
      localStorage.setItem('ca_device', key);
    }
    return key;
  } catch {
    return '';
  }
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function canvasTrait(): string {
  try {
    const c = document.createElement('canvas');
    c.width = 220;
    c.height = 40;
    const g = c.getContext('2d');
    if (!g) return 'no-canvas';
    g.textBaseline = 'top';
    g.font = "16px 'Arial'";
    g.fillStyle = '#10b981';
    g.fillRect(0, 0, 220, 40);
    g.fillStyle = '#0b1611';
    g.fillText('CashAds ✓ 0123456789', 4, 10);
    return c.toDataURL().slice(-64);
  } catch {
    return 'canvas-error';
  }
}

function webglTrait(): string {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl') || c.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return 'no-webgl';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? `${gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)}|${gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}` : 'webgl';
  } catch {
    return 'webgl-error';
  }
}

export function getFingerprint(): Promise<string> {
  if (typeof window === 'undefined') return Promise.resolve('');
  if (fpValue) return Promise.resolve(fpValue);
  if (!fpPromise) {
    fpPromise = (async () => {
      const nav = navigator as Navigator & { deviceMemory?: number };
      const traits = [
        nav.userAgent,
        nav.language,
        (nav.languages ?? []).join(','),
        nav.hardwareConcurrency,
        nav.deviceMemory ?? '',
        `${screen.width}x${screen.height}x${screen.colorDepth}`,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        'ontouchstart' in window ? 'touch' : 'no-touch',
        canvasTrait(),
        webglTrait(),
      ].join('||');
      fpValue = (await sha256Hex(traits)).slice(0, 48);
      return fpValue;
    })().catch(() => '');
  }
  return fpPromise;
}

export function fingerprintSync(): string {
  return fpValue ?? '';
}
