'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { useState } from 'react';
import { BRAND } from '@cashads/shared';
import { ButtonLink } from '@/components/ui/button';
import { Logo } from '@/components/ui/misc';
import { useMe } from '@/lib/queries';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/offers', label: 'Offers' },
  { href: '/transparency', label: 'Transparency' },
  { href: '/faq', label: 'FAQ' },
  { href: '/blog', label: 'Blog' },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label={`${BRAND.name} home`}>
          <Logo />
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cn('rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:text-fg', pathname.startsWith(n.href) && 'text-fg')}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          {me ? (
            <ButtonLink href="/app" size="sm">
              Open dashboard
            </ButtonLink>
          ) : (
            <>
              <ButtonLink href="/login" variant="ghost" size="sm">
                Log in
              </ButtonLink>
              <ButtonLink href="/signup" size="sm">
                Start earning
              </ButtonLink>
            </>
          )}
        </div>
        <button className="rounded-lg p-2 md:hidden" onClick={() => setOpen((v) => !v)} aria-label="Menu">
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <div className="border-t border-line bg-surface px-4 py-3 md:hidden">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2.5 text-sm font-medium">
              {n.label}
            </Link>
          ))}
          <div className="mt-2 grid grid-cols-2 gap-2">
            {me ? (
              <ButtonLink href="/app" className="col-span-2">
                Open dashboard
              </ButtonLink>
            ) : (
              <>
                <ButtonLink href="/login" variant="secondary">
                  Log in
                </ButtonLink>
                <ButtonLink href="/signup">Start earning</ButtonLink>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

export function SiteFooter() {
  const cols: Array<[string, Array<[string, string]>]> = [
    ['Product', [['How it works', '/how-it-works'], ['Offers', '/offers'], ['Transparency', '/transparency'], ['System status', '/status']]],
    ['Help', [['FAQ', '/faq'], ['Contact us', '/contact'], ['Missing credit', '/faq#missing-credit'], ['Blog', '/blog']]],
    ['Legal', [['Terms of Service', '/terms'], ['Privacy Policy', '/privacy'], ['Cookie Policy', '/cookies']]],
  ];
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto grid grid-cols-1 max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm text-muted">{BRAND.promise}</p>
          <p className="mt-4 text-xs text-subtle">18+ only. Earnings depend on your country and the offers available. CashAds never sells your personal data.</p>
        </div>
        {cols.map(([title, links]) => (
          <div key={title}>
            <p className="text-sm font-semibold">{title}</p>
            <ul className="mt-3 space-y-2">
              {links.map(([label, href]) => (
                <li key={href}>
                  <Link href={href} className="text-sm text-muted hover:text-fg">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-xs text-subtle sm:flex-row sm:px-6">
          <p>© {new Date().getFullYear()} CashAds. All amounts shown are real money (USD unless stated).</p>
          <p>Built trust-first: instant payouts · no minimum · missing-credit guarantee</p>
        </div>
      </div>
    </footer>
  );
}

export function Section({ eyebrow, title, description, children, className, center }: { eyebrow?: string; title: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode; className?: string; center?: boolean }) {
  return (
    <section className={cn('mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24', className)}>
      <div className={cn('max-w-2xl', center && 'mx-auto text-center')}>
        {eyebrow && <p className="text-sm font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">{eyebrow}</p>}
        <h2 className="mt-2 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h2>
        {description && <p className="mt-4 text-lg text-muted">{description}</p>}
      </div>
      {children && <div className="mt-12">{children}</div>}
    </section>
  );
}
