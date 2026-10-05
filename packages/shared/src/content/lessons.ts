import { usd } from '../money';

/**
 * "Earn + learn" (spec pain point #17): sponsored micro-lessons with a quiz.
 * Answers live server-side only — the API strips `answer` before sending.
 */
export interface LessonContent {
  id: string;
  title: string;
  summary: string;
  icon: string;
  minutes: number;
  rewardMicros: number;
  /** What the sponsor pays CashAds; the member gets `rewardMicros`. */
  sponsorPayoutMicros: number;
  sponsor: string;
  passMark: number;
  sections: { heading: string; body: string }[];
  quiz: { question: string; options: string[]; answer: number }[];
}

export const LESSONS: LessonContent[] = [
  {
    id: 'spot-scam-offers',
    title: 'Spot a scam offer in 30 seconds',
    summary: 'The five red flags that separate real offers from traps.',
    icon: '🛡️',
    minutes: 4,
    rewardMicros: usd(0.3),
    sponsorPayoutMicros: usd(0.5),
    sponsor: 'SafeWeb Foundation (sandbox)',
    passMark: 0.75,
    sections: [
      {
        heading: 'Red flag 1: you have to pay to get paid',
        body: 'Legitimate platforms never ask for an “activation fee”, “withdrawal fee to unlock” or “VIP upgrade” before paying you. Provider fees are deducted from a payout — never paid upfront.',
      },
      {
        heading: 'Red flag 2: free trials that need a card for “verification”',
        body: 'Many “free” trials quietly convert to monthly subscriptions. If an offer requires a card, check the cancellation terms and set a reminder before the trial ends.',
      },
      {
        heading: 'Red flag 3: the payout is too good to be true',
        body: '$50 for a 2-minute task with no requirements is almost always a lead-farming scheme. Real high payouts come with real requirements (for example funding a bank account).',
      },
      {
        heading: 'Red flag 4: pressure and countdowns',
        body: '“Only 3 spots left!” and fake countdown timers exist to stop you from thinking. Real offers don’t disappear in 60 seconds.',
      },
      {
        heading: 'Red flag 5: requests for codes or passwords',
        body: 'No legitimate task needs your OTP, banking PIN or email password. Share them and you lose the account.',
      },
    ],
    quiz: [
      {
        question: 'An app says you must pay ₦2,000 to unlock withdrawals. What is it?',
        options: ['A normal fee', 'A red flag — likely a scam', 'A tax requirement'],
        answer: 1,
      },
      {
        question: 'A “free trial” requires your card. What should you do?',
        options: [
          'Ignore the terms',
          'Check cancellation terms and set a reminder',
          'Use someone else’s card',
        ],
        answer: 1,
      },
      {
        question: 'A task asks for the OTP sent to your phone. You should…',
        options: ['Share it quickly', 'Never share it', 'Share only half'],
        answer: 1,
      },
      {
        question: 'Which offer is most likely legitimate?',
        options: [
          '$50 for 2 minutes, no requirements',
          '$40 for opening and funding a bank account',
          '$100 for sharing a link once',
        ],
        answer: 1,
      },
    ],
  },
  {
    id: 'budget-50-30-20',
    title: 'Budgeting with the 50/30/20 rule',
    summary: 'A simple way to split income so savings actually happen.',
    icon: '📊',
    minutes: 5,
    rewardMicros: usd(0.35),
    sponsorPayoutMicros: usd(0.6),
    sponsor: 'MoneyWise Academy (sandbox)',
    passMark: 0.75,
    sections: [
      {
        heading: 'The rule',
        body: 'Split take-home income into 50% needs (rent, food, transport), 30% wants (outings, subscriptions) and 20% savings or debt repayment.',
      },
      {
        heading: 'Pay yourself first',
        body: 'Move the 20% to savings the day money arrives — before spending. Automating it removes willpower from the equation.',
      },
      {
        heading: 'Adjust for reality',
        body: 'If needs take 70% of your income, start with 5% savings and grow it. The habit matters more than the exact percentage.',
      },
    ],
    quiz: [
      {
        question: 'In 50/30/20, what is the 20% for?',
        options: ['Wants', 'Savings or debt', 'Rent'],
        answer: 1,
      },
      {
        question: 'When should you move money to savings?',
        options: ['End of month', 'As soon as income arrives', 'Never'],
        answer: 1,
      },
      { question: 'Rent and food belong to…', options: ['Needs', 'Wants', 'Savings'], answer: 0 },
      {
        question: 'Needs take 70% of income. A good first step is…',
        options: ['Give up on saving', 'Start saving a smaller % and grow it', 'Take a loan'],
        answer: 1,
      },
    ],
  },
  {
    id: 'crypto-payout-safety',
    title: 'Receiving crypto payouts safely',
    summary: 'Addresses, networks and fees — without losing money to a typo.',
    icon: '🪙',
    minutes: 4,
    rewardMicros: usd(0.3),
    sponsorPayoutMicros: usd(0.5),
    sponsor: 'Ledger of Things (sandbox)',
    passMark: 0.75,
    sections: [
      {
        heading: 'Network matters',
        body: 'USDT exists on several networks (Polygon, Tron, Ethereum…). Sending on the wrong network can lose funds. Always match the network your wallet expects.',
      },
      {
        heading: 'Copy, paste, verify',
        body: 'Never type an address by hand. Paste it, then check the first and last 4 characters match your wallet.',
      },
      {
        heading: 'Fees eat small payouts',
        body: 'A $1 network fee on a $2 payout is 50%. For tiny amounts, Lightning or local rails are usually cheaper.',
      },
    ],
    quiz: [
      {
        question: 'Your wallet expects USDT on Polygon. You should send on…',
        options: ['Any network', 'Polygon', 'Ethereum'],
        answer: 1,
      },
      {
        question: 'Best way to enter an address?',
        options: ['Type it', 'Paste and verify the ends', 'Guess'],
        answer: 1,
      },
      {
        question: 'For a $0.20 payout, which is usually cheapest?',
        options: ['Ethereum USDT', 'Lightning or local rails', 'Paper cheque'],
        answer: 1,
      },
      {
        question: 'Someone asks for your seed phrase to “verify” a payout. You…',
        options: ['Share it', 'Refuse — never share it', 'Share half'],
        answer: 1,
      },
    ],
  },
  {
    id: 'emergency-fund',
    title: 'Build a ₦0 → emergency fund',
    summary: 'Why three months of expenses changes everything, and how to start from nothing.',
    icon: '🧱',
    minutes: 3,
    rewardMicros: usd(0.25),
    sponsorPayoutMicros: usd(0.4),
    sponsor: 'MoneyWise Academy (sandbox)',
    passMark: 0.67,
    sections: [
      {
        heading: 'What it is',
        body: 'An emergency fund is money set aside only for real emergencies — job loss, medical bills, urgent repairs. The target is 3–6 months of essential expenses.',
      },
      {
        heading: 'Start microscopic',
        body: 'Even small, regular amounts compound into a buffer. Set a goal in CashAds and send part of every cash-out to a separate savings account.',
      },
      {
        heading: 'Keep it boring',
        body: 'Emergency money should be safe and accessible — not in volatile assets.',
      },
    ],
    quiz: [
      {
        question: 'Typical emergency fund target?',
        options: ['1 week', '3–6 months of essentials', '5 years'],
        answer: 1,
      },
      {
        question: 'Where should it be kept?',
        options: ['Safe and accessible', 'Volatile crypto', 'Lottery tickets'],
        answer: 0,
      },
      {
        question: 'Best way to start with little money?',
        options: ['Wait until you earn more', 'Small regular amounts', 'Borrow to fund it'],
        answer: 1,
      },
    ],
  },
];

export function getLesson(id: string): LessonContent | undefined {
  return LESSONS.find((l) => l.id === id);
}
