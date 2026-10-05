import type { Metadata } from 'next';
import { LegalPage } from '@/components/marketing/legal';

export const metadata: Metadata = { title: 'Terms of Service' };

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="October 1, 2026"
      intro="The short version: you complete offers honestly, we pay you real money quickly and transparently, and we explain any decision we make about your account."
      sections={[
        { h: 'Eligibility', p: ['You must be 18 or older (or the age of majority where you live) and may hold one account per person. Some offers have extra country or age requirements shown on the offer.'] },
        { h: 'How earning works', p: ['Partners pay CashAds when you complete their offers. We credit your share, shown in real currency before you start, once the partner confirms (or once we verify a missing-credit claim). The amount is locked when you start an offer.', 'High-value partner rewards may have a safety hold, shown on each offer and pending item. Holds release automatically.'] },
        { h: 'Reversals', p: ['Partners can reverse conversions they find invalid. If that happens we deduct the reward from your pending or available balance and tell you why. If you already cashed it out, we absorb the difference unless the reversal was caused by fraud.'] },
        { h: 'Cash outs', p: ['There is no CashAds minimum. Payment providers may have their own minimums and fees, always shown before you confirm. We may ask you to verify your email, phone or identity before certain cash outs. Failed cash outs are refunded to your balance in full.'] },
        { h: 'Fair use', p: ['Not allowed: multiple accounts, automation or bots, VPNs or emulators used to misrepresent your location or device, fake information on partner sites, and abuse of referrals. These rules protect the payout budget for honest members.'] },
        { h: 'Account decisions & appeals', p: ['If we restrict or suspend an account, we always give a specific reason. You can appeal from Support, and a different person reviews every appeal within 48 hours. Your balance is never confiscated without review.'] },
        { h: 'Your balance', p: ['Your balance never expires while your account is open. If you close your account, please cash out first. We keep anonymised financial records as the law requires.'] },
        { h: 'Changes', p: ['We version these terms. Material changes are announced in-app at least 14 days in advance.'] },
      ]}
    />
  );
}
