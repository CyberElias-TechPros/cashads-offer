import crypto from 'node:crypto';
import type { AppContext } from '../../context';
import type { payoutMethods } from '../../db/schema';

type MethodRow = typeof payoutMethods.$inferSelect;

export interface ProviderSendInput {
  payoutId: string;
  netMicros: number;
  localAmount: number | null;
  localCurrency: string | null;
  destination: Record<string, string>;
  method: MethodRow;
}

export type ProviderResult = { status: 'completed' | 'processing'; reference: string };
export type ProviderCheck = 'completed' | 'processing' | 'failed';

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly transient: boolean,
  ) {
    super(message);
  }
}

export interface PayoutProvider {
  id: string;
  send(input: ProviderSendInput): Promise<ProviderResult>;
  check?(reference: string): Promise<ProviderCheck>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sandbox rails: behave like a real provider (latency, transient outages,
 * permanent rejections, async settlement) so every UI state can be exercised.
 *  - any destination value containing "fail" → permanent rejection
 *  - containing "slow" → async: settles ~20s later via status checks
 *  - random transient outage at `sandboxPayoutFailureRate`
 */
export function sandboxProvider(ctx: AppContext): PayoutProvider {
  return {
    id: 'sandbox',
    async send(input) {
      if (ctx.config.NODE_ENV !== 'test') await sleep(300 + Math.random() * 900);
      const values = Object.values(input.destination).join(' ').toLowerCase();
      if (values.includes('fail')) throw new ProviderError('The recipient account can’t receive payments — please check the details.', false);
      if (Math.random() < ctx.settings.get().sandboxPayoutFailureRate) {
        throw new ProviderError(`${input.method.name} is temporarily unavailable`, true);
      }
      const ref = `SBX-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
      if (values.includes('slow')) return { status: 'processing', reference: `${ref}-${Date.now()}` };
      return { status: 'completed', reference: ref };
    },
    async check(reference) {
      const ts = Number(reference.split('-').pop());
      if (Number.isFinite(ts) && Date.now() - ts > 20_000) return 'completed';
      return 'processing';
    },
  };
}

/** PayPal Payouts API (https://developer.paypal.com/docs/api/payments.payouts-batch/v1/). Verify in sandbox before going live. */
export function paypalProvider(ctx: AppContext): PayoutProvider {
  const base = ctx.config.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  let cached: { token: string; exp: number } | null = null;
  async function token(): Promise<string> {
    if (cached && cached.exp > Date.now() + 60_000) return cached.token;
    const res = await fetch(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${ctx.config.PAYPAL_CLIENT_ID}:${ctx.config.PAYPAL_CLIENT_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new ProviderError(`PayPal auth failed (${res.status})`, res.status >= 500);
    const data = (await res.json()) as { access_token: string; expires_in: number };
    cached = { token: data.access_token, exp: Date.now() + data.expires_in * 1000 };
    return cached.token;
  }
  return {
    id: 'paypal',
    async send(input) {
      const res = await fetch(`${base}/v1/payments/payouts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': input.payoutId },
        body: JSON.stringify({
          sender_batch_header: { sender_batch_id: input.payoutId, email_subject: 'You have a payment from CashAds' },
          items: [
            {
              recipient_type: 'EMAIL',
              amount: { value: (Math.floor(input.netMicros / 10_000) / 100).toFixed(2), currency: 'USD' },
              receiver: input.destination.email,
              note: 'CashAds cash out — thanks for your time!',
              sender_item_id: input.payoutId,
            },
          ],
        }),
      });
      if (res.status >= 500 || res.status === 429) throw new ProviderError(`PayPal unavailable (${res.status})`, true);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new ProviderError(body.message ?? `PayPal rejected the payout (${res.status})`, false);
      }
      const data = (await res.json()) as { batch_header: { payout_batch_id: string } };
      return { status: 'processing', reference: data.batch_header.payout_batch_id };
    },
    async check(reference) {
      const res = await fetch(`${base}/v1/payments/payouts/${reference}`, { headers: { Authorization: `Bearer ${await token()}` } });
      if (!res.ok) return 'processing';
      const data = (await res.json()) as { items?: Array<{ transaction_status?: string }> };
      const s = data.items?.[0]?.transaction_status ?? 'PENDING';
      if (s === 'SUCCESS') return 'completed';
      if (['FAILED', 'RETURNED', 'BLOCKED', 'REFUNDED', 'REVERSED'].includes(s)) return 'failed';
      return 'processing';
    },
  };
}

/** Paystack Transfers (NGN bank accounts). Verify in test mode before going live. */
export function paystackProvider(ctx: AppContext): PayoutProvider {
  const headers = { Authorization: `Bearer ${ctx.config.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' };
  return {
    id: 'paystack',
    async send(input) {
      const r1 = await fetch('https://api.paystack.co/transferrecipient', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'nuban',
          name: input.destination.accountName,
          account_number: input.destination.accountNumber,
          bank_code: input.destination.bankCode,
          currency: 'NGN',
        }),
      });
      if (r1.status >= 500) throw new ProviderError('Paystack unavailable', true);
      const rec = (await r1.json()) as { status: boolean; message?: string; data?: { recipient_code: string } };
      if (!rec.status || !rec.data) throw new ProviderError(rec.message ?? 'Paystack rejected the bank account', false);
      const r2 = await fetch('https://api.paystack.co/transfer', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          source: 'balance',
          amount: Math.round((input.localAmount ?? 0) * 100),
          recipient: rec.data.recipient_code,
          reason: 'CashAds cash out',
          reference: input.payoutId,
        }),
      });
      if (r2.status >= 500) throw new ProviderError('Paystack unavailable', true);
      const tr = (await r2.json()) as { status: boolean; message?: string; data?: { status: string; reference: string } };
      if (!tr.status || !tr.data) throw new ProviderError(tr.message ?? 'Paystack transfer failed', false);
      return { status: tr.data.status === 'success' ? 'completed' : 'processing', reference: tr.data.reference };
    },
    async check(reference) {
      const res = await fetch(`https://api.paystack.co/transfer/verify/${encodeURIComponent(reference)}`, { headers });
      if (!res.ok) return 'processing';
      const data = (await res.json()) as { data?: { status: string } };
      if (data.data?.status === 'success') return 'completed';
      if (data.data?.status === 'failed' || data.data?.status === 'reversed') return 'failed';
      return 'processing';
    },
  };
}

export function providerFor(ctx: AppContext, method: MethodRow): PayoutProvider {
  if (method.provider === 'paypal' && ctx.config.PAYPAL_CLIENT_ID && ctx.config.PAYPAL_CLIENT_SECRET) return paypalProvider(ctx);
  if (method.provider === 'paystack' && ctx.config.PAYSTACK_SECRET_KEY) return paystackProvider(ctx);
  return sandboxProvider(ctx);
}
