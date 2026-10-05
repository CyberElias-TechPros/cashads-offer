export interface FaqItem {
  id: string;
  category: 'start' | 'earning' | 'missing' | 'payouts' | 'account' | 'trust' | 'privacy';
  q: string;
  a: string;
}

export const FAQ_CATEGORIES: Record<FaqItem['category'], string> = {
  start: 'Getting started',
  earning: 'Earning',
  missing: 'Missing credit',
  payouts: 'Cash-outs',
  account: 'Account & security',
  trust: 'Trust & transparency',
  privacy: 'Privacy & data',
};

export const FAQ: FaqItem[] = [
  {
    id: 'what-is',
    category: 'start',
    q: 'What is CashAds?',
    a: 'CashAds pays you real money for short tasks from brands that want your attention — surveys, app trials, sign-ups, quick polls, lessons and short videos. Brands pay us when you complete a task; we pass a published share of that money to you and you can cash out from $0.01.',
  },
  {
    id: 'cost',
    category: 'start',
    q: 'Does it cost anything?',
    a: 'No. CashAds is free. We never ask you to pay to unlock earnings, withdrawals or “VIP” levels. If anyone asks you to pay to withdraw, it is not us.',
  },
  {
    id: 'who',
    category: 'start',
    q: 'Who can join?',
    a: 'Anyone aged 18+ in a supported country. One account per person. Offers and payout methods are matched to your country so you only see things that actually work where you live.',
  },
  {
    id: 'points',
    category: 'earning',
    q: 'Why don’t you use points or coins?',
    a: 'Points hide how little many apps pay. Every amount in CashAds — every task, bonus and balance — is shown in real money (dollars, plus your local currency). No conversion tables, no mental maths.',
  },
  {
    id: 'hourly',
    category: 'earning',
    q: 'How is the hourly rate calculated?',
    a: 'Hourly rate = what you earn ÷ how long the task really takes. Once at least 5 members complete a task we use the measured median time from real completions instead of the advertiser’s estimate, and we label which one you are seeing.',
  },
  {
    id: 'share',
    category: 'earning',
    q: 'How much of the money do I get?',
    a: 'We pass 60% of what the network pays us to you, and we publish the live figure on the Transparency page so you can check it. Bonuses (streaks, referrals, plan bonuses) come out of our 40% — they are never deducted from your share.',
  },
  {
    id: 'ads',
    category: 'earning',
    q: 'Why do videos pay so little?',
    a: 'Advertisers pay fractions of a cent per video view, and we show you exactly that — e.g. $0.008 for a 20-second video. Videos are there for spare seconds; surveys, trials and sign-ups pay 50–500× more per task.',
  },
  {
    id: 'quality',
    category: 'earning',
    q: 'What is the quality grade on offers?',
    a: 'Each offer gets a grade (A–F) based on how often members finish it, how reliably it credits, member ratings and reports. Offers with repeated scam reports are paused, reviewed and — if confirmed — removed and listed on our Wall of Shame.',
  },
  {
    id: 'data-saver',
    category: 'earning',
    q: 'Does CashAds work on slow connections?',
    a: 'Yes. Turn on Data-saver in your profile (or your browser’s data-saver) and we hide heavy offers, skip images and show the estimated data each task uses.',
  },
  {
    id: 'missing-how',
    category: 'missing',
    q: 'I finished a task but wasn’t credited. What now?',
    a: 'Open Activity and tap “Missing credit?” on that task. We immediately check the network’s logs and ask the network directly. If the completion is confirmed you are paid on the spot. Trusted members (Silver tier and up) are paid instantly as goodwill even if the network can’t confirm, up to their tier limit. Everything else gets a human review within 24 hours.',
  },
  {
    id: 'missing-guarantee',
    category: 'missing',
    q: 'Who pays if the network never pays you?',
    a: 'We do. If we verify that you completed a task, you get paid — we chase the network separately. Your relationship with us shouldn’t depend on someone else’s tracking pixel.',
  },
  {
    id: 'missing-wait',
    category: 'missing',
    q: 'Why do I have to wait before filing a claim?',
    a: 'Most networks confirm within a few minutes. We ask you to wait 10 minutes after starting a task so we don’t create claims for credits that are about to arrive anyway.',
  },
  {
    id: 'reversal',
    category: 'missing',
    q: 'Can my earnings be taken back?',
    a: 'Sometimes an advertiser reverses a completion days later. Unless the completion was fraudulent, CashAds absorbs that loss — your balance is not touched.',
  },
  {
    id: 'minimum',
    category: 'payouts',
    q: 'Is there a minimum cash-out?',
    a: 'No CashAds minimum. You can cash out $0.01. Some providers have their own floors (for example a gift card may start at $1) and fees — we always show the fee and exactly what you’ll receive before you confirm.',
  },
  {
    id: 'speed',
    category: 'payouts',
    q: 'How fast are cash-outs?',
    a: 'Most cash-outs are automatic and arrive in minutes; our live median payout time is on the Transparency page. Bank transfers in some countries (e.g. US ACH) take 1–3 business days because of the banking network.',
  },
  {
    id: 'methods',
    category: 'payouts',
    q: 'Which payout methods can I use?',
    a: 'It depends on your country: bank transfer and airtime in Nigeria, MoMo in Ghana, M-Pesa in Kenya, UPI in India, GCash in the Philippines, Pix in Brazil, PayPal, ACH, gift cards, Lightning and USDT elsewhere. We only show methods that work where you are.',
  },
  {
    id: 'verification',
    category: 'payouts',
    q: 'Why do you ask me to verify my phone or ID?',
    a: 'Only when needed: email for any cash-out, phone above $1, and ID for a single cash-out above $100. This keeps fraudsters from draining the money that pays honest members — and we ask at the moment it matters, not at sign-up.',
  },
  {
    id: 'review',
    category: 'payouts',
    q: 'Why is my cash-out “under review”?',
    a: 'A small share of cash-outs get a quick safety check, for example a new device or unusual activity. We finish reviews within 24 hours and always tell you the outcome and the reason.',
  },
  {
    id: 'failed',
    category: 'payouts',
    q: 'What if a payout provider is down?',
    a: 'We retry automatically and tell you we’re doing it. If a provider can’t complete the payment after several retries, the full amount (including the fee) goes back to your balance.',
  },
  {
    id: 'ban',
    category: 'account',
    q: 'Can my account be closed without a reason?',
    a: 'No. If we restrict an account we show the specific reason, the evidence category and how to appeal — right inside the app. A real person reviews every appeal.',
  },
  {
    id: 'devices',
    category: 'account',
    q: 'Can I use CashAds on more than one device?',
    a: 'Yes, you can be signed in everywhere. To prevent farming, only one device can be actively earning (watching a video or answering polls) at a time — you can take over from another device in one tap.',
  },
  {
    id: '2fa',
    category: 'account',
    q: 'How do I protect my account?',
    a: 'Turn on two-factor authentication (authenticator app) in Profile → Security, review your signed-in devices, and never share codes. CashAds staff will never ask for your password or codes.',
  },
  {
    id: 'legit',
    category: 'trust',
    q: 'How do I know CashAds is legit?',
    a: 'Don’t trust — verify. Our Transparency page shows total paid, live payouts, median payout time, postback success rate, claim resolution times and the revenue share we actually paid. Try a small cash-out first — you can withdraw $0.05 to see it arrive.',
  },
  {
    id: 'feed',
    category: 'trust',
    q: 'Is the live payout feed real?',
    a: 'Yes. It is generated from completed payouts in our database — nothing is scripted. Names are anonymised unless a member opts in to appear on the payout wall.',
  },
  {
    id: 'collect',
    category: 'privacy',
    q: 'What data do you collect?',
    a: 'Only what we need, when we need it: your email to start, your phone when you cash out above $1, and ID only for large cash-outs. We store device and IP information to prevent fraud. You can export or delete your data any time from Profile → Privacy.',
  },
  {
    id: 'sell',
    category: 'privacy',
    q: 'Do you sell my data?',
    a: 'No. We do not sell personal data. Advertisers receive what is needed to confirm a task (an anonymous click ID), not your profile.',
  },
];
