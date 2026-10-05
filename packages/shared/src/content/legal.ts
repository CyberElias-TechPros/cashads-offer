export interface LegalDoc {
  id: 'terms' | 'privacy' | 'cookies' | 'earnings-policy';
  title: string;
  version: string;
  effective: string;
  sections: { heading: string; body: string }[];
}

export const TERMS_VERSION = '2026-10-01';

export const LEGAL_DOCS: LegalDoc[] = [
  {
    id: 'terms',
    title: 'Terms of Service',
    version: TERMS_VERSION,
    effective: '1 October 2026',
    sections: [
      {
        heading: '1. Who we are',
        body: 'CashAds (“we”, “us”) operates a rewards platform where members earn money for completing tasks offered by third-party advertisers and networks. These terms form an agreement between you and CashAds.',
      },
      {
        heading: '2. Eligibility',
        body: 'You must be at least 18 years old and live in a supported country. One account per person. Accounts may not be sold, shared or transferred.',
      },
      {
        heading: '3. Earning',
        body: 'Tasks are provided by third parties. We credit your balance when a network confirms a completion, or when we approve a Missing Credit claim. We publish the share of network revenue paid to members and will give at least 30 days’ notice before changing it.',
      },
      {
        heading: '4. Your balance',
        body: 'Balances are shown in real currency and never expire while your account is open. Earnings obtained through fraud, automation, VPNs/proxies or multiple accounts are not payable.',
      },
      {
        heading: '5. Cash-outs',
        body: 'There is no CashAds minimum cash-out. Third-party provider fees and floors are displayed before you confirm. We may verify your email, phone or identity before processing a cash-out, as described in our Earnings Policy.',
      },
      {
        heading: '6. Account restrictions',
        body: 'If we restrict your account we will tell you the specific reason and how to appeal. A human reviews every appeal. Legitimately earned funds are not confiscated because of an unrelated dispute.',
      },
      {
        heading: '7. Prohibited behaviour',
        body: 'No bots, scripts, emulators, VPNs/proxies to mask location, fake information, multiple accounts, referral self-dealing or abuse of staff and members.',
      },
      {
        heading: '8. Liability',
        body: 'Advertisers are responsible for their own products and offers. We vet and rate offers and remove bad actors, but you should read each offer’s terms. To the extent permitted by law, our liability is limited to the balance in your account.',
      },
      {
        heading: '9. Changes',
        body: 'We will notify you of material changes in-app and by email at least 14 days before they take effect. Versioned history of these terms is kept and available on request.',
      },
    ],
  },
  {
    id: 'privacy',
    title: 'Privacy Policy',
    version: TERMS_VERSION,
    effective: '1 October 2026',
    sections: [
      {
        heading: 'Collected only when needed',
        body: 'Sign-up: email and country. Cash-outs above $1: phone number. Single cash-outs above $100: identity document. Payout details you provide are encrypted at rest.',
      },
      {
        heading: 'Fraud prevention',
        body: 'We store IP addresses, a random device identifier and coarse device characteristics (browser, screen size, timezone) to protect members’ earnings from fraud. We do not use invasive fingerprinting.',
      },
      {
        heading: 'Advertisers',
        body: 'Networks receive an anonymous click identifier so they can confirm completions. We do not sell personal data. Some tasks are run directly by advertisers and are covered by their own privacy policies.',
      },
      {
        heading: 'Your rights',
        body: 'You can export your data and delete your account from Profile → Privacy. We keep ledger records required for financial and tax compliance (in anonymised form where possible) for the legally required period.',
      },
      {
        heading: 'Frameworks',
        body: 'We design for the Nigeria Data Protection Act (NDPA) 2023, the EU/UK GDPR and the CCPA. Contact privacy@cashads.example for any request.',
      },
    ],
  },
  {
    id: 'cookies',
    title: 'Cookie Policy',
    version: TERMS_VERSION,
    effective: '1 October 2026',
    sections: [
      {
        heading: 'Essential only by default',
        body: 'We use one essential, HTTP-only session cookie to keep you signed in, and local storage for your preferences (theme, data-saver) and a random device identifier. No third-party advertising cookies are set by CashAds.',
      },
      {
        heading: 'Advertiser pages',
        body: 'When you open a task, you visit the advertiser’s or network’s site, which may set its own cookies to track completion. Blocking those may prevent automatic crediting — that’s what Missing Credit claims are for.',
      },
    ],
  },
  {
    id: 'earnings-policy',
    title: 'Earnings & Payout Policy',
    version: TERMS_VERSION,
    effective: '1 October 2026',
    sections: [
      {
        heading: 'Revenue share',
        body: 'Members receive 60% of what networks pay CashAds for their completions. Bonuses are funded from our share. The live, measured figure is published on the Transparency page.',
      },
      {
        heading: 'Verification thresholds',
        body: 'Email verification: required for any cash-out. Phone verification: cash-outs above $1. Identity verification: a single cash-out above $100.',
      },
      {
        heading: 'Limits',
        body: 'Up to 3 cash-outs per day. Weekly limits depend on your tier ($500 for Bronze/Silver, $750 Gold, $1,500 Platinum).',
      },
      {
        heading: 'Missing credit',
        body: 'Claims can be filed 10 minutes after starting a task and up to 30 days later. Confirmed completions are paid immediately. Silver+ members receive instant goodwill credit up to their tier limit (max 3 per 30 days). Other claims receive a human decision within 24 hours.',
      },
      {
        heading: 'Reversals',
        body: 'If an advertiser reverses a legitimate completion, CashAds absorbs the loss. We only reclaim funds when a completion is confirmed fraudulent.',
      },
      {
        heading: 'Failed payouts',
        body: 'If a provider fails, we retry automatically. If it ultimately fails, the full amount including fees returns to your balance.',
      },
    ],
  },
];

export function getLegalDoc(id: string): LegalDoc | undefined {
  return LEGAL_DOCS.find((d) => d.id === id);
}
