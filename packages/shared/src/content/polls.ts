import { usd } from '../money';

/**
 * Native quick tasks (spec pain points #11 "I'm busy" + #6 "slow internet"):
 * single-question sponsored polls, text-only, < 30 seconds, a few KB of data.
 */
export interface PollContent {
  id: string;
  question: string;
  options: string[];
  sponsor: string;
  rewardMicros: number;
  sponsorPayoutMicros: number;
  estSeconds: number;
}

const p = (
  id: string,
  question: string,
  options: string[],
  reward: number,
  sponsor = 'PulseCheck Polls (sandbox)',
): PollContent => ({
  id,
  question,
  options,
  sponsor,
  rewardMicros: usd(reward),
  sponsorPayoutMicros: Math.round(usd(reward) / 0.6),
  estSeconds: 20,
});

export const POLLS: PollContent[] = [
  p(
    'commute',
    'How do you usually get to work or school?',
    ['Bus / danfo', 'Ride-hailing', 'Own car', 'Walk / bike', 'I work from home'],
    0.03,
  ),
  p(
    'phone-brand',
    'Which phone brand do you use right now?',
    ['Tecno / Infinix / itel', 'Samsung', 'Apple', 'Xiaomi / Redmi', 'Other'],
    0.03,
  ),
  p(
    'data-spend',
    'How much do you spend on mobile data per month?',
    ['Under $2', '$2–$5', '$5–$10', '$10–$20', 'Over $20'],
    0.04,
  ),
  p(
    'savings',
    'Where do you keep most of your savings?',
    ['Bank account', 'Fintech app', 'Cash at home', 'Crypto', 'I don’t save yet'],
    0.04,
  ),
  p(
    'streaming',
    'Which streaming service do you use most?',
    ['YouTube', 'Netflix', 'Showmax', 'Spotify / Audiomack', 'None'],
    0.03,
  ),
  p(
    'online-shop',
    'How often do you shop online?',
    ['Weekly', 'Monthly', 'A few times a year', 'Never'],
    0.03,
  ),
  p(
    'payments',
    'How do you usually pay in shops?',
    ['Cash', 'Bank transfer', 'Card', 'USSD', 'Mobile wallet'],
    0.04,
  ),
  p(
    'side-hustle',
    'Do you have a side hustle besides your main income?',
    ['Yes, online', 'Yes, offline', 'Not yet, looking', 'No'],
    0.03,
  ),
  p(
    'news',
    'Where do you get most of your news?',
    ['X / Twitter', 'TV / radio', 'WhatsApp groups', 'News websites', 'TikTok / Instagram'],
    0.03,
  ),
  p(
    'food-delivery',
    'Have you ordered food delivery in the last month?',
    ['Yes, several times', 'Once', 'No'],
    0.03,
  ),
  p(
    'insurance',
    'Do you have any type of insurance?',
    ['Health', 'Car', 'Life', 'More than one', 'None'],
    0.05,
    'InsureSense (sandbox)',
  ),
  p(
    'learning',
    'What would you most like to learn next?',
    ['Coding', 'Design', 'Personal finance', 'A new language', 'Marketing'],
    0.03,
  ),
  p(
    'power',
    'How many hours of electricity do you get on a typical day?',
    ['Under 6', '6–12', '12–18', '18+', 'I use solar / generator'],
    0.04,
    'GridWatch (sandbox)',
  ),
  p(
    'wallet',
    'Which do you trust more for small payments?',
    ['Bank apps', 'Fintech wallets', 'Mobile money', 'Crypto', 'Cash'],
    0.04,
  ),
  p(
    'gaming',
    'How much time do you spend gaming each week?',
    ['None', 'Under 2 hours', '2–7 hours', '7+ hours'],
    0.03,
  ),
  p(
    'support',
    'What annoys you most about customer support?',
    ['Slow replies', 'Bots only', 'Unclear answers', 'Being passed around'],
    0.03,
  ),
  p(
    'loans',
    'Have you used a digital lending app?',
    ['Yes, happy with it', 'Yes, bad experience', 'No, but considering', 'No'],
    0.05,
    'CreditPulse (sandbox)',
  ),
  p('remote', 'Would you take a fully remote job paying 20% less?', ['Yes', 'Maybe', 'No'], 0.03),
];

export function getPoll(id: string): PollContent | undefined {
  return POLLS.find((x) => x.id === id);
}
