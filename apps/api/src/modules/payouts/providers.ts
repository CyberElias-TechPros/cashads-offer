import { createHmac } from 'node:crypto';
import { NG_BANKS, getPayoutMethod } from '@lucrum/shared';
import type { AppContext } from '../../context';
import { sha256, safeEqual } from '../../lib/crypto';

/**
 * Payout providers. Every provider call carries our payout id as an idempotency
 * reference so a retried call can never pay twice (Paystack, PayPal Payouts,
 * Flutterwave and most rails dedupe on it).
 */

export interface ProviderSendInput {
  payoutId: string;
  reference: string;
  methodId: string;
  netMicros: number;
  localCurrency: string;
  localAmount: number;
  details: Record<string, string>;
  recipientName?: string | null;
}

export type ProviderResult =
  | { status: 'completed'; reference: string }
  | { status: 'processing'; reference: string; pollAfterMs: number }
  | { status: 'failed'; retryable: boolean; error: string };

export interface PayoutProvider {
  id: string;
  send(ctx: AppContext, input: ProviderSendInput): Promise<ProviderResult>;
  poll?(ctx: AppContext, reference: string, input: ProviderSendInput): Promise<ProviderResult>;
  nameEnquiry?(ctx: AppContext, methodId: string, details: Record<string, string>): Promise<string | null>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ── sandbox: realistic latency, outages and failure modes, no money moves ─── */

const SANDBOX_NAMES = [
  'ADAEZE OKAFOR',
  'TUNDE BAKARE',
  'CHIOMA NWOSU',
  'IBRAHIM MUSA',
  'FUNMI ADEYEMI',
  'EMEKA EZE',
  'HALIMA BELLO',
  'SEGUN OLADIPO',
];
const sandboxLedger = new Map<string, ProviderResult>();
const SLOW_RAILS = new Set(['us_ach', 'wise']);
/** Destinations that deterministically fail permanently — handy for demos and tests. */
export const SANDBOX_FAIL_DESTINATIONS = new Set([
  '0000000000',
  'fail@example.com',
  '0x0000000000000000000000000000000000000000',
]);

export const sandboxProvider: PayoutProvider = {
  id: 'sandbox',
  async send(ctx, input) {
    const previous = sandboxLedger.get(input.reference);
    if (previous) return previous; // idempotent by reference, like real rails
    if (ctx.settings.get().sandboxProviderOutages[input.methodId]) {
      const name = getPayoutMethod(input.methodId)?.provider ?? 'Provider';
      return {
        status: 'failed',
        retryable: true,
        error: `${name} is temporarily unavailable (simulated outage)`,
      };
    }
    if (Object.values(input.details).some((v) => SANDBOX_FAIL_DESTINATIONS.has(v))) {
      return {
        status: 'failed',
        retryable: false,
        error: 'The destination account could not be found. Check the details and try again.',
      };
    }
    if (!ctx.config.isTest) await sleep(400 + Math.floor(Math.random() * 900));
    const reference = `SBX-${input.methodId.toUpperCase()}-${sha256(input.reference).slice(0, 10).toUpperCase()}`;
    const result: ProviderResult = SLOW_RAILS.has(input.methodId)
      ? { status: 'processing', reference, pollAfterMs: ctx.config.isTest ? 0 : 45_000 }
      : { status: 'completed', reference };
    sandboxLedger.set(input.reference, result);
    return result;
  },
  async poll(_ctx, reference) {
    return { status: 'completed', reference };
  },
  async nameEnquiry(_ctx, methodId, details) {
    if (methodId !== 'ng_bank') return null;
    const acct = details.accountNumber ?? '';
    if (!/^\d{10}$/.test(acct) || SANDBOX_FAIL_DESTINATIONS.has(acct)) return null;
    const idx = parseInt(sha256(acct).slice(0, 6), 16) % SANDBOX_NAMES.length;
    return SANDBOX_NAMES[idx]!;
  },
};

/* ── Paystack (live NG bank transfers) ─────────────────────────────────────── */

const PAYSTACK = 'https://api.paystack.co';

export function createPaystackProvider(secretKey: string, fetchImpl: typeof fetch = fetch): PayoutProvider {
  const call = async <T>(
    path: string,
    init: RequestInit = {},
  ): Promise<{ ok: boolean; status: number; json: T }> => {
    const res = await fetchImpl(`${PAYSTACK}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const json = (await res.json().catch(() => ({}))) as T;
    return { ok: res.ok, status: res.status, json };
  };
  const mapTransfer = (status: string | undefined, reference: string): ProviderResult => {
    if (status === 'success') return { status: 'completed', reference };
    if (status === 'failed' || status === 'reversed')
      return { status: 'failed', retryable: false, error: `Paystack transfer ${status}` };
    return { status: 'processing', reference, pollAfterMs: 30_000 };
  };
  return {
    id: 'paystack',
    async nameEnquiry(_ctx, methodId, details) {
      if (methodId !== 'ng_bank') return null;
      const r = await call<{ status: boolean; data?: { account_name: string } }>(
        `/bank/resolve?account_number=${encodeURIComponent(details.accountNumber ?? '')}&bank_code=${encodeURIComponent(details.bankCode ?? '')}`,
      );
      return r.ok && r.json.status ? (r.json.data?.account_name ?? null) : null;
    },
    async send(_ctx, input) {
      if (input.methodId !== 'ng_bank')
        return { status: 'failed', retryable: false, error: 'Paystack only handles NG bank transfers' };
      const recipient = await call<{ status: boolean; message?: string; data?: { recipient_code: string } }>(
        '/transferrecipient',
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'nuban',
            name: input.recipientName ?? 'Lucrum member',
            account_number: input.details.accountNumber,
            bank_code: input.details.bankCode,
            currency: 'NGN',
          }),
        },
      );
      if (!recipient.ok || !recipient.json.data) {
        return {
          status: 'failed',
          retryable: recipient.status >= 500,
          error: recipient.json.message ?? 'Could not create transfer recipient',
        };
      }
      const transfer = await call<{
        status: boolean;
        message?: string;
        data?: { status: string; reference: string };
      }>('/transfer', {
        method: 'POST',
        body: JSON.stringify({
          source: 'balance',
          amount: Math.round(input.localAmount * 100), // kobo
          recipient: recipient.json.data.recipient_code,
          reference: input.reference,
          reason: 'Lucrum cash-out',
        }),
      });
      if (!transfer.ok || !transfer.json.data) {
        return {
          status: 'failed',
          retryable: transfer.status >= 500 || transfer.status === 429,
          error: transfer.json.message ?? 'Transfer failed',
        };
      }
      return mapTransfer(transfer.json.data.status, input.reference);
    },
    async poll(_ctx, reference) {
      const r = await call<{ status: boolean; data?: { status: string } }>(
        `/transfer/verify/${encodeURIComponent(reference)}`,
      );
      if (!r.ok) return { status: 'processing', reference, pollAfterMs: 60_000 };
      return mapTransfer(r.json.data?.status, reference);
    },
  };
}

/** Paystack signs webhooks with HMAC-SHA512 of the raw body using the secret key. */
export function verifyPaystackSignature(
  secretKey: string,
  rawBody: string,
  signature: string | undefined,
): boolean {
  if (!signature) return false;
  return safeEqual(createHmac('sha512', secretKey).update(rawBody).digest('hex'), signature);
}

export function providerFor(ctx: AppContext, methodId: string): PayoutProvider {
  if (methodId === 'ng_bank' && ctx.config.PAYSTACK_SECRET_KEY && !ctx.config.SANDBOX_MODE) {
    return createPaystackProvider(ctx.config.PAYSTACK_SECRET_KEY);
  }
  return sandboxProvider;
}

export function bankName(code: string | undefined): string {
  return NG_BANKS.find((b) => b.value === code)?.label ?? 'Bank';
}
