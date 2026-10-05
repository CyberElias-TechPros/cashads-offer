/* IP helpers, user-agent labels and masking utilities. */

export function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.replace(/^::ffff:/, ''));
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split('/');
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base ?? '');
  if (ipInt === null || baseInt === null) return ip === cidr;
  const bits = bitsStr === undefined ? 32 : Number(bitsStr);
  if (bits === 0) return true;
  const mask = (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

export function isPrivateIp(ip: string): boolean {
  return (
    ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '169.254.0.0/16'].some((c) =>
      ipInCidr(ip, c),
    ) || ip === '::1'
  );
}

/**
 * A small curated sample of well-known hosting ranges. Production should use an
 * IP-intelligence provider (MaxMind minFraud, IPQS, ipinfo privacy detection);
 * admins can also add CIDR rules at runtime (ip_rules table).
 */
export const KNOWN_DATACENTER_CIDRS = [
  '104.131.0.0/16', // DigitalOcean
  '159.203.0.0/16', // DigitalOcean
  '45.55.0.0/16', // DigitalOcean
  '45.79.0.0/16', // Linode
  '139.162.0.0/16', // Linode
  '51.68.0.0/16', // OVH
  '95.216.0.0/16', // Hetzner
  '116.202.0.0/16', // Hetzner
  '45.32.0.0/16', // Vultr
  '45.63.0.0/16', // Vultr
];

export function deviceLabel(ua: string | undefined): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung Internet'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Firefox\//.test(ua)
            ? 'Firefox'
            : /Safari\//.test(ua)
              ? 'Safari'
              : /node|undici|curl|axios|lightmyrequest/i.test(ua)
                ? 'API client'
                : 'Browser';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
}

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'•'.repeat(Math.max(1, Math.min(6, local.length - visible.length)))}@${domain}`;
}

export function maskTail(value: string, keep = 4): string {
  const v = value.replace(/\s/g, '');
  if (v.length <= keep) return v;
  return `••••${v.slice(-keep)}`;
}

export const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com',
  'guerrillamail.com',
  '10minutemail.com',
  'tempmail.com',
  'temp-mail.org',
  'yopmail.com',
  'trashmail.com',
  'getnada.com',
  'dispostable.com',
  'maildrop.cc',
  'sharklasers.com',
  'throwawaymail.com',
  'fakeinbox.com',
  'emailondeck.com',
  'mohmal.com',
  '1secmail.com',
  'moakt.com',
  'burnermail.io',
  'mintemail.com',
  'tempail.com',
]);
