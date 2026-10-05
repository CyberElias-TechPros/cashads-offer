/** Tiny, dependency-free UA → "Chrome on macOS" label for session/device lists. */
export function deviceLabel(ua: string | undefined | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung Internet'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : /curl|node|undici|python|Go-http/i.test(ua)
                ? 'Script'
                : 'Browser';
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X|Macintosh/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Unknown OS';
  return `${browser} on ${os}`;
}

export function isLikelyBot(ua: string | undefined | null): boolean {
  if (!ua) return true;
  return /bot|crawler|spider|headless|phantom|selenium|puppeteer|playwright/i.test(ua);
}
