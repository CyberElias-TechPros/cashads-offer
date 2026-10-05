import type { MetadataRoute } from 'next';
import { POSTS } from '@/lib/blog';

const BASE = process.env.PUBLIC_WEB_URL ?? 'https://cashads.app';

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ['', '/how-it-works', '/offers', '/transparency', '/faq', '/blog', '/contact', '/terms', '/privacy', '/cookies', '/status', '/signup', '/login'];
  return [...pages.map((p) => ({ url: `${BASE}${p}`, changeFrequency: 'weekly' as const })), ...POSTS.map((p) => ({ url: `${BASE}/blog/${p.slug}`, lastModified: p.date }))];
}
