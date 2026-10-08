import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, Loader2, Pause, Play, Smartphone, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type AdCreativeDTO, type AdNextDTO, type AdSessionDTO, formatUsd } from '@lucrum/shared';
import {
  Button,
  ButtonLink,
  Callout,
  Card,
  EmptyState,
  Modal,
  PageHeader,
  Skeleton,
} from '../../components/ui';
import { ApiError, errorMessage, get, post } from '../../lib/api';
import { qk } from '../../lib/queries';
import { cn } from '../../lib/utils';
import { BoostCard } from '../../components/boostCard';
import { PartnerVideos } from '../../components/partnerAds';
import { toast } from '../../store/ui';

type Phase = 'ready' | 'loading' | 'playing' | 'paused' | 'confirming' | 'rewarded' | 'rejected';

/**
 * Rewarded video player (spec §4.1 AdPlayer, §7 edge cases):
 *  • honest reward + the hourly maths, before you start
 *  • full event chain (loaded → started → Q1–Q3 → completed) reported to the server
 *  • hiding the tab pauses playback; hidden time never counts
 *  • waits for server-side verification; >5s shows "Reward is being confirmed"
 */
export function Watch() {
  const qc = useQueryClient();
  const {
    data: next,
    isLoading,
    refetch,
  } = useQuery({ queryKey: ['ads', 'next'], queryFn: () => get<AdNextDTO>('/ads/next') });
  const [phase, setPhase] = useState<Phase>('ready');
  const [session, setSession] = useState<AdSessionDTO | null>(null);
  const [mediaTime, setMediaTime] = useState(0);
  const [slow, setSlow] = useState(false);
  const [otherDevice, setOtherDevice] = useState<string | null>(null);
  const creativeRef = useRef<AdCreativeDTO | null>(null);
  const timeRef = useRef(0);
  const quartiles = useRef(new Set<number>());
  const raf = useRef(0);
  const last = useRef(0);
  const sessionRef = useRef<AdSessionDTO | null>(null);

  const send = useCallback(async (type: string, extra: Record<string, unknown> = {}) => {
    const s = sessionRef.current;
    if (!s) return null;
    try {
      return await post<AdSessionDTO>(`/ads/sessions/${s.id}/events`, {
        type,
        mediaTime: Math.round(timeRef.current * 100) / 100,
        ...extra,
      });
    } catch {
      return null;
    }
  }, []);

  const finish = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    setPhase('confirming');
    await send('completed');
    try {
      let res = await post<AdSessionDTO>(`/ads/sessions/${s.id}/complete`);
      const started = Date.now();
      while (res.status === 'verifying' && Date.now() - started < 20_000) {
        if (Date.now() - started > 5000) setSlow(true);
        await new Promise((r) => setTimeout(r, 700));
        res = await get<AdSessionDTO>(`/ads/sessions/${s.id}`);
      }
      setSession(res);
      setPhase(
        res.status === 'rewarded' ? 'rewarded' : res.status === 'verifying' ? 'confirming' : 'rejected',
      );
      qc.invalidateQueries({ queryKey: qk.wallet });
      qc.invalidateQueries({ queryKey: qk.boosts });
    } catch (err) {
      setSession({ ...s, status: 'rejected', rejectionReason: errorMessage(err) });
      setPhase('rejected');
    }
  }, [qc, send]);

  const tick = useCallback(
    (t: number) => {
      const creative = creativeRef.current;
      if (!creative) return;
      const dt = last.current ? (t - last.current) / 1000 : 0;
      last.current = t;
      timeRef.current = Math.min(creative.durationSeconds, timeRef.current + dt);
      setMediaTime(timeRef.current);
      for (const q of [1, 2, 3] as const) {
        if (!quartiles.current.has(q) && timeRef.current >= (creative.durationSeconds * q) / 4) {
          quartiles.current.add(q);
          void send('quartile', { quartile: q });
        }
      }
      if (timeRef.current >= creative.durationSeconds) {
        void finish();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    },
    [finish, send],
  );

  const play = useCallback(() => {
    last.current = 0;
    setPhase('playing');
    raf.current = requestAnimationFrame(tick);
  }, [tick]);

  const pause = useCallback(
    (reason: 'hidden' | 'paused') => {
      cancelAnimationFrame(raf.current);
      setPhase((p) => (p === 'playing' ? 'paused' : p));
      void send(reason);
      if (reason === 'hidden') void send('paused');
    },
    [send],
  );

  // Hidden tab = paused, and hidden time never counts toward the reward.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && phase === 'playing') pause('hidden');
      else if (!document.hidden && phase === 'paused') void send('visible');
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [phase, pause, send]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const start = async (takeover = false) => {
    if (!next?.creative) return;
    setOtherDevice(null);
    setSlow(false);
    setPhase('loading');
    creativeRef.current = next.creative;
    timeRef.current = 0;
    quartiles.current = new Set();
    setMediaTime(0);
    try {
      const s = await post<AdSessionDTO>('/ads/sessions', { creativeId: next.creative.id, takeover });
      sessionRef.current = s;
      setSession(s);
      // Simulated buffering, then the event chain begins.
      await new Promise((r) => setTimeout(r, 600));
      await send('loaded');
      await send('started');
      play();
    } catch (err) {
      setPhase('ready');
      if (err instanceof ApiError && err.code === 'EARNING_ON_OTHER_DEVICE')
        setOtherDevice(String(err.details?.deviceLabel ?? 'another device'));
      else toast.error('Couldn’t start the video', errorMessage(err));
    }
  };

  /** Plays an already-created session (boost videos arrive pre-created). */
  const startWith = async (creative: AdCreativeDTO, s: AdSessionDTO) => {
    setOtherDevice(null);
    setSlow(false);
    creativeRef.current = creative;
    timeRef.current = 0;
    quartiles.current = new Set();
    setMediaTime(0);
    sessionRef.current = s;
    setSession(s);
    setPhase('loading');
    await new Promise((r) => setTimeout(r, 600));
    await send('loaded');
    await send('started');
    play();
  };

  const reset = async () => {
    sessionRef.current = null;
    setSession(null);
    setPhase('ready');
    setMediaTime(0);
    await refetch();
  };

  if (isLoading) return <Skeleton className="h-96" />;
  const creative = phase === 'ready' ? next?.creative : (creativeRef.current ?? next?.creative);
  const hourly = next?.creative ? Math.round((next.rewardMicros * 3600) / next.creative.durationSeconds) : 0;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Rewarded videos"
        subtitle="Short ads for spare seconds — with honest pay."
        back={{ to: '/app/earn', label: 'All tasks' }}
      />
      {!creative ? (
        <EmptyState
          icon="🎬"
          title={next?.remainingToday === 0 ? 'You’ve hit today’s video limit' : 'No videos right now'}
          body="Tasks and quick polls pay far more per minute anyway."
          action={<ButtonLink to="/app/earn">Browse tasks</ButtonLink>}
        />
      ) : (
        <>
          <div className="relative aspect-video overflow-hidden rounded-3xl bg-slate-900 shadow-xl">
            <SimulatedAd
              creative={creative}
              progress={mediaTime / creative.durationSeconds}
              active={phase === 'playing'}
            />
            <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3 text-xs text-white/90">
              <span className="rounded-full bg-black/40 px-2.5 py-1 backdrop-blur">
                Ad · {creative.advertiser}
              </span>
              {(phase === 'playing' || phase === 'paused') && (
                <span className="tabular rounded-full bg-black/40 px-2.5 py-1 backdrop-blur">
                  Reward in {Math.max(0, Math.ceil(creative.durationSeconds - mediaTime))}s
                </span>
              )}
            </div>
            <div className="absolute inset-x-0 bottom-0 h-1.5 bg-white/20">
              <div
                className="h-full bg-amber-400 transition-[width] duration-200"
                style={{ width: `${(mediaTime / creative.durationSeconds) * 100}%` }}
              />
            </div>
            {phase !== 'playing' && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/55 backdrop-blur-[2px]">
                {phase === 'ready' && (
                  <button onClick={() => start()} className="flex flex-col items-center gap-3 text-white">
                    <span className="flex size-20 items-center justify-center rounded-full bg-white/95 text-slate-900 shadow-2xl transition hover:scale-105">
                      <Play className="ml-1 size-9" />
                    </span>
                    <span className="text-sm font-semibold">
                      Watch {creative.durationSeconds}s · earn {formatUsd(next?.rewardMicros ?? 0)}
                    </span>
                  </button>
                )}
                {phase === 'loading' && <Loader2 className="size-10 animate-spin text-white" />}
                {phase === 'paused' && (
                  <button
                    onClick={async () => {
                      await send('visible');
                      await send('resumed');
                      play();
                    }}
                    className="flex flex-col items-center gap-3 text-white"
                  >
                    <span className="flex size-16 items-center justify-center rounded-full bg-white/95 text-slate-900">
                      <Pause className="size-7" />
                    </span>
                    <span className="max-w-xs text-center text-sm">
                      Paused — the video must be on screen to count. Tap to resume.
                    </span>
                  </button>
                )}
                {phase === 'confirming' && (
                  <div className="flex flex-col items-center gap-3 text-center text-white">
                    <Loader2 className="size-10 animate-spin" />
                    <p className="font-semibold">
                      {slow ? 'Reward is being confirmed…' : 'Confirming with the ad network…'}
                    </p>
                    {slow && (
                      <p className="max-w-xs text-sm text-white/80">
                        This can take a few seconds. You won’t lose it — it will appear in your wallet
                        automatically.
                      </p>
                    )}
                  </div>
                )}
                {phase === 'rewarded' && session && (
                  <div className="animate-pop text-center text-white">
                    <CircleCheck className="mx-auto size-12 text-emerald-400" />
                    <p className="tabular mt-2 text-4xl font-bold">
                      +{formatUsd(session.rewardMicros + session.bonusMicros)}
                    </p>
                    {session.bonusMicros > 0 && (
                      <p className="text-sm text-amber-300">
                        includes +{formatUsd(session.bonusMicros)} combo bonus
                      </p>
                    )}
                  </div>
                )}
                {phase === 'rejected' && (
                  <div className="max-w-sm text-center text-white">
                    <CircleX className="mx-auto size-10 text-rose-300" />
                    <p className="mt-2 font-semibold">Not counted this time</p>
                    <p className="mt-1 text-sm text-white/80">
                      {session?.rejectionReason ?? 'Something went wrong.'} No penalty — try another.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {(phase === 'rewarded' || phase === 'rejected') && (
            <div className="mt-4 flex gap-2">
              <Button onClick={reset} block size="lg">
                <Zap className="size-4" /> Watch another{' '}
                {next && next.comboLevel < 2 && phase === 'rewarded' ? '(combo bonus!)' : ''}
              </Button>
              <ButtonLink to="/app/earn" variant="outline" size="lg">
                Tasks pay more
              </ButtonLink>
            </div>
          )}

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Card className="p-4">
              <p className="text-xs text-slate-500">This video pays</p>
              <p className="tabular text-xl font-bold">{formatUsd(next?.rewardMicros ?? 0)}</p>
              <p className="text-xs text-slate-500">≈ {formatUsd(hourly, { precision: 2 })}/hour</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-slate-500">Combo</p>
              <p className="text-xl font-bold">
                ×{((next?.comboMultiplierBps ?? 10_000) / 10_000).toFixed(2)}
              </p>
              <p className="text-xs text-slate-500">Watch back-to-back to boost</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-slate-500">Left today</p>
              <p className="text-xl font-bold">
                {next?.remainingToday ?? 0}
                <span className="text-sm font-normal text-slate-400"> / {next?.dailyCap ?? 0}</span>
              </p>
              <p className="text-xs text-slate-500">Max 45s per video, ever</p>
            </Card>
          </div>
          <Callout tone="info" className="mt-4">
            {next?.offersPayMoreHint}
          </Callout>
        </>
      )}
      <BoostCard onWatchInline={startWith} />
      <PartnerVideos />
      <Modal
        open={Boolean(otherDevice)}
        onClose={() => setOtherDevice(null)}
        title="You’re earning on another device"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOtherDevice(null)}>
              Keep it there
            </Button>
            <Button onClick={() => start(true)}>
              <Smartphone className="size-4" /> Earn on this device
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-400">
          To keep things fair, only one device can earn at a time. <strong>{otherDevice}</strong> is currently
          active. Taking over here ends the session there.
        </p>
      </Modal>
    </div>
  );
}

function SimulatedAd({
  creative,
  progress,
  active,
}: {
  creative: AdCreativeDTO;
  progress: number;
  active: boolean;
}) {
  const stage = progress < 0.34 ? 0 : progress < 0.67 ? 1 : 2;
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center"
      style={{
        background: `linear-gradient(135deg, ${creative.theme.from}, ${creative.theme.to})`,
        color: creative.theme.accent,
      }}
    >
      <div
        className={cn(
          'text-7xl drop-shadow-xl transition-transform duration-700 sm:text-8xl',
          active && 'animate-float',
        )}
      >
        {creative.theme.emoji}
      </div>
      <p
        key={stage}
        className="mt-4 animate-slide-up text-2xl font-extrabold tracking-tight drop-shadow sm:text-3xl"
      >
        {stage === 0 ? creative.title : stage === 1 ? creative.tagline : creative.advertiser}
      </p>
      {stage === 2 && (
        <span className="mt-3 animate-pop rounded-full bg-white/90 px-4 py-1.5 text-sm font-semibold text-slate-900">
          Learn more
        </span>
      )}
      <p className="absolute bottom-4 right-4 text-[10px] uppercase tracking-widest opacity-70">
        Sandbox creative
      </p>
    </div>
  );
}
