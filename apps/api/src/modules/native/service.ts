import { and, desc, eq, gt, sql } from 'drizzle-orm';
import {
  LESSONS,
  type LessonDTO,
  type LessonSummaryDTO,
  POLLS,
  type PollDTO,
  getLesson,
  getPoll,
} from '@cashads/shared';
import type { AppContext } from '../../context';
import { lessonAttempts, pollResponses } from '../../db/schema';
import type { ClientInfo, UserRow } from '../../http/auth';
import { AppError, conflict, notFound, tooMany } from '../../lib/errors';
import { MINUTE } from '../../lib/time';
import { acquireEarningLock } from '../ads/service';
import { recordSignal } from '../fraud/service';
import { creditNative } from '../rewards/service';

/* ── quick polls ("while you wait" micro-task mode) ────────────────────────── */

const MIN_SECONDS_BETWEEN_POLLS = 4;

export async function nextPoll(ctx: AppContext, user: UserRow): Promise<PollDTO | null> {
  const answered = await ctx.db
    .select({ pollId: pollResponses.pollId })
    .from(pollResponses)
    .where(eq(pollResponses.userId, user.id));
  const done = new Set(answered.map((a) => a.pollId));
  const remaining = POLLS.filter((p) => !done.has(p.id));
  if (remaining.length === 0) return null;
  // Deterministic-but-varied order per member so refreshes don't reshuffle.
  const poll = [...remaining].sort((a, b) => hash(user.id + a.id) - hash(user.id + b.id))[0]!;
  return {
    id: poll.id,
    question: poll.question,
    options: poll.options,
    rewardMicros: poll.rewardMicros,
    sponsor: poll.sponsor,
    estSeconds: poll.estSeconds,
    remaining: remaining.length,
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export async function answerPoll(
  ctx: AppContext,
  user: UserRow,
  client: ClientInfo,
  pollId: string,
  optionIndex: number,
): Promise<{ rewardMicros: number; distribution: number[]; next: PollDTO | null }> {
  const poll = getPoll(pollId);
  if (!poll) throw notFound('Quick task');
  if (optionIndex >= poll.options.length)
    throw new AppError(400, 'INVALID_OPTION', 'Pick one of the options');
  await ctx.db.transaction(async (tx) => {
    await acquireEarningLock(tx, user.id, client);
    const last = await tx
      .select({ createdAt: pollResponses.createdAt })
      .from(pollResponses)
      .where(eq(pollResponses.userId, user.id))
      .orderBy(desc(pollResponses.createdAt))
      .limit(1);
    if (last[0] && Date.now() - last[0].createdAt.getTime() < MIN_SECONDS_BETWEEN_POLLS * 1000) {
      await recordSignal(ctx, tx, user.id, 'poll_speed', { pollId });
      throw tooMany('Slow down a little — read each question before answering.');
    }
    const inserted = await tx
      .insert(pollResponses)
      .values({ userId: user.id, pollId, optionIndex, rewardMicros: poll.rewardMicros })
      .onConflictDoNothing()
      .returning();
    if (!inserted[0]) throw conflict('ALREADY_ANSWERED', 'You already answered this one.');
    const txnId = await creditNative(ctx, tx, {
      type: 'poll_reward',
      userId: user.id,
      networkId: 'pollnet',
      sponsorPayoutMicros: poll.sponsorPayoutMicros,
      userAmountMicros: poll.rewardMicros,
      idempotencyKey: `poll:${user.id}:${pollId}`,
      description: `Quick task — ${poll.sponsor.replace(' (sandbox)', '')}`,
      referenceType: 'poll',
      referenceId: pollId,
    });
    await tx
      .update(pollResponses)
      .set({ ledgerTxnId: txnId })
      .where(and(eq(pollResponses.userId, user.id), eq(pollResponses.pollId, pollId)));
    await ctx.jobs.enqueue(tx, 'earning.after', {
      userId: user.id,
      kind: 'poll',
      amountMicros: poll.rewardMicros,
      sourceKey: `poll:${user.id}:${pollId}`,
    });
  });
  ctx.events.toUser(user.id, 'reward', {
    kind: 'poll',
    amountMicros: poll.rewardMicros,
    title: 'Quick task',
  });
  const dist = await ctx.db
    .select({ optionIndex: pollResponses.optionIndex, n: sql<number>`count(*)::int` })
    .from(pollResponses)
    .where(eq(pollResponses.pollId, pollId))
    .groupBy(pollResponses.optionIndex);
  const total = dist.reduce((s, d) => s + d.n, 0);
  const distribution = poll.options.map((_, i) =>
    Math.round(((dist.find((d) => d.optionIndex === i)?.n ?? 0) / Math.max(1, total)) * 100),
  );
  return { rewardMicros: poll.rewardMicros, distribution, next: await nextPoll(ctx, user) };
}

/* ── earn + learn ──────────────────────────────────────────────────────────── */

const LESSON_RETRY_COOLDOWN = 2 * MINUTE;

export async function listLessons(ctx: AppContext, user: UserRow): Promise<LessonSummaryDTO[]> {
  const passed = await ctx.db
    .select({ lessonId: lessonAttempts.lessonId })
    .from(lessonAttempts)
    .where(and(eq(lessonAttempts.userId, user.id), eq(lessonAttempts.passed, true)));
  const set = new Set(passed.map((p) => p.lessonId));
  return LESSONS.map((l) => ({
    id: l.id,
    title: l.title,
    summary: l.summary,
    icon: l.icon,
    minutes: l.minutes,
    rewardMicros: l.rewardMicros,
    sponsor: l.sponsor,
    passed: set.has(l.id),
  }));
}

export async function getLessonDTO(ctx: AppContext, user: UserRow, lessonId: string): Promise<LessonDTO> {
  const lesson = getLesson(lessonId);
  if (!lesson) throw notFound('Lesson');
  const summaries = await listLessons(ctx, user);
  const summary = summaries.find((s) => s.id === lessonId)!;
  return {
    ...summary,
    sections: lesson.sections,
    // Answers never leave the server.
    quiz: lesson.quiz.map((q) => ({ question: q.question, options: q.options })),
    passMark: lesson.passMark,
  };
}

export async function submitLesson(
  ctx: AppContext,
  user: UserRow,
  lessonId: string,
  answers: number[],
): Promise<{
  score: number;
  passed: boolean;
  rewardMicros: number;
  correct: boolean[];
  retryAt: string | null;
}> {
  const lesson = getLesson(lessonId);
  if (!lesson) throw notFound('Lesson');
  const correct = lesson.quiz.map((q, i) => answers[i] === q.answer);
  const score = correct.filter(Boolean).length / lesson.quiz.length;
  const passed = score >= lesson.passMark;
  const result = await ctx.db.transaction(async (tx) => {
    const prior = await tx
      .select()
      .from(lessonAttempts)
      .where(and(eq(lessonAttempts.userId, user.id), eq(lessonAttempts.lessonId, lessonId)))
      .orderBy(desc(lessonAttempts.createdAt));
    const alreadyPassed = prior.some((p) => p.passed);
    const lastFail = prior.find((p) => !p.passed);
    if (!alreadyPassed && lastFail && Date.now() - lastFail.createdAt.getTime() < LESSON_RETRY_COOLDOWN) {
      throw tooMany('Take another look at the lesson — you can retry the quiz in a couple of minutes.');
    }
    const reward = passed && !alreadyPassed ? lesson.rewardMicros : 0;
    const [attempt] = await tx
      .insert(lessonAttempts)
      .values({ userId: user.id, lessonId, score, passed: passed && !alreadyPassed, rewardMicros: reward })
      .returning();
    if (reward > 0) {
      const txnId = await creditNative(ctx, tx, {
        type: 'lesson_reward',
        userId: user.id,
        networkId: 'learnhub',
        sponsorPayoutMicros: lesson.sponsorPayoutMicros,
        userAmountMicros: reward,
        idempotencyKey: `lesson:${user.id}:${lessonId}`,
        description: `Lesson passed — ${lesson.title}`,
        referenceType: 'lesson',
        referenceId: lessonId,
      });
      await tx.update(lessonAttempts).set({ ledgerTxnId: txnId }).where(eq(lessonAttempts.id, attempt!.id));
      await ctx.jobs.enqueue(tx, 'earning.after', {
        userId: user.id,
        kind: 'lesson',
        amountMicros: reward,
        sourceKey: `lesson:${user.id}:${lessonId}`,
      });
    }
    return { reward, alreadyPassed };
  });
  if (result.reward > 0)
    ctx.events.toUser(user.id, 'reward', {
      kind: 'lesson',
      amountMicros: result.reward,
      title: lesson.title,
    });
  return {
    score,
    passed,
    rewardMicros: result.reward,
    correct,
    retryAt:
      passed || result.alreadyPassed ? null : new Date(Date.now() + LESSON_RETRY_COOLDOWN).toISOString(),
  };
}

export async function lessonsPassedSince(ctx: AppContext, userId: string, since: Date): Promise<number> {
  const rows = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(lessonAttempts)
    .where(
      and(
        eq(lessonAttempts.userId, userId),
        eq(lessonAttempts.passed, true),
        gt(lessonAttempts.createdAt, since),
      ),
    );
  return rows[0]?.n ?? 0;
}
