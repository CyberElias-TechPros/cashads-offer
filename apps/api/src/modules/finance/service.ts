import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  type CharityDTO,
  type KycDTO,
  type TaxSummaryDTO,
  formatUsd,
  us1099ThresholdMicros,
} from '@cashads/shared';
import type { AppContext } from '../../context';
import { charities, donations, kycSubmissions, users } from '../../db/schema';
import type { UserRow } from '../../http/auth';
import { encrypt, randomToken } from '../../lib/crypto';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { maskTail } from '../../lib/net';
import { audit, notify } from '../platform/messaging';
import {
  BONUS_TXN_TYPES,
  EARNING_TXN_TYPES,
  SYS,
  getAvailableMicros,
  postTransaction,
  userAccountCode,
} from '../wallet/ledger';

/* ── charity: earn for a cause (pain point #15) ────────────────────────────── */

export async function listCharities(ctx: AppContext, userId: string): Promise<CharityDTO[]> {
  const rows = await ctx.db.select().from(charities).where(eq(charities.active, true));
  const totals = await ctx.db
    .select({
      charityId: donations.charityId,
      total: sql<string>`sum(${donations.amountMicros})`,
      mine: sql<string>`sum(case when ${donations.userId} = ${userId} then ${donations.amountMicros} else 0 end)`,
    })
    .from(donations)
    .groupBy(donations.charityId);
  const by = new Map(totals.map((t) => [t.charityId, t]));
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    icon: c.icon,
    url: c.url,
    impactUnit: c.impactUnit,
    impactUnitMicros: c.impactUnitMicros,
    totalDonatedMicros: Number(by.get(c.id)?.total ?? 0),
    myDonatedMicros: Number(by.get(c.id)?.mine ?? 0),
  }));
}

export async function donate(
  ctx: AppContext,
  user: UserRow,
  charityId: string,
  amountMicros: number,
): Promise<void> {
  const charity = (await ctx.db.select().from(charities).where(eq(charities.id, charityId)))[0];
  if (!charity || !charity.active) throw notFound('Cause');
  if (amountMicros < 10_000) throw badRequest('MIN_DONATION', 'The smallest donation is $0.01');
  await ctx.db.transaction(async (tx) => {
    const posted = await postTransaction(tx, {
      type: 'charity_donation',
      userId: user.id,
      idempotencyKey: `donation:manual:${user.id}:${randomToken(8)}`,
      description: `Donation to ${charity.name}`,
      referenceType: 'charity',
      referenceId: charity.id,
      entries: [
        { account: userAccountCode(user.id), direction: 'debit', amount: amountMicros },
        { account: SYS.charityPayable(charity.id), direction: 'credit', amount: amountMicros },
      ],
    });
    await tx
      .insert(donations)
      .values({ userId: user.id, charityId, amountMicros, source: 'manual', ledgerTxnId: posted.id });
    await ctx.jobs.enqueue(tx, 'engagement.achievements', { userId: user.id });
  });
  const units = Math.floor(amountMicros / charity.impactUnitMicros);
  await notify(ctx, ctx.db, user.id, {
    type: 'donation',
    title: `💚 Thank you for donating ${formatUsd(amountMicros)}`,
    body:
      units > 0
        ? `That’s ${units} ${charity.impactUnit}${units === 1 ? '' : 's'} with ${charity.name}.`
        : `Every cent adds up at ${charity.name}.`,
    link: '/app/charity',
  });
  ctx.events.toUser(user.id, 'balance', { reason: 'donation' });
}

/* ── tax centre (pain point #12) ───────────────────────────────────────────── */

export async function taxSummary(ctx: AppContext, user: UserRow, year: number): Promise<TaxSummaryDTO> {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));
  const types = (list: string[]) =>
    sql.join(
      list.map((t) => sql`${t}`),
      sql`, `,
    );
  const res = await ctx.db.execute<{
    month: number;
    earnings: string;
    bonuses: string;
    payouts: string;
    donations: string;
  }>(sql`
    select extract(month from t.created_at)::int as month,
      coalesce(sum(case when t.type in (${types(EARNING_TXN_TYPES)}) and e.direction = 'credit' then e.amount_micros end), 0) as earnings,
      coalesce(sum(case when t.type in (${types(BONUS_TXN_TYPES)}) and e.direction = 'credit' then e.amount_micros end), 0) as bonuses,
      coalesce(sum(case when t.type = 'payout_request' then e.amount_micros end), 0) - coalesce(sum(case when t.type = 'payout_refund' then e.amount_micros end), 0) as payouts,
      coalesce(sum(case when t.type = 'charity_donation' then e.amount_micros end), 0) as donations
    from ledger_entries e
    join ledger_transactions t on t.id = e.transaction_id
    join ledger_accounts a on a.id = e.account_id and a.code = ${userAccountCode(user.id)}
    where t.created_at >= ${start} and t.created_at < ${end}
    group by 1 order by 1`);
  const byMonth = Array.from({ length: 12 }, (_, i) => {
    const r = res.rows.find((x) => Number(x.month) === i + 1);
    return {
      month: i + 1,
      earningsMicros: Number(r?.earnings ?? 0) + Number(r?.bonuses ?? 0),
      payoutsMicros: Number(r?.payouts ?? 0),
    };
  });
  const totals = res.rows.reduce(
    (acc, r) => ({
      earningsMicros: acc.earningsMicros + Number(r.earnings),
      bonusesMicros: acc.bonusesMicros + Number(r.bonuses),
      payoutsMicros: acc.payoutsMicros + Number(r.payouts),
      donationsMicros: acc.donationsMicros + Number(r.donations),
    }),
    { earningsMicros: 0, bonusesMicros: 0, payoutsMicros: 0, donationsMicros: 0 },
  );
  const threshold = us1099ThresholdMicros(year);
  const reportable = totals.earningsMicros + totals.bonusesMicros;
  const notes: string[] = [];
  if (user.country === 'US') {
    notes.push(
      `For ${year}, platforms issue Form 1099-MISC when a member’s rewards reach ${formatUsd(threshold, { precision: 0 })} in the calendar year${year >= 2026 ? ' (raised from $600 by the One Big Beautiful Bill Act for payments after 2025)' : ''}.`,
      'Rewards may be taxable income even below the reporting threshold. Keep this summary with your records.',
    );
  } else if (user.country === 'NG') {
    notes.push(
      'In Nigeria, online earnings may be part of your personal income. Keep this statement for your records and ask a tax adviser about your situation.',
    );
  } else {
    notes.push(
      'Rewards may count as income where you live. Keep this statement for your records and consult a local tax adviser.',
    );
  }
  notes.push('This summary is provided for convenience and is not tax advice.');
  return {
    year,
    country: user.country,
    totals,
    byMonth,
    us1099: {
      applicable: user.country === 'US',
      thresholdMicros: threshold,
      reportableMicros: reportable,
      likely: user.country === 'US' && reportable >= threshold,
    },
    notes,
  };
}

export function taxCsv(summary: TaxSummaryDTO): string {
  const d = (m: number) => (m / 1_000_000).toFixed(2);
  const lines = [
    'month,earnings_usd,payouts_usd',
    ...summary.byMonth.map(
      (m) =>
        `${summary.year}-${String(m.month).padStart(2, '0')},${d(m.earningsMicros)},${d(m.payoutsMicros)}`,
    ),
  ];
  lines.push(
    `total,${d(summary.totals.earningsMicros + summary.totals.bonusesMicros)},${d(summary.totals.payoutsMicros)}`,
  );
  return `${lines.join('\n')}\n`;
}

/* ── KYC (only when a single cash-out exceeds the threshold) ───────────────── */

const ALLOWED_MIME = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['application/pdf', 'pdf'],
]);

export async function storeUpload(
  ctx: AppContext,
  buffer: Buffer,
  mime: string,
  prefix: string,
): Promise<string> {
  const ext = ALLOWED_MIME.get(mime);
  if (!ext) throw badRequest('INVALID_FILE', 'Upload a JPG, PNG, WEBP or PDF');
  if (buffer.length > 5 * 1024 * 1024) throw badRequest('FILE_TOO_LARGE', 'Files must be 5 MB or smaller');
  const dir = path.resolve(ctx.config.UPLOAD_DIR, prefix);
  await mkdir(dir, { recursive: true });
  const name = `${randomToken(16)}.${ext}`;
  await writeFile(path.join(dir, name), buffer, { mode: 0o600 });
  return `${prefix}/${name}`;
}

export async function getKyc(ctx: AppContext, user: UserRow): Promise<KycDTO> {
  const rows = await ctx.db
    .select()
    .from(kycSubmissions)
    .where(eq(kycSubmissions.userId, user.id))
    .orderBy(desc(kycSubmissions.createdAt))
    .limit(1);
  const s = rows[0];
  return {
    status: user.kycStatus,
    idType: s?.idType ?? null,
    idNumberMasked: s?.idNumberMasked ?? null,
    submittedAt: s?.createdAt.toISOString() ?? null,
    reviewedAt: s?.reviewedAt?.toISOString() ?? null,
    reviewerNote: s?.reviewerNote ?? null,
  };
}

export async function submitKyc(
  ctx: AppContext,
  user: UserRow,
  input: { idType: string; idNumber: string; fullName: string; dateOfBirth: string },
  files: { document?: string | undefined; selfie?: string | undefined },
): Promise<KycDTO> {
  if (user.kycStatus === 'verified') throw conflict('ALREADY_VERIFIED', 'Your identity is already verified');
  if (user.kycStatus === 'pending') throw conflict('KYC_PENDING', 'Your documents are being reviewed');
  const dob = new Date(`${input.dateOfBirth}T00:00:00Z`);
  const age = (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (!(age >= 18 && age < 120))
    throw badRequest('INVALID_DOB', 'You must be 18 or older', { dateOfBirth: 'You must be 18+' });
  await ctx.db.transaction(async (tx) => {
    await tx.insert(kycSubmissions).values({
      userId: user.id,
      idType: input.idType,
      idNumberEnc: encrypt(input.idNumber),
      idNumberMasked: maskTail(input.idNumber),
      fullName: input.fullName,
      dateOfBirth: input.dateOfBirth,
      documentPath: files.document ?? null,
      selfiePath: files.selfie ?? null,
    });
    await tx
      .update(users)
      .set({ kycStatus: 'pending', fullName: input.fullName, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    if (ctx.config.SANDBOX_MODE)
      await ctx.jobs.enqueue(
        tx,
        'sandbox.kyc_review',
        { userId: user.id },
        { delayMs: ctx.config.isTest ? 0 : 4_000 },
      );
  });
  const fresh = (await ctx.db.select().from(users).where(eq(users.id, user.id)))[0]!;
  return getKyc(ctx, fresh);
}

export async function decideKyc(
  ctx: AppContext,
  submissionId: string,
  decision: 'verified' | 'rejected',
  note: string | undefined,
  actorId: string | null,
  ip?: string,
): Promise<void> {
  const sub = (await ctx.db.select().from(kycSubmissions).where(eq(kycSubmissions.id, submissionId)))[0];
  if (!sub) throw notFound('Submission');
  if (sub.status !== 'pending') throw conflict('ALREADY_DECIDED', 'This submission was already reviewed');
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(kycSubmissions)
      .set({ status: decision, reviewerNote: note ?? null, reviewedBy: actorId, reviewedAt: new Date() })
      .where(eq(kycSubmissions.id, submissionId));
    await tx
      .update(users)
      .set({ kycStatus: decision, updatedAt: new Date() })
      .where(eq(users.id, sub.userId));
    if (actorId)
      await audit(tx, {
        actorId,
        action: `kyc.${decision}`,
        targetType: 'user',
        targetId: sub.userId,
        ip: ip ?? null,
      });
    await notify(ctx, tx, sub.userId, {
      type: 'kyc',
      title: decision === 'verified' ? 'Identity verified ✅' : 'Identity check: we need another look',
      body:
        decision === 'verified'
          ? 'Larger cash-outs are now unlocked.'
          : `${note ?? 'The document was unclear.'} You can resubmit from the verification page.`,
      link: '/app/kyc',
      email: { category: 'security' },
    });
    if (decision === 'rejected')
      await tx.update(users).set({ kycStatus: 'rejected' }).where(eq(users.id, sub.userId));
  });
}

export async function latestPendingKyc(ctx: AppContext, userId: string) {
  const rows = await ctx.db
    .select()
    .from(kycSubmissions)
    .where(and(eq(kycSubmissions.userId, userId), eq(kycSubmissions.status, 'pending')))
    .orderBy(desc(kycSubmissions.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function walletSnapshot(ctx: AppContext, userId: string) {
  return { available: await getAvailableMicros(ctx.db, userId) };
}
