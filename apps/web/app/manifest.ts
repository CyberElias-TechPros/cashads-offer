import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'CashAds — real cash for your spare minutes',
    short_name: 'CashAds',
    description: 'Earn real money from surveys, app trials and sponsor videos. Instant cash outs, no minimum.',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    background_color: '#f4f7f5',
    theme_color: '#059669',
    orientation: 'portrait',
    categories: ['finance', 'lifestyle'],
    icons: [
      { src: '/icon', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
    shortcuts: [
      { name: 'Offers', url: '/app/earn' },
      { name: 'Watch & earn', url: '/app/watch' },
      { name: 'Cash out', url: '/app/cashout' },
    ],
  };
}
