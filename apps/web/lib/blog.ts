export interface Post {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  readMinutes: number;
  body: string[];
}

export const POSTS: Post[] = [
  {
    slug: 'why-we-dont-use-points',
    title: 'Why we don’t use points',
    excerpt: 'Points exist to make small payouts feel bigger. We think you deserve to see the real number.',
    date: '2026-09-02',
    readMinutes: 3,
    body: [
      'Most rewards apps pay you in points, coins or gems. It looks generous: 5,000 points for a survey! Then you find out that 5,000 points is $0.50.',
      'Points are a psychological buffer. They hide low payouts, make fees invisible, and let platforms quietly change the exchange rate.',
      'On CashAds every offer, every balance and every transaction is shown in real money. A survey that pays $0.72 says $0.72, and every offer page shows what the partner pays us next to what you get.',
      'There’s a nice side effect: nothing ever “expires”. Your money is your money.',
    ],
  },
  {
    slug: 'how-instant-payouts-work',
    title: 'How we pay out in minutes (and why others take weeks)',
    excerpt: 'Slow payouts are usually a business decision, not a technical one. Here’s how our pipeline works.',
    date: '2026-09-16',
    readMinutes: 4,
    body: [
      'When you cash out, we reserve the amount in our double-entry ledger, send it to the payment provider, and settle the books when the provider confirms. All of this happens automatically, usually in under five minutes.',
      'Two things make this safe. First, fraud checks happen before the money moves: device signals, shared payout destinations, account age. Second, holds apply only to high-value partner rewards that can be reversed, and each one shows its exact unlock time.',
      'If a provider is down, we queue and retry with backoff and tell you what’s happening. If a payout fails, the full amount returns to your balance immediately.',
      'Our real median payout time is published live on the Transparency page. If it ever gets slow, you’ll see it there before you hear it from us.',
    ],
  },
  {
    slug: 'we-pay-when-tracking-fails',
    title: 'We pay you even when tracking fails',
    excerpt: 'Missing credit is the #1 complaint in this industry. Our answer: check automatically, pay first, chase the partner ourselves.',
    date: '2026-09-28',
    readMinutes: 3,
    body: [
      'Partners tell us about your completions with a server-to-server callback called a postback. Sometimes postbacks get lost: a partner’s server hiccups, a cookie gets blocked, a parameter is mangled.',
      'Most platforms put the burden on you: clear your cookies, wait 30 days, open a ticket. We built the opposite. Tap “Missing credit” and we immediately check our own logs for a failed signal, ask the partner’s API directly, and credit you if we can verify it.',
      'Gold and Platinum members get small claims approved instantly. Everything else gets a human review within 24 hours.',
      'When we pay before the partner does, we absorb the risk. If the partner pays later, our books recover automatically. If they never do, that’s our problem, not yours.',
    ],
  },
];
