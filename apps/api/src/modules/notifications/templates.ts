import { BRAND } from '@cashads/shared';

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function layout(title: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  const button = cta
    ? `<p style="margin:28px 0"><a href="${esc(cta.url)}" style="background:#059669;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">${esc(cta.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f4f7f5;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px">
    <div style="font-weight:800;font-size:20px;letter-spacing:-0.02em;margin-bottom:20px"><span style="display:inline-block;background:#059669;color:#fff;border-radius:8px;padding:2px 8px;margin-right:6px">$</span>${BRAND.name}</div>
    <div style="background:#fff;border-radius:16px;padding:28px;border:1px solid #e2e8f0">
      <h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>
      ${bodyHtml}
      ${button}
    </div>
    <p style="color:#64748b;font-size:12px;margin-top:20px">${BRAND.promise}<br/>You can change email preferences in Settings → Notifications.</p>
  </div></body></html>`;
}

const p = (s: string) => `<p style="line-height:1.6;margin:0 0 12px">${esc(s)}</p>`;

export const templates = {
  verifyEmail(name: string, url: string): EmailContent {
    return {
      subject: 'Confirm your email to unlock cash outs',
      text: `Hi ${name},\n\nConfirm your email to unlock cash outs: ${url}\n\nThis link expires in 24 hours.`,
      html: layout('Confirm your email', p(`Hi ${name}, confirm your email so you can cash out anytime. This link expires in 24 hours.`), { label: 'Confirm email', url }),
    };
  },
  resetPassword(name: string, url: string): EmailContent {
    return {
      subject: 'Reset your CashAds password',
      text: `Hi ${name},\n\nReset your password: ${url}\n\nThis link expires in 1 hour. If you didn't ask for this, you can ignore this email — your password won't change.`,
      html: layout(
        'Reset your password',
        p(`Hi ${name}, use the button below to choose a new password. The link expires in 1 hour.`) +
          p("Didn't ask for this? You can safely ignore this email."),
        { label: 'Choose a new password', url },
      ),
    };
  },
  payoutCompleted(name: string, amount: string, method: string, duration: string, url: string): EmailContent {
    return {
      subject: `You got paid ${amount} 🎉`,
      text: `Hi ${name},\n\n${amount} was sent to your ${method} in ${duration}.\n\nDetails: ${url}`,
      html: layout(`You got paid ${amount}`, p(`${amount} was sent to your ${method} — it took ${duration}.`) + p('Thanks for trusting us with your time.'), {
        label: 'View receipt',
        url,
      }),
    };
  },
  payoutReview(name: string, amount: string, url: string): EmailContent {
    return {
      subject: `Your ${amount} cash out is in a quick safety review`,
      text: `Hi ${name},\n\nYour ${amount} cash out is getting a quick safety review. We aim to finish within 24 hours and you'll get an email either way.\n\n${url}`,
      html: layout(
        'Quick safety review',
        p(`Your ${amount} cash out is getting a quick safety review. We aim to finish within 24 hours and you'll get an email either way.`) +
          p('Your money is reserved for you and nothing is needed from you right now.'),
        { label: 'Track your cash out', url },
      ),
    };
  },
  payoutFailed(name: string, amount: string, reason: string, url: string): EmailContent {
    return {
      subject: `Your ${amount} cash out couldn't be sent — refunded`,
      text: `Hi ${name},\n\nWe couldn't send your ${amount} cash out: ${reason}\nThe full amount is back in your balance.\n\n${url}`,
      html: layout('Cash out refunded', p(`We couldn't send your ${amount} cash out: ${reason}`) + p('The full amount is back in your balance.'), {
        label: 'Try again',
        url,
      }),
    };
  },
  claimResolved(name: string, approved: boolean, offer: string, detail: string, url: string): EmailContent {
    return {
      subject: approved ? `Missing credit approved: ${offer}` : `Update on your missing-credit claim: ${offer}`,
      text: `Hi ${name},\n\n${detail}\n\n${url}`,
      html: layout(approved ? 'Claim approved' : 'Claim update', p(detail), { label: 'View claim', url }),
    };
  },
  ticketReply(name: string, subject: string, url: string): EmailContent {
    return {
      subject: `Re: ${subject}`,
      text: `Hi ${name},\n\nOur support team replied to your ticket "${subject}".\n\n${url}`,
      html: layout('New reply from support', p(`We replied to your ticket "${subject}".`), { label: 'Read reply', url }),
    };
  },
  newDevice(name: string, device: string, ip: string, url: string): EmailContent {
    return {
      subject: 'New sign-in to your CashAds account',
      text: `Hi ${name},\n\nNew sign-in from ${device} (${ip}). If this wasn't you, reset your password and sign out other sessions: ${url}`,
      html: layout('New sign-in', p(`We noticed a new sign-in from ${device} (IP ${ip}).`) + p("If this wasn't you, secure your account now."), {
        label: 'Review sessions',
        url,
      }),
    };
  },
  accountStatus(name: string, status: string, reason: string, url: string): EmailContent {
    return {
      subject: `Your account status changed: ${status}`,
      text: `Hi ${name},\n\nYour account is now ${status}. Reason: ${reason}\n\nYou can appeal with one tap: ${url}`,
      html: layout(`Account ${status}`, p(`Reason: ${reason}`) + p('You can appeal this decision. A human will respond within 48 hours.'), {
        label: 'Appeal',
        url,
      }),
    };
  },
};

export function smsCode(code: string): string {
  return `${code} is your CashAds verification code. It expires in 10 minutes. Never share it with anyone.`;
}
