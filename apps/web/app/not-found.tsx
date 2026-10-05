import Link from 'next/link';
import { Logo } from '@/components/ui/misc';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <Logo />
      <p className="mt-10 font-display text-7xl font-extrabold text-brand-600">404</p>
      <h1 className="mt-3 text-2xl font-bold">This page doesn’t exist</h1>
      <p className="mt-2 text-muted">But your balance does. Let’s get you back.</p>
      <div className="mt-6 flex gap-3">
        <Link href="/" className="rounded-xl border border-line px-4 py-2 text-sm font-semibold">
          Home
        </Link>
        <Link href="/app" className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
          Dashboard
        </Link>
      </div>
    </div>
  );
}
