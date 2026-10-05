export interface BlogPost {
  slug: string;
  title: string;
  summary: string;
  date: string;
  readMinutes: number;
  tag: string;
  body: { heading?: string; text: string }[];
}

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: 'why-no-points',
    title: 'Why Lucrum will never use points',
    summary:
      'Points are a psychological buffer that hides low payouts. We show real money everywhere — here’s why.',
    date: '2026-09-02',
    readMinutes: 3,
    tag: 'Trust',
    body: [
      {
        text: 'Open almost any rewards app and you’ll see something like “5,000 points”. Is that a lot? You have no idea — and that’s the point. Points let platforms pay less without you noticing.',
      },
      {
        heading: 'Real money, everywhere',
        text: 'In Lucrum every task shows what you earn in dollars (and your local currency), how long it really takes, and the hourly rate that works out to. Your balance is money. Your history is money. There is no exchange rate to decode.',
      },
      {
        heading: 'Honesty about small amounts',
        text: 'This means some numbers look small. A 20-second video pays about $0.008 — we show exactly that, then show you the tasks that pay 100× more. We’d rather you trust us than feel tricked later.',
      },
    ],
  },
  {
    slug: 'missing-credit-guarantee',
    title: 'How the Missing Credit guarantee works',
    summary:
      'The #1 complaint about rewards apps is “I did the offer and it didn’t track.” Here is exactly what happens when you tap Missing credit.',
    date: '2026-09-10',
    readMinutes: 4,
    tag: 'Product',
    body: [
      {
        text: 'Tracking breaks. Cookies get blocked, an advertiser’s pixel misfires, a network has an outage. Most platforms tell you to “clear your cache” and move on. We built a system instead.',
      },
      {
        heading: '1. We check our own postback logs',
        text: 'Every server-to-server notification a network sends us is stored — even ones that failed validation. If the network did tell us you completed the task but something went wrong on our side, the claim is approved automatically.',
      },
      {
        heading: '2. We ask the network directly',
        text: 'We query the network’s conversion API using your anonymous click ID. If they confirm the completion, you’re paid immediately.',
      },
      {
        heading: '3. Goodwill for trusted members',
        text: 'If you have a good track record (Silver tier and up), claims up to your tier limit are paid instantly even when the network can’t confirm. We absorb that cost and chase the network ourselves.',
      },
      {
        heading: '4. A human within 24 hours',
        text: 'Everything else gets a human review with a visible deadline. You’ll always get a decision and a reason.',
      },
    ],
  },
  {
    slug: 'hourly-rate',
    title: 'The hourly rate: the number other apps don’t want you to see',
    summary: 'A $0.40 survey that takes 30 minutes pays $0.80/hour. We put that number on every task.',
    date: '2026-09-18',
    readMinutes: 3,
    tag: 'Product',
    body: [
      {
        text: 'The absolute payout of a task tells you very little. What matters is what your time is worth. So every Lucrum task shows payout, real duration and hourly rate.',
      },
      {
        heading: 'Measured, not promised',
        text: 'Advertisers tend to underestimate how long their tasks take. Once five or more members complete a task we switch to the measured median completion time — and label it, so you know which number you are looking at.',
      },
      {
        heading: 'Sort by what matters to you',
        text: 'Sort by best hourly rate, filter by a minimum rate, or switch to Quick tasks when you only have two minutes.',
      },
    ],
  },
  {
    slug: 'cash-out-in-nigeria',
    title: 'Cashing out in Nigeria: bank, airtime and crypto compared',
    summary: 'PayPal doesn’t pay out in Nigeria. Here are the methods that do — with real fees and speeds.',
    date: '2026-09-25',
    readMinutes: 4,
    tag: 'Guides',
    body: [
      {
        text: 'Most rewards apps are built for the US and leave Nigerian members with money they can’t access. Lucrum pays out on local rails.',
      },
      {
        heading: 'Bank transfer (Paystack)',
        text: 'Instant to any Nigerian bank or fintech account — GTBank, Access, OPay, Moniepoint, Kuda and more. We confirm the account name before you send so mistakes don’t cost you.',
      },
      {
        heading: 'Airtime & data',
        text: 'Perfect for tiny balances: top up any MTN, Airtel, Glo or 9mobile line from about ₦50, with no fee.',
      },
      {
        heading: 'Lightning & USDT',
        text: 'Prefer crypto? Lightning handles very small amounts with near-zero fees; USDT on Polygon is a stable option for bigger cash-outs. The network fee is always shown before you confirm.',
      },
    ],
  },
  {
    slug: 'transparency-report',
    title: 'What our transparency page measures (and why)',
    summary:
      'Postback success rate, median payout time, revenue share paid. Here’s how each number is calculated.',
    date: '2026-10-01',
    readMinutes: 3,
    tag: 'Trust',
    body: [
      {
        heading: 'Postback success rate',
        text: 'Of all conversion notifications networks sent us in the last 30 days, the share we processed successfully. Duplicates count as successful (they are retries we correctly ignored); invalid signatures and unknown clicks count as failures.',
      },
      {
        heading: 'Median payout time',
        text: 'The middle value of “request → paid” across completed cash-outs. We use the median so one slow bank transfer doesn’t hide how fast most payouts are — and so a few instant ones don’t flatter us.',
      },
      {
        heading: 'Actual revenue share',
        text: 'Total paid to members for tasks ÷ total paid to us by networks, over the last 30 days. Our promise is 60%. If the number ever drops below that, you’ll see it.',
      },
    ],
  },
];

export function getBlogPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}
