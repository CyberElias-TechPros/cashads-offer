'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PageHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/app/settings', label: 'Profile' },
  { href: '/app/settings/verification', label: 'Verification' },
  { href: '/app/settings/security', label: 'Security' },
  { href: '/app/settings/notifications', label: 'Notifications' },
  { href: '/app/settings/health', label: 'Account health' },
  { href: '/app/settings/privacy', label: 'Privacy & data' },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div>
      <PageHeader title="Settings" />
      <div className="scrollbar-none -mx-4 mb-6 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className={cn('shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors', pathname === t.href ? 'border-brand-600 text-fg' : 'border-transparent text-muted hover:text-fg')}>
            {t.label}
          </Link>
        ))}
      </div>
      <div className="max-w-3xl">{children}</div>
    </div>
  );
}
