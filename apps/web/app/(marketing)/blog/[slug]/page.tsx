import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { ButtonLink } from '@/components/ui/button';
import { POSTS } from '@/lib/blog';

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = POSTS.find((p) => p.slug === slug);
  return post ? { title: post.title, description: post.excerpt } : {};
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = POSTS.find((p) => p.slug === slug);
  if (!post) notFound();
  return (
    <article className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <Link href="/blog" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> All posts
      </Link>
      <p className="mt-6 text-sm text-muted">
        {new Date(post.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} · {post.readMinutes} min read
      </p>
      <h1 className="mt-2 font-display text-4xl font-extrabold leading-tight tracking-tight">{post.title}</h1>
      <div className="mt-8 space-y-5 text-lg leading-relaxed text-muted">
        {post.body.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
      <div className="mt-12 rounded-2xl border border-line bg-surface p-6 text-center">
        <p className="font-semibold">See it for yourself.</p>
        <ButtonLink href="/signup" className="mt-4">
          Create a free account
        </ButtonLink>
      </div>
    </article>
  );
}
