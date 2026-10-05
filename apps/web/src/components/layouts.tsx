import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Award,
  Banknote,
  Bell,
  ChartColumn,
  ChevronDown,
  CirclePlay,
  ClipboardList,
  Flag,
  GraduationCap,
  Heart,
  House,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  Lightbulb,
  LogOut,
  Menu,
  Network,
  Receipt,
  ScrollText,
  Settings,
  Shield,
  ShieldAlert,
  Sparkles,
  Trophy,
  UserRound,
  Users,
  Wallet,
  X,
  Zap,
  BadgeCheck,
  Gift,
} from 'lucide-react';
import { type ReactNode, Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { post } from '../lib/api';
import { qk, useMe, useMoney, useRealtime, useUnreadCount, useWallet } from '../lib/queries';
import { cn } from '../lib/utils';
import { toast } from '../store/ui';
import { Logo, SandboxBanner, useAnimatedNumber } from './brand';
import { Avatar, ButtonLink, Callout, Spinner } from './ui';

/* ── public site ───────────────────────────────────────────────────────────── */

const PUBLIC_NAV = [
  { to: '/how-it-works', label: 'How it works' },
  { to: '/transparency', label: 'Transparency' },
  { to: '/faq', label: 'FAQ' },
  { to: '/blog', label: 'Blog' },
];

export function PublicLayout() {
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  return (
    <div className="flex min-h-screen flex-col">
      <SandboxBanner />
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/80 backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-950/80">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex">
            {PUBLIC_NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-lg px-3 py-2 text-sm font-medium transition',
                    isActive
                      ? 'text-slate-900 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            {me ? (
              <ButtonLink to="/app">Open app</ButtonLink>
            ) : (
              <>
                <ButtonLink to="/login" variant="ghost">
                  Sign in
                </ButtonLink>
                <ButtonLink to="/signup">Start earning</ButtonLink>
              </>
            )}
          </div>
          <button className="rounded-lg p-2 md:hidden" onClick={() => setOpen((v) => !v)} aria-label="Menu">
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
        {open && (
          <div className="animate-fade-in border-t border-slate-200 px-4 pb-4 md:hidden dark:border-slate-800">
            <nav className="flex flex-col py-2">
              {PUBLIC_NAV.map((n) => (
                <Link
                  key={n.to}
                  to={n.to}
                  className="rounded-lg px-2 py-2.5 font-medium text-slate-700 dark:text-slate-300"
                >
                  {n.label}
                </Link>
              ))}
            </nav>
            <div className="grid grid-cols-2 gap-2">
              {me ? (
                <ButtonLink to="/app" className="col-span-2">
                  Open app
                </ButtonLink>
              ) : (
                <>
                  <ButtonLink to="/login" variant="outline">
                    Sign in
                  </ButtonLink>
                  <ButtonLink to="/signup">Start earning</ButtonLink>
                </>
              )}
            </div>
          </div>
        )}
      </header>
      <main className="flex-1">
        <Suspense fallback={<PageSpinner />}>
          <Outlet />
        </Suspense>
      </main>
      <PublicFooter />
    </div>
  );
}

function PublicFooter() {
  const cols = [
    {
      title: 'Product',
      links: [
        ['How it works', '/how-it-works'],
        ['Earning preview', '/#preview'],
        ['Transparency', '/transparency'],
        ['System status', '/status'],
      ],
    },
    {
      title: 'Help',
      links: [
        ['FAQ', '/faq'],
        ['Contact support', '/contact'],
        ['Blog & guides', '/blog'],
        ['Earnings policy', '/legal/earnings-policy'],
      ],
    },
    {
      title: 'Legal',
      links: [
        ['Terms', '/legal/terms'],
        ['Privacy', '/legal/privacy'],
        ['Cookies', '/legal/cookies'],
      ],
    },
  ];
  return (
    <footer className="border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-5">
        <div className="md:col-span-2">
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-slate-500">
            Real cash for your spare minutes. No points, no minimum — and paid even when tracking fails.
          </p>
          <p className="mt-4 text-xs text-slate-400">
            60% of what advertisers pay us goes to members. Live figure on our transparency page.
          </p>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{c.title}</p>
            <ul className="mt-3 space-y-2">
              {c.links.map(([label, to]) => (
                <li key={to}>
                  <Link
                    to={to!}
                    className="text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-100 py-5 text-center text-xs text-slate-400 dark:border-slate-900">
        © {new Date().getFullYear()} Lucrum · Built for members in Nigeria, Ghana, Kenya, South Africa,
        India, the Philippines, Brazil and beyond.
      </div>
    </footer>
  );
}

export function PageSpinner() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner className="size-6" />
    </div>
  );
}

/* ── member app ────────────────────────────────────────────────────────────── */

const APP_NAV: {
  title: string;
  items: { to: string; label: string; icon: typeof House; end?: boolean }[];
}[] = [
  {
    title: 'Earn',
    items: [
      { to: '/app', label: 'Home', icon: House, end: true },
      { to: '/app/earn', label: 'All tasks', icon: Sparkles, end: true },
      { to: '/app/earn/quick', label: 'Quick tasks', icon: Zap },
      { to: '/app/watch', label: 'Videos', icon: CirclePlay },
      { to: '/app/learn', label: 'Earn + learn', icon: GraduationCap },
    ],
  },
  {
    title: 'Money',
    items: [
      { to: '/app/wallet', label: 'Wallet', icon: Wallet },
      { to: '/app/cashout', label: 'Cash out', icon: Banknote },
      { to: '/app/activity', label: 'Activity & claims', icon: Activity },
      { to: '/app/tax', label: 'Tax centre', icon: Receipt },
    ],
  },
  {
    title: 'Grow',
    items: [
      { to: '/app/referrals', label: 'Invite friends', icon: Gift },
      { to: '/app/leaderboard', label: 'Leaderboard', icon: Trophy },
      { to: '/app/achievements', label: 'Achievements', icon: Award },
      { to: '/app/charity', label: 'Earn for a cause', icon: Heart },
    ],
  },
  {
    title: 'Help',
    items: [
      { to: '/app/support', label: 'Support', icon: LifeBuoy },
      { to: '/app/community', label: 'Community ideas', icon: Lightbulb },
    ],
  },
];

const BOTTOM_NAV = [
  { to: '/app', label: 'Home', icon: House, end: true },
  { to: '/app/earn', label: 'Earn', icon: Sparkles, end: false },
  { to: '/app/activity', label: 'Activity', icon: Activity, end: false },
  { to: '/app/wallet', label: 'Wallet', icon: Wallet, end: false },
  { to: '/app/profile', label: 'Profile', icon: UserRound, end: false },
];

function BalancePill() {
  const { data } = useWallet();
  const m = useMoney();
  const animated = useAnimatedNumber(data?.availableMicros ?? 0);
  return (
    <Link
      to="/app/wallet"
      className="tabular inline-flex items-center gap-2 rounded-full bg-slate-900 py-1.5 pl-2 pr-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 dark:bg-white dark:text-slate-900"
      title={m.local(data?.availableMicros ?? 0) ? `≈ ${m.local(data?.availableMicros ?? 0)}` : undefined}
    >
      <span className="flex size-6 items-center justify-center rounded-full bg-brand-500 text-white">
        <Wallet className="size-3.5" />
      </span>
      {data ? m.usd(animated, { floor: true }) : '—'}
    </Link>
  );
}

function UserMenu() {
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  if (!me) return null;
  const logout = async () => {
    await post('/auth/logout');
    qc.clear();
    navigate('/');
  };
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-full p-0.5 hover:bg-slate-100 dark:hover:bg-slate-800"
        aria-label="Account menu"
      >
        <Avatar name={me.displayName ?? me.email} className="size-8 text-xs" />
        <ChevronDown className="hidden size-4 text-slate-400 sm:block" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 z-50 mt-2 w-60 animate-slide-up overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
            onClick={() => setOpen(false)}
          >
            <div className="px-3 py-2">
              <p className="truncate text-sm font-semibold">{me.displayName ?? 'Member'}</p>
              <p className="truncate text-xs text-slate-500">{me.email}</p>
            </div>
            <MenuLink to="/app/profile" icon={Settings}>
              Profile & settings
            </MenuLink>
            <MenuLink to="/app/notifications" icon={Bell}>
              Notifications
            </MenuLink>
            {me.role !== 'user' && (
              <MenuLink to="/admin" icon={Shield}>
                Admin console
              </MenuLink>
            )}
            <button
              onClick={logout}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
            >
              <LogOut className="size-4" /> Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function MenuLink({ to, icon: Icon, children }: { to: string; icon: typeof House; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      <Icon className="size-4 text-slate-400" /> {children}
    </Link>
  );
}

function NotificationBell() {
  const { data: unread } = useUnreadCount();
  return (
    <Link
      to="/app/notifications"
      className="relative rounded-full p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
    >
      <Bell className="size-5" />
      {!!unread && (
        <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-4 text-white">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  );
}

function SideNavLink({
  to,
  label,
  icon: Icon,
  end,
}: {
  to: string;
  label: string;
  icon: typeof House;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition',
          isActive
            ? 'bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-300'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-white',
        )
      }
    >
      <Icon className="size-[18px]" />
      {label}
    </NavLink>
  );
}

export function AppLayout() {
  const { data: me, isLoading } = useMe();
  const location = useLocation();
  const qc = useQueryClient();
  useRealtime(Boolean(me));

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', Boolean(me?.prefs.reduceMotion));
  }, [me?.prefs.reduceMotion]);

  if (isLoading) return <PageSpinner />;
  if (!me)
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (!me.onboardingDone && location.pathname !== '/app/onboarding')
    return <Navigate to="/app/onboarding" replace />;

  const restricted = me.status === 'banned' || me.status === 'restricted';

  return (
    <div className="min-h-screen">
      <SandboxBanner />
      <div className="lg:flex">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white px-3 py-5 lg:flex dark:border-slate-800 dark:bg-slate-950">
          <div className="px-3">
            <Logo to="/app" />
          </div>
          <nav className="mt-6 flex-1 space-y-6 overflow-y-auto scrollbar-none">
            {APP_NAV.map((g) => (
              <div key={g.title}>
                <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {g.title}
                </p>
                <div className="space-y-0.5">
                  {g.items.map((i) => (
                    <SideNavLink key={i.to} {...i} />
                  ))}
                </div>
              </div>
            ))}
            {me.role !== 'user' && (
              <div>
                <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Staff
                </p>
                <SideNavLink to="/admin" label="Admin console" icon={Shield} />
              </div>
            )}
          </nav>
          <div className="mt-4 rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-4 text-white">
            <p className="text-sm font-semibold">Paid even when tracking fails</p>
            <p className="mt-1 text-xs text-brand-100">
              Not credited? File a Missing Credit claim from Activity.
            </p>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/85 backdrop-blur-xl dark:border-slate-800/70 dark:bg-slate-950/85">
            <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
              <div className="lg:hidden">
                <Logo to="/app" />
              </div>
              <div className="hidden text-sm text-slate-500 lg:block">
                {me.displayName ? <>Hi {me.displayName.split(' ')[0]} 👋</> : <>Welcome back 👋</>}
              </div>
              <div className="flex items-center gap-1.5">
                <BalancePill />
                <NotificationBell />
                <UserMenu />
              </div>
            </div>
          </header>

          <main className="mx-auto max-w-5xl px-4 pb-28 pt-5 sm:px-6 lg:pb-12">
            {restricted && location.pathname !== '/app/restricted' && (
              <Callout
                tone="danger"
                className="mb-5"
                title={me.restriction?.title ?? 'Account restricted'}
                action={
                  <ButtonLink to="/app/restricted" size="sm" variant="outline">
                    Details & appeal
                  </ButtonLink>
                }
              >
                Earning and cash-outs are paused. We’ll always tell you exactly why.
              </Callout>
            )}
            {!me.emailVerified && !restricted && (
              <VerifyEmailBanner onResent={() => qc.invalidateQueries({ queryKey: qk.me })} />
            )}
            <Suspense fallback={<PageSpinner />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur-xl lg:hidden dark:border-slate-800 dark:bg-slate-950/95">
        <div className="mx-auto grid max-w-md grid-cols-5">
          {BOTTOM_NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium',
                  isActive ? 'text-brand-700 dark:text-brand-400' : 'text-slate-500',
                )
              }
            >
              <Icon className="size-5" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

function VerifyEmailBanner({ onResent }: { onResent: () => void }) {
  const [sending, setSending] = useState(false);
  return (
    <Callout
      tone="warning"
      className="mb-5"
      title="Confirm your email to unlock cash-outs"
      action={
        <button
          className="text-sm font-semibold underline underline-offset-2"
          disabled={sending}
          onClick={async () => {
            setSending(true);
            try {
              await post('/auth/resend-verification');
              toast.success('Verification email sent', 'Check your inbox (in sandbox mode: the Dev inbox).');
              onResent();
            } catch (err) {
              toast.error('Couldn’t send', (err as Error).message);
            } finally {
              setSending(false);
            }
          }}
        >
          Resend
        </button>
      }
    >
      You can earn right away — we only need this before your first cash-out.
    </Callout>
  );
}

/* ── admin console ─────────────────────────────────────────────────────────── */

const ADMIN_NAV = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/admin/analytics', label: 'Analytics', icon: ChartColumn },
  { to: '/admin/users', label: 'Members', icon: Users },
  { to: '/admin/payouts', label: 'Payout queue', icon: Banknote },
  { to: '/admin/claims', label: 'Missing credit', icon: ClipboardList },
  { to: '/admin/fraud', label: 'Fraud review', icon: ShieldAlert },
  { to: '/admin/kyc', label: 'Identity checks', icon: BadgeCheck },
  { to: '/admin/offers', label: 'Offers & reports', icon: Flag },
  { to: '/admin/postbacks', label: 'Postback logs', icon: Network },
  { to: '/admin/support', label: 'Support & appeals', icon: Inbox },
  { to: '/admin/community', label: 'Community ideas', icon: Lightbulb },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
  { to: '/admin/audit', label: 'Audit log', icon: ScrollText },
];

export function AdminLayout() {
  const { data: me, isLoading } = useMe();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [location.pathname]);
  if (isLoading) return <PageSpinner />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (me.role === 'user') return <Navigate to="/app" replace />;
  return (
    <div className="min-h-screen bg-slate-100/60 dark:bg-slate-950">
      <SandboxBanner />
      <div className="lg:flex">
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-40 w-64 shrink-0 border-r border-slate-800 bg-slate-950 px-3 py-5 text-slate-300 transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
            open ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="flex items-center justify-between px-3">
            <Link to="/admin" className="flex items-center gap-2 font-bold text-white">
              <Shield className="size-5 text-brand-400" /> Lucrum Ops
            </Link>
            <button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="size-5" />
            </button>
          </div>
          <nav className="mt-6 space-y-0.5">
            {ADMIN_NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium',
                    isActive ? 'bg-white/10 text-white' : 'hover:bg-white/5 hover:text-white',
                  )
                }
              >
                <Icon className="size-[18px]" /> {label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-6 border-t border-white/10 pt-4">
            <Link
              to="/app"
              className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm hover:bg-white/5 hover:text-white"
            >
              <House className="size-[18px]" /> Back to member app
            </Link>
            <p className="px-3 pt-3 text-xs text-slate-500">
              Signed in as {me.email} · {me.role}
            </p>
          </div>
        </aside>
        {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:hidden dark:border-slate-800 dark:bg-slate-950/90">
            <button onClick={() => setOpen(true)} aria-label="Open menu">
              <Menu className="size-5" />
            </button>
            <span className="font-semibold">Lucrum Ops</span>
          </header>
          <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
            <Suspense fallback={<PageSpinner />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>
    </div>
  );
}
