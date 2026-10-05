/**
 * A compact list of high-volume disposable email providers. In production,
 * pair this with a maintained feed (e.g. disposable-email-domains on GitHub)
 * refreshed by a scheduled job.
 */
const DISPOSABLE = new Set([
  '10minutemail.com', '10minutemail.net', '20minutemail.com', 'anonaddy.me', 'burnermail.io', 'byom.de', 'dispostable.com',
  'dropmail.me', 'emailondeck.com', 'fakeinbox.com', 'fakemail.net', 'getairmail.com', 'getnada.com', 'guerrillamail.biz',
  'guerrillamail.com', 'guerrillamail.de', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamailblock.com', 'harakirimail.com',
  'inboxkitten.com', 'jetable.org', 'kasmail.com', 'mail-temp.com', 'mail.tm', 'mailcatch.com', 'maildrop.cc', 'mailinator.com',
  'mailinator.net', 'mailnesia.com', 'mailpoof.com', 'mailsac.com', 'mintemail.com', 'moakt.com', 'mohmal.com', 'mytemp.email',
  'nada.email', 'sharklasers.com', 'spam4.me', 'spambog.com', 'spamgourmet.com', 'temp-mail.io', 'temp-mail.org', 'tempail.com',
  'tempinbox.com', 'tempmail.dev', 'tempmail.net', 'tempmailo.com', 'tempr.email', 'throwawaymail.com', 'tmail.ws', 'tmpmail.net',
  'tmpmail.org', 'trashmail.com', 'trashmail.de', 'trashmail.net', 'wegwerfmail.de', 'yopmail.com', 'yopmail.fr', 'yopmail.net',
  'emailfake.com', 'fexbox.org', 'linshiyouxiang.net', 'minuteinbox.com', 'mvrht.net', 'owlymail.com', 'spamex.com',
]);

export function isDisposableEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase().trim();
  if (!domain) return false;
  if (DISPOSABLE.has(domain)) return true;
  // catch subdomains like abc.mailinator.com
  const parts = domain.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    if (DISPOSABLE.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}
