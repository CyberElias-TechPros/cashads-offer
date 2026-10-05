import { usd, type PayoutFieldDef } from '@cashads/shared';
import type { NetworkParamMap, OfferGoalDef, PartnerContent } from './schema';

/* ------------------------------------------------------------------ networks */
export const NETWORKS: Array<{
  id: string;
  name: string;
  kind: 'offerwall' | 'survey' | 'video' | 'sandbox';
  status: 'active' | 'disabled';
  signatureScheme: 'hmac_sha256_sorted' | 'md5_txid_secret' | 'hmac_sha1_url' | 'sha256_secret_txid' | 'ip_only';
  paramMap: NetworkParamMap;
  docsUrl?: string;
  notes?: string;
}> = [
  {
    id: 'demo',
    name: 'Demo Network (sandbox)',
    kind: 'sandbox',
    status: 'active',
    signatureScheme: 'hmac_sha256_sorted',
    paramMap: { clickId: 'click_id', txId: 'tx_id', payout: 'payout', payoutUnit: 'usd', status: 'status', statusValues: { '1': 'credit', '2': 'reversal' }, goalId: 'goal', offerId: 'offer_id', signature: 'sig' },
    notes: 'Built-in partner simulator. Fires real signed HTTP postbacks; some offers deliberately "lose" postbacks to exercise missing-credit claims.',
  },
  {
    id: 'house_video',
    name: 'CashAds Sponsors (direct video)',
    kind: 'video',
    status: 'active',
    signatureScheme: 'sha256_secret_txid',
    paramMap: { userId: 'user_id', txId: 'trans_id', payout: 'reward_amount', payoutUnit: 'usd', signature: 'sign' },
    notes: 'Direct-sold rewarded video. The /api/ssv/house_video endpoint accepts Pangle-style server-side verification: sign = sha256("{secret}:{trans_id}").',
  },
  {
    id: 'cpx',
    name: 'CPX Research (preset)',
    kind: 'survey',
    status: 'disabled',
    signatureScheme: 'md5_txid_secret',
    paramMap: { userId: 'user_id', txId: 'trans_id', payout: 'amount_usd', payoutUnit: 'usd', status: 'status', statusValues: { '1': 'credit', '2': 'reversal' }, signature: 'hash' },
    docsUrl: 'https://publisher.cpx-research.com',
    notes: 'Preset — verify parameter names & hash format in your CPX publisher dashboard before enabling.',
  },
  {
    id: 'bitlabs',
    name: 'BitLabs (preset)',
    kind: 'survey',
    status: 'disabled',
    signatureScheme: 'hmac_sha1_url',
    paramMap: { userId: 'uid', txId: 'tx', payout: 'raw', payoutUnit: 'usd', signature: 'hash' },
    docsUrl: 'https://developer.bitlabs.ai',
    notes: 'Preset — confirm callback macros in the BitLabs dashboard.',
  },
  {
    id: 'generic_offerwall',
    name: 'Generic offerwall (IP allowlist)',
    kind: 'offerwall',
    status: 'disabled',
    signatureScheme: 'ip_only',
    paramMap: { userId: 'user_id', clickId: 'subid', txId: 'tx_id', payout: 'payout', payoutUnit: 'usd', offerId: 'offer_id', status: 'status' },
    notes: 'For partners that only support IP allowlisting. Add their server IPs before enabling.',
  },
];

/* ------------------------------------------------------------------- offers */
const Q = (id: string, text: string, options: string[]) => ({ id, text, options });
const GENERIC_SURVEY = [
  Q('age', 'Which age group are you in?', ['18–24', '25–34', '35–44', '45–54', '55+']),
  Q('device', 'Which device do you use most?', ['Android phone', 'iPhone', 'Laptop', 'Tablet']),
  Q('shop', 'How often do you shop online?', ['Daily', 'Weekly', 'Monthly', 'Rarely']),
  Q('ads', 'How do you feel about ads that pay you?', ['Love it', 'It’s fair', 'Neutral', 'Not a fan']),
  Q('time', 'When do you usually have spare minutes?', ['Morning commute', 'Lunch break', 'Evenings', 'Weekends']),
];

export interface CatalogOffer {
  externalId: string;
  title: string;
  advertiser: string;
  shortDescription: string;
  description: string;
  category: 'survey' | 'poll' | 'app' | 'game' | 'signup' | 'financial' | 'learn' | 'shopping';
  icon: string;
  brandColor: string;
  partner: number;
  minutes: number;
  data: 'light' | 'medium' | 'heavy';
  steps: string[];
  requirements?: string[];
  goals?: OfferGoalDef[];
  countries?: string[];
  holdHours?: number | null;
  windowHours?: number;
  featured?: boolean;
  drop?: boolean;
  delay?: number;
  quality?: number;
  reliability?: number;
  content: PartnerContent;
}

export const OFFERS: CatalogOffer[] = [
  // ---------------------------------------------------------------- surveys
  {
    externalId: 'svy-stream', title: 'Share your streaming habits', advertiser: 'Pollara Insights', category: 'survey', icon: '📺', brandColor: '#7c3aed',
    shortDescription: '5 quick questions about what you watch.', description: 'A short survey for a media research company. Honest answers only — there are no wrong ones.',
    partner: usd(1.2), minutes: 5, data: 'light', steps: ['Answer 5 multiple-choice questions', 'Submit — you’re credited within seconds'], quality: 92, reliability: 0.97,
    content: { questions: [Q('svc', 'Which streaming service do you use most?', ['Netflix', 'YouTube', 'Prime Video', 'Disney+', 'Other']), Q('hours', 'Hours of streaming per week?', ['< 3', '3–7', '8–15', '15+']), Q('dev', 'Where do you watch most?', ['Phone', 'TV', 'Laptop', 'Tablet']), Q('ads', 'Would you accept ads for a cheaper plan?', ['Yes', 'Maybe', 'No']), Q('genre', 'Favourite genre?', ['Drama', 'Comedy', 'Documentary', 'Sports', 'Anime'])] },
  },
  {
    externalId: 'svy-grocery', title: 'Grocery shopping survey', advertiser: 'FreshPanel', category: 'survey', icon: '🥦', brandColor: '#16a34a',
    shortDescription: 'Tell a grocery brand how you shop.', description: 'Help a grocery chain improve delivery and in-store experience.',
    partner: usd(0.85), minutes: 4, data: 'light', steps: ['Answer 5 questions', 'Submit'], quality: 88, reliability: 0.95, content: { questions: GENERIC_SURVEY },
  },
  {
    externalId: 'svy-gadgets', title: 'Tech gadgets opinion survey', advertiser: 'GadgetVoice', category: 'survey', icon: '🎧', brandColor: '#0ea5e9',
    shortDescription: 'In-depth survey about headphones & smart devices.', description: 'A longer study that pays more. Includes a few open-ended style choices.',
    partner: usd(2.4), minutes: 11, data: 'medium', steps: ['Answer the screening question', 'Complete the main survey', 'Submit'], quality: 85, reliability: 0.93, content: { questions: GENERIC_SURVEY },
  },
  {
    externalId: 'svy-travel', title: 'Travel plans 2026', advertiser: 'Wanderly Research', category: 'survey', icon: '✈️', brandColor: '#f97316',
    shortDescription: 'Where are you heading next year?', description: 'Travel research for an airline alliance.\n\n🧪 Sandbox note: this partner “loses” its postback on purpose so you can try a Missing Credit claim — we’ll still pay you.',
    partner: usd(1.6), minutes: 7, data: 'light', steps: ['Answer 5 questions', 'Submit'], drop: true, quality: 74, reliability: 0.82, content: { questions: GENERIC_SURVEY },
  },
  {
    externalId: 'svy-banking', title: 'Banking experience survey', advertiser: 'FinSight', category: 'survey', icon: '🏦', brandColor: '#1d4ed8',
    shortDescription: 'How do you manage money day to day?', description: 'A fintech wants to understand everyday banking frustrations.',
    partner: usd(3.0), minutes: 14, data: 'light', steps: ['Answer the survey', 'Submit'], quality: 90, reliability: 0.96, content: { questions: GENERIC_SURVEY },
  },
  {
    externalId: 'svy-carrier', title: 'Your mobile carrier experience', advertiser: 'SignalScope', category: 'survey', icon: '📶', brandColor: '#db2777',
    shortDescription: 'Rate your mobile network and data plan.', description: 'Telecom research — takes about 6 minutes.',
    partner: usd(1.4), minutes: 6, data: 'light', steps: ['Answer 5 questions', 'Submit'], quality: 86, reliability: 0.94, content: { questions: GENERIC_SURVEY },
  },
  {
    externalId: 'svy-sports', title: 'Sports fan survey', advertiser: 'Fanbase Labs', category: 'survey', icon: '⚽', brandColor: '#059669',
    shortDescription: 'Which sports do you follow?', description: 'A sports media company wants to learn what fans love.',
    partner: usd(1.0), minutes: 5, data: 'light', steps: ['Answer 5 questions', 'Submit'], quality: 84, reliability: 0.95, content: { questions: GENERIC_SURVEY },
  },
  // ----------------------------------------------------------------- polls
  {
    externalId: 'poll-snack', title: 'Which snack wins?', advertiser: 'SnackLab', category: 'poll', icon: '🍿', brandColor: '#eab308',
    shortDescription: 'One tap. Pick your favourite.', description: 'A single-question poll for a snack brand.',
    partner: usd(0.12), minutes: 0.5, data: 'light', steps: ['Tap your answer'], quality: 95, reliability: 0.99,
    content: { questions: [Q('snack', 'Pick one for movie night:', ['Popcorn', 'Chips', 'Chocolate', 'Fruit'])] },
  },
  {
    externalId: 'poll-headline', title: 'Rate this ad headline', advertiser: 'AdTest Co.', category: 'poll', icon: '📰', brandColor: '#64748b',
    shortDescription: 'Would this headline make you click?', description: 'Copy testing for an advertiser.',
    partner: usd(0.15), minutes: 0.75, data: 'light', steps: ['Read the headline', 'Rate it'], quality: 93, reliability: 0.99,
    content: { questions: [Q('rate', '“Save 2 hours a week on groceries” — would you click?', ['Definitely', 'Probably', 'Probably not', 'No way'])] },
  },
  {
    externalId: 'poll-coffee', title: 'Coffee or tea?', advertiser: 'BrewPoll', category: 'poll', icon: '☕', brandColor: '#92400e',
    shortDescription: 'The eternal question.', description: 'A beverage brand’s quick poll.',
    partner: usd(0.1), minutes: 0.4, data: 'light', steps: ['Tap your answer'], quality: 96, reliability: 0.99,
    content: { questions: [Q('brew', 'Your morning drink?', ['Coffee', 'Tea', 'Both', 'Neither'])] },
  },
  {
    externalId: 'poll-logo', title: 'Pick a logo', advertiser: 'BrandPulse', category: 'poll', icon: '🎨', brandColor: '#a21caf',
    shortDescription: 'Help a startup choose its logo.', description: 'Design research.',
    partner: usd(0.2), minutes: 1, data: 'light', steps: ['Choose your favourite concept'], quality: 91, reliability: 0.98,
    content: { questions: [Q('logo', 'Which feels most trustworthy?', ['Concept A — rounded', 'Concept B — geometric', 'Concept C — handwritten'])] },
  },
  // ------------------------------------------------------------------- apps
  {
    externalId: 'app-budgetly', title: 'Install & open Budgetly', advertiser: 'Budgetly', category: 'app', icon: '📊', brandColor: '#10b981',
    shortDescription: 'Try a free budgeting app for 2 minutes.', description: 'Install Budgetly, open it and connect a demo account. New users only.',
    partner: usd(1.8), minutes: 4, data: 'medium', steps: ['Install Budgetly', 'Open the app', 'Finish the welcome tour'], requirements: ['New Budgetly users only'], quality: 89, reliability: 0.94, featured: false,
    content: { appSteps: ['Install from the store', 'Open Budgetly', 'Finish the welcome tour'] },
  },
  {
    externalId: 'app-lingoleap', title: 'Finish 3 lessons on Lingoleap', advertiser: 'Lingoleap', category: 'app', icon: '🗣️', brandColor: '#22c55e',
    shortDescription: 'Learn a few words in a new language.', description: 'Complete 3 bite-sized lessons in any language.',
    partner: usd(3.5), minutes: 14, data: 'medium', steps: ['Install Lingoleap', 'Pick a language', 'Finish 3 lessons'], requirements: ['New users only'], featured: true, quality: 93, reliability: 0.96,
    content: { appSteps: ['Install Lingoleap', 'Pick a language', 'Finish lesson 1', 'Finish lesson 2', 'Finish lesson 3'] },
  },
  {
    externalId: 'app-snapgrocer', title: 'Set up SnapGrocer', advertiser: 'SnapGrocer', category: 'app', icon: '🛒', brandColor: '#f43f5e',
    shortDescription: 'Create an account & browse 3 aisles.', description: 'No purchase needed.',
    partner: usd(2.2), minutes: 5, data: 'heavy', steps: ['Install', 'Create account', 'Browse 3 aisles'], quality: 82, reliability: 0.9,
    content: { appSteps: ['Install SnapGrocer', 'Create an account', 'Browse 3 aisles'] },
  },
  {
    externalId: 'app-fitflow', title: 'Try a FitFlow workout', advertiser: 'FitFlow', category: 'app', icon: '🏃', brandColor: '#ef4444',
    shortDescription: 'Do one 7-minute workout.', description: 'Install FitFlow and complete one guided workout.',
    partner: usd(2.8), minutes: 10, data: 'medium', steps: ['Install FitFlow', 'Complete one 7-minute workout'], quality: 87, reliability: 0.93,
    content: { appSteps: ['Install FitFlow', 'Allow notifications (optional)', 'Complete a 7-minute workout'] },
  },
  // ------------------------------------------------------------------ games
  {
    externalId: 'game-kingdom', title: 'Kingdom Clash — reach Town Hall 5', advertiser: 'Northwind Games', category: 'game', icon: '🏰', brandColor: '#b45309',
    shortDescription: 'Get paid at every milestone — up to $14.10.', description: 'A strategy game. Each milestone pays the moment you reach it. You have 30 days.',
    partner: usd(23.5), minutes: 60 * 24 * 5, data: 'heavy', steps: ['Install & finish the tutorial', 'Reach level 5', 'Reach level 10', 'Upgrade to Town Hall 5'], requirements: ['New players only', 'Complete within 30 days'],
    goals: [
      { id: 'tutorial', label: 'Finish the tutorial', partnerPayoutMicros: usd(0.5) },
      { id: 'lvl5', label: 'Reach level 5', partnerPayoutMicros: usd(2) },
      { id: 'lvl10', label: 'Reach level 10', partnerPayoutMicros: usd(6) },
      { id: 'th5', label: 'Town Hall 5', partnerPayoutMicros: usd(15) },
    ],
    windowHours: 24 * 30, featured: true, quality: 88, reliability: 0.95, content: {},
  },
  {
    externalId: 'game-merge', title: 'Merge Garden — reach level 20', advertiser: 'Petal Studio', category: 'game', icon: '🌷', brandColor: '#ec4899',
    shortDescription: 'Relaxing puzzle game, 3 milestones.', description: 'Merge flowers, grow your garden, get paid per level.',
    partner: usd(7.7), minutes: 60 * 24 * 2, data: 'heavy', steps: ['Reach level 5', 'Reach level 12', 'Reach level 20'], requirements: ['New players only'],
    goals: [
      { id: 'lvl5', label: 'Reach level 5', partnerPayoutMicros: usd(0.4) },
      { id: 'lvl12', label: 'Reach level 12', partnerPayoutMicros: usd(1.8) },
      { id: 'lvl20', label: 'Reach level 20', partnerPayoutMicros: usd(5.5) },
    ],
    windowHours: 24 * 14, quality: 86, reliability: 0.94, content: {},
  },
  {
    externalId: 'game-words', title: 'Word Sprint — solve 50 puzzles', advertiser: 'Lexi Games', category: 'game', icon: '🔤', brandColor: '#6366f1',
    shortDescription: 'Light on data, great on a slow connection.', description: 'Word puzzles. Works well on 3G.',
    partner: usd(2.8), minutes: 60 * 3, data: 'light', steps: ['Solve 10 puzzles', 'Solve 50 puzzles'],
    goals: [
      { id: 'p10', label: 'Solve 10 puzzles', partnerPayoutMicros: usd(0.3) },
      { id: 'p50', label: 'Solve 50 puzzles', partnerPayoutMicros: usd(2.5) },
    ],
    windowHours: 24 * 7, quality: 90, reliability: 0.97, content: {},
  },
  // ---------------------------------------------------------------- signups
  {
    externalId: 'su-notewise', title: 'Create a free Notewise account', advertiser: 'Notewise', category: 'signup', icon: '🗒️', brandColor: '#0f766e',
    shortDescription: 'Free note-taking app. Takes 2 minutes.', description: 'Sign up and confirm your email.',
    partner: usd(1.1), minutes: 2, data: 'light', steps: ['Enter your name & email', 'Confirm your email'], requirements: ['New accounts only'], quality: 91, reliability: 0.96,
    content: { formFields: ['Full name', 'Email address'] },
  },
  {
    externalId: 'su-petpals', title: 'Join the PetPals newsletter', advertiser: 'PetPals', category: 'signup', icon: '🐾', brandColor: '#d97706',
    shortDescription: 'Pet care tips every week.', description: 'Subscribe and confirm. Unsubscribe anytime.',
    partner: usd(0.6), minutes: 2, data: 'light', steps: ['Subscribe', 'Confirm the email'], quality: 85, reliability: 0.95, content: { formFields: ['First name', 'Email address'] },
  },
  {
    externalId: 'su-streambox', title: 'StreamBox free trial', advertiser: 'StreamBox', category: 'signup', icon: '🎬', brandColor: '#dc2626',
    shortDescription: '7-day free trial — cancel anytime.', description: 'Start a free trial. ⚠️ Cancel before day 7 to avoid being charged — CashAds will remind you on day 5.',
    partner: usd(4), minutes: 5, data: 'medium', steps: ['Start the free trial', 'Stream anything for 1 minute'], requirements: ['Payment card required by partner', 'Cancel before day 7 to avoid charges'], quality: 78, reliability: 0.92,
    content: { formFields: ['Email address', 'Card (sandbox — not charged)'] },
  },
  // -------------------------------------------------------------- financial
  {
    externalId: 'fin-novabank', title: 'Open a NovaBank account & deposit $10', advertiser: 'NovaBank', category: 'financial', icon: '💳', brandColor: '#0f172a',
    shortDescription: 'No-fee checking. The biggest payout on CashAds.', description: 'Open a free NovaBank checking account and make a $10 deposit (it stays yours). Partner verification takes up to 72 hours.',
    partner: usd(40), minutes: 15, data: 'light', steps: ['Open your account', 'Verify your identity', 'Deposit $10'], requirements: ['US residents 18+', 'New NovaBank customers only'], countries: ['US'], holdHours: 72, featured: true, quality: 94, reliability: 0.97,
    content: { appSteps: ['Create your NovaBank login', 'Verify your identity', 'Deposit $10 (stays in your account)'] },
  },
  {
    externalId: 'fin-creditpath', title: 'Check your free credit score', advertiser: 'CreditPath', category: 'financial', icon: '📈', brandColor: '#2563eb',
    shortDescription: 'Free, doesn’t affect your score.', description: 'Create a CreditPath account and view your score.',
    partner: usd(8), minutes: 5, data: 'light', steps: ['Create account', 'View your score'], countries: ['US', 'CA', 'GB'], quality: 90, reliability: 0.95,
    content: { appSteps: ['Create your account', 'Answer security questions', 'View your score'] },
  },
  {
    externalId: 'fin-stackr', title: 'Start investing with Stackr ($5)', advertiser: 'Stackr', category: 'financial', icon: '🪙', brandColor: '#4f46e5',
    shortDescription: 'Fund a micro-investing account with $5.', description: 'Open a Stackr account and invest $5 (it remains your money).',
    partner: usd(25), minutes: 10, data: 'light', steps: ['Open an account', 'Verify identity', 'Invest $5'], countries: ['US', 'GB', 'CA', 'AU'], holdHours: 72, quality: 89, reliability: 0.95,
    content: { appSteps: ['Create account', 'Verify your identity', 'Invest $5'] },
  },
  {
    externalId: 'fin-zenko', title: 'Open a Zenko digital account', advertiser: 'Zenko', category: 'financial', icon: '🇳🇬', brandColor: '#15803d',
    shortDescription: 'Free Naira account with instant transfers.', description: 'Open a free Zenko account with your BVN and fund it with ₦1,000.',
    partner: usd(6), minutes: 8, data: 'light', steps: ['Download Zenko', 'Verify with BVN', 'Fund ₦1,000'], countries: ['NG'], holdHours: 24, featured: true, quality: 91, reliability: 0.96,
    content: { appSteps: ['Download Zenko', 'Verify with your BVN', 'Fund ₦1,000'] },
  },
  {
    externalId: 'fin-coinhaven', title: 'CoinHaven: sign up & verify', advertiser: 'CoinHaven', category: 'financial', icon: '₿', brandColor: '#f59e0b',
    shortDescription: 'Crypto exchange — verification required.', description: 'Create and verify a CoinHaven account. No deposit required.',
    partner: usd(18), minutes: 12, data: 'light', steps: ['Create account', 'Verify identity'], countries: ['GB', 'DE', 'FR', 'NL', 'ES', 'IT', 'NG', 'KE', 'IN', 'PH', 'BR', 'MX', 'ZA', 'GH', 'AU', 'CA'], holdHours: 72, quality: 83, reliability: 0.92,
    content: { appSteps: ['Create account', 'Upload ID', 'Take a selfie'] },
  },
  // ------------------------------------------------------------------ learn
  {
    externalId: 'learn-budget', title: 'Budgeting 101 — 5-minute lesson', advertiser: 'MoneySmart Foundation', category: 'learn', icon: '🎓', brandColor: '#0891b2',
    shortDescription: 'Learn the 50/30/20 rule and get paid.', description: 'A short lesson followed by a 3-question quiz.',
    partner: usd(0.6), minutes: 5, data: 'light', steps: ['Read the lesson', 'Pass the 3-question quiz'], featured: true, quality: 97, reliability: 0.99,
    content: {
      lesson: {
        title: 'The 50/30/20 rule',
        paragraphs: [
          'A simple way to budget is to split your after-tax income into three buckets.',
          '50% goes to needs: rent, food, transport, bills — things you must pay.',
          '30% goes to wants: eating out, entertainment, subscriptions.',
          '20% goes to savings and paying off debt. Even small amounts add up thanks to compounding.',
          'If 20% is too much right now, start with 5% and increase it every few months.',
        ],
        quiz: [
          { q: 'What share of income goes to needs?', options: ['20%', '30%', '50%'], answer: 2 },
          { q: 'Which is a "want"?', options: ['Rent', 'Streaming subscription', 'Electricity bill'], answer: 1 },
          { q: 'If 20% savings is too hard, you should…', options: ['Give up on saving', 'Start smaller and increase it', 'Borrow to save'], answer: 1 },
        ],
      },
    },
  },
  {
    externalId: 'learn-phishing', title: 'Spot a phishing email', advertiser: 'CyberSafe Initiative', category: 'learn', icon: '🛡️', brandColor: '#334155',
    shortDescription: '4 minutes that could save your savings.', description: 'Learn the 4 tell-tale signs of phishing.',
    partner: usd(0.5), minutes: 4, data: 'light', steps: ['Read the lesson', 'Pass the quiz'], quality: 96, reliability: 0.99,
    content: {
      lesson: {
        title: '4 signs of a phishing email',
        paragraphs: [
          '1. Urgency: "Your account will be closed in 24 hours!" is a classic pressure tactic.',
          '2. Mismatched sender: the display name says your bank, but the address is random.',
          '3. Suspicious links: hover (or long-press) to preview where a link really goes.',
          '4. Requests for secrets: real companies never ask for passwords or OTP codes by email.',
        ],
        quiz: [
          { q: 'A bank emails asking for your OTP code. You…', options: ['Reply with it', 'Ignore & report it', 'Call the number in the email'], answer: 1 },
          { q: 'Which is a red flag?', options: ['Extreme urgency', 'Your first name', 'A logo'], answer: 0 },
          { q: 'Before clicking a link you should…', options: ['Preview the real address', 'Click quickly', 'Forward it to friends'], answer: 0 },
        ],
      },
    },
  },
  {
    externalId: 'learn-compound', title: 'Intro to compound interest', advertiser: 'MoneySmart Foundation', category: 'learn', icon: '📚', brandColor: '#0d9488',
    shortDescription: 'Why starting early matters so much.', description: 'A visual explanation and a short quiz.',
    partner: usd(0.7), minutes: 6, data: 'light', steps: ['Read the lesson', 'Pass the quiz'], quality: 95, reliability: 0.99,
    content: {
      lesson: {
        title: 'Compound interest in 3 minutes',
        paragraphs: [
          'Compound interest means you earn interest on your interest.',
          '$100 at 10% per year becomes $110 after one year — and $121 after two, not $120.',
          'Over 30 years, that same $100 grows to about $1,745. Time is the secret ingredient.',
          'That is why starting early with small amounts often beats starting late with big ones.',
        ],
        quiz: [
          { q: '$100 at 10% for 2 years becomes…', options: ['$120', '$121', '$200'], answer: 1 },
          { q: 'The most powerful ingredient is…', options: ['Time', 'Luck', 'Fees'], answer: 0 },
          { q: 'Compound interest means…', options: ['Interest on interest', 'A fixed fee', 'A loan'], answer: 0 },
        ],
      },
    },
  },
  // --------------------------------------------------------------- shopping
  {
    externalId: 'shop-shopnest', title: 'Get 8% back at ShopNest', advertiser: 'ShopNest', category: 'shopping', icon: '🛍️', brandColor: '#be123c',
    shortDescription: 'Cashback on your next order (demo order: $40).', description: 'Shop through CashAds and get 8% of your order back. Cashback confirms after the return window.',
    partner: usd(5.3), minutes: 10, data: 'medium', steps: ['Browse the store', 'Place an order', 'Cashback confirms after the return window'], holdHours: 72, quality: 84, reliability: 0.91,
    content: { appSteps: ['Browse ShopNest', 'Add items to cart', 'Check out (sandbox — no charge)'] },
  },
  {
    externalId: 'shop-mealkitty', title: 'First MealKitty box — $6 back', advertiser: 'MealKitty', category: 'shopping', icon: '🥘', brandColor: '#65a30d',
    shortDescription: 'Fresh recipes delivered. First box only.', description: 'Order your first MealKitty box and get money back.',
    partner: usd(10), minutes: 12, data: 'medium', steps: ['Choose a plan', 'Place your first order'], requirements: ['First order only'], countries: ['US', 'CA', 'GB', 'AU', 'DE', 'NL'], holdHours: 48, quality: 86, reliability: 0.93,
    content: { appSteps: ['Choose a plan', 'Pick 3 recipes', 'Check out (sandbox — no charge)'] },
  },
];

/* ------------------------------------------------------------------ videos */
export const VIDEO_ADS = [
  { advertiser: 'Budgetly', headline: 'Know where every dollar goes.', tagline: 'Budgeting that takes 2 minutes a week.', cta: 'Try Budgetly free', brandColor: '#059669', accentColor: '#a7f3d0', emoji: '📊', durationSeconds: 15, partner: usd(0.025) },
  { advertiser: 'Lingoleap', headline: 'Speak a new language in 5 minutes a day.', tagline: 'Join 20 million learners.', cta: 'Start learning', brandColor: '#16a34a', accentColor: '#bbf7d0', emoji: '🗣️', durationSeconds: 20, partner: usd(0.03) },
  { advertiser: 'FreshCart', headline: 'Groceries at your door in 30 minutes.', tagline: 'Free delivery on your first order.', cta: 'Order now', brandColor: '#ea580c', accentColor: '#fed7aa', emoji: '🥕', durationSeconds: 15, partner: usd(0.02) },
  { advertiser: 'NovaBank', headline: 'No fees. No minimums. Ever.', tagline: 'Banking that respects your money.', cta: 'Open an account', brandColor: '#0f172a', accentColor: '#94a3b8', emoji: '💳', durationSeconds: 20, partner: usd(0.04) },
  { advertiser: 'FitFlow', headline: 'Fit in 7 minutes a day.', tagline: 'Guided workouts, no equipment.', cta: 'Get moving', brandColor: '#dc2626', accentColor: '#fecaca', emoji: '🏃', durationSeconds: 15, partner: usd(0.02) },
  { advertiser: 'SolarNest', headline: 'Power your home with the sun.', tagline: 'Cut your energy bill by up to 70%.', cta: 'Get a free quote', brandColor: '#ca8a04', accentColor: '#fef08a', emoji: '☀️', durationSeconds: 25, partner: usd(0.05) },
  { advertiser: 'PetPals', headline: 'Everything your pet loves.', tagline: 'Treats, toys and vet tips.', cta: 'Shop PetPals', brandColor: '#b45309', accentColor: '#fde68a', emoji: '🐾', durationSeconds: 15, partner: usd(0.018) },
  { advertiser: 'TripTide', headline: 'Flights that fit your budget.', tagline: 'Price alerts for 900+ airlines.', cta: 'Find a flight', brandColor: '#0284c7', accentColor: '#bae6fd', emoji: '✈️', durationSeconds: 20, partner: usd(0.03) },
];

/* ---------------------------------------------------------- payout methods */
const ALL_PAYPAL = ['US', 'CA', 'GB', 'IE', 'DE', 'FR', 'NL', 'ES', 'IT', 'PL', 'AU', 'NZ', 'IN', 'PH', 'ID', 'VN', 'BR', 'MX', 'AR', 'CO', 'ZA', 'KE', 'EG', 'AE', 'UG', 'TZ'];
const email = (label: string): PayoutFieldDef => ({ key: 'email', label, type: 'email', placeholder: 'you@example.com' });

export const PAYOUT_METHODS: Array<{
  id: string;
  name: string;
  kind: 'paypal' | 'crypto' | 'giftcard' | 'bank' | 'mobile_money' | 'wise' | 'charity';
  description: string;
  logo: string;
  provider: string;
  min: number;
  max: number;
  feeFixed: number;
  feeBps: number;
  eta: string;
  countries: string[];
  currency: string | null;
  fields: PayoutFieldDef[];
  sort: number;
}> = [
  { id: 'paypal', name: 'PayPal', kind: 'paypal', description: 'Sent to your PayPal balance.', logo: '🅿️', provider: 'paypal', min: usd(0.1), max: usd(2000), feeFixed: 0, feeBps: 200, eta: 'Usually minutes', countries: ALL_PAYPAL, currency: null, fields: [email('PayPal email')], sort: 10 },
  {
    id: 'usdc_polygon', name: 'USDC (Polygon)', kind: 'crypto', description: 'Stablecoin, near-zero network fee.', logo: '🟣', provider: 'sandbox', min: usd(0.1), max: usd(5000), feeFixed: usd(0.01), feeBps: 0, eta: '~2 minutes', countries: [], currency: null,
    fields: [{ key: 'address', label: 'Polygon wallet address', type: 'text', placeholder: '0x…', pattern: '^0x[a-fA-F0-9]{40}$', hint: 'starts with 0x and has 42 characters' }], sort: 20,
  },
  {
    id: 'usdt_trc20', name: 'USDT (TRC-20)', kind: 'crypto', description: 'Tether on Tron.', logo: '🟢', provider: 'sandbox', min: usd(1), max: usd(5000), feeFixed: usd(0.1), feeBps: 0, eta: '10–30 minutes', countries: [], currency: null,
    fields: [{ key: 'address', label: 'Tron (TRC-20) address', type: 'text', placeholder: 'T…', pattern: '^T[1-9A-HJ-NP-Za-km-z]{33}$', hint: 'starts with T and has 34 characters' }], sort: 25,
  },
  {
    id: 'btc_lightning', name: 'Bitcoin (Lightning)', kind: 'crypto', description: 'Instant sats to your Lightning address.', logo: '⚡', provider: 'sandbox', min: usd(0.05), max: usd(500), feeFixed: 0, feeBps: 50, eta: 'Instant', countries: [], currency: null,
    fields: [{ key: 'address', label: 'Lightning address', type: 'text', placeholder: 'you@walletofsatoshi.com', pattern: '^[\\w.+-]+@[\\w-]+\\.[\\w.-]+$', hint: 'looks like name@wallet.com' }], sort: 30,
  },
  {
    id: 'amazon', name: 'Amazon gift card', kind: 'giftcard', description: 'Code delivered by email.', logo: '🎁', provider: 'sandbox', min: usd(1), max: usd(500), feeFixed: 0, feeBps: 0, eta: 'Instant (email)', countries: ['US', 'CA', 'GB', 'DE', 'FR', 'ES', 'IT', 'AU', 'IN', 'MX', 'BR'], currency: null,
    fields: [email('Email to deliver the code'), { key: 'region', label: 'Amazon store', type: 'select', options: [{ value: 'US', label: 'amazon.com' }, { value: 'UK', label: 'amazon.co.uk' }, { value: 'CA', label: 'amazon.ca' }, { value: 'DE', label: 'amazon.de' }, { value: 'IN', label: 'amazon.in' }] }],
    sort: 40,
  },
  {
    id: 'bank_ach', name: 'Bank transfer (ACH)', kind: 'bank', description: 'Direct to a US bank account.', logo: '🏛️', provider: 'sandbox', min: usd(5), max: usd(5000), feeFixed: 0, feeBps: 0, eta: '1–3 business days', countries: ['US'], currency: null,
    fields: [
      { key: 'accountName', label: 'Account holder name', type: 'text' },
      { key: 'routingNumber', label: 'Routing number', type: 'text', pattern: '^\\d{9}$', hint: '9 digits' },
      { key: 'accountNumber', label: 'Account number', type: 'text', pattern: '^\\d{4,17}$', hint: '4–17 digits' },
    ],
    sort: 50,
  },
  {
    id: 'paystack_ng', name: 'Nigerian bank (Paystack)', kind: 'bank', description: 'Instant transfer to any Nigerian bank in Naira.', logo: '🇳🇬', provider: 'paystack', min: usd(0.5), max: usd(2000), feeFixed: 0, feeBps: 100, eta: 'Instant', countries: ['NG'], currency: 'NGN',
    fields: [
      { key: 'bankCode', label: 'Bank', type: 'select', options: [{ value: '058', label: 'GTBank' }, { value: '044', label: 'Access Bank' }, { value: '057', label: 'Zenith Bank' }, { value: '011', label: 'First Bank' }, { value: '033', label: 'UBA' }, { value: '999992', label: 'OPay' }, { value: '50211', label: 'Kuda' }, { value: '50515', label: 'Moniepoint' }] },
      { key: 'accountNumber', label: 'Account number (NUBAN)', type: 'text', pattern: '^\\d{10}$', hint: '10 digits' },
      { key: 'accountName', label: 'Account name', type: 'text' },
    ],
    sort: 15,
  },
  { id: 'mpesa_ke', name: 'M-Pesa', kind: 'mobile_money', description: 'Straight to your M-Pesa wallet in KES.', logo: '📲', provider: 'sandbox', min: usd(0.2), max: usd(1000), feeFixed: 0, feeBps: 100, eta: 'Instant', countries: ['KE'], currency: 'KES', fields: [{ key: 'phone', label: 'M-Pesa number', type: 'tel', placeholder: '+2547…', pattern: '^\\+254(7|1)\\d{8}$', hint: '+2547XXXXXXXX' }], sort: 15 },
  { id: 'momo_gh', name: 'MTN MoMo', kind: 'mobile_money', description: 'Mobile money in Ghana cedis.', logo: '🟡', provider: 'sandbox', min: usd(0.2), max: usd(1000), feeFixed: 0, feeBps: 100, eta: 'Instant', countries: ['GH'], currency: 'GHS', fields: [{ key: 'phone', label: 'MoMo number', type: 'tel', placeholder: '+233…', pattern: '^\\+233\\d{9}$', hint: '+233XXXXXXXXX' }], sort: 15 },
  { id: 'gcash_ph', name: 'GCash', kind: 'mobile_money', description: 'Instant to GCash in pesos.', logo: '🔵', provider: 'sandbox', min: usd(0.2), max: usd(1000), feeFixed: 0, feeBps: 100, eta: 'Instant', countries: ['PH'], currency: 'PHP', fields: [{ key: 'phone', label: 'GCash number', type: 'tel', placeholder: '+639…', pattern: '^\\+639\\d{9}$', hint: '+639XXXXXXXXX' }], sort: 15 },
  { id: 'upi_in', name: 'UPI', kind: 'mobile_money', description: 'Instant to any UPI ID in rupees.', logo: '🇮🇳', provider: 'sandbox', min: usd(0.2), max: usd(1000), feeFixed: 0, feeBps: 50, eta: 'Instant', countries: ['IN'], currency: 'INR', fields: [{ key: 'vpa', label: 'UPI ID', type: 'text', placeholder: 'name@bank', pattern: '^[\\w.-]{2,64}@[a-zA-Z]{2,64}$', hint: 'looks like name@okaxis' }], sort: 15 },
  { id: 'pix_br', name: 'Pix', kind: 'mobile_money', description: 'Instantâneo para sua chave Pix, em reais.', logo: '🇧🇷', provider: 'sandbox', min: usd(0.2), max: usd(1000), feeFixed: 0, feeBps: 50, eta: 'Instant', countries: ['BR'], currency: 'BRL', fields: [{ key: 'pixKey', label: 'Chave Pix (CPF, email or phone)', type: 'text' }], sort: 15 },
  { id: 'wise', name: 'Wise', kind: 'wise', description: 'Bank payout in 40+ currencies.', logo: '🌐', provider: 'sandbox', min: usd(5), max: usd(5000), feeFixed: 0, feeBps: 100, eta: '1–2 days', countries: [], currency: null, fields: [email('Wise account email')], sort: 60 },
  {
    id: 'charity', name: 'Donate to charity', kind: 'charity', description: '100% goes to a verified nonprofit. Zero fees.', logo: '💚', provider: 'sandbox', min: usd(0.01), max: usd(5000), feeFixed: 0, feeBps: 0, eta: 'Instant', countries: [], currency: null,
    fields: [{ key: 'charity', label: 'Charity', type: 'select', options: [{ value: 'givedirectly', label: 'GiveDirectly' }, { value: 'amf', label: 'Against Malaria Foundation' }, { value: 'waterorg', label: 'Water.org' }] }],
    sort: 90,
  },
];

/** Indicative mid-market rates (USD → local). Refresh from an FX provider in production. */
export const FX_RATES: Record<string, number> = {
  NGN: 1545, GHS: 15.4, KES: 129, ZAR: 18.2, UGX: 3720, TZS: 2650, EGP: 49.2, AED: 3.67, INR: 86.4, PKR: 281, BDT: 120, PHP: 57.8,
  IDR: 16250, VND: 25450, BRL: 5.48, MXN: 18.6, ARS: 1180, COP: 4120, EUR: 0.92, GBP: 0.78, CAD: 1.37, AUD: 1.53, NZD: 1.68, PLN: 3.94,
};
