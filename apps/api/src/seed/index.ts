import { eq, sql } from 'drizzle-orm';
import {
  DEFAULT_PREFS,
  TERMS_VERSION,
  getCountry,
  payoutMethodsForCountry,
  splitByBps,
  usd,
} from '@cashads/shared';
import type { AppContext } from '../context';
import type { DbOrTx } from '../db/client';
import {
  adCreatives,
  charities,
  claimEvents,
  claims,
  conversions,
  devices,
  featureRequests,
  featureVotes,
  fraudFlags,
  kycSubmissions,
  networks,
  offerClicks,
  offerRatings,
  offerReports,
  offers,
  payoutEvents,
  payouts,
  postbackLogs,
  referrals,
  settings as settingsTable,
  streaks,
  ticketMessages,
  tickets,
  users,
} from '../db/schema';
import { blindIndex, encrypt, hashPassword, randomToken, referralCode } from '../lib/crypto';
import { DAY, HOUR, MINUTE, localDate, previousDate } from '../lib/time';
import { evaluateAchievements, recomputeTier } from '../modules/engagement/service';
import { recomputeScore } from '../modules/fraud/service';
import { refreshOfferStats } from '../modules/offers/service';
import { SYS, ensureUserAccount, postTransaction, userAccountCode } from '../modules/wallet/ledger';
import { SANDBOX_NETWORKS, SEED_CHARITIES, SEED_CREATIVES, SEED_OFFERS } from './catalog';

/* ── idempotent system data (runs on every boot) ───────────────────────────── */

export async function ensureSystemData(ctx: AppContext): Promise<void> {
  const db = ctx.db;
  for (const n of SANDBOX_NETWORKS) {
    const needsSecret = n.adapter === 'sandboxnet' || n.adapter === 'pangle_ssv';
    await db
      .insert(networks)
      .values({
        id: n.id,
        name: n.name,
        adapter: n.adapter,
        kind: n.kind,
        status: n.status,
        config: n.config as Record<string, unknown>,
        secretEnc: needsSecret ? encrypt(randomToken(24)) : null,
      })
      .onConflictDoNothing();
  }
  for (const c of SEED_CHARITIES) {
    await db
      .insert(charities)
      .values({
        id: c.id,
        name: c.name,
        description: c.description,
        icon: c.icon,
        url: c.url,
        impactUnit: c.impactUnit,
        impactUnitMicros: usd(c.impact),
      })
      .onConflictDoNothing();
  }
  for (const c of SEED_CREATIVES) {
    await db
      .insert(adCreatives)
      .values({
        id: c.id,
        networkId: 'sandbox-ads',
        advertiser: c.advertiser,
        title: c.title,
        tagline: c.tagline,
        durationSeconds: c.durationSeconds,
        revenueMicros: usd(c.revenue),
        lite: c.lite,
        theme: c.theme,
      })
      .onConflictDoNothing();
  }
  if (ctx.config.SANDBOX_MODE) {
    for (const o of SEED_OFFERS) {
      await db
        .insert(offers)
        .values({
          networkId: 'sandboxnet',
          networkOfferId: o.key,
          title: o.title,
          description: o.description,
          advertiser: o.advertiser,
          category: o.category,
          steps: o.steps,
          payoutMicros: usd(o.payout),
          estMinutes: o.minutes,
          dataMb: o.dataMb,
          paySpeed: o.paySpeed,
          countries: o.countries,
          icon: o.icon,
          color: o.color,
          tags: o.tags,
          isLite: o.lite,
          status: o.status ?? 'active',
          statusReason: o.statusReason ?? null,
          statusChangedAt: o.status ? new Date(Date.now() - 3 * DAY) : null,
        })
        .onConflictDoNothing();
    }
    const stored = await db.select().from(settingsTable).where(eq(settingsTable.key, 'platform'));
    if (!stored[0]) {
      // Behind preview proxies every visitor can share an egress IP; IP heuristics would misfire.
      // A shorter claim wait keeps the Missing Credit flow demo-able (production default: 10 min).
      await ctx.settings.update(db, { fraudIpSignals: false, claimMinWaitMinutes: 2 }, null);
    }
  }
}

/* ── demo data (sandbox only, once) ────────────────────────────────────────── */

function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MEMBERS: [string, string][] = [
  ['Chidi', 'NG'],
  ['Amaka', 'NG'],
  ['Tunde', 'NG'],
  ['Zainab', 'NG'],
  ['Ifeoma', 'NG'],
  ['Bayo', 'NG'],
  ['Ngozi', 'NG'],
  ['Emeka', 'NG'],
  ['Halima', 'NG'],
  ['Segun', 'NG'],
  ['Kwame', 'GH'],
  ['Akosua', 'GH'],
  ['Kofi', 'GH'],
  ['Wanjiru', 'KE'],
  ['Otieno', 'KE'],
  ['Achieng', 'KE'],
  ['Thabo', 'ZA'],
  ['Lerato', 'ZA'],
  ['Priya', 'IN'],
  ['Arjun', 'IN'],
  ['Ananya', 'IN'],
  ['Joy', 'PH'],
  ['Paolo', 'PH'],
  ['Maria', 'PH'],
  ['Ana', 'BR'],
  ['Lucas', 'BR'],
  ['Jessica', 'US'],
  ['Marcus', 'US'],
  ['Emily', 'US'],
  ['Oliver', 'GB'],
  ['Amelia', 'GB'],
  ['Liam', 'CA'],
  ['Chloe', 'AU'],
  ['Lukas', 'DE'],
  ['Femi', 'NG'],
  ['Sade', 'NG'],
];

async function insertUser(
  db: DbOrTx,
  v: Partial<typeof users.$inferInsert> & { email: string; country: string },
) {
  const c = getCountry(v.country);
  const [u] = await db
    .insert(users)
    .values({
      timezone: c.timezone,
      displayCurrency: c.currency,
      referralCode: referralCode(),
      prefs: DEFAULT_PREFS,
      termsVersion: TERMS_VERSION,
      termsAcceptedAt: v.createdAt ?? new Date(),
      ...v,
    })
    .returning();
  await ensureUserAccount(db, u!.id);
  return u!;
}

interface OfferRow {
  id: string;
  networkOfferId: string;
  title: string;
  payoutMicros: number;
  estMinutes: number;
  countries: string[];
  status: string;
}

async function seedConversion(
  db: DbOrTx,
  user: { id: string },
  offer: OfferRow,
  at: Date,
  rand: () => number,
  shareBps: number,
) {
  const duration = Math.max(30, Math.round(offer.estMinutes * 60 * (0.7 + rand() * 0.9)));
  const started = new Date(at.getTime() - duration * 1000);
  const [click] = await db
    .insert(offerClicks)
    .values({
      userId: user.id,
      offerId: offer.id,
      status: 'credited',
      startedAt: started,
      creditedAt: at,
      expiresAt: new Date(started.getTime() + 72 * HOUR),
      deviceKey: `seed_${user.id.slice(0, 8)}`,
    })
    .returning();
  const { share, remainder } = splitByBps(offer.payoutMicros, shareBps);
  const txnId = `SBN-SEED-${randomToken(6).toUpperCase()}`;
  const [conv] = await db
    .insert(conversions)
    .values({
      networkId: 'sandboxnet',
      networkTxnId: txnId,
      clickId: click!.id,
      userId: user.id,
      offerId: offer.id,
      title: offer.title,
      payoutMicros: offer.payoutMicros,
      userAmountMicros: share,
      platformAmountMicros: remainder,
      durationSeconds: duration,
      creditedAt: at,
    })
    .returning();
  await db.update(offerClicks).set({ conversionId: conv!.id }).where(eq(offerClicks.id, click!.id));
  await db.insert(postbackLogs).values({
    networkId: 'sandboxnet',
    method: 'GET',
    url: `/api/postback/sandboxnet?click_id=${click!.id}&txn_id=${txnId}`,
    query: {
      click_id: click!.id,
      txn_id: txnId,
      user_id: user.id,
      payout: (offer.payoutMicros / 1e6).toFixed(6),
      status: '1',
    },
    headers: { 'user-agent': 'SandboxNet-Postback/1.0' },
    ip: '10.0.0.10',
    signatureValid: true,
    status: 'processed',
    networkTxnId: txnId,
    clickId: click!.id,
    userId: user.id,
    conversionId: conv!.id,
    processingMs: 12 + Math.floor(rand() * 30),
    createdAt: at,
  });
  const posted = await postTransaction(db, {
    type: 'conversion',
    userId: user.id,
    idempotencyKey: `conversion:${conv!.id}`,
    description: offer.title,
    referenceType: 'conversion',
    referenceId: conv!.id,
    at,
    entries: [
      { account: SYS.networkReceivable('sandboxnet'), direction: 'debit', amount: offer.payoutMicros },
      { account: userAccountCode(user.id), direction: 'credit', amount: share },
      { account: SYS.platformRevenue, direction: 'credit', amount: remainder },
    ],
  });
  await db.update(conversions).set({ ledgerTxnId: posted.id }).where(eq(conversions.id, conv!.id));
  return share;
}

async function seedPayout(
  db: DbOrTx,
  user: { id: string; country: string },
  methodId: string,
  amount: number,
  requestedAt: Date,
  seconds: number,
  fx: Record<string, number>,
  status: 'completed' | 'review' = 'completed',
  reviewReasons: string[] = [],
) {
  const method = payoutMethodsForCountry(user.country).find((m) => m.id === methodId)!;
  const fee = Math.min(
    method.feeCapMicros ?? Number.MAX_SAFE_INTEGER,
    method.feeFixedMicros + Math.ceil((amount * method.feePercentBps) / 10_000),
  );
  const feeCents = fee === 0 ? 0 : Math.ceil(fee / 10_000) * 10_000;
  const completedAt = new Date(requestedAt.getTime() + seconds * 1000);
  const details =
    method.id === 'ng_bank'
      ? { bankCode: '058', accountNumber: `01${Math.floor(10_000_000 + Math.random() * 89_999_999)}` }
      : { email: `member+${user.id.slice(0, 6)}@example.com` };
  const [p] = await db
    .insert(payouts)
    .values({
      userId: user.id,
      methodId,
      detailsEnc: encrypt(JSON.stringify(details)),
      detailsHash: blindIndex(`${methodId}|${JSON.stringify(details)}`),
      destinationMasked:
        method.id === 'ng_bank' ? `GTBank ••••${details.accountNumber!.slice(-4)}` : 'me••••@example.com',
      amountMicros: amount,
      feeMicros: feeCents,
      netMicros: amount - feeCents,
      localCurrency: method.currency,
      fxRate: fx[method.currency] ?? 1,
      status,
      reviewReasons,
      providerReference:
        status === 'completed' ? `SBX-${methodId.toUpperCase()}-${randomToken(5).toUpperCase()}` : null,
      attempts: status === 'completed' ? 1 : 0,
      idempotencyKey: `seed_${randomToken(8)}`,
      requestedAt,
      processingAt: status === 'completed' ? new Date(requestedAt.getTime() + 2000) : null,
      completedAt: status === 'completed' ? completedAt : null,
    })
    .returning();
  await postTransaction(db, {
    type: 'payout_request',
    userId: user.id,
    idempotencyKey: `payout_request:${p!.id}`,
    description: `Cash-out to ${method.name}`,
    referenceType: 'payout',
    referenceId: p!.id,
    at: requestedAt,
    entries: [
      { account: userAccountCode(user.id), direction: 'debit', amount },
      { account: SYS.payoutClearing, direction: 'credit', amount },
    ],
  });
  await db.insert(payoutEvents).values({
    payoutId: p!.id,
    status: 'pending',
    message: `Requested to ${method.name}.`,
    actor: 'user',
    createdAt: requestedAt,
  });
  if (status === 'completed') {
    await postTransaction(db, {
      type: 'payout_complete',
      userId: user.id,
      idempotencyKey: `payout_complete:${p!.id}`,
      description: `Cash-out settled via ${method.provider}`,
      referenceType: 'payout',
      referenceId: p!.id,
      at: completedAt,
      entries: [
        { account: SYS.payoutClearing, direction: 'debit', amount },
        { account: SYS.cash, direction: 'credit', amount },
      ],
    });
    await db.insert(payoutEvents).values([
      {
        payoutId: p!.id,
        status: 'processing',
        message: `Sent to ${method.provider}.`,
        createdAt: new Date(requestedAt.getTime() + 2000),
      },
      { payoutId: p!.id, status: 'completed', message: 'Paid ✓', createdAt: completedAt },
    ]);
  } else {
    await db.insert(payoutEvents).values({
      payoutId: p!.id,
      status: 'review',
      message: `Quick safety review: ${reviewReasons.join('; ')}.`,
      createdAt: requestedAt,
    });
  }
  return p!;
}

export async function seedDemo(ctx: AppContext): Promise<boolean> {
  const db = ctx.db;
  const exists = await db.select({ id: users.id }).from(users).where(eq(users.email, ctx.config.DEMO_EMAIL));
  if (exists[0]) return false;
  ctx.log.info('Seeding sandbox demo data…');
  const rand = prng(20261005);
  const settings = ctx.settings.get();
  const share = settings.revenueShareBps;
  const fx = settings.fxRates;
  const now = Date.now();
  const allOffers = (await db.select().from(offers)) as unknown as OfferRow[];
  const active = allOffers.filter((o) => o.status === 'active');
  const forCountry = (c: string) => active.filter((o) => o.countries.length === 0 || o.countries.includes(c));
  const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)]!;

  const [adminHash, demoHash] = await Promise.all([
    hashPassword(ctx.config.ADMIN_PASSWORD),
    hashPassword(ctx.config.DEMO_PASSWORD),
  ]);

  await insertUser(db, {
    email: ctx.config.ADMIN_EMAIL,
    passwordHash: adminHash,
    country: 'NG',
    role: 'admin',
    displayName: 'CashAds Ops',
    emailVerifiedAt: new Date(now - 60 * DAY),
    createdAt: new Date(now - 60 * DAY),
    isDemo: true,
  });

  // Synthetic members with realistic, ledger-backed histories.
  const members: (typeof users.$inferSelect)[] = [];
  for (const [i, [name, country]] of MEMBERS.entries()) {
    const ageDays = 3 + Math.floor(rand() * 38);
    const optIn = rand() < 0.45;
    const u = await insertUser(db, {
      email: `${name.toLowerCase()}.${i}@demo.cashads.local`,
      country,
      displayName: optIn ? `${name} ${String.fromCharCode(65 + Math.floor(rand() * 26))}.` : null,
      prefs: { ...DEFAULT_PREFS, leaderboardOptIn: optIn, showOnPayoutWall: optIn },
      emailVerifiedAt: new Date(now - ageDays * DAY + HOUR),
      phoneVerifiedAt: rand() < 0.6 ? new Date(now - ageDays * DAY + 2 * HOUR) : null,
      createdAt: new Date(now - ageDays * DAY),
      lastSeenAt: new Date(now - Math.floor(rand() * 3 * DAY)),
      isDemo: true,
    });
    members.push(u);
    const pool = forCountry(country);
    let earned = 0;
    const n = 2 + Math.floor(rand() * 9);
    for (let k = 0; k < n; k++) {
      const offer = pick(pool);
      const at = new Date(u.createdAt.getTime() + rand() * (now - u.createdAt.getTime() - HOUR));
      earned += await seedConversion(db, u, offer, at, rand, share);
    }
    const methods = payoutMethodsForCountry(country).filter((m) => m.minMicros <= usd(1));
    const payoutsN = Math.floor(rand() * 3);
    let spent = 0;
    for (let k = 0; k < payoutsN; k++) {
      const amount = Math.floor(((earned - spent) * (0.3 + rand() * 0.5)) / 10_000) * 10_000;
      const method = pick(methods);
      if (amount < Math.max(method.minMicros, usd(0.1))) break;
      const roll = rand();
      const seconds =
        roll < 0.7
          ? 25 + Math.floor(rand() * 150)
          : roll < 0.92
            ? 180 + Math.floor(rand() * 720)
            : 3600 + Math.floor(rand() * 20_000);
      const requestedAt = new Date(now - Math.floor(rand() * 20 * DAY) - HOUR);
      await seedPayout(db, u, method.id, amount, requestedAt, seconds, fx);
      spent += amount;
    }
    if (rand() < 0.5) {
      const today = localDate(u.timezone);
      const current = 1 + Math.floor(rand() * 9);
      await db.insert(streaks).values({
        userId: u.id,
        current,
        longest: current + Math.floor(rand() * 4),
        lastClaimDate: rand() < 0.5 ? today : previousDate(today),
      });
    }
  }

  // The demo account you sign in with.
  const demoCreated = new Date(now - 12 * DAY);
  const demo = await insertUser(db, {
    email: ctx.config.DEMO_EMAIL,
    passwordHash: demoHash,
    country: 'NG',
    displayName: 'Demo Earner',
    emailVerifiedAt: new Date(demoCreated.getTime() + 10 * MINUTE),
    createdAt: demoCreated,
    prefs: {
      ...DEFAULT_PREFS,
      leaderboardOptIn: true,
      savingsGoalMicros: usd(10),
      savingsGoalLabel: 'New phone fund',
    },
    isDemo: true,
  });
  await db.insert(devices).values({
    userId: demo.id,
    deviceKey: 'seed_demo_device',
    label: 'Chrome on Android',
    lastIp: '102.89.1.10',
    firstSeenAt: demoCreated,
  });
  const demoPool = forCountry('NG');
  const demoOffers = [
    'svy-shopping-2026',
    'svy-mobile-money',
    'svy-food-quick',
    'sgn-jobbridge',
    'app-sandboxpay',
    'svy-ad-concepts',
  ]
    .map((k) => demoPool.find((o) => o.networkOfferId === k))
    .filter((o): o is OfferRow => Boolean(o));
  for (const [i, offer] of demoOffers.entries()) {
    await seedConversion(db, demo, offer, new Date(demoCreated.getTime() + (i + 1) * 1.6 * DAY), rand, share);
  }
  await postTransaction(db, {
    type: 'bonus_first_task',
    userId: demo.id,
    idempotencyKey: `first_task:${demo.id}`,
    description: 'First-task bonus — welcome to CashAds!',
    at: new Date(demoCreated.getTime() + 1.6 * DAY),
    entries: [
      { account: SYS.bonusExpense, direction: 'debit', amount: settings.firstTaskBonusMicros },
      { account: userAccountCode(demo.id), direction: 'credit', amount: settings.firstTaskBonusMicros },
    ],
  });
  await seedPayout(db, demo, 'ng_bank', usd(2), new Date(now - 4 * DAY), 112, fx);
  const demoToday = localDate(demo.timezone);
  await db
    .insert(streaks)
    .values({ userId: demo.id, current: 3, longest: 5, lastClaimDate: previousDate(demoToday) });
  // A task the demo user reported as finished that's still awaiting the network.
  const pendingOffer = demoPool.find((o) => o.networkOfferId === 'svy-streaming');
  if (pendingOffer) {
    await db.insert(offerClicks).values({
      userId: demo.id,
      offerId: pendingOffer.id,
      status: 'reported',
      startedAt: new Date(now - 40 * MINUTE),
      reportedAt: new Date(now - 30 * MINUTE),
      expiresAt: new Date(now + 70 * HOUR),
      deviceKey: 'seed_demo_device',
    });
  }
  // A friend the demo user referred (qualified → both got the bonus).
  const friend = members[1]!;
  await db.update(users).set({ referredBy: demo.id }).where(eq(users.id, friend.id));
  const [ref] = await db
    .insert(referrals)
    .values({
      referrerId: demo.id,
      refereeId: friend.id,
      status: 'qualified',
      qualifiedAt: new Date(now - 6 * DAY),
      createdAt: new Date(now - 8 * DAY),
    })
    .returning();
  for (const uid of [demo.id, friend.id]) {
    await postTransaction(db, {
      type: 'bonus_referral',
      userId: uid,
      idempotencyKey: `referral_bonus:${ref!.id}:${uid}`,
      description:
        uid === demo.id
          ? 'Referral bonus — your friend completed their first task'
          : 'Welcome bonus for joining with a referral',
      referenceType: 'referral',
      referenceId: ref!.id,
      at: new Date(now - 6 * DAY),
      entries: [
        { account: SYS.bonusExpense, direction: 'debit', amount: settings.referralBonusMicros },
        { account: userAccountCode(uid), direction: 'credit', amount: settings.referralBonusMicros },
      ],
    });
  }

  // Operations queues so the admin console has real work to show.
  const suspicious = members[5]!;
  await db.insert(devices).values([
    {
      userId: suspicious.id,
      deviceKey: 'seed_shared_device',
      label: 'Chrome on Android',
      lastIp: '102.89.3.77',
    },
    {
      userId: members[6]!.id,
      deviceKey: 'seed_shared_device',
      label: 'Chrome on Android',
      lastIp: '102.89.3.77',
    },
  ]);
  await db.insert(fraudFlags).values({
    userId: suspicious.id,
    type: 'shared_device',
    severity: 25,
    details: { otherAccounts: [members[6]!.id] },
  });
  await db.insert(fraudFlags).values({
    userId: suspicious.id,
    type: 'too_fast',
    severity: 10,
    details: { durationSeconds: 21, expectedSeconds: 420 },
  });
  await recomputeScore(ctx, db, suspicious.id);
  await seedPayout(
    db,
    suspicious,
    payoutMethodsForCountry('NG')[0]!.id,
    usd(0.5),
    new Date(now - 3 * HOUR),
    0,
    fx,
    'review',
    ['This device has also been used by another account', 'Some tasks were completed unusually fast'],
  );

  const banned = members[9]!;
  await db
    .update(users)
    .set({
      status: 'banned',
      banReasonCode: 'multi_account',
      banMessage:
        'Three accounts were created from the same phone within an hour and cashed out to one bank account.',
      bannedAt: new Date(now - DAY),
      balanceFrozen: true,
    })
    .where(eq(users.id, banned.id));
  const [appeal] = await db
    .insert(tickets)
    .values({
      userId: banned.id,
      email: banned.email,
      subject: 'Account restriction appeal',
      category: 'appeal',
      priority: 'high',
      slaDueAt: new Date(now + 60 * HOUR),
      createdAt: new Date(now - 12 * HOUR),
    })
    .returning();
  await db.insert(ticketMessages).values([
    {
      ticketId: appeal!.id,
      authorType: 'user',
      authorId: banned.id,
      body: 'My brothers and I share one phone at home. We each have our own bank account — I can send proof.',
      createdAt: new Date(now - 12 * HOUR),
    },
    {
      ticketId: appeal!.id,
      authorType: 'system',
      body: 'Thanks — a person will review your appeal within 72 hours.',
      createdAt: new Date(now - 12 * HOUR),
    },
  ]);
  const [ticket] = await db
    .insert(tickets)
    .values({
      userId: members[2]!.id,
      email: members[2]!.email,
      subject: 'How long does Paystack take?',
      category: 'payout',
      slaDueAt: new Date(now + 20 * HOUR),
      createdAt: new Date(now - 4 * HOUR),
    })
    .returning();
  await db.insert(ticketMessages).values({
    ticketId: ticket!.id,
    authorType: 'user',
    authorId: members[2]!.id,
    body: 'My first cash-out arrived in 2 minutes — is it always this fast? Great app!',
    createdAt: new Date(now - 4 * HOUR),
  });

  // A claim waiting for a human, and one paid as goodwill.
  const claimant = members[3]!;
  const claimOffer = forCountry(claimant.country)[0]!;
  const [cClick] = await db
    .insert(offerClicks)
    .values({
      userId: claimant.id,
      offerId: claimOffer.id,
      status: 'claimed',
      startedAt: new Date(now - 26 * HOUR),
      reportedAt: new Date(now - 25 * HOUR),
      expiresAt: new Date(now + 46 * HOUR),
    })
    .returning();
  const [claim] = await db
    .insert(claims)
    .values({
      userId: claimant.id,
      clickId: cClick!.id,
      offerId: claimOffer.id,
      status: 'needs_review',
      amountMicros: splitByBps(claimOffer.payoutMicros, share).share,
      note: 'Finished the survey and saw the thank-you page, but it never showed up.',
      slaDueAt: new Date(now + 5 * HOUR),
      createdAt: new Date(now - 19 * HOUR),
    })
    .returning();
  await db.insert(claimEvents).values([
    {
      claimId: claim!.id,
      type: 'submitted',
      message: 'Claim received. Checking automatically now…',
      createdAt: new Date(now - 19 * HOUR),
    },
    {
      claimId: claim!.id,
      type: 'network_no_record',
      message: 'SandboxNet has no record of the completion yet.',
      createdAt: new Date(now - 19 * HOUR),
    },
    {
      claimId: claim!.id,
      type: 'needs_review',
      message: 'A person will review this within 24 hours.',
      createdAt: new Date(now - 19 * HOUR),
    },
  ]);

  // A few failed postbacks so reliability metrics are honest, not perfect.
  await db.insert(postbackLogs).values([
    {
      networkId: 'sandboxnet',
      method: 'GET',
      url: '/api/postback/sandboxnet?txn_id=SBN-FORGED',
      query: { txn_id: 'SBN-FORGED' },
      ip: '45.79.10.1',
      signatureValid: false,
      status: 'rejected',
      errorCode: 'bad_signature',
      errorMessage: 'Signature verification failed',
      createdAt: new Date(now - 2 * DAY),
    },
    {
      networkId: 'sandboxnet',
      method: 'GET',
      url: '/api/postback/sandboxnet?txn_id=SBN-UNKNOWN',
      query: { txn_id: 'SBN-UNKNOWN' },
      ip: '10.0.0.10',
      signatureValid: true,
      status: 'rejected',
      errorCode: 'unknown_click',
      errorMessage: 'Click not found',
      createdAt: new Date(now - 5 * DAY),
    },
  ]);

  // Community: reports, ratings, ideas.
  const scam = allOffers.find((o) => o.networkOfferId === 'scam-vip-unlock');
  const spam = allOffers.find((o) => o.networkOfferId === 'spam-dealz');
  for (const [i, m] of members.slice(10, 17).entries()) {
    if (scam) {
      await db.insert(offerClicks).values({
        userId: m.id,
        offerId: scam.id,
        status: 'expired',
        startedAt: new Date(now - (5 + i) * DAY),
        expiresAt: new Date(now - (2 + i) * DAY),
      });
      await db.insert(offerReports).values({
        userId: m.id,
        offerId: scam.id,
        reason: 'scam',
        details: 'Asked me to pay an unlock fee first.',
        status: 'actioned',
        createdAt: new Date(now - (4 + i) * DAY),
      });
    }
  }
  for (const m of members.slice(17, 20)) {
    if (spam) {
      await db.insert(offerClicks).values({
        userId: m.id,
        offerId: spam.id,
        status: 'expired',
        startedAt: new Date(now - 2 * DAY),
        expiresAt: new Date(now - DAY),
      });
      await db.insert(offerReports).values({
        userId: m.id,
        offerId: spam.id,
        reason: 'spam',
        details: 'Started sending me SMS spam daily.',
        createdAt: new Date(now - DAY),
      });
    }
  }
  for (const m of members.slice(0, 20)) {
    const ratedOffer = (
      await db
        .select({ offerId: conversions.offerId })
        .from(conversions)
        .where(eq(conversions.userId, m.id))
        .limit(1)
    )[0];
    if (ratedOffer?.offerId)
      await db
        .insert(offerRatings)
        .values({ userId: m.id, offerId: ratedOffer.offerId, value: rand() < 0.85 ? 1 : -1 })
        .onConflictDoNothing();
  }
  const ideas: [string, string, 'open' | 'planned' | 'in_progress' | 'shipped', number][] = [
    ['Cash out to airtime and data', 'Small balances are perfect for topping up my line.', 'shipped', 41],
    ['Hausa and Yoruba language support', 'My parents would use it if it were in Hausa.', 'planned', 33],
    ['Offline mode for quick polls', 'Queue answers when my data is off and sync later.', 'in_progress', 27],
    ['Weekly earnings goal reminders', 'Remind me on Friday how close I am to my goal.', 'open', 15],
    ['Team charity challenges', 'Let friends pool donations for one cause.', 'open', 9],
  ];
  for (const [i, [title, body, status, votes]] of ideas.entries()) {
    const author = members[i * 3]!;
    const [fr] = await db
      .insert(featureRequests)
      .values({
        userId: author.id,
        title,
        body,
        status,
        votes,
        shippedAt: status === 'shipped' ? new Date(now - 10 * DAY) : null,
        createdAt: new Date(now - (20 - i) * DAY),
      })
      .returning();
    await db.insert(featureVotes).values({ userId: author.id, requestId: fr!.id }).onConflictDoNothing();
  }
  await db.insert(kycSubmissions).values({
    userId: members[27]!.id,
    idType: 'drivers_license',
    idNumberEnc: encrypt('D1234-5678-9012'),
    idNumberMasked: '••••9012',
    fullName: 'Marcus Reed',
    dateOfBirth: '1994-03-14',
  });
  await db.update(users).set({ kycStatus: 'pending' }).where(eq(users.id, members[27]!.id));

  // Real offers don't convert 100% of the time: add abandoned clicks so completion
  // rates (and therefore quality grades) vary realistically between offers.
  const ABANDON = [0.15, 0.35, 0.6, 1.1, 2.2];
  for (const [i, o] of active.entries()) {
    const convs =
      (
        await db
          .select({ n: sql<number>`count(*)::int` })
          .from(conversions)
          .where(eq(conversions.offerId, o.id))
      )[0]?.n ?? 0;
    const abandoned = Math.round(convs * ABANDON[i % ABANDON.length]!);
    for (let k = 0; k < abandoned; k++) {
      const m = pick(members);
      const started = new Date(now - (2 + rand() * 30) * DAY);
      await db.insert(offerClicks).values({
        userId: m.id,
        offerId: o.id,
        status: 'expired',
        startedAt: started,
        expiresAt: new Date(started.getTime() + 72 * HOUR),
      });
    }
    if (i % ABANDON.length === 4) {
      for (const m of members.slice(20, 24))
        await db
          .insert(offerRatings)
          .values({ userId: m.id, offerId: o.id, value: -1 })
          .onConflictDoNothing();
    }
  }
  for (const o of allOffers) await refreshOfferStats(db, o.id);
  for (const u of [...members, demo]) {
    await evaluateAchievementsQuiet(ctx, u.id);
    await recomputeTier(ctx, db, u.id);
  }
  // Achievement notifications from seeding would be noise.
  await db.execute(sql`delete from notifications where type in ('achievement', 'tier_up')`);
  ctx.log.info({ members: members.length }, 'Demo data ready');
  return true;
}

async function evaluateAchievementsQuiet(ctx: AppContext, userId: string): Promise<void> {
  await evaluateAchievements(ctx, ctx.db, userId);
}

export async function phoneHashFor(phone: string): Promise<string> {
  return blindIndex(phone);
}
