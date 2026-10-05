import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { withUow } from '../src/context';
import { riskSignals, users } from '../src/db/schema';
import { clock } from '../src/lib/clock';
import { hotp, totpStep } from '../src/lib/totp';
import { acct, LedgerError, postEntry } from '../src/modules/wallet/ledger';
import { Agent, createTestEnv, expectLedgerHealthy, latestMessage, signupUser, type TestEnv } from './helpers';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => env.close());

describe('double-entry ledger', () => {
  it('rejects unbalanced and fractional entries', async () => {
    const { userId } = await signupUser(env);
    await expect(
      withUow(env.ctx, ({ tx }) =>
        postEntry(tx, { kind: 'bad', idempotencyKey: 'bad-1', postings: [{ account: acct.available(userId), amount: 100 }, { account: acct.marketing, amount: -99 }] }),
      ),
    ).rejects.toThrow(LedgerError);
    await expect(
      withUow(env.ctx, ({ tx }) =>
        postEntry(tx, { kind: 'bad', idempotencyKey: 'bad-2', postings: [{ account: acct.available(userId), amount: 0.5 }, { account: acct.marketing, amount: -0.5 }] }),
      ),
    ).rejects.toThrow(LedgerError);
  });

  it('is idempotent and keeps the wallet cache in sync', async () => {
    const { userId, agent } = await signupUser(env);
    const post = () =>
      withUow(env.ctx, ({ tx }) =>
        postEntry(tx, { kind: 'test', idempotencyKey: `once-${userId}`, postings: [{ account: acct.marketing, amount: -500_000 }, { account: acct.available(userId), amount: 500_000 }] }),
      );
    expect((await post()).duplicate).toBe(false);
    expect((await post()).duplicate).toBe(true);
    expect((await agent.get('/api/wallet')).body.availableMicros).toBe(500_000);
    await expectLedgerHealthy(env);
  });

  it('refuses root-db access inside a unit of work (deadlock guard)', async () => {
    await expect(withUow(env.ctx, async () => env.ctx.db.select().from(users).limit(1))).rejects.toThrow(/inside a unit of work/);
  });
});

describe('authentication', () => {
  it('signs up with an httpOnly session cookie and blocks duplicate emails', async () => {
    const agent = new Agent(env.app);
    const body = { email: 'Jane@Example.com', password: 'CorrectHorse9!', displayName: 'Jane Doe', country: 'NG', timezone: 'Africa/Lagos', acceptTerms: true, confirmAge: true };
    const res = await agent.post('/api/auth/signup', body);
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('jane@example.com');
    expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly/i);
    expect((await agent.get('/api/me')).status).toBe(200);
    const dup = await new Agent(env.app).post('/api/auth/signup', body);
    expect(dup.status).toBe(409);
  });

  it('validates input with helpful messages', async () => {
    const res = await new Agent(env.app).post('/api/auth/signup', { email: 'nope', password: 'short', displayName: 'J', country: 'US', acceptTerms: true, confirmAge: true });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.details.issues.length).toBeGreaterThan(1);
  });

  it('blocks state-changing requests without the CSRF header', async () => {
    const { agent } = await signupUser(env);
    const res = await agent.req('POST', '/api/engagement/checkin', {}, { 'x-requested-with': '' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf');
  });

  it('locks the account after repeated failed logins', async () => {
    const { email } = await signupUser(env);
    const agent = new Agent(env.app);
    for (let i = 0; i < 5; i++) expect((await agent.post('/api/auth/login', { email, password: 'wrong-password' })).status).toBe(401);
    const locked = await agent.post('/api/auth/login', { email, password: 'CorrectHorse9!' });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('account_locked');
  });

  it('verifies email through the emailed link', async () => {
    const { agent, email } = await signupUser(env, { verify: false });
    const msg = await latestMessage(env, email);
    const token = /token=([\w-]+)/.exec(msg.text)![1];
    expect((await agent.post('/api/auth/verify-email', { token })).status).toBe(200);
    expect((await agent.get('/api/me')).body.user.emailVerified).toBe(true);
    expect((await agent.post('/api/auth/verify-email', { token })).status).toBe(400); // single use
  });

  it('resets the password and signs out every session', async () => {
    const { agent, email } = await signupUser(env);
    await new Agent(env.app).post('/api/auth/forgot-password', { email });
    const msg = await latestMessage(env, email);
    const token = /token=([\w-]+)/.exec(msg.text)![1];
    expect((await new Agent(env.app).post('/api/auth/reset-password', { token, password: 'BrandNewPass42!' })).status).toBe(200);
    expect((await agent.get('/api/me')).status).toBe(401);
    expect((await new Agent(env.app).post('/api/auth/login', { email, password: 'BrandNewPass42!' })).status).toBe(200);
  });

  it('supports TOTP two-factor authentication with replay protection', async () => {
    const { agent, email } = await signupUser(env);
    clock.freeze(Date.now());
    const setup = await agent.post('/api/me/2fa/setup');
    expect(setup.body.qrDataUrl).toMatch(/^data:image\/png/);
    const secret = setup.body.secret as string;
    expect((await agent.post('/api/me/2fa/enable', { code: hotp(secret, totpStep(clock.ms())) })).status).toBe(200);
    await agent.post('/api/auth/logout');
    const login = await agent.post('/api/auth/login', { email, password: 'CorrectHorse9!' });
    expect(login.body.twoFactorRequired).toBe(true);
    // Same 30s window as enrolment → replay is refused.
    const replay = await agent.post('/api/auth/login/2fa', { challengeId: login.body.challengeId, code: hotp(secret, totpStep(clock.ms())) });
    expect(replay.status).toBe(401);
    clock.advance(31_000);
    const ok = await agent.post('/api/auth/login/2fa', { challengeId: login.body.challengeId, code: hotp(secret, totpStep(clock.ms())) });
    expect(ok.status).toBe(200);
    expect((await agent.get('/api/me')).body.user.twoFactorEnabled).toBe(true);
    clock.reset();
  });

  it('flags disposable email domains without blocking sign-up', async () => {
    const { userId } = await signupUser(env, { email: 'someone@mailinator.com' });
    const signals = await env.ctx.db.select().from(riskSignals).where(eq(riskSignals.userId, userId));
    expect(signals.map((s) => s.code)).toContain('disposable_email');
  });
});
