import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { eq, inArray, sql } from 'drizzle-orm';
import { addDaysToKey, dayKey, usd } from '@cashads/shared';
import { withUow, type AppContext } from '../context';
import {
  devices,
  fxRates,
  jobs,
  kycSubmissions,
  networks,
  offerReports,
  offers,
  outboundMessages,
  payoutEvents,
  payoutMethods,
  payouts,
  sandboxConversions,
  uploads,
  users,
  videoAds,
  wallets,
} from './schema';
import { FX_RATES, NETWORKS, OFFERS, PAYOUT_METHODS, VIDEO_ADS } from './catalog';
import { clock, DAY, HOUR, MINUTE } from '../lib/clock';
import { hashPassword, randomToken, referralCode } from '../lib/crypto';
import { signHmacSorted } from '../modules/postbacks/adapters';
import { handlePostback } from '../modules/postbacks/service';
import { startOffer } from '../modules/offers/service';
import { completePayout, requestPayout } from '../modules/payouts/service';
import { completeSession, recordEvent, startSession } from '../modules/video/service';
import { checkin } from '../modules/engagement/service';
import { createClaim, autoCheckClaim } from '../modules/claims/service';
import { addSignal } from '../modules/fraud/service';
import { attachReferral } from '../modules/referrals/service';
import { createTicket, staffReply } from '../modules/support/service';
import { jobHandlers } from '../jobs/handlers';
import { Worker } from '../jobs/queue';

export const DEMO_ACCOUNTS = {
  admin: { email: 'admin@cashads.dev', password: 'Admin12345!' },
  support: { email: 'support@cashads.dev', password: 'Support12345!' },
  demo: { email: 'demo@cashads.dev', password: 'Demo12345!' },
  nigeria: { email: 'ada@cashads.dev', password: 'Demo12345!' },
};

type UserRow = typeof users.$inferSelect;

function rng(seedStr: string) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const TZ: Record<string, string> = {
  US: 'America/New_York', NG: 'Africa/Lagos', IN: 'Asia/Kolkata', MX: 'America/Mexico_City', PH: 'Asia/Manila', KE: 'Africa/Nairobi', BR: 'America/Sao_Paulo',
  GB: 'Europe/London', CA: 'America/Toronto', AU: 'Australia/Sydney', GH: 'Africa/Accra', PK: 'Asia/Karachi', VN: 'Asia/Ho_Chi_Minh', IT: 'Europe/Rome',
  EG: 'Africa/Cairo', ZA: 'Africa/Johannesburg', AR: 'America/Argentina/Buenos_Aires', CO: 'America/Bogota', FR: 'Europe/Paris', DE: 'Europe/Berlin', PL: 'Europe/Warsaw', NZ: 'Pacific/Auckland',
};

const MEMBERS: Array<[string, string]> = [
  ['Sarah Johnson', 'US'], ['Chinedu Okafor', 'NG'], ['Priya Sharma', 'IN'], ['Juan Martínez', 'MX'], ['Maria Santos', 'PH'], ['Emeka Nwosu', 'NG'],
  ['Grace Wanjiru', 'KE'], ['Lucas Silva', 'BR'], ['Emma Wilson', 'GB'], ['Liam Brown', 'CA'], ['Olivia Taylor', 'AU'], ['Kwame Mensah', 'GH'],
  ['Fatima Khan', 'PK'], ['Nguyen Van An', 'VN'], ['Sofia Rossi', 'IT'], ['Ahmed Hassan', 'EG'], ['Thandiwe Dlamini', 'ZA'], ['Mateo García', 'AR'],
  ['Isabella Gómez', 'CO'], ['Noah Miller', 'US'], ['Ava Davis', 'US'], ['Ethan Moore', 'US'], ['Chloe Martin', 'FR'], ['Lukas Müller', 'DE'],
  ['Anna Kowalska', 'PL'], ['Daniel Kim', 'US'], ['Zainab Yusuf', 'NG'], ['Rahul Verma', 'IN'], ['Joy Atieno', 'KE'], ['Tolu Adeyemi', 'NG'],
  ['Kofi Boateng', 'GH'], ['Camila Rocha', 'BR'], ['Jack Thompson', 'NZ'], ['Mia Anderson', 'US'], ['Oliver Smith', 'GB'],
];

const METHOD_FOR: Record<string, string[]> = {
  NG: ['paystack_ng'], KE: ['mpesa_ke'], GH: ['momo_gh'], PH: ['gcash_ph', 'paypal'], IN: ['upi_in', 'paypal'], BR: ['pix_br', 'paypal'],
  US: ['paypal', 'amazon', 'usdc_polygon'], PK: ['usdc_polygon', 'wise'],
};

function destinationFor(methodId: string, name: string, r: () => number): Record<string, string> {
  const slug = name.toLowerCase().normalize('NFD').replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '.');
  const digits = (n: number) => Array.from({ length: n }, () => Math.floor(r() * 10)).join('');
  const hex = (n: number) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(r() * 16)]).join('');
  switch (methodId) {
    case 'paypal':
    case 'wise':
    case 'pix_br':
      return methodId === 'pix_br' ? { pixKey: `${slug}@example.com` } : { email: `${slug}@example.com` };
    case 'amazon':
      return { email: `${slug}@example.com`, region: 'US' };
    case 'usdc_polygon':
      return { address: `0x${hex(40)}` };
    case 'paystack_ng':
      return { bankCode: '058', accountNumber: digits(10), accountName: name };
    case 'mpesa_ke':
      return { phone: `+2547${digits(8)}` };
    case 'momo_gh':
      return { phone: `+233${digits(9)}` };
    case 'gcash_ph':
      return { phone: `+639${digits(9)}` };
    case 'upi_in':
      return { vpa: `${slug.replace(/\./g, '')}@okaxis` };
    default:
      return { email: `${slug}@example.com` };
  }
}

/* 1×1 PNG used as placeholder KYC images in the demo. */
const PNG_1PX = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0f01f0005000201e2b3a4c80000000049454e44ae426082', 'hex');

/** Networks, offers, sponsor videos, payout rails and FX rates (also used by the test suite). */
export async function seedCatalog(ctx: AppContext, opts: { now?: number } = {}) {
  const db = ctx.db;
  const now = opts.now ?? Date.now();
  const sandboxSecret = ctx.config.SANDBOX_NETWORK_SECRET ?? randomToken(24);
  const videoSecret = randomToken(24);
  for (const n of NETWORKS) {
    await db.insert(networks).values({
      id: n.id,
      name: n.name,
      kind: n.kind,
      status: n.status,
      signatureScheme: n.signatureScheme,
      secretEnc: ctx.vault.encrypt(n.id === 'demo' ? sandboxSecret : n.id === 'house_video' ? videoSecret : randomToken(24)),
      paramMap: n.paramMap,
      docsUrl: n.docsUrl ?? null,
      notes: n.notes ?? null,
    });
  }
  const offerIds = new Map<string, string>();
  for (const [i, o] of OFFERS.entries()) {
    const [row] = await db
      .insert(offers)
      .values({
        networkId: 'demo',
        externalId: o.externalId,
        title: o.title,
        advertiser: o.advertiser,
        shortDescription: o.shortDescription,
        description: o.description,
        category: o.category,
        icon: o.icon,
        brandColor: o.brandColor,
        partnerPayoutMicros: o.partner,
        estimatedMinutes: o.minutes,
        dataUsage: o.data,
        steps: o.steps,
        requirements: o.requirements ?? [],
        goals: o.goals ?? [],
        countries: o.countries ?? [],
        platforms: ['web', 'ios', 'android'],
        holdHours: o.holdHours ?? null,
        conversionWindowHours: o.windowHours ?? 72,
        featured: o.featured ?? false,
        qualityScore: o.quality ?? 85,
        trackingReliability: o.reliability ?? null,
        sandboxDropPostback: o.drop ?? false,
        sandboxDelaySeconds: o.delay ?? 3,
        partnerContent: o.content,
        createdAt: new Date(now - (60 - (i % 9)) * DAY + (i < 3 ? 56 * DAY : 0)),
      })
      .returning({ id: offers.id });
    offerIds.set(o.externalId, row.id);
  }
  for (const v of VIDEO_ADS) {
    await db.insert(videoAds).values({
      advertiser: v.advertiser,
      headline: v.headline,
      tagline: v.tagline,
      cta: v.cta,
      brandColor: v.brandColor,
      accentColor: v.accentColor,
      emoji: v.emoji,
      durationSeconds: v.durationSeconds,
      partnerPayoutMicros: v.partner,
    });
  }
  for (const m of PAYOUT_METHODS) {
    await db.insert(payoutMethods).values({
      id: m.id,
      name: m.name,
      kind: m.kind,
      description: m.description,
      logo: m.logo,
      provider: m.provider,
      minMicros: m.min,
      maxMicros: m.max,
      feeFixedMicros: m.feeFixed,
      feeBps: m.feeBps,
      etaLabel: m.eta,
      countries: m.countries,
      currency: m.currency,
      fields: m.fields,
      sortOrder: m.sort,
    });
  }
  for (const [currency, rate] of Object.entries(FX_RATES)) await db.insert(fxRates).values({ currency, ratePerUsd: rate });

  return { offerIds, sandboxSecret, videoSecret };
}

export async function seed(ctx: AppContext) {
  const db = ctx.db;
  const now = Date.now();
  const r = rng('cashads-seed-v1');
  const pick = <T>(arr: T[]) => arr[Math.floor(r() * arr.length)];

  const { offerIds, sandboxSecret } = await seedCatalog(ctx, { now });

  /* --------------------------------------------------------------- people */
  const createMember = async (opts: { name: string; country: string; email: string; createdAt: number; password?: string; role?: 'user' | 'admin' | 'support'; phone?: boolean; seed?: boolean; deviceKey?: string; refCode?: string; ip?: string }) => {
    clock.freeze(opts.createdAt);
    const [u] = await db
      .insert(users)
      .values({
        email: opts.email,
        passwordHash: opts.password ? await hashPassword(opts.password) : null,
        displayName: opts.name,
        country: opts.country,
        timezone: TZ[opts.country] ?? 'UTC',
        role: opts.role ?? 'user',
        referralCode: referralCode(),
        emailVerifiedAt: new Date(opts.createdAt + 10 * MINUTE),
        phone: opts.phone === false ? null : `+1555${Math.floor(1_000_000 + r() * 8_999_999)}`,
        phoneVerifiedAt: opts.phone === false ? null : new Date(opts.createdAt + 20 * MINUTE),
        onboardingCompletedAt: new Date(opts.createdAt + 5 * MINUTE),
        preferences: { emailPayouts: true, leaderboardOptIn: r() > 0.12, showLocalCurrency: true, theme: 'system', interests: ['survey', 'poll', 'learn'], dailyMinutes: 15 },
        signupIp: opts.ip ?? `10.${Math.floor(r() * 250)}.${Math.floor(r() * 250)}.${Math.floor(r() * 250)}`,
        isSeed: opts.seed ?? true,
        lastSeenAt: new Date(now - Math.floor(r() * 2 * DAY)),
        createdAt: new Date(opts.createdAt),
        updatedAt: new Date(opts.createdAt),
      })
      .returning();
    await db.insert(wallets).values({ userId: u.id });
    await db.insert(devices).values({
      userId: u.id,
      deviceKey: opts.deviceKey ?? `seed-${crypto.randomUUID()}`,
      fingerprint: null,
      label: pick(['Chrome on Android', 'Safari on iOS', 'Chrome on Windows', 'Firefox on macOS']),
      firstIp: u.signupIp,
      lastIp: u.signupIp,
      firstSeenAt: new Date(opts.createdAt),
      lastSeenAt: new Date(opts.createdAt),
    });
    if (opts.refCode) await withUow(ctx, (uow) => attachReferral(uow, u.id, opts.refCode!, { ip: opts.ip ?? null, deviceKey: opts.deviceKey ?? null }));
    return u;
  };

  const reload = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];

  /** Full pipeline: click → partner-side record → signed postback → credit. */
  const completeOffer = async (user: UserRow, ext: string, at: number, goalId?: string) => {
    const offerId = offerIds.get(ext)!;
    const def = OFFERS.find((o) => o.externalId === ext)!;
    clock.freeze(at - Math.max(1, Math.min(def.minutes, 120)) * MINUTE * (0.7 + r() * 0.6));
    const fresh = await reload(user.id);
    let clickId: string;
    try {
      ({ clickId } = await withUow(ctx, (uow) => startOffer(uow, fresh, offerId, { ip: fresh.signupIp, userAgent: 'seed', deviceId: null })));
    } catch (err) {
      if ((err as { code?: string }).code === 'already_completed') return { clickId: '', txId: '' };
      throw err;
    }
    clock.freeze(at);
    const txId = `DEMO-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    await db.insert(sandboxConversions).values({ clickId, offerId, goalId: goalId ?? '', txId, postbackSent: true, createdAt: new Date(at) });
    const payout = goalId ? def.goals!.find((g) => g.id === goalId)!.partnerPayoutMicros : def.partner;
    const params: Record<string, string> = { click_id: clickId, tx_id: txId, payout: (payout / 1e6).toFixed(4), status: '1', offer_id: ext };
    if (goalId) params.goal = goalId;
    params.sig = signHmacSorted(params, sandboxSecret);
    await handlePostback(ctx, { networkId: 'demo', method: 'GET', params, fullUrl: 'http://seed.local/api/postback/demo', headers: {}, ip: '10.0.0.1' });
    return { clickId, txId };
  };

  // Runs due background jobs (hold releases, claim checks…) at the simulated time.
  const worker = new Worker(ctx, jobHandlers());
  const runDueJobs = async () => {
    await worker.drain(20);
  };

  /** amount: micros, or a fraction (0–1) of the available balance at that moment. */
  const cashOut = async (user: UserRow, methodId: string, amountOrShare: number, at: number, durationSec: number, complete = true) => {
    clock.freeze(at);
    await runDueJobs();
    const fresh = await reload(user.id);
    const [bal] = await db.select().from(wallets).where(eq(wallets.userId, user.id));
    const amount = amountOrShare <= 1 ? Math.floor((bal.availableMicros * amountOrShare) / 10_000) * 10_000 : Math.min(amountOrShare, Math.floor(bal.availableMicros / 10_000) * 10_000);
    if (amount < 100_000) return null;
    const dest = destinationFor(methodId, user.displayName, r);
    const p = await withUow(ctx, (uow) => requestPayout(uow, fresh, { methodId, amountMicros: amount, destination: dest, saveDestination: true, idempotencyKey: `seed-${crypto.randomUUID()}` }));
    if (!complete || p.status === 'review') return p;
    await db.update(payouts).set({ status: 'processing', processingAt: new Date(at + 2000) }).where(eq(payouts.id, p.id));
    clock.freeze(at + durationSec * 1000);
    await completePayout(ctx, p.id, `SBX-${crypto.randomBytes(5).toString('hex').toUpperCase()}`);
    return p;
  };

  const watchVideos = async (user: UserRow, count: number, start: number) => {
    let t = start;
    for (let i = 0; i < count; i++) {
      clock.freeze(t);
      const fresh = await reload(user.id);
      let session;
      try {
        session = await withUow(ctx, (uow) => startSession(uow, fresh, { deviceId: null, deviceLabel: 'Chrome on Android', ip: null, takeOver: true }));
      } catch {
        return;
      }
      const d = session.creative.durationSeconds * 1000;
      const events: Array<[string, number]> = [['loaded', 300], ['started', 800], ['q1', 800 + d * 0.25], ['mid', 800 + d * 0.5], ['q3', 800 + d * 0.75], ['completed', 800 + d]];
      for (const [type, offset] of events) {
        clock.freeze(t + offset + 50);
        await withUow(ctx, (uow) => recordEvent(uow, user.id, session.id, { type: type as 'loaded', t: offset }));
      }
      clock.freeze(t + 800 + d + 400);
      await withUow(ctx, (uow) => completeSession(uow, fresh, session.id));
      t += 800 + d + 4000 + Math.floor(r() * 5000);
    }
  };

  /** Check in N local days ago (in the member's own timezone — streak days are local). */
  const checkinDays = async (user: UserRow, daysAgo: number[]) => {
    const tz = TZ[user.country] ?? 'UTC';
    const todayKey = dayKey(new Date(now), tz);
    for (const d of daysAgo.sort((a, b) => b - a)) {
      const target = addDaysToKey(todayKey, -d);
      let t = Date.parse(`${target}T12:00:00Z`);
      for (let i = 0; i < 6 && dayKey(new Date(t), tz) !== target; i++) t += dayKey(new Date(t), tz) > target ? -4 * HOUR : 4 * HOUR;
      clock.freeze(Math.min(t, now - HOUR));
      await withUow(ctx, (uow) => checkin(uow, user.id)).catch(() => undefined);
    }
  };

  try {
    /* staff */
    const admin = await createMember({ name: 'Morgan Admin', country: 'US', email: DEMO_ACCOUNTS.admin.email, password: DEMO_ACCOUNTS.admin.password, role: 'admin', createdAt: now - 90 * DAY, seed: false });
    await createMember({ name: 'Sam Support', country: 'GB', email: DEMO_ACCOUNTS.support.email, password: DEMO_ACCOUNTS.support.password, role: 'support', createdAt: now - 80 * DAY, seed: false });

    /* the demo member (story: 3 weeks in, Silver → Gold, money pending, a claim in review) */
    let demo = await createMember({ name: 'Alex Rivera', country: 'US', email: DEMO_ACCOUNTS.demo.email, password: DEMO_ACCOUNTS.demo.password, createdAt: now - 21 * DAY, seed: false });
    await db.update(users).set({ goalLabel: 'Amazon gift card', goalTargetMicros: usd(25) }).where(eq(users.id, demo.id));

    /* synthetic members */
    const members: UserRow[] = [];
    for (const [i, [name, country]] of MEMBERS.entries()) {
      const createdAt = now - (58 - i * 1.4) * DAY - Math.floor(r() * 10 * HOUR);
      const refCode = name === 'Noah Miller' || name === 'Ava Davis' ? demo.referralCode : undefined;
      const slug = name.toLowerCase().normalize('NFD').replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '.');
      members.push(await createMember({ name, country, email: `${slug}@members.cashads.dev`, createdAt, refCode }));
    }

    /* history for synthetic members */
    const t0 = Date.now();
    const progress = (label: string) => ctx.log.info(`[seed] ${label} (+${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    progress('members created');
    for (const [i, m] of members.entries()) {
      if (i % 5 === 0) progress(`history ${i}/${members.length}`);
      const eligible = OFFERS.filter((o) => (!o.countries || o.countries.includes(m.country)) && !o.goals && !o.drop);
      const count = 3 + Math.floor(r() * 6);
      const span = (now - m.createdAt.getTime()) * 0.95;
      const chosen = new Set<string>();
      for (let k = 0; k < count; k++) {
        const o = pick(eligible);
        if (chosen.has(o.externalId)) continue;
        chosen.add(o.externalId);
        const at = m.createdAt.getTime() + span * ((k + 1) / (count + 1)) + Math.floor(r() * 3 * HOUR);
        await completeOffer(m, o.externalId, Math.min(at, now - 30 * MINUTE));
      }
      if (i % 3 === 0) await completeOffer(m, 'game-words', m.createdAt.getTime() + span * 0.5, 'p10');
      if (i % 4 === 0) await watchVideos(m, 3 + Math.floor(r() * 5), now - (2 + r() * 5) * DAY);
      if (i % 2 === 0) await checkinDays(m, [5, 4, 3, 2, 1].slice(0, 2 + Math.floor(r() * 4)));
    }

    /* recent activity so this week's leaderboard & live feed feel alive */
    for (const m of members.slice(0, 18)) {
      const eligible = OFFERS.filter((o) => (!o.countries || o.countries.includes(m.country)) && !o.goals && !o.drop && o.partner <= usd(8));
      const o = pick(eligible);
      await completeOffer(m, o.externalId, now - Math.floor(r() * 3 * DAY) - 20 * MINUTE).catch(() => undefined);
    }

    progress('recent activity done');
    /* cash outs (real flow: reserve → provider → settle) */
    for (const [i, m] of members.entries()) {
      const methodId = pick(METHOD_FOR[m.country] ?? ['paypal', 'usdc_polygon']);
      const recent = i < 14;
      const firstAt = recent ? now - Math.floor((0.2 + r() * 20) * HOUR) : now - Math.floor((2 + r() * 12) * DAY);
      const duration = r() < 0.85 ? 25 + Math.floor(r() * 400) : 1800 + Math.floor(r() * 7200);
      await cashOut(m, methodId, 0.35 + r() * 0.3, firstAt, duration).catch((err) => ctx.log.debug?.({ err }, 'seed payout skipped'));
      if (r() < 0.45) {
        await cashOut(m, methodId, 0.5, Math.max(firstAt + HOUR, now - Math.floor(r() * 6 * HOUR)), 30 + Math.floor(r() * 300)).catch(() => undefined);
      }
    }

    progress('cash outs done');
    /* demo member story */
    const d = (days: number, hours = 0) => now - days * DAY - hours * HOUR;
    await completeOffer(demo, 'svy-stream', d(19, 3));
    await completeOffer(demo, 'poll-snack', d(19, 2));
    await completeOffer(demo, 'learn-budget', d(16));
    await completeOffer(demo, 'app-budgetly', d(14, 5));
    await completeOffer(demo, 'su-notewise', d(12, 2));
    await checkinDays(demo, [15, 14, 13]);
    await completeOffer(demo, 'game-words', d(10), 'p10');
    await cashOut(demo, 'paypal', 0.8, d(9, 4), 74);
    await watchVideos(demo, 6, d(7, 6));
    await completeOffer(demo, 'svy-banking', d(5, 1));
    await completeOffer(demo, 'poll-coffee', d(4, 3));
    await cashOut(demo, 'usdc_polygon', 0.6, d(3, 8), 41);
    // A survey the partner never confirmed → claim goes to human review.
    clock.freeze(d(2, 6));
    demo = await reload(demo.id);
    const carrier = await withUow(ctx, (uow) => startOffer(uow, demo, offerIds.get('svy-carrier')!, { ip: null, userAgent: 'seed', deviceId: null }));
    clock.freeze(d(2, 5));
    const demoClaim = await createClaim(ctx, demo.id, { clickId: carrier.clickId, completedAt: new Date(d(2, 5) - 10 * MINUTE).toISOString(), note: 'Finished all questions and saw the thank-you page, but nothing arrived.' });
    await autoCheckClaim(ctx, demoClaim.id);
    await completeOffer(demo, 'fin-creditpath', d(2, 2));
    await watchVideos(demo, 6, d(1, 5));
    await completeOffer(demo, 'poll-logo', d(1, 2));
    await checkinDays(demo, [4, 3, 2, 1]);
    // Big-ticket offer → shows a real safety hold counting down.
    await completeOffer(demo, 'fin-novabank', now - 3 * HOUR);
    clock.freeze(d(6));
    const demoTicket = await createTicket(ctx, await reload(demo.id), {
      subject: 'How do safety holds work?',
      category: 'payout',
      message: 'My bank offer shows as pending. When can I cash it out?',
    });
    clock.freeze(d(6) + 2 * HOUR);
    await staffReply(ctx, admin.id, demoTicket.id, 'Great question! High-value partner offers get a short safety hold (72h for bank accounts, shorter on higher tiers) because partners can reverse fraudulent sign-ups. Your Wallet shows the exact unlock time for each item. Nothing for you to do — it unlocks automatically.', 'resolved');

    /* Nigeria member (local rails demo) */
    const ada = await createMember({ name: 'Ada Okonkwo', country: 'NG', email: DEMO_ACCOUNTS.nigeria.email, password: DEMO_ACCOUNTS.nigeria.password, createdAt: now - 11 * DAY, seed: false });
    await completeOffer(ada, 'poll-snack', d(10));
    await completeOffer(ada, 'learn-phishing', d(9));
    await completeOffer(ada, 'svy-grocery', d(7));
    await completeOffer(ada, 'fin-zenko', d(5));
    await cashOut(ada, 'paystack_ng', 0.7, d(4), 38);
    await completeOffer(ada, 'svy-sports', d(1));

    progress('demo stories done');
    /* ------------------------------------------------ admin work queues */
    // 1) Payout above the auto-approve limit → manual review.
    const rahul = members.find((m) => m.displayName === 'Rahul Verma')!;
    clock.freeze(now - 7 * DAY);
    await completeOffer(rahul, 'fin-coinhaven', now - 6 * DAY);
    await completeOffer(rahul, 'svy-banking', now - 5 * DAY);
    await completeOffer(rahul, 'fin-creditpath', now - 5 * DAY).catch(() => undefined);
    const rp = await cashOut(rahul, 'upi_in', 1, now - 40 * MINUTE, 0, false).catch(() => null);
    if (rp && rp.status === 'pending') {
      // Staged for the demo: a cash out sitting in the manual review queue.
      await db.update(payouts).set({ status: 'review', statusReason: 'Quick safety review' }).where(eq(payouts.id, rp.id));
      await db.insert(payoutEvents).values({ payoutId: rp.id, status: 'review', message: 'Quick safety review — we aim to finish within 24 hours. No action needed from you.', createdAt: new Date(now - 39 * MINUTE) });
      await db.delete(jobs).where(sql`${jobs.payload}->>'payoutId' = ${rp.id}`);
    }

    // 2) Multi-accounting ring → open fraud case.
    const sharedKey = `seed-ring-${randomToken(6)}`;
    const kevin = await createMember({ name: 'Kevin Lee', country: 'US', email: 'kevin.lee@members.cashads.dev', createdAt: now - 4 * DAY, deviceKey: sharedKey, ip: '203.0.113.7' });
    const kev2 = await createMember({ name: 'Kev L', country: 'US', email: 'kev.l.2024@mailinator.com', createdAt: now - 3 * DAY, deviceKey: sharedKey, ip: '203.0.113.7', refCode: kevin.referralCode });
    await completeOffer(kevin, 'poll-coffee', now - 3 * DAY);
    await completeOffer(kev2, 'poll-coffee', now - 2 * DAY);
    await completeOffer(kev2, 'su-notewise', now - 2 * DAY + 2 * MINUTE);
    await withUow(ctx, async (uow) => {
      await addSignal(uow, kev2.id, 'shared_device', { otherUserIds: [kevin.id] });
      await addSignal(uow, kev2.id, 'disposable_email', { domain: 'mailinator.com' });
      await addSignal(uow, kevin.id, 'shared_device', { otherUserIds: [kev2.id] });
    });
    clock.freeze(now - 20 * HOUR);
    await createTicket(ctx, await reload(kev2.id), {
      subject: 'Why is my cash out under review?',
      category: 'appeal',
      message: 'I live with my brother and we share a laptop. Please review my account, I did nothing wrong.',
    });

    // 3) A synthetic claim in review + a partner reversal.
    const sarah = members.find((m) => m.displayName === 'Sarah Johnson')!;
    clock.freeze(now - 30 * HOUR);
    const sarahFresh = await reload(sarah.id);
    const sarahClick = await withUow(ctx, (uow) => startOffer(uow, sarahFresh, offerIds.get('app-fitflow')!, { ip: null, userAgent: 'seed', deviceId: null }));
    clock.freeze(now - 29 * HOUR);
    const sc = await createClaim(ctx, sarah.id, { clickId: sarahClick.clickId, completedAt: new Date(now - 29 * HOUR - 5 * MINUTE).toISOString(), note: 'Did the full workout, screenshot attached.' });
    await autoCheckClaim(ctx, sc.id);

    const liam = members.find((m) => m.displayName === 'Liam Brown')!;
    const conv = await completeOffer(liam, 'su-petpals', now - 26 * HOUR);
    clock.freeze(now - 10 * HOUR);
    const rev: Record<string, string> = { click_id: conv.clickId, tx_id: conv.txId, payout: '0.6000', status: '2', offer_id: 'su-petpals' };
    rev.sig = signHmacSorted(rev, sandboxSecret);
    await handlePostback(ctx, { networkId: 'demo', method: 'GET', params: rev, fullUrl: 'http://seed.local/api/postback/demo', headers: {}, ip: '10.0.0.1' });

    // 4) Postback log noise every real system sees: forged signature + unknown click.
    clock.freeze(now - 5 * HOUR);
    await handlePostback(ctx, { networkId: 'demo', method: 'GET', params: { click_id: crypto.randomUUID(), tx_id: 'FORGED-1', payout: '50', status: '1', sig: 'deadbeef' }, fullUrl: 'http://seed.local/api/postback/demo', headers: {}, ip: '198.51.100.23' });
    const unknown: Record<string, string> = { click_id: crypto.randomUUID(), tx_id: 'DEMO-UNKNOWN-CLICK', payout: '1.2000', status: '1', offer_id: 'svy-stream' };
    unknown.sig = signHmacSorted(unknown, sandboxSecret);
    await handlePostback(ctx, { networkId: 'demo', method: 'GET', params: unknown, fullUrl: 'http://seed.local/api/postback/demo', headers: {}, ip: '10.0.0.1' });

    // 5) KYC waiting for a human.
    const emma = members.find((m) => m.displayName === 'Emma Wilson')!;
    const dir = path.resolve(ctx.config.DATA_DIR, 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    const ups: string[] = [];
    for (const purpose of ['kyc_document', 'kyc_selfie']) {
      const id = crypto.randomUUID();
      const file = path.join(dir, `${id}.png`);
      fs.writeFileSync(file, PNG_1PX);
      await db.insert(uploads).values({ id, userId: emma.id, purpose, mime: 'image/png', size: PNG_1PX.length, path: file });
      ups.push(id);
    }
    await db.insert(kycSubmissions).values({
      userId: emma.id, documentType: 'passport', documentCountry: 'GB', documentNumberLast4: '4821', documentNumberHash: crypto.randomBytes(16).toString('hex'),
      legalName: 'Emma Wilson', dateOfBirth: '1994-03-12', documentUploadId: ups[0], selfieUploadId: ups[1], status: 'pending', createdAt: new Date(now - 3 * HOUR),
    });
    await db.update(users).set({ kycStatus: 'pending' }).where(eq(users.id, emma.id));

    // 6) Offer reports + an open payout question.
    const streambox = offerIds.get('su-streambox')!;
    for (const m of members.slice(3, 5)) await db.insert(offerReports).values({ userId: m.id, offerId: streambox, reason: 'not_as_described', details: 'The trial asked for a card right away.' });
    await db.update(offers).set({ reportsOpen: 2 }).where(eq(offers.id, streambox));
    clock.freeze(now - 2 * HOUR);
    await createTicket(ctx, await reload(members[6].id), { subject: 'M-Pesa cash out not received yet', category: 'payout', message: 'It says paid but my M-Pesa balance did not change. Can you check the reference?' });
    clock.freeze(now);
    await runDueJobs();
  } finally {
    clock.reset();
  }

  /* Activity days derived from real member actions (powers DAU/MAU & retention cohorts). */
  await db.execute(sql`
    insert into user_activity_days (user_id, day)
    select distinct user_id, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') from transactions
    union select distinct user_id, to_char(started_at at time zone 'UTC', 'YYYY-MM-DD') from offer_clicks
    union select distinct user_id, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') from video_sessions
    union select distinct id, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') from users
    on conflict do nothing`);

  /* Tidy up: seeded history shouldn't flood the demo mailbox or job queue. */
  await db.delete(outboundMessages);
  await db.delete(jobs).where(inArray(jobs.type, ['message.deliver', 'claims.auto_check', 'kyc.auto_review']));
}
