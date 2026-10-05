export interface FaqItem {
  id: string;
  q: string;
  a: string;
  category: 'earning' | 'cashout' | 'tracking' | 'account' | 'transparency';
}

export const FAQ_CATEGORIES: Record<FaqItem['category'], string> = {
  earning: 'Earning',
  cashout: 'Cashing out',
  tracking: 'Tracking & missing credit',
  account: 'Account & safety',
  transparency: 'Fees & transparency',
};

export const FAQ: FaqItem[] = [
  {
    id: 'what-is',
    category: 'earning',
    q: 'What is CashAds, in one sentence?',
    a: 'Brands pay us to find people who will try their products, answer their surveys or watch their videos. You do the task, the brand pays us, and we pass most of that money to you, in real dollars, straight away.',
  },
  {
    id: 'how-much',
    category: 'earning',
    q: 'How much can I realistically earn?',
    a: 'It depends on where you live and how much time you have. Quick polls and videos pay cents. Surveys pay $0.50–$3. App trials and games pay $1–$40. Finance offers can pay $20–$100+. Every offer shows its real hourly rate, so you can decide whether it is worth your time before you start.',
  },
  {
    id: 'hourly-rate',
    category: 'earning',
    q: 'What does the hourly rate on each offer mean?',
    a: 'It is the payout divided by the time the offer takes. Once enough members have finished an offer, we use their median completion time instead of the advertiser\'s estimate. Sort by hourly rate to get the most money for your time.',
  },
  {
    id: 'no-points',
    category: 'transparency',
    q: 'Why don\'t you use points or coins?',
    a: 'Points hide how little most platforms pay. Every balance, offer and transaction on CashAds is shown in real money, so you always know exactly what your time is worth.',
  },
  {
    id: 'revenue-share',
    category: 'transparency',
    q: 'How much of the money do I get?',
    a: 'Our revenue share is published on the Transparency page and shown on every offer. By default you get 60% of what the partner pays us, plus your tier bonus (paid by us). Each offer shows the partner payout next to your payout, so you can check the split yourself.',
  },
  {
    id: 'price-lock',
    category: 'transparency',
    q: 'Can an offer\'s payout change after I start?',
    a: 'No. When you start an offer, its payout is locked. If the partner later lowers the price, you still get the amount you saw.',
  },
  {
    id: 'minimum',
    category: 'cashout',
    q: 'Is there a minimum cash out?',
    a: 'No. You can cash out from $0.01. The only cost is the payment provider\'s fee, shown before you confirm. Crypto and mobile money cost almost nothing, so small cash outs are worth it.',
  },
  {
    id: 'speed',
    category: 'cashout',
    q: 'How fast are cash outs?',
    a: 'Most cash outs are sent automatically within minutes. Our real median payout time is published on the Transparency page. Large or unusual cash outs may get a quick safety review, which we aim to finish within 24 hours, and we tell you when that happens.',
  },
  {
    id: 'methods',
    category: 'cashout',
    q: 'Which payment methods can I use?',
    a: 'It depends on your country. We show only methods that actually work where you live: PayPal, crypto (USDT/USDC), gift cards, bank transfer, Paystack (Nigeria), M-Pesa, GCash, UPI, Pix and more. Fees and typical speed are shown next to each one.',
  },
  {
    id: 'pending',
    category: 'cashout',
    q: 'Why is some of my balance "pending"?',
    a: 'High-value partner offers, such as bank accounts, can be reversed by the partner if a signup turns out to be fraudulent. For these offers we apply a short safety hold, and every pending item shows exactly when it unlocks. Higher tiers get shorter holds, and Platinum has none.',
  },
  {
    id: 'missing-credit',
    category: 'tracking',
    q: 'I finished an offer but wasn\'t credited. What now?',
    a: 'Tap "Missing credit" on the offer or in your history. We check the partner\'s records automatically, often within seconds. If we can confirm you completed it, you get paid, even if the partner\'s tracking failed. If not, a human reviews it within our published SLA (24 hours by default).',
  },
  {
    id: 'eat-the-loss',
    category: 'tracking',
    q: 'Do you really pay even when the partner doesn\'t?',
    a: 'Yes. If we can verify you completed an offer, we pay you first and chase the partner afterwards. Your trust is worth more than one lost conversion.',
  },
  {
    id: 'tracking-tips',
    category: 'tracking',
    q: 'How do I make sure offers track?',
    a: 'Start offers from CashAds, finish them in the same browser, use a new account with the advertiser (offers are for new users only), and don\'t use VPNs or ad blockers on partner sites. Each offer shows its real tracking reliability so you can choose dependable ones.',
  },
  {
    id: 'videos',
    category: 'earning',
    q: 'How do rewarded videos work?',
    a: 'Watch a short sponsor video, and the reward is credited the moment it ends. Watching several in a row earns a combo bonus of up to +25%. If you switch tabs, the video pauses. If an ad fails to load, it doesn\'t count against your daily limit.',
  },
  {
    id: 'one-device',
    category: 'account',
    q: 'Can I use CashAds on several devices?',
    a: 'Yes, you can log in anywhere. To keep things fair, you can only earn from rewarded videos on one device at a time. You can move earning to another device with one tap.',
  },
  {
    id: 'bans',
    category: 'account',
    q: 'Will my account be banned for no reason?',
    a: 'No. If we ever restrict an account, we show the specific reason and you can appeal with one tap. A human answers appeals within 48 hours. We never say just "terms violation" without an explanation.',
  },
  {
    id: 'data',
    category: 'account',
    q: 'What data do you collect?',
    a: 'Only what we need, when we need it. You can start earning with just an email address. We ask for a phone number before your first cash out, and ID only for large cash outs. You can export or delete your data at any time from Settings → Privacy.',
  },
  {
    id: 'fraud',
    category: 'account',
    q: 'Why do you check devices and IP addresses?',
    a: 'Fraud is the biggest threat to fair payouts. Every fake account takes money that should go to real members. We look for things like many accounts on one device. You can see your account health in Settings, and verifying your phone improves it.',
  },
  {
    id: 'taxes',
    category: 'account',
    q: 'Do I owe taxes on my earnings?',
    a: 'Possibly. It depends on your country. The Tax Center gives you a yearly summary and a CSV export. In the US, members paid $600 or more in a year may receive a 1099 form.',
  },
  {
    id: 'streaks',
    category: 'earning',
    q: 'What are streaks, plans and tiers?',
    a: 'Optional extras. Check in daily for a growing streak bonus. Finish your 3-task daily plan for a small bonus. Reach higher tiers for extra earnings on every offer, shorter holds and faster support. None of these are required to earn or cash out.',
  },
  {
    id: 'how-we-make-money',
    category: 'transparency',
    q: 'How does CashAds make money?',
    a: 'We keep the rest of what partners pay after your share (40% by default). From that we pay for bonuses, missing-credit payouts, fraud losses and running the service. We never sell your personal data.',
  },
];
