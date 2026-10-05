import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { outboundMessages, sessions, users } from '../src/db/schema';
import { decrypt } from '../src/lib/crypto';
import { totpAt, currentStep } from '../src/lib/totp';
import {
  SYS,
  balancesMatchEntries,
  getAvailableMicros,
  ledgerIsBalanced,
  postTransaction,
  userAccountCode,
} from '../src/modules/wallet/ledger';
import { Client, PASSWORD, type TestEnv, createTestEnv, registerUser, verifyEmailFor } from './helpers';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => env.close());

describe('ledger', () => {
  it('rejects unbalanced transactions', async () => {
    const { user } = await registerUser(env);
    await expect(
      postTransaction(env.ctx.db, {
        type: 'admin_adjustment',
        userId: user.id,
        idempotencyKey: 'unbalanced-1',
        description: 'x',
        entries: [
          { account: SYS.adjustments, direction: 'debit', amount: 100 },
          { account: userAccountCode(user.id), direction: 'credit', amount: 99 },
        ],
      }),
    ).rejects.toThrow(/Unbalanced/);
  });

  it('is idempotent on the idempotency key', async () => {
    const { user } = await registerUser(env);
    const input = {
      type: 'admin_adjustment' as const,
      userId: user.id,
      idempotencyKey: `idem-${user.id}`,
      description: 'goodwill',
      entries: [
        { account: SYS.adjustments, direction: 'debit' as const, amount: 1_000_000 },
        { account: userAccountCode(user.id), direction: 'credit' as const, amount: 1_000_000 },
      ],
    };
    const a = await postTransaction(env.ctx.db, input);
    const b = await postTransaction(env.ctx.db, input);
    expect(b.duplicate).toBe(true);
    expect(b.id).toBe(a.id);
    expect(await getAvailableMicros(env.ctx.db, user.id)).toBe(1_000_000);
  });

  it('makes member overdrafts physically impossible (CHECK constraint)', async () => {
    const { user } = await registerUser(env);
    await expect(
      env.ctx.db.transaction((tx) =>
        postTransaction(tx, {
          type: 'admin_adjustment',
          userId: user.id,
          idempotencyKey: `overdraft-${user.id}`,
          description: 'overdraft attempt',
          entries: [
            { account: userAccountCode(user.id), direction: 'debit', amount: 1 },
            { account: SYS.adjustments, direction: 'credit', amount: 1 },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    expect(await getAvailableMicros(env.ctx.db, user.id)).toBe(0);
  });

  it('keeps Σdebits = Σcredits and cached balances = entries', async () => {
    expect((await ledgerIsBalanced(env.ctx.db)).ok).toBe(true);
    expect(await balancesMatchEntries(env.ctx.db)).toBe(true);
  });
});

describe('auth', () => {
  it('registers, sets an httpOnly session cookie and returns the member', async () => {
    const client = new Client(env.app);
    const res = await client.post('/api/auth/register', {
      email: 'Ada@Example.com ',
      password: PASSWORD,
      country: 'NG',
      acceptTerms: true,
      confirmAdult: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('ada@example.com');
    expect(res.body.user.emailVerified).toBe(false);
    expect(String(res.raw.headers['set-cookie'])).toMatch(/HttpOnly/i);
    const me = await client.get('/api/auth/me');
    expect(me.body.user.id).toBe(res.body.user.id);
  });

  it('rejects duplicate emails, weak passwords and minors', async () => {
    const client = new Client(env.app);
    expect(
      (
        await client.post('/api/auth/register', {
          email: 'ada@example.com',
          password: PASSWORD,
          country: 'NG',
          acceptTerms: true,
          confirmAdult: true,
        })
      ).body.error.code,
    ).toBe('EMAIL_TAKEN');
    expect(
      (
        await client.post('/api/auth/register', {
          email: 'b@example.com',
          password: 'short',
          country: 'NG',
          acceptTerms: true,
          confirmAdult: true,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await client.post('/api/auth/register', {
          email: 'c@example.com',
          password: PASSWORD,
          country: 'NG',
          acceptTerms: true,
          confirmAdult: false,
        })
      ).status,
    ).toBe(400);
  });

  it('requires the CSRF header on state-changing requests', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ada@example.com', password: PASSWORD },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('CSRF');
  });

  it('verifies email via the emailed link — idempotently (double-clicks and link prefetchers are fine)', async () => {
    const { client, email } = await registerUser(env);
    await verifyEmailFor(env, client, email);
    expect((await client.get('/api/auth/me')).body.user.emailVerified).toBe(true);
    await verifyEmailFor(env, client, email); // same link again → still 200
    expect((await client.post('/api/auth/verify-email', { token: 'x'.repeat(32) })).body.error.code).toBe(
      'INVALID_TOKEN',
    );
  });

  it('locks out brute-force attempts without revealing whether the account exists', async () => {
    const { email } = await registerUser(env);
    const attacker = new Client(env.app);
    for (let i = 0; i < 8; i++) {
      const r = await attacker.post('/api/auth/login', { email, password: 'wrong-password-1' });
      expect(r.status).toBe(401);
      expect(r.body.error.message).toBe('Email or password is incorrect');
    }
    const locked = await attacker.post('/api/auth/login', { email, password: PASSWORD });
    expect(locked.status).toBe(429);
  });

  it('resets password via email link and signs out every device', async () => {
    const { client, email, user } = await registerUser(env);
    await new Client(env.app).post('/api/auth/forgot-password', { email });
    const msg = (
      await env.ctx.db
        .select()
        .from(outboundMessages)
        .where(eq(outboundMessages.to, email))
        .orderBy(desc(outboundMessages.createdAt))
    ).find((m) => (m.meta as { kind?: string } | null)?.kind === 'password_reset');
    const token = String((msg!.meta as { link: string }).link).split('token=')[1]!;
    expect(
      (await new Client(env.app).post('/api/auth/reset-password', { token, password: 'brand-new-pass-7' }))
        .status,
    ).toBe(200);
    expect((await client.get('/api/auth/me')).body.user).toBeNull();
    const live = await env.ctx.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, user.id)));
    expect(live.every((s) => s.revokedAt !== null)).toBe(true);
    expect(
      (await new Client(env.app).post('/api/auth/login', { email, password: 'brand-new-pass-7' })).status,
    ).toBe(200);
  });

  it('supports TOTP two-factor login with replay protection', async () => {
    const { client, email, user } = await registerUser(env);
    const setup = await client.post('/api/auth/2fa/setup');
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    const secret = setup.body.secret as string;
    const enable = await client.post('/api/auth/2fa/enable', { code: totpAt(secret, currentStep()) });
    expect(enable.body.recoveryCodes).toHaveLength(10);

    const fresh = new Client(env.app);
    const first = await fresh.post('/api/auth/login', { email, password: PASSWORD });
    expect(first.body.mfaRequired).toBe(true);
    const [row] = await env.ctx.db.select().from(users).where(eq(users.id, user.id));
    expect(decrypt(row!.totpSecretEnc!)).toBe(secret);
    // The enable step consumed the current step; the next window's code must be used.
    const ok = await fresh.post('/api/auth/login/mfa', {
      mfaToken: first.body.mfaToken,
      code: totpAt(secret, currentStep() + 1),
    });
    expect(ok.status).toBe(200);
    expect(ok.body.user.totpEnabled).toBe(true);

    const recovery = new Client(env.app);
    const second = await recovery.post('/api/auth/login', { email, password: PASSWORD });
    const viaRecovery = await recovery.post('/api/auth/login/mfa', {
      mfaToken: second.body.mfaToken,
      code: enable.body.recoveryCodes[0],
    });
    expect(viaRecovery.status).toBe(200);
  });

  it('verifies phone numbers by SMS code and enforces one phone per account', async () => {
    const a = await registerUser(env);
    expect((await a.client.post('/api/auth/phone/start', { phone: '08031234567' })).status).toBe(200);
    const sms = (
      await env.ctx.db
        .select()
        .from(outboundMessages)
        .where(eq(outboundMessages.channel, 'sms'))
        .orderBy(desc(outboundMessages.createdAt))
    )[0]!;
    expect(sms.to).toBe('+2348031234567');
    const code = /(\d{6})/.exec(sms.body)![1]!;
    expect(
      (await a.client.post('/api/auth/phone/verify', { code: '000000' === code ? '111111' : '000000' }))
        .status,
    ).toBe(400);
    const ok = await a.client.post('/api/auth/phone/verify', { code });
    expect(ok.body.user.phoneVerified).toBe(true);
    const b = await registerUser(env);
    expect((await b.client.post('/api/auth/phone/start', { phone: '+2348031234567' })).body.error.code).toBe(
      'PHONE_TAKEN',
    );
  });

  it('lists and revokes sessions (remote sign-out)', async () => {
    const { client, email } = await registerUser(env);
    const other = new Client(env.app);
    await other.post('/api/auth/login', { email, password: PASSWORD });
    const list = await client.get('/api/auth/sessions');
    expect(list.body).toHaveLength(2);
    await client.post('/api/auth/sessions/revoke-others');
    expect((await other.get('/api/auth/me')).body.user).toBeNull();
    expect((await client.get('/api/auth/me')).body.user).not.toBeNull();
  });

  it('exports data and deletes accounts (PII erased, ledger kept)', async () => {
    const { client, user } = await registerUser(env);
    const exported = await client.get('/api/me/export');
    expect(exported.body.profile.id).toBe(user.id);
    expect((await client.post('/api/me/delete', { password: PASSWORD, confirm: 'DELETE' })).status).toBe(200);
    const [row] = await env.ctx.db.select().from(users).where(eq(users.id, user.id));
    expect(row!.status).toBe('deleted');
    expect(row!.email).toMatch(/@deleted\.invalid$/);
  });
});
