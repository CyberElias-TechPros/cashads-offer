import { type ComponentType, lazy } from 'react';
import { Outlet, ScrollRestoration, createBrowserRouter } from 'react-router';
import { AdminLayout, AppLayout, PublicLayout } from './components/layouts';

/** Route-level code splitting: each area loads only when visited (data-saver friendly). */
function page<M extends Record<string, unknown>>(loader: () => Promise<M>, name: keyof M) {
  return lazy(async () => ({ default: (await loader())[name] as ComponentType }));
}

const pub = () => import('./routes/public/pages');
const auth = () => import('./routes/auth/AuthPages');
const earn = () => import('./routes/app/Earn');
const money = () => import('./routes/app/Money');
const grow = () => import('./routes/app/Grow');
const account = () => import('./routes/app/Account');
const help = () => import('./routes/app/Help');
const admin = () => import('./routes/admin/Admin');
const adminOps = () => import('./routes/admin/Operations');

const Landing = page(() => import('./routes/public/Landing'), 'Landing');
const Transparency = page(() => import('./routes/public/Transparency'), 'Transparency');
const HowItWorks = page(pub, 'HowItWorks');
const Faq = page(pub, 'Faq');
const Blog = page(pub, 'Blog');
const BlogPostPage = page(pub, 'BlogPostPage');
const Legal = page(pub, 'Legal');
const Contact = page(pub, 'Contact');
const Status = page(pub, 'Status');
const ReferralLanding = page(pub, 'ReferralLanding');
const NotFound = page(pub, 'NotFound');

const AuthLayout = page(auth, 'AuthLayout');
const Login = page(auth, 'Login');
const Signup = page(auth, 'Signup');
const ForgotPassword = page(auth, 'ForgotPassword');
const ResetPassword = page(auth, 'ResetPassword');
const VerifyEmail = page(auth, 'VerifyEmail');

const Dashboard = page(() => import('./routes/app/Dashboard'), 'Dashboard');
const Onboarding = page(() => import('./routes/app/Onboarding'), 'Onboarding');
const EarnPage = page(earn, 'EarnPage');
const OfferDetail = page(earn, 'OfferDetail');
const QuickTasks = page(() => import('./routes/app/QuickTasks'), 'QuickTasks');
const Watch = page(() => import('./routes/app/Watch'), 'Watch');
const Lessons = page(() => import('./routes/app/Learn'), 'Lessons');
const LessonPage = page(() => import('./routes/app/Learn'), 'LessonPage');
const ActivityPage = page(() => import('./routes/app/Activity'), 'ActivityPage');
const ClaimNew = page(() => import('./routes/app/Activity'), 'ClaimNew');
const ClaimDetail = page(() => import('./routes/app/Activity'), 'ClaimDetail');
const WalletPage = page(money, 'WalletPage');
const PayoutDetail = page(money, 'PayoutDetail');
const Cashout = page(() => import('./routes/app/Cashout'), 'Cashout');
const Referrals = page(grow, 'Referrals');
const Leaderboard = page(grow, 'Leaderboard');
const Achievements = page(grow, 'Achievements');
const Charity = page(grow, 'Charity');
const Profile = page(account, 'Profile');
const Kyc = page(account, 'Kyc');
const Notifications = page(account, 'Notifications');
const Restricted = page(account, 'Restricted');
const Support = page(help, 'Support');
const TicketPage = page(help, 'TicketPage');
const Community = page(help, 'Community');
const Tax = page(help, 'Tax');

const AdminOverview = page(admin, 'AdminOverview');
const AdminAnalytics = page(admin, 'AdminAnalytics');
const AdminUsers = page(admin, 'AdminUsers');
const AdminUserDetail = page(admin, 'AdminUserDetail');
const AdminSettings = page(admin, 'AdminSettings');
const AdminAudit = page(admin, 'AdminAudit');
const AdminPayouts = page(adminOps, 'AdminPayouts');
const AdminClaims = page(adminOps, 'AdminClaims');
const AdminFraud = page(adminOps, 'AdminFraud');
const AdminKyc = page(adminOps, 'AdminKyc');
const AdminOffers = page(adminOps, 'AdminOffers');
const AdminPostbacks = page(adminOps, 'AdminPostbacks');
const AdminSupport = page(adminOps, 'AdminSupport');
const AdminCommunity = page(adminOps, 'AdminCommunity');

const SandboxOffer = page(() => import('./routes/sandbox/SandboxOffer'), 'SandboxOffer');
const DevInbox = page(() => import('./routes/sandbox/DevInbox'), 'DevInbox');

function Root() {
  return (
    <>
      <ScrollRestoration />
      <Outlet />
    </>
  );
}

export const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      {
        element: <PublicLayout />,
        children: [
          { index: true, element: <Landing /> },
          { path: 'how-it-works', element: <HowItWorks /> },
          { path: 'transparency', element: <Transparency /> },
          { path: 'faq', element: <Faq /> },
          { path: 'blog', element: <Blog /> },
          { path: 'blog/:slug', element: <BlogPostPage /> },
          { path: 'legal/:doc', element: <Legal /> },
          { path: 'contact', element: <Contact /> },
          { path: 'status', element: <Status /> },
          { path: 'r/:code', element: <ReferralLanding /> },
        ],
      },
      {
        element: <AuthLayout />,
        children: [
          { path: 'login', element: <Login /> },
          { path: 'signup', element: <Signup /> },
          { path: 'forgot-password', element: <ForgotPassword /> },
          { path: 'reset-password', element: <ResetPassword /> },
          { path: 'verify-email', element: <VerifyEmail /> },
        ],
      },
      {
        path: 'app',
        element: <AppLayout />,
        children: [
          { index: true, element: <Dashboard /> },
          { path: 'onboarding', element: <Onboarding /> },
          { path: 'earn', element: <EarnPage /> },
          { path: 'earn/quick', element: <QuickTasks /> },
          { path: 'earn/:offerId', element: <OfferDetail /> },
          { path: 'watch', element: <Watch /> },
          { path: 'learn', element: <Lessons /> },
          { path: 'learn/:lessonId', element: <LessonPage /> },
          { path: 'activity', element: <ActivityPage /> },
          { path: 'claims/new', element: <ClaimNew /> },
          { path: 'claims/:id', element: <ClaimDetail /> },
          { path: 'wallet', element: <WalletPage /> },
          { path: 'cashout', element: <Cashout /> },
          { path: 'payouts/:id', element: <PayoutDetail /> },
          { path: 'referrals', element: <Referrals /> },
          { path: 'leaderboard', element: <Leaderboard /> },
          { path: 'achievements', element: <Achievements /> },
          { path: 'charity', element: <Charity /> },
          { path: 'profile', element: <Profile /> },
          { path: 'kyc', element: <Kyc /> },
          { path: 'notifications', element: <Notifications /> },
          { path: 'restricted', element: <Restricted /> },
          { path: 'support', element: <Support /> },
          { path: 'support/:id', element: <TicketPage /> },
          { path: 'community', element: <Community /> },
          { path: 'tax', element: <Tax /> },
        ],
      },
      {
        path: 'admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: <AdminOverview /> },
          { path: 'analytics', element: <AdminAnalytics /> },
          { path: 'users', element: <AdminUsers /> },
          { path: 'users/:id', element: <AdminUserDetail /> },
          { path: 'payouts', element: <AdminPayouts /> },
          { path: 'claims', element: <AdminClaims /> },
          { path: 'fraud', element: <AdminFraud /> },
          { path: 'kyc', element: <AdminKyc /> },
          { path: 'offers', element: <AdminOffers /> },
          { path: 'postbacks', element: <AdminPostbacks /> },
          { path: 'support', element: <AdminSupport /> },
          { path: 'community', element: <AdminCommunity /> },
          { path: 'settings', element: <AdminSettings /> },
          { path: 'audit', element: <AdminAudit /> },
        ],
      },
      { path: 'sandbox/offer/:clickId', element: <SandboxOffer /> },
      { path: 'dev/inbox', element: <DevInbox /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
