import Link from 'next/link';
import { Check } from 'lucide-react';
import { Logo } from '@/components/ui/misc';
import { TrustStats } from '@/components/marketing/live';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 min-h-screen lg:grid-cols-[1fr_1.05fr]">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 via-emerald-800 to-emerald-950 p-10 text-white lg:flex lg:flex-col">
        <div className="decorative absolute -right-24 top-10 h-80 w-80 rounded-full bg-emerald-300/20 blur-3xl" />
        <div className="decorative absolute -bottom-24 -left-10 h-80 w-80 rounded-full bg-sky-300/10 blur-3xl" />
        <Link href="/" className="relative">
          <Logo className="text-white [&_span_span]:text-emerald-200" />
        </Link>
        <div className="relative my-auto max-w-md">
          <h2 className="font-display text-4xl font-extrabold leading-tight tracking-tight">Your time, paid in real money.</h2>
          <ul className="mt-8 space-y-4 text-white/85">
            {['Cash out from $0.01 — no minimum, ever', 'Most cash outs land in minutes', 'Missing credit? We check and pay — automatically', 'Clear reasons and a human appeal for every decision'].map((t) => (
              <li key={t} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15">
                  <Check className="h-3.5 w-3.5" />
                </span>
                {t}
              </li>
            ))}
          </ul>
          <TrustStats className="mt-10 [&>div]:border-white/10 [&>div]:bg-white/10 [&_p]:text-white [&_div_div]:text-white/70" />
        </div>
        <p className="relative text-xs text-white/50">Numbers above are live from our ledger.</p>
      </aside>
      <main className="flex flex-col">
        <div className="flex items-center justify-between p-5 lg:hidden">
          <Link href="/">
            <Logo />
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-10">
          <div className="w-full max-w-[420px] animate-slide-up">{children}</div>
        </div>
      </main>
    </div>
  );
}
