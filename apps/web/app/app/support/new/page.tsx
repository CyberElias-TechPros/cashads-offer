'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { TICKET_CATEGORIES, TICKET_CATEGORY_LABELS, ticketCreateSchema, type TicketCategory } from '@cashads/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody, PageHeader } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { api, errorMessage } from '@/lib/api';
import { qk, useMe } from '@/lib/queries';

function NewTicket() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const initialCategory = (TICKET_CATEGORIES as readonly string[]).includes(params.get('category') ?? '') ? (params.get('category') as TicketCategory) : 'other';
  const [category, setCategory] = useState<TicketCategory>(initialCategory);
  const [subject, setSubject] = useState(initialCategory === 'appeal' ? `Appeal: ${me?.user.statusReason ?? 'account decision'}` : '');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const relatedType = params.get('relatedType') ?? undefined;
  const relatedId = params.get('relatedId') ?? undefined;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={category === 'appeal' ? 'Appeal a decision' : 'Contact support'} description={category === 'appeal' ? 'Tell us your side. A different person from the one who made the decision reviews every appeal within 48 hours.' : 'A real person will reply — usually well within our 24-hour promise.'} />
      <Card>
        <CardBody className="space-y-4 sm:p-6">
          {error && <Alert tone="danger">{error}</Alert>}
          {relatedId && <Alert tone="info">We’ll attach the related {relatedType} automatically so you don’t have to explain it twice.</Alert>}
          <Field label="Topic">
            <Select value={category} onChange={(e) => setCategory(e.target.value as TicketCategory)}>
              {TICKET_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {TICKET_CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Subject" error={errors.subject}>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} />
          </Field>
          <Field label="Message" error={errors.message} hint="Include dates, amounts or references if you have them.">
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={7} maxLength={5000} />
          </Field>
          <Button
            className="w-full"
            loading={loading}
            onClick={async () => {
              const parsed = ticketCreateSchema.safeParse({ subject, category, message, relatedType, relatedId });
              if (!parsed.success) {
                const e: Record<string, string> = {};
                for (const i of parsed.error.issues) e[String(i.path[0])] ??= i.message;
                return setErrors(e);
              }
              setErrors({});
              setLoading(true);
              setError(null);
              try {
                const t = await api<{ id: string }>('/support/tickets', { body: parsed.data });
                await qc.invalidateQueries({ queryKey: qk.tickets });
                router.replace(`/app/support/${t.id}`);
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setLoading(false);
              }
            }}
          >
            Send
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}

export default function NewTicketPage() {
  return (
    <Suspense>
      <NewTicket />
    </Suspense>
  );
}
