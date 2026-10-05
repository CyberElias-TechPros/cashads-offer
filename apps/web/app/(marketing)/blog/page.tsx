import type { Metadata } from 'next';
import Link from 'next/link';
import { POSTS } from '@/lib/blog';

export const metadata: Metadata = { title: 'Blog', description: 'How CashAds works under the hood — payouts, tracking, fairness.' };

export default function BlogPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="font-display text-4xl font-extrabold tracking-tight">The CashAds blog</h1>
      <p className="mt-3 text-muted">How we work, in plain language.</p>
      <div className="mt-10 space-y-4">
        {POSTS.map((p) => (
          <Link key={p.slug} href={`/blog/${p.slug}`} className="block rounded-2xl border border-line bg-surface p-6 shadow-soft transition-shadow hover:shadow-lift">
            <p className="text-xs text-muted">
              {new Date(p.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} · {p.readMinutes} min read
            </p>
            <h2 className="mt-2 text-xl font-bold">{p.title}</h2>
            <p className="mt-2 text-muted">{p.excerpt}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
