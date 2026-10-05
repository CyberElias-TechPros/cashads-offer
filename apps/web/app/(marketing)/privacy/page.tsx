import type { Metadata } from 'next';
import { LegalPage } from '@/components/marketing/legal';

export const metadata: Metadata = { title: 'Privacy Policy' };

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="October 1, 2026"
      intro="We collect only what we need, when we need it. We never sell your personal data. Written to align with GDPR, CCPA and Nigeria’s NDPR."
      sections={[
        { h: 'What we collect', p: ['Account: email, display name, country, timezone. Before your first cash out: a phone number. For large cash outs only: identity document details (we keep the last 4 digits and a one-way hash) and a selfie for verification.', 'Payout details are encrypted at rest (AES-256-GCM) and only ever displayed masked.', 'Device & network signals (a random device key, a hashed browser fingerprint, IP address) are used solely for security and fraud prevention.'] },
        { h: 'Why', p: ['To pay you, keep your account secure, prevent multi-accounting and fraud, meet legal obligations (tax, anti-money-laundering), and improve the service with aggregated statistics.'] },
        { h: 'Sharing', p: ['With payment providers (to send your money), offer partners (a random click id so they can confirm completions; never your email unless you give it to them directly), and service providers under contract. Never sold, never used for third-party ad targeting.'] },
        { h: 'Retention', p: ['Personal data is kept while your account is open. Financial records are kept for the period required by law (typically 5–7 years) in anonymised form after account deletion.'] },
        { h: 'Your rights', p: ['Download all your data anytime (Settings → Privacy & data), correct it, delete your account, or object to processing. EU/UK members can lodge a complaint with their supervisory authority.'] },
        { h: 'Cookies', p: ['We use a strictly necessary session cookie, a referral cookie when you follow an invite link, and local storage for preferences such as theme and data saver. No third-party advertising cookies. See the Cookie Policy.'] },
        { h: 'Security', p: ['TLS everywhere, scrypt password hashing, optional TOTP two-factor authentication, encryption of sensitive fields at rest, rate limiting, audit logs for all staff actions, and session management with remote sign-out.'] },
      ]}
    />
  );
}
