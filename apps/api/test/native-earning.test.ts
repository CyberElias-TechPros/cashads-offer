import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LESSONS } from '@cashads/shared';
import { computeVisibleMs, validateEventChain } from '../src/modules/ads/service';
import { Client, type TestEnv, balance, createTestEnv, registerUser } from './helpers';

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => env.close());
afterEach(() => {
  vi.useRealTimers();
});

const at = (type: string, t: number, mediaTime = 0, quartile?: number) => ({
  type,
  at: t,
  mediaTime,
  ...(quartile ? { quartile } : {}),
});

describe('event-chain verification (unit)', () => {
  const d = 20;
  const good = [
    at('loaded', 0),
    at('started', 100, 0),
    at('quartile', 5100, 5, 1),
    at('quartile', 10100, 10, 2),
    at('quartile', 15100, 15, 3),
    at('completed', 20200, 20),
  ];

  it('accepts a complete, in-order, fully visible chain', () => {
    expect(validateEventChain(good, d)).toBeNull();
    expect(computeVisibleMs(good)).toBe(20_100);
  });

  it('rejects out-of-order events and impossible speed as tampering', () => {
    const swapped = [...good];
    swapped[3] = at('quartile', 2000, 10, 2);
    expect(validateEventChain(swapped, d)?.tampering).toBe(true);
    const fast = good.map((e) => ({ ...e, at: Math.round(e.at / 4) }));
    expect(validateEventChain(fast, d)?.reason).toMatch(/faster than its real length/);
  });

  it('does not count time while the tab is hidden', () => {
    const hidden = [
      at('loaded', 0),
      at('started', 0),
      at('hidden', 5000),
      at('visible', 15000),
      at('resumed', 15000),
      at('completed', 30000, 20),
    ];
    expect(computeVisibleMs(hidden)).toBe(20_000);
  });
});

async function watch(client: Client, opts: { speed?: number; hideMs?: number } = {}) {
  vi.useFakeTimers({ toFake: ['Date'] });
  let now = Date.now();
  vi.setSystemTime(now);
  const next = (await client.get('/api/ads/next')).body;
  const d = next.creative.durationSeconds as number;
  const session = (await client.post('/api/ads/sessions', { creativeId: next.creative.id })).body;
  const ev = (type: string, mediaTime: number, quartile?: number) =>
    client.post(`/api/ads/sessions/${session.id}/events`, {
      type,
      mediaTime,
      ...(quartile ? { quartile } : {}),
    });
  const advance = async (ms: number) => {
    now += ms;
    vi.setSystemTime(now);
  };
  const speed = opts.speed ?? 1;
  await ev('loaded', 0);
  await ev('started', 0);
  for (const q of [1, 2, 3] as const) {
    await advance((d * 250) / speed);
    if (q === 2 && opts.hideMs) {
      await ev('hidden', (d * q) / 4);
      await advance(opts.hideMs);
      await ev('visible', (d * q) / 4);
      await ev('resumed', (d * q) / 4);
    }
    await ev('quartile', (d * q) / 4, q);
  }
  await advance((d * 250) / speed + 200);
  await ev('completed', d);
  const done = await client.post(`/api/ads/sessions/${session.id}/complete`);
  vi.useRealTimers();
  return { next, session, done };
}

describe('rewarded video', () => {
  it('rewards a fully watched video after server-side verification (SSV) — honest sub-cent amount', async () => {
    const { client } = await registerUser(env);
    const { next, session, done } = await watch(client);
    expect(next.rewardMicros).toBeLessThan(20_000); // honest: well under 2 cents
    expect(next.offersPayMoreHint).toMatch(/survey/);
    expect(done.body.status).toBe('verifying');
    await env.drain({ now: new Date(Date.now() + 120_000) }); // the ad network's server calls our SSV endpoint
    const final = (await client.get(`/api/ads/sessions/${session.id}`)).body;
    expect(final.status).toBe('rewarded');
    expect(await balance(client)).toBe(next.rewardMicros);
  });

  it('pays a combo bonus for consecutive videos', async () => {
    const { client } = await registerUser(env);
    await watch(client);
    await env.drain({ now: new Date(Date.now() + 120_000) });
    const second = await watch(client);
    expect(second.next.comboLevel).toBe(1);
    await env.drain({ now: new Date(Date.now() + 240_000) });
    const txns = (await client.get('/api/wallet/transactions')).body.items as { type: string }[];
    expect(txns.some((t) => t.type === 'bonus_combo')).toBe(true);
  });

  it('rejects a video "watched" faster than its length, without touching the balance', async () => {
    const { client } = await registerUser(env);
    const { done } = await watch(client, { speed: 3 });
    expect(done.body.status).toBe('rejected');
    await env.drain();
    expect(await balance(client)).toBe(0);
  });

  it('still rewards when the tab was hidden but playback paused and resumed', async () => {
    const { client } = await registerUser(env);
    const { done } = await watch(client, { hideMs: 8_000 });
    expect(done.body.status).toBe('verifying');
  });

  it('lets only one device earn at a time, with an explicit takeover', async () => {
    const { client, email } = await registerUser(env);
    const next = (await client.get('/api/ads/next')).body;
    expect((await client.post('/api/ads/sessions', { creativeId: next.creative.id })).status).toBe(200);
    const phone = new Client(env.app);
    await phone.post('/api/auth/login', { email, password: 'correct-horse-42' });
    const blocked = await phone.post('/api/ads/sessions', { creativeId: next.creative.id });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('EARNING_ON_OTHER_DEVICE');
    expect(
      (await phone.post('/api/ads/sessions', { creativeId: next.creative.id, takeover: true })).status,
    ).toBe(200);
  });

  it('never counts a failed load against the member', async () => {
    const { client } = await registerUser(env);
    const next = (await client.get('/api/ads/next')).body;
    const s = (await client.post('/api/ads/sessions', { creativeId: next.creative.id })).body;
    const res = await client.post(`/api/ads/sessions/${s.id}/events`, { type: 'error', mediaTime: 0 });
    expect(res.body.status).toBe('abandoned');
    expect(res.body.rejectionReason).toMatch(/doesn’t count against you/);
    expect((await client.get('/api/ads/next')).body.remainingToday).toBe(next.remainingToday);
  });
});

describe('quick tasks', () => {
  it('pays instantly, shows how others answered, and blocks bot-speed answering', async () => {
    const { client } = await registerUser(env);
    const { poll } = (await client.get('/api/polls/next')).body;
    const res = await client.post(`/api/polls/${poll.id}/answer`, { optionIndex: 0 });
    expect(res.status).toBe(200);
    expect(res.body.distribution).toHaveLength(poll.options.length);
    expect(res.body.next.id).not.toBe(poll.id);
    const tooFast = await client.post(`/api/polls/${res.body.next.id}/answer`, { optionIndex: 1 });
    expect(tooFast.status).toBe(429);
    await env.drain(); // first-task bonus is paid by the earning outbox job
    expect(await balance(client)).toBe(poll.rewardMicros + env.ctx.settings.get().firstTaskBonusMicros);
  });
});

describe('earn + learn', () => {
  it('never leaks quiz answers and pays once on passing', async () => {
    const { client } = await registerUser(env);
    const lesson = LESSONS[0]!;
    const dto = (await client.get(`/api/lessons/${lesson.id}`)).body;
    expect(JSON.stringify(dto.quiz)).not.toContain('"answer"');
    const wrong = await client.post(`/api/lessons/${lesson.id}/submit`, {
      answers: lesson.quiz.map((q) => (q.answer + 1) % q.options.length),
    });
    expect(wrong.body.passed).toBe(false);
    expect(wrong.body.retryAt).not.toBeNull();
    expect(
      (await client.post(`/api/lessons/${lesson.id}/submit`, { answers: lesson.quiz.map((q) => q.answer) }))
        .status,
    ).toBe(429); // cooldown
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 3 * 60_000);
    const pass = await client.post(`/api/lessons/${lesson.id}/submit`, {
      answers: lesson.quiz.map((q) => q.answer),
    });
    vi.useRealTimers();
    expect(pass.body.passed).toBe(true);
    expect(pass.body.rewardMicros).toBe(lesson.rewardMicros);
    const again = await client.post(`/api/lessons/${lesson.id}/submit`, {
      answers: lesson.quiz.map((q) => q.answer),
    });
    expect(again.body.rewardMicros).toBe(0);
  });
});
