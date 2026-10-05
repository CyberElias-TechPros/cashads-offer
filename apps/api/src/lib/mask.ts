export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '•••';
  const visible = local.length <= 2 ? local[0] ?? '' : `${local[0]}${local[local.length - 1]}`;
  return `${visible[0] ?? ''}•••${visible[1] ?? ''}@${domain}`;
}

export function maskTail(value: string, keep = 4): string {
  const v = value.replace(/\s+/g, '');
  if (v.length <= keep) return `••${v}`;
  return `••••${v.slice(-keep)}`;
}

export function maskMiddle(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function maskPhone(phone: string): string {
  if (phone.length < 6) return '••••';
  return `${phone.slice(0, 4)}•••••${phone.slice(-2)}`;
}

/** "Sarah Johnson" → "Sarah J." — used on public feeds & leaderboards. */
export function publicName(displayName: string | null | undefined): string {
  if (!displayName) return 'A member';
  const parts = displayName.trim().split(/\s+/);
  const first = parts[0].slice(0, 14);
  const initial = parts[1]?.[0];
  return initial ? `${first} ${initial.toUpperCase()}.` : first;
}
