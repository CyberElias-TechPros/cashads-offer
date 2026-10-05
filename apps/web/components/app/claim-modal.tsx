'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus } from 'lucide-react';
import { formatMoney, type OfferClickDTO } from '@cashads/shared';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Modal } from '@/components/ui/overlay';
import { api, errorMessage, uploadImage } from '@/lib/api';
import { qk } from '@/lib/queries';

function localInputValue(d: Date) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

export function ClaimModal({ open, onClose, clicks, defaultClickId }: { open: boolean; onClose: () => void; clicks: OfferClickDTO[]; defaultClickId?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const claimable = clicks.filter((c) => c.claimable);
  const [clickId, setClickId] = useState(defaultClickId ?? claimable[0]?.id ?? '');
  const [when, setWhen] = useState(localInputValue(new Date()));
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = claimable.find((c) => c.id === clickId);

  useEffect(() => {
    if (open && defaultClickId && claimable.some((c) => c.id === defaultClickId)) setClickId(defaultClickId);
    else if (open && !claimable.some((c) => c.id === clickId) && claimable[0]) setClickId(claimable[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultClickId, claimable.length]);

  // Sensible default: a few minutes ago, but never before the member actually started the offer.
  useEffect(() => {
    if (!open) return;
    const started = selected ? Date.parse(selected.startedAt) : 0;
    setWhen(localInputValue(new Date(Math.min(Date.now(), Math.max(started + 60_000, Date.now() - 5 * 60_000)))));
  }, [open, selected]);

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      const uploadId = file ? (await uploadImage(file, 'claim_evidence')).id : undefined;
      const claim = await api<{ id: string }>('/claims', { body: { clickId, completedAt: new Date(when).toISOString(), note: note || undefined, uploadId } });
      await Promise.all([qc.invalidateQueries({ queryKey: qk.claims }), qc.invalidateQueries({ queryKey: qk.clicks })]);
      onClose();
      router.push(`/app/claims/${claim.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Report missing credit"
      description="We check the partner’s records automatically — usually within seconds. If we can verify it, you get paid."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={loading} disabled={!clickId}>
            Submit claim
          </Button>
        </>
      }
    >
      {claimable.length === 0 ? (
        <Alert tone="info">Nothing to claim right now. Start an offer from CashAds first — completed or already-claimed offers don’t appear here.</Alert>
      ) : (
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Which offer?">
            <Select value={clickId} onChange={(e) => setClickId(e.target.value)}>
              {claimable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.offerIcon} {c.offerTitle} — {formatMoney(c.userPayoutMicros)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="When did you finish?" hint={selected ? `You started it ${new Date(selected.startedAt).toLocaleString()}.` : undefined}>
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} max={localInputValue(new Date())} />
          </Field>
          <Field label="Anything we should know?" optional>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. I saw the thank-you page but nothing arrived." maxLength={1000} />
          </Field>
          <Field label="Screenshot" optional hint="A confirmation screen or email speeds up human review.">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <button type="button" onClick={() => fileRef.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong px-4 py-4 text-sm text-muted hover:border-brand-400 hover:text-fg">
              <ImagePlus className="h-4 w-4" /> {file ? file.name : 'Attach an image (PNG, JPG, WebP · max 5 MB)'}
            </button>
          </Field>
        </div>
      )}
    </Modal>
  );
}
