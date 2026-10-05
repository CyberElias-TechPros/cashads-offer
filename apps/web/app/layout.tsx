import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/inter';
import '@fontsource-variable/plus-jakarta-sans';
import { BRAND } from '@cashads/shared';
import { Providers } from './providers';
import './globals.css';

/* Fonts are self-hosted (no third-party requests — privacy-friendly and works offline). */

export const metadata: Metadata = {
  title: { default: `${BRAND.name} — ${BRAND.tagline}`, template: `%s · ${BRAND.name}` },
  description: 'Earn real money from surveys, app trials and short sponsor videos. Instant cash outs with no minimum, no points, and we pay you even when tracking fails.',
  applicationName: BRAND.name,
  manifest: '/manifest.webmanifest',
  openGraph: {
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description: 'Real money. Instant cash outs. No minimum. No points.',
    type: 'website',
  },
  appleWebApp: { capable: true, title: BRAND.name, statusBarStyle: 'default' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f7f5' },
    { media: '(prefers-color-scheme: dark)', color: '#060a08' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

/** Applies theme + data-saver before first paint (no flash). */
const bootScript = `(function(){try{var p=JSON.parse(localStorage.getItem('ca_prefs')||'{}').state||{};var t=p.theme||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);var c=document.documentElement.classList;if(d)c.add('dark');if(p.dataSaver)c.add('data-saver');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
      </head>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
