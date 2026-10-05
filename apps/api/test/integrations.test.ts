import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { md5 } from '../src/lib/crypto';
import {
  type PostbackRequest,
  decimalToMicros,
  getAdapter,
  microsToDecimal,
  sandboxSign,
  ssvSign,
} from '../src/modules/networks/adapters';
import { createPaystackProvider, verifyPaystackSignature } from '../src/modules/payouts/providers';
import { base32Decode, base32Encode, totpAt, verifyTotp } from '../src/lib/totp';

const req = (fullUrl: string): PostbackRequest => {
  const u = new URL(fullUrl);
  return {
    method: 'GET',
    url: u.pathname + u.search,
    fullUrl,
    query: Object.fromEntries(u.searchParams),
    body: null,
    headers: {},
    ip: '1.2.3.4',
  };
};

describe('network adapters', () => {
  it('BitLabs: verifies the official documentation test vector (HMAC-SHA1 over the full URL)', () => {
    const adapter = getAdapter('bitlabs')!;
    const secret = 'JLOIAUNMHFli7ZJOQVEzm98rzqnm9';
    const url =
      'https://publisher.com/complete?uid=8cc877ee-af19-488d-b28d-216fb866b996&val=500&hash=dbcd6bb8ca677344592842a52b4fca9bec36cd4b';
    expect(adapter.verify(req(url), secret)).toBe(true);
    expect(adapter.verify(req(url.replace('val=500', 'val=5000')), secret)).toBe(false);
    expect(adapter.verify(req(url), 'wrong-secret')).toBe(false);
  });

  it('BitLabs: parses completes, screen-outs and reconciliations', () => {
    const adapter = getAdapter('bitlabs')!;
    const base =
      'https://x.test/api/postback/bitlabs?uid=8cc877ee-af19-488d-b28d-216fb866b996&tx=TX1&raw=1.25';
    expect(adapter.parse(req(`${base}&type=COMPLETE`))).toMatchObject({
      status: 'credit',
      payoutMicros: 1_250_000,
      networkTxnId: 'TX1',
    });
    expect(adapter.parse(req(`${base}&type=SCREENOUT`)).status).toBe('screenout');
    expect(adapter.parse(req(`${base}&type=RECONCILIATION`)).status).toBe('reversal');
  });

  it('md5 wall family: md5(subId + transId + reward + secret), status 2 = chargeback', () => {
    const adapter = getAdapter('md5wall')!;
    const subId = '8cc877ee-af19-488d-b28d-216fb866b996';
    const sig = md5(`${subId}T-77120s3cret`);
    const url = `https://x.test/p?subId=${subId}&transId=T-77&reward=120&payout=0.95&status=1&signature=${sig}`;
    expect(adapter.verify(req(url), 's3cret')).toBe(true);
    expect(adapter.verify(req(url.replace('reward=120', 'reward=999')), 's3cret')).toBe(false);
    expect(adapter.parse(req(url.replace('status=1', 'status=2'))).status).toBe('reversal');
  });

  it('sandboxnet: sorted-parameter HMAC-SHA256, order independent', () => {
    const adapter = getAdapter('sandboxnet')!;
    const params = {
      txn_id: 'A1',
      click_id: '8cc877ee-af19-488d-b28d-216fb866b996',
      payout: '2.500000',
      status: '1',
      ts: '1700000000',
    };
    const sig = sandboxSign(params, 'k');
    expect(sig).toBe(
      sandboxSign(
        { ts: '1700000000', status: '1', payout: '2.500000', click_id: params.click_id, txn_id: 'A1' },
        'k',
      ),
    );
    expect(adapter.verify(req(`https://x.test/p?${new URLSearchParams({ ...params, sig })}`), 'k')).toBe(
      true,
    );
  });

  it('SSV: sign = sha256(appSecurityKey:transId), responds {"isValid": …}', () => {
    const adapter = getAdapter('pangle_ssv')!;
    const url = `https://x.test/api/ssv/x?user_id=8cc877ee-af19-488d-b28d-216fb866b996&trans_id=abc&sign=${ssvSign('key', 'abc')}`;
    expect(adapter.verify(req(url), 'key')).toBe(true);
    expect(adapter.respond('ok').body).toEqual({ isValid: true });
    expect(adapter.respond('invalid').body).toEqual({ isValid: false });
  });

  it('parses decimal amounts exactly', () => {
    expect(decimalToMicros('0.1')).toBe(100_000);
    expect(decimalToMicros('12.345678')).toBe(12_345_678);
    expect(decimalToMicros('-1.5')).toBe(-1_500_000);
    expect(microsToDecimal(333_333)).toBe('0.333333');
    expect(() => decimalToMicros('1e3')).toThrow();
  });
});

describe('Paystack adapter (live NG bank payouts)', () => {
  const ctx = {} as never;
  const mockFetch = (responses: Record<string, { status?: number; body: unknown }>) =>
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const path = String(url).replace('https://api.paystack.co', '').split('?')[0]!;
      const r = responses[path] ?? { status: 404, body: {} };
      return new Response(JSON.stringify(r.body), {
        status: r.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    });

  it('resolves the account holder name before sending', async () => {
    const f = mockFetch({
      '/bank/resolve': { body: { status: true, data: { account_name: 'ADAEZE OKAFOR' } } },
    });
    const p = createPaystackProvider('sk_test_x', f as unknown as typeof fetch);
    expect(await p.nameEnquiry!(ctx, 'ng_bank', { bankCode: '058', accountNumber: '0123456789' })).toBe(
      'ADAEZE OKAFOR',
    );
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toContain('account_number=0123456789&bank_code=058');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer sk_test_x');
  });

  it('creates a recipient then an idempotent transfer in kobo', async () => {
    const f = mockFetch({
      '/transferrecipient': { body: { status: true, data: { recipient_code: 'RCP_1' } } },
      '/transfer': { body: { status: true, data: { status: 'success', reference: 'cashads_p1' } } },
    });
    const p = createPaystackProvider('sk', f as unknown as typeof fetch);
    const res = await p.send(ctx, {
      payoutId: 'p1',
      reference: 'cashads_p1',
      methodId: 'ng_bank',
      netMicros: 2_000_000,
      localCurrency: 'NGN',
      localAmount: 3060,
      details: { bankCode: '058', accountNumber: '0123456789' },
    });
    expect(res).toEqual({ status: 'completed', reference: 'cashads_p1' });
    const transfer = JSON.parse(String(f.mock.calls[1]![1]!.body));
    expect(transfer).toMatchObject({
      amount: 306_000,
      recipient: 'RCP_1',
      reference: 'cashads_p1',
      source: 'balance',
    });
  });

  it('maps pending, failures and outages correctly', async () => {
    const pending = createPaystackProvider(
      'sk',
      mockFetch({
        '/transferrecipient': { body: { status: true, data: { recipient_code: 'R' } } },
        '/transfer': { body: { status: true, data: { status: 'pending', reference: 'r' } } },
      }) as unknown as typeof fetch,
    );
    expect(
      (
        await pending.send(ctx, {
          payoutId: 'p',
          reference: 'r',
          methodId: 'ng_bank',
          netMicros: 1,
          localCurrency: 'NGN',
          localAmount: 1,
          details: {},
        })
      ).status,
    ).toBe('processing');
    const outage = createPaystackProvider(
      'sk',
      mockFetch({
        '/transferrecipient': { status: 503, body: { status: false, message: 'Service unavailable' } },
      }) as unknown as typeof fetch,
    );
    expect(
      await outage.send(ctx, {
        payoutId: 'p',
        reference: 'r',
        methodId: 'ng_bank',
        netMicros: 1,
        localCurrency: 'NGN',
        localAmount: 1,
        details: {},
      }),
    ).toMatchObject({ status: 'failed', retryable: true });
    const rejected = createPaystackProvider(
      'sk',
      mockFetch({
        '/transferrecipient': { status: 400, body: { status: false, message: 'Invalid account' } },
      }) as unknown as typeof fetch,
    );
    expect(
      await rejected.send(ctx, {
        payoutId: 'p',
        reference: 'r',
        methodId: 'ng_bank',
        netMicros: 1,
        localCurrency: 'NGN',
        localAmount: 1,
        details: {},
      }),
    ).toMatchObject({ status: 'failed', retryable: false, error: 'Invalid account' });
  });

  it('verifies webhook signatures (HMAC-SHA512 of the raw body)', () => {
    const body = '{"event":"transfer.success","data":{"reference":"cashads_p1"}}';
    const sig = createHmac('sha512', 'sk').update(body).digest('hex');
    expect(verifyPaystackSignature('sk', body, sig)).toBe(true);
    expect(verifyPaystackSignature('sk', `${body} `, sig)).toBe(false);
    expect(verifyPaystackSignature('sk', body, undefined)).toBe(false);
  });
});

describe('TOTP (RFC 6238)', () => {
  it('matches the RFC test vector and rejects replays', () => {
    // RFC 6238 Appendix B: secret "12345678901234567890" (ASCII), T = 59s → 94287082 (8 digits) → 287082 (6 digits).
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
    expect(totpAt(secret, 1)).toBe('287082');
    const step = verifyTotp(secret, totpAt(secret, 1), null, 59_000);
    expect(step).toBe(1);
    expect(verifyTotp(secret, totpAt(secret, 1), step, 59_000)).toBeNull();
  });
});
