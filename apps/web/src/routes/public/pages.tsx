import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, CircleCheck, Gift, Search, TriangleAlert, CircleX } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  BLOG_POSTS,
  FAQ,
  FAQ_CATEGORIES,
  type FaqItem,
  type StatusComponentDTO,
  TICKET_CATEGORIES,
  formatUsd,
  getBlogPost,
  getLegalDoc,
} from '@lucrum/shared';
import { Badge, Button, ButtonLink, Callout, Card, Chip, Input, Select, Textarea } from '../../components/ui';
import { errorMessage, get, post } from '../../lib/api';
import { useConfig } from '../../lib/queries';
import { cn, timeAgo } from '../../lib/utils';

function Container({ children, narrow }: { children: React.ReactNode; narrow?: boolean }) {
  return (
    <div className={cn('mx-auto px-4 py-12 sm:px-6 sm:py-16', narrow ? 'max-w-3xl' : 'max-w-6xl')}>
      {children}
    </div>
  );
}

function Hero({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="mb-10">
      <p className="text-sm font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-400">
        {eyebrow}
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-5xl">{title}</h1>
      {subtitle && <p className="mt-3 max-w-2xl text-lg text-slate-600 dark:text-slate-400">{subtitle}</p>}
    </div>
  );
}

export function HowItWorks() {
  const { data: config } = useConfig();
  const flows = [
    {
      title: 'Earning',
      steps: [
        'Pick a task. You see what it pays, how long it really takes (measured from real members), the hourly rate, a quality grade and the data it uses.',
        'We open the advertiser’s page with an anonymous click ID. Complete the steps there.',
        'The advertiser’s network notifies our server directly (a signed “postback”). We verify the signature, prevent duplicates, and credit you — usually within seconds.',
        'Your balance updates live, everywhere you’re signed in.',
      ],
    },
    {
      title: 'When tracking fails',
      steps: [
        'Tap “I finished” — we start checking with the network for you, and file a claim automatically if nothing arrives in 72 hours.',
        'Or tap “Missing credit” after 10 minutes. We search the network’s postback logs and ask the network directly.',
        'Trusted members (Silver tier and up) are paid instantly as goodwill. Everyone else gets a human decision within 24 hours — and if we miss that, small claims auto-approve.',
      ],
    },
    {
      title: 'Cashing out',
      steps: [
        'Choose a method that works in your country — bank, airtime, mobile money, UPI, Pix, PayPal, Lightning or USDT.',
        'See the provider fee and exactly what you’ll receive (in your local currency) before confirming. No Lucrum minimum.',
        'Most cash-outs are automatic and arrive in minutes. If a provider is down we retry automatically — and if it fails, the full amount comes back.',
      ],
    },
  ];
  return (
    <Container narrow>
      <Hero
        eyebrow="How it works"
        title="Simple on the surface. Serious underneath."
        subtitle="The plain-English version of what happens when you earn and cash out."
      />
      <div className="space-y-6">
        {flows.map((f) => (
          <Card key={f.title} className="p-6">
            <h2 className="text-xl font-semibold">{f.title}</h2>
            <ol className="mt-4 space-y-3">
              {f.steps.map((s, i) => (
                <li key={i} className="flex gap-3 text-slate-700 dark:text-slate-300">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-800 dark:bg-brand-900 dark:text-brand-200">
                    {i + 1}
                  </span>
                  <span className="leading-relaxed">{s}</span>
                </li>
              ))}
            </ol>
          </Card>
        ))}
        <Card className="p-6">
          <h2 className="text-xl font-semibold">Where the money comes from</h2>
          <p className="mt-3 leading-relaxed text-slate-700 dark:text-slate-300">
            Brands pay networks to find real customers; networks pay us when you complete a task. We pass{' '}
            <strong>{config?.revenueSharePercent ?? 60}%</strong> of that to you and keep the rest to run
            Lucrum, pay for fraud prevention and fund bonuses and goodwill credits. Rewarded videos pay very
            little — we show you exactly how little, and point you to tasks that pay 50–500× more.
          </p>
        </Card>
      </div>
      <div className="mt-10 flex gap-3">
        <ButtonLink to="/signup" size="lg">
          Start earning <ArrowRight className="size-4" />
        </ButtonLink>
        <ButtonLink to="/transparency" size="lg" variant="outline">
          See the numbers
        </ButtonLink>
      </div>
    </Container>
  );
}

export function FaqList({ items }: { items: FaqItem[] }) {
  return (
    <div className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
      {items.map((f) => (
        <details key={f.id} className="group p-5" id={f.id}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
            {f.q}
            <span className="text-slate-400 transition group-open:rotate-45">+</span>
          </summary>
          <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{f.a}</p>
        </details>
      ))}
      {items.length === 0 && (
        <p className="p-6 text-center text-sm text-slate-500">
          No matching questions. Try different words or contact support.
        </p>
      )}
    </div>
  );
}

export function Faq() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<FaqItem['category'] | 'all'>('all');
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return FAQ.filter(
      (f) =>
        (cat === 'all' || f.category === cat) && (!needle || `${f.q} ${f.a}`.toLowerCase().includes(needle)),
    );
  }, [q, cat]);
  return (
    <Container narrow>
      <Hero
        eyebrow="Help centre"
        title="Frequently asked questions"
        subtitle="Straight answers — including the uncomfortable ones."
      />
      <Input
        placeholder="Search questions…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        prefix={<Search className="size-4" />}
      />
      <div className="my-5 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        <Chip active={cat === 'all'} onClick={() => setCat('all')}>
          All
        </Chip>
        {Object.entries(FAQ_CATEGORIES).map(([id, label]) => (
          <Chip key={id} active={cat === id} onClick={() => setCat(id as FaqItem['category'])}>
            {label}
          </Chip>
        ))}
      </div>
      <FaqList items={items} />
      <p className="mt-6 text-sm text-slate-500">
        Still stuck?{' '}
        <Link to="/contact" className="font-semibold text-brand-700 hover:underline dark:text-brand-400">
          Contact a real person
        </Link>{' '}
        — we reply within 24 hours.
      </p>
    </Container>
  );
}

export function Blog() {
  return (
    <Container>
      <Hero
        eyebrow="Blog & guides"
        title="Notes from the Lucrum team"
        subtitle="How the product works, why we made the choices we did, and practical guides."
      />
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {BLOG_POSTS.map((p) => (
          <Link
            key={p.slug}
            to={`/blog/${p.slug}`}
            className="group rounded-3xl border border-slate-200 bg-white p-6 transition hover:-translate-y-0.5 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900"
          >
            <Badge tone="brand">{p.tag}</Badge>
            <h2 className="mt-3 text-lg font-semibold leading-snug group-hover:text-brand-700 dark:group-hover:text-brand-400">
              {p.title}
            </h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{p.summary}</p>
            <p className="mt-4 text-xs text-slate-400">
              {new Date(p.date).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}{' '}
              · {p.readMinutes} min read
            </p>
          </Link>
        ))}
      </div>
    </Container>
  );
}

export function BlogPostPage() {
  const { slug = '' } = useParams();
  const post = getBlogPost(slug);
  if (!post) return <NotFound />;
  return (
    <Container narrow>
      <Link to="/blog" className="text-sm font-medium text-slate-500 hover:text-slate-900">
        ← All posts
      </Link>
      <Badge tone="brand" className="ml-3">
        {post.tag}
      </Badge>
      <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">{post.title}</h1>
      <p className="mt-3 text-lg text-slate-600 dark:text-slate-400">{post.summary}</p>
      <article className="mt-8 space-y-6">
        {post.body.map((b, i) => (
          <section key={i}>
            {b.heading && <h2 className="mb-2 text-xl font-semibold">{b.heading}</h2>}
            <p className="leading-relaxed text-slate-700 dark:text-slate-300">{b.text}</p>
          </section>
        ))}
      </article>
      <Card className="mt-10 flex flex-wrap items-center justify-between gap-4">
        <p className="font-medium">Ready to try it?</p>
        <ButtonLink to="/signup">Start earning</ButtonLink>
      </Card>
    </Container>
  );
}

export function Legal() {
  const { doc = '' } = useParams();
  const d = getLegalDoc(doc);
  if (!d) return <NotFound />;
  return (
    <Container narrow>
      <Hero eyebrow="Legal" title={d.title} subtitle={`Version ${d.version} · effective ${d.effective}`} />
      <div className="space-y-6">
        {d.sections.map((s) => (
          <section key={s.heading}>
            <h2 className="text-lg font-semibold">{s.heading}</h2>
            <p className="mt-2 leading-relaxed text-slate-700 dark:text-slate-300">{s.body}</p>
          </section>
        ))}
      </div>
      <div className="mt-10 flex flex-wrap gap-2 text-sm">
        {['terms', 'privacy', 'cookies', 'earnings-policy'].map((id) => (
          <Link
            key={id}
            to={`/legal/${id}`}
            className={cn(
              'rounded-full border px-3 py-1',
              id === doc
                ? 'border-slate-900 bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                : 'border-slate-300 dark:border-slate-700',
            )}
          >
            {getLegalDoc(id)?.title}
          </Link>
        ))}
      </div>
    </Container>
  );
}

export function Contact() {
  const [form, setForm] = useState({ email: '', subject: '', category: 'other', message: '' });
  const m = useMutation({
    mutationFn: () => post<{ id: string; slaDueAt: string }>('/public/contact', form),
  });
  return (
    <Container narrow>
      <Hero
        eyebrow="Support"
        title="Talk to a real person"
        subtitle="We reply within 24 hours (Gold members within 4). No bots pretending to be people."
      />
      {m.isSuccess ? (
        <Callout tone="success" title="Message received">
          We’ll reply to {form.email} by {new Date(m.data.slaDueAt).toLocaleString()}.
        </Callout>
      ) : (
        <Card className="space-y-4 p-6">
          {m.isError && <Callout tone="danger">{errorMessage(m.error)}</Callout>}
          <Input
            label="Your email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
          <Select
            label="Topic"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          >
            {TICKET_CATEGORIES.filter((c) => c !== 'appeal').map((c) => (
              <option key={c} value={c}>
                {c.replace('_', ' ')}
              </option>
            ))}
          </Select>
          <Input
            label="Subject"
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
          />
          <Textarea
            label="Message"
            value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
            rows={5}
          />
          <Button loading={m.isPending} onClick={() => m.mutate()}>
            Send message
          </Button>
          <p className="text-xs text-slate-500">
            Have an account? Signing in lets us see your activity and help faster.
          </p>
        </Card>
      )}
    </Container>
  );
}

export function Status() {
  const { data, isLoading } = useQuery({
    queryKey: ['status'],
    queryFn: () => get<{ components: StatusComponentDTO[]; updatedAt: string }>('/public/status'),
    refetchInterval: 30_000,
  });
  const worst = data?.components.some((c) => c.status === 'outage')
    ? 'outage'
    : data?.components.some((c) => c.status === 'degraded')
      ? 'degraded'
      : 'operational';
  return (
    <Container narrow>
      <Hero
        eyebrow="Status"
        title="System status"
        subtitle="Live health of every part of Lucrum, including each payout provider."
      />
      {!isLoading && (
        <Callout
          tone={worst === 'operational' ? 'success' : worst === 'degraded' ? 'warning' : 'danger'}
          title={
            worst === 'operational'
              ? 'All systems operational'
              : worst === 'degraded'
                ? 'Some systems degraded'
                : 'Partial outage'
          }
        >
          Updated {timeAgo(data?.updatedAt)}. Cash-outs affected by a provider outage retry automatically —
          your money is safe.
        </Callout>
      )}
      <div className="mt-6 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {data?.components.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-4 p-4">
            <div>
              <p className="font-medium">{c.name}</p>
              <p className="text-sm text-slate-500">{c.detail}</p>
            </div>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 text-sm font-medium',
                c.status === 'operational'
                  ? 'text-emerald-600'
                  : c.status === 'degraded'
                    ? 'text-amber-600'
                    : 'text-rose-600',
              )}
            >
              {c.status === 'operational' ? (
                <CircleCheck className="size-4" />
              ) : c.status === 'degraded' ? (
                <TriangleAlert className="size-4" />
              ) : (
                <CircleX className="size-4" />
              )}
              {c.status}
            </span>
          </div>
        ))}
      </div>
    </Container>
  );
}

export function ReferralLanding() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const { data: config } = useConfig();
  useEffect(() => {
    try {
      localStorage.setItem('lucrum.ref', code.toUpperCase());
    } catch {
      /* ignore */
    }
  }, [code]);
  return (
    <Container narrow>
      <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center sm:p-12 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
          <Gift className="size-7" />
        </div>
        <h1 className="mt-5 text-3xl font-bold tracking-tight">A friend invited you to Lucrum</h1>
        <p className="mx-auto mt-3 max-w-md text-slate-600 dark:text-slate-400">
          Complete your first task and you’ll <strong>both</strong> get{' '}
          {config ? formatUsd(config.referralBonusMicros) : '$0.50'} — real money, cash out any time.
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Invite code:{' '}
          <span className="font-mono font-semibold text-slate-900 dark:text-white">{code.toUpperCase()}</span>
        </p>
        <Button
          size="lg"
          className="mt-8"
          onClick={() => navigate(`/signup?ref=${encodeURIComponent(code)}`)}
        >
          Accept invite & sign up <ArrowRight className="size-4" />
        </Button>
      </div>
    </Container>
  );
}

export function NotFound() {
  return (
    <Container narrow>
      <div className="py-16 text-center">
        <p className="text-6xl">🧭</p>
        <h1 className="mt-4 text-3xl font-bold">Page not found</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-400">
          The link may be old or mistyped. Your balance is safe either way.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <ButtonLink to="/">Home</ButtonLink>
          <ButtonLink to="/app" variant="outline">
            Open app
          </ButtonLink>
        </div>
      </div>
    </Container>
  );
}
