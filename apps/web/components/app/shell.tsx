'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  CircleDollarSign,
  Clapperboard,
  FileText,
  Gift,
  Home,
  LayoutGrid,
  LifeBuoy,
  LogOut,
  Moon,
  PlayCircle,
  Search,
  Settings,
  Shield,
  Signal,
  Sun,
  Trophy,
  User,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { formatMoney, TIER_BY_ID } from '@cashads/shared';
import { Alert, Badge, Spinner } from '@/components/ui/feedback';
import { Avatar, Logo, Money, TimeAgo } from '@/components/ui/misc';
import { Dropdown, MenuItem } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { useLiveUpdates } from '@/lib/live';
import { qk, useMe, useNotifications } from '@/lib/queries';
import { toast, usePrefs, useUi } from '@/lib/store';
import { cn } from '@/lib/utils';
import { RewardCelebration } from './celebration';

const NAV: Array<{ group: string; items: Array<{ href: string; label: string; icon: typeof Home; exact?: boolean }> }> = [
  {
    group: 'Earn',
    items: [
      { href: '/app', label: 'Home', icon: Home, exact: true },
      { href: '/app/earn', label: 'Offers', icon: LayoutGrid },
      { href: '/app/watch', label: 'Watch & earn', icon: PlayCircle },
    ],
  },
  {
    group: 'Money',
    items: [
      { href: '/app/wallet', label: 'Wallet', icon: Wallet },
      { href: '/app/cashout', label: 'Cash out', icon: CircleDollarSign },
      { href: '/app/claims', label: 'Missing credit', icon: Search },
    ],
  },
  {
    group: 'Grow',
    items: [
      { href: '/app/rewards', label: 'Rewards & tiers', icon: Trophy },
      { href: '/app/leaderboard', label: 'Leaderboard', icon: Signal },
      { href: '/app/referrals', label: 'Invite friends', icon: Users },
    ],
  },
  {
    group: 'Account',
    items: [
      { href: '/app/support', label: 'Help & support', icon: LifeBuoy },
      { href: '/app/tax', label: 'Tax center', icon: FileText },
      { href: '/app/settings', label: 'Settings', icon: Settings },
    ],
  },
];

const MOBILE = [
  { href: '/app', label: 'Home', icon: Home, exact: true },
  { href: '/app/earn', label: 'Earn', icon: LayoutGrid },
  { href: '/app/watch', label: 'Watch', icon: Clapperboard },
  { href: '/app/wallet', label: 'Wallet', icon: Wallet },
  { href: '/app/settings', label: 'Me', icon: User },
];

function isActive(pathname: string, href: string, exact?: boolean) {
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function NotificationBell({ unread }: { unread: number }) {
  const { data, refetch } = useNotifications();
  const qc = useQueryClient();
  const markAll = async () => {
    await api('/notifications/read', { body: { all: true } });
    await Promise.all([qc.invalidateQueries({ queryKey: qk.notifications }), qc.invalidateQueries({ queryKey: qk.me })]);
  };
  return (
    <Dropdown
      className="w-[min(92vw,380px)] p-0"
      trigger={
        <button className="relative rounded-xl p-2.5 text-muted hover:bg-surface-3 hover:text-fg" aria-label={`Notifications (${unread} unread)`} onClick={() => void refetch()}>
          <Bell className="h-5 w-5" />
          {unread > 0 && <span className="tabular absolute right-1 top-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}
        </button>
      }
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <p className="text-sm font-semibold">Notifications</p>
        {unread > 0 && (
          <button className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300" onClick={(e) => (e.stopPropagation(), void markAll())}>
            Mark all read
          </button>
        )}
      </div>
      <div className="max-h-96 overflow-y-auto">
        {data?.slice(0, 12).map((n) => (
          <Link key={n.id} href={n.link ?? '/app/notifications'} className={cn('block border-b border-line px-4 py-3 last:border-0 hover:bg-surface-2', !n.readAt && 'bg-brand-50/40 dark:bg-brand-500/5')}>
            <div className="flex items-start gap-2">
              {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
              <div className="min-w-0">
                <p className="text-sm font-medium">{n.title}</p>
                <p className="line-clamp-2 text-xs text-muted">{n.body}</p>
                <TimeAgo iso={n.createdAt} className="text-[11px] text-subtle" />
              </div>
            </div>
          </Link>
        ))}
        {data && data.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted">You’re all caught up.</p>}
      </div>
      <Link href="/app/notifications" className="block border-t border-line px-4 py-2.5 text-center text-sm font-semibold text-brand-700 hover:bg-surface-2 dark:text-brand-300">
        View all
      </Link>
    </Dropdown>
  );
}

function Banners() {
  const { data: me } = useMe();
  const [dismissedDemo, setDismissedDemo] = useState(true);
  const takenOver = useUi((s) => s.videoTakenOver);
  const setTakenOver = useUi((s) => s.setVideoTakenOver);
  const [sending, setSending] = useState(false);
  useEffect(() => setDismissedDemo(sessionStorage.getItem('ca_demo_banner') === '1'), []);
  if (!me) return null;
  const u = me.user;
  return (
    <div className="mb-5 space-y-2 empty:hidden">
      {me.flags.maintenanceBanner && <Alert tone="warning">{me.flags.maintenanceBanner}</Alert>}
      {(u.status === 'banned' || u.status === 'restricted') && (
        <Alert
          tone="danger"
          title={u.status === 'banned' ? 'Your account is suspended' : 'Your account is restricted'}
          action={
            <Link href="/app/support/new?category=appeal" className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white">
              Appeal
            </Link>
          }
        >
          Reason: {u.statusReason ?? 'see Support'}. A human reviews every appeal within 48 hours.
        </Alert>
      )}
      {!u.emailVerified && u.status !== 'banned' && (
        <Alert
          tone="info"
          title="Confirm your email to unlock cash outs"
          action={
            <button
              disabled={sending}
              onClick={async () => {
                setSending(true);
                try {
                  await api('/auth/resend-verification', { body: {} });
                  toast({ title: 'Verification email sent', description: me.flags.demoMode ? 'Demo: open the Dev mailbox to click the link.' : 'Check your inbox (and spam folder).', tone: 'success', action: me.flags.demoMode ? { label: 'Open mailbox', href: '/dev/mailbox' } : undefined });
                } catch (err) {
                  toast({ title: errorMessage(err), tone: 'danger' });
                } finally {
                  setSending(false);
                }
              }}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              Resend link
            </button>
          }
        >
          We sent a link to {u.email}. You can keep earning in the meantime.
        </Alert>
      )}
      {takenOver && (
        <Alert tone="warning" title="Earning moved to another device" action={<button onClick={() => setTakenOver(false)} className="text-xs font-semibold">Dismiss</button>}>
          You started a rewarded video on another device. You can earn on one device at a time.
        </Alert>
      )}
      {me.flags.demoMode && !dismissedDemo && (
        <Alert
          tone="brand"
          title="You’re exploring the CashAds demo"
          action={
            <button
              onClick={() => {
                sessionStorage.setItem('ca_demo_banner', '1');
                setDismissedDemo(true);
              }}
              className="rounded-md p-1"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          }
        >
          Offers come from the built-in sandbox partner, which fires real signed postbacks. Cash outs use sandbox payment rails, and emails and SMS codes land in the{' '}
          <Link href="/dev/mailbox" className="font-semibold underline">
            dev mailbox
          </Link>
          .
        </Alert>
      )}
    </div>
  );
}

export function AppShell({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me, isLoading } = useMe();
  const { theme, setTheme, dataSaver, setDataSaver } = usePrefs();
  useLiveUpdates(!!me);

  useEffect(() => {
    if (!isLoading && me === null) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    if (me && !me.user.onboardingCompleted && !pathname.startsWith('/app/onboarding') && me.user.role === 'user') router.replace('/app/onboarding');
  }, [me, isLoading, pathname, router]);

  if (isLoading || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    );
  }

  const signOut = async () => {
    await api('/auth/logout', { body: {} }).catch(() => undefined);
    qc.clear();
    router.replace('/login');
  };
  const isDark = theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const tier = TIER_BY_ID[me.user.tier];

  return (
    <div className="min-h-screen lg:pl-64">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface lg:flex">
        <div className="flex h-16 items-center px-5">
          <Link href="/app">
            <Logo />
          </Link>
        </div>
        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
          {NAV.map((g) => (
            <div key={g.group}>
              <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">{g.group}</p>
              {g.items.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                    isActive(pathname, it.href, it.exact) ? 'bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-300' : 'text-muted hover:bg-surface-3 hover:text-fg',
                  )}
                >
                  <it.icon className="h-4.5 w-4.5" />
                  {it.label}
                </Link>
              ))}
            </div>
          ))}
          {me.user.role !== 'user' && (
            <Link href="/admin" className="flex items-center gap-3 rounded-xl border border-dashed border-line-strong px-3 py-2 text-sm font-medium text-muted hover:text-fg">
              <Shield className="h-4.5 w-4.5" /> Admin console
            </Link>
          )}
        </nav>
        <div className="border-t border-line p-4">
          <Link href="/app/rewards" className="block rounded-2xl bg-gradient-to-br from-brand-600 to-emerald-800 p-4 text-white">
            <p className="text-xs text-white/70">Your tier</p>
            <p className="text-lg font-bold">{tier.label}</p>
            <p className="mt-1 text-xs text-white/80">{tier.perks[0]}</p>
          </Link>
        </div>
      </aside>

      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-xl">
        <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
          <Link href="/app" className="lg:hidden">
            <Logo compact />
          </Link>
          <div className="flex-1" />
          <Link href="/app/wallet" className="group flex items-center gap-2.5 rounded-2xl border border-line bg-surface py-1.5 pl-3 pr-1.5 shadow-sm hover:border-brand-300 dark:hover:border-brand-500/40">
            <div className="text-right leading-tight">
              <Money micros={me.wallet.availableMicros} animate className="block text-sm font-bold" />
              {me.wallet.pendingMicros > 0 && <span className="tabular block text-[11px] text-amber-600 dark:text-amber-400">+{formatMoney(me.wallet.pendingMicros)} pending</span>}
            </div>
            <span className="rounded-xl bg-brand-600 px-2.5 py-1.5 text-xs font-bold text-white dark:bg-brand-500 dark:text-brand-950">Cash out</span>
          </Link>
          <button className="hidden rounded-xl p-2.5 text-muted hover:bg-surface-3 hover:text-fg sm:block" aria-label="Toggle theme" onClick={() => setTheme(isDark ? 'light' : 'dark')}>
            {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
          <NotificationBell unread={me.unreadNotifications} />
          <Dropdown
            trigger={
              <button className="rounded-full" aria-label="Account menu">
                <Avatar name={me.user.displayName} />
              </button>
            }
          >
            <div className="border-b border-line px-3 pb-3 pt-2">
              <p className="truncate text-sm font-semibold">{me.user.displayName}</p>
              <p className="truncate text-xs text-muted">{me.user.email}</p>
              <Badge tone="brand" className="mt-2">
                {tier.label}
              </Badge>
            </div>
            <div className="py-1">
              <MenuItem href="/app/settings" icon={<User className="h-4 w-4" />}>
                Profile & settings
              </MenuItem>
              <MenuItem href="/app/settings/security" icon={<Shield className="h-4 w-4" />}>
                Security
              </MenuItem>
              <MenuItem href="/app/referrals" icon={<Gift className="h-4 w-4" />}>
                Invite friends
              </MenuItem>
              <MenuItem onClick={() => setDataSaver(!dataSaver)} icon={<Signal className="h-4 w-4" />}>
                Data saver: {dataSaver ? 'On' : 'Off'}
              </MenuItem>
              <MenuItem onClick={() => setTheme(isDark ? 'light' : 'dark')} icon={isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}>
                {isDark ? 'Light' : 'Dark'} mode
              </MenuItem>
              {me.user.role !== 'user' && (
                <MenuItem href="/admin" icon={<Shield className="h-4 w-4" />}>
                  Admin console
                </MenuItem>
              )}
            </div>
            <div className="border-t border-line pt-1">
              <MenuItem onClick={signOut} icon={<LogOut className="h-4 w-4" />} danger>
                Sign out
              </MenuItem>
            </div>
          </Dropdown>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 pb-28 pt-5 sm:px-6 lg:pb-12">
        {!admin && <Banners />}
        {children}
      </div>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5">
          {MOBILE.map((it) => (
            <Link key={it.href} href={it.href} className={cn('flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium', isActive(pathname, it.href, it.exact) ? 'text-brand-700 dark:text-brand-400' : 'text-muted')}>
              <it.icon className="h-5 w-5" />
              {it.label}
            </Link>
          ))}
        </div>
      </nav>
      <RewardCelebration />
    </div>
  );
}
