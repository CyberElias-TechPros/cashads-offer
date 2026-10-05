'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  BarChart3,
  BookOpen,
  Cable,
  CircleDollarSign,
  Gauge,
  IdCard,
  LayoutGrid,
  LifeBuoy,
  LogOut,
  Menu,
  ScrollText,
  Search,
  Settings,
  ShieldAlert,
  Users,
  Webhook,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, Spinner } from '@/components/ui/feedback';
import { Field, Textarea } from '@/components/ui/form';
import { Logo } from '@/components/ui/misc';
import { Modal } from '@/components/ui/overlay';
import { api } from '@/lib/api';
import { useAdmin, useMe } from '@/lib/queries';
import { cn } from '@/lib/utils';

interface Overview {
  queues: { payoutsReview: number; claimsOpen: number; claimsBreached: number; fraudOpen: number; ticketsOpen: number; ticketsBreached: number; kycPending: number; jobsDead: number; offersFlagged: number };
}

const NAV = [
  { href: '/admin', label: 'Overview', icon: Gauge, exact: true },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/payouts', label: 'Payout queue', icon: CircleDollarSign, badge: 'payoutsReview' },
  { href: '/admin/fraud', label: 'Fraud review', icon: ShieldAlert, badge: 'fraudOpen' },
  { href: '/admin/claims', label: 'Missing credit', icon: Search, badge: 'claimsOpen' },
  { href: '/admin/kyc', label: 'KYC', icon: IdCard, badge: 'kycPending' },
  { href: '/admin/tickets', label: 'Support tickets', icon: LifeBuoy, badge: 'ticketsOpen' },
  { href: '/admin/offers', label: 'Offers', icon: LayoutGrid, badge: 'offersFlagged' },
  { href: '/admin/networks', label: 'Networks', icon: Cable },
  { href: '/admin/postbacks', label: 'Postback logs', icon: Webhook },
  { href: '/admin/ledger', label: 'Ledger', icon: BookOpen },
  { href: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
  { href: '/admin/audit', label: 'Audit log', icon: ScrollText },
  { href: '/admin/jobs', label: 'Jobs & outbox', icon: Activity },
] as const;

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me, isLoading } = useMe();
  const [open, setOpen] = useState(false);
  const staff = me && me.user.role !== 'user';
  const { data: ov } = useAdmin<Overview>(['overview'], '/overview', { refetchInterval: 20_000, enabled: !!staff });
  useEffect(() => {
    if (!isLoading && me === null) router.replace('/login?next=/admin');
  }, [me, isLoading, router]);
  useEffect(() => setOpen(false), [pathname]);

  if (isLoading || !me) return <div className="flex min-h-screen items-center justify-center"><Spinner className="h-8 w-8" /></div>;
  if (!staff) return <div className="mx-auto max-w-md p-10"><Alert tone="danger" title="Staff only">This area is for the CashAds team. <Link href="/app" className="underline">Back to your dashboard</Link></Alert></div>;

  const nav = (
    <nav className="space-y-0.5 px-3 py-4">
      {NAV.map((n) => {
        const active = 'exact' in n && n.exact ? pathname === n.href : pathname.startsWith(n.href);
        const count = 'badge' in n && ov ? ov.queues[n.badge as keyof Overview['queues']] : 0;
        return (
          <Link key={n.href} href={n.href} className={cn('flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium', active ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white')}>
            <n.icon className="h-4.5 w-4.5" />
            <span className="flex-1">{n.label}</span>
            {count > 0 && <span className="tabular rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-slate-900">{count}</span>}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className={cn('fixed inset-y-0 left-0 z-40 w-64 flex-col bg-slate-950 transition-transform lg:flex lg:translate-x-0', open ? 'flex translate-x-0' : 'hidden -translate-x-full lg:flex')}>
        <div className="flex h-16 items-center justify-between px-5">
          <Link href="/admin" className="flex items-center gap-2">
            <Logo compact />
            <span className="font-bold text-white">Admin</span>
          </Link>
          <button className="text-slate-400 lg:hidden" onClick={() => setOpen(false)} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <div className="border-t border-white/10 p-4 text-xs text-slate-400">
          <p className="truncate text-sm font-medium text-white">{me.user.displayName}</p>
          <p className="capitalize">{me.user.role}</p>
          <div className="mt-3 flex gap-2">
            <Link href="/app" className="rounded-lg bg-white/10 px-2.5 py-1.5 text-white hover:bg-white/15">
              Member view
            </Link>
            <button
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 hover:bg-white/10 hover:text-white"
              onClick={async () => {
                await api('/auth/logout', { body: {} }).catch(() => undefined);
                qc.clear();
                router.replace('/login');
              }}
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
        </div>
      </aside>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur lg:hidden">
        <button onClick={() => setOpen(true)} aria-label="Menu">
          <Menu className="h-5 w-5" />
        </button>
        <span className="font-semibold">CashAds Admin</span>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
    </div>
  );
}

/** Ask staff for a member-visible reason before a consequential action. */
export function ReasonDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  danger,
  onConfirm,
  defaultReason = '',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: (reason: string) => Promise<void>;
  defaultReason?: string;
  children?: ReactNode;
}) {
  const [reason, setReason] = useState(defaultReason);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setReason(defaultReason);
      setError(null);
    }
  }, [open, defaultReason]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={loading}
            disabled={reason.trim().length < 5}
            onClick={async () => {
              setLoading(true);
              setError(null);
              try {
                await onConfirm(reason.trim());
                onClose();
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed');
              } finally {
                setLoading(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {children}
        <Field label="Reason" hint="The member sees this. Be specific and kind.">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} />
        </Field>
      </div>
    </Modal>
  );
}

export function AdminHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}

