'use client';

import { useState } from 'react';
import { CheckCircle2, Clock, Mail, MessageCircle } from 'lucide-react';
import { BRAND, contactSchema } from '@cashads/shared';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field, Input, Textarea } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api';

export default function ContactPage() {
  const [form, setForm] = useState({ name: '', email: '', message: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  return (
    <div className="mx-auto grid grid-cols-1 max-w-5xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.2fr]">
      <div>
        <h1 className="font-display text-4xl font-extrabold tracking-tight">Talk to a human</h1>
        <p className="mt-3 text-muted">Members get the fastest help from in-app Support. Everyone else (partners, press, curious people) can use this form.</p>
        <ul className="mt-8 space-y-4 text-sm">
          <li className="flex gap-3">
            <Clock className="h-5 w-5 text-brand-600" /> Replies within 24 hours, every day
          </li>
          <li className="flex gap-3">
            <Mail className="h-5 w-5 text-brand-600" /> {BRAND.supportEmail}
          </li>
          <li className="flex gap-3">
            <MessageCircle className="h-5 w-5 text-brand-600" /> Advertisers: ask about direct campaigns and rewarded video
          </li>
        </ul>
      </div>
      <div className="rounded-3xl border border-line bg-surface p-6 shadow-soft sm:p-8">
        {sent ? (
          <div className="py-10 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-brand-600" />
            <p className="mt-4 text-lg font-semibold">Thanks — we’ll reply within 24 hours.</p>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const parsed = contactSchema.safeParse(form);
              if (!parsed.success) {
                const er: Record<string, string> = {};
                for (const i of parsed.error.issues) er[String(i.path[0])] ??= i.message;
                return setErrors(er);
              }
              setErrors({});
              setLoading(true);
              setError(null);
              try {
                await api('/public/contact', { body: parsed.data });
                setSent(true);
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setLoading(false);
              }
            }}
          >
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label="Name" error={errors.name}>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Email" error={errors.email}>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Message" error={errors.message}>
              <Textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} rows={6} />
            </Field>
            <Button type="submit" className="w-full" loading={loading}>
              Send message
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
