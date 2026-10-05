'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Info, MonitorSmartphone, Pause, Play, ShieldCheck, Sparkles, Volume2 } from 'lucide-react';
import { formatMoney, type VideoCompleteResponse, type VideoEvent, type VideoSessionDTO, type VideoStatusDTO } from '@cashads/shared';
import { Button } from '@/components/ui/button';
import { Card, CardBody, PageHeader } from '@/components/ui/card';
import { Alert, Badge, Progress, Skeleton } from '@/components/ui/feedback';
import { Modal } from '@/components/ui/overlay';
import { api, ApiError, errorMessage } from '@/lib/api';
import { qk, useVideoStatus } from '@/lib/queries';
import { useUi } from '@/lib/store';
import { cn } from '@/lib/utils';

type Phase = 'idle' | 'loading' | 'playing' | 'paused' | 'verifying' | 'rewarded' | 'rejected' | 'stopped';
const HIDDEN_LIMIT_MS = 30_000;

export default function WatchPage() {
  const qc = useQueryClient();
  const { data: status, isLoading } = useVideoStatus();
  const takenOver = useUi((s) => s.videoTakenOver);
  const setTakenOver = useUi((s) => s.setVideoTakenOver);
  const [session, setSession] = useState<VideoSessionDTO | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [played, setPlayed] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [lastReward, setLastReward] = useState<number>(0);
  const [elsewhere, setElsewhere] = useState<string | null>(null);
  const [autoNext, setAutoNext] = useState(true);
  const [countdown, setCountdown] = useState<number | null>(null);

  const t0 = useRef(0);
  const playedRef = useRef(0);
  const lastTick = useRef(0);
  const fired = useRef<Set<VideoEvent>>(new Set());
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const hiddenAt = useRef<number | null>(null);
  const raf = useRef<number>(0);
  const sessionRef = useRef<VideoSessionDTO | null>(null);
  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;
  sessionRef.current = session;

  const send = useCallback((type: VideoEvent) => {
    const s = sessionRef.current;
    if (!s) return Promise.resolve();
    const t = Math.round(performance.now() - t0.current);
    queue.current = queue.current.then(() => api(`/video/sessions/${s.id}/events`, { body: { type, t } }).catch(() => undefined));
    return queue.current;
  }, []);

  const finish = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    setPhase('verifying');
    await queue.current;
    try {
      const res = await api<VideoCompleteResponse>(`/video/sessions/${s.id}/complete`, { body: {} });
      qc.setQueryData<VideoStatusDTO>(qk.video, res.status);
      if (res.rewarded) {
        setLastReward(res.amountMicros);
        setPhase('rewarded');
      } else {
        setMessage(res.reason ?? 'No reward this time.');
        setPhase('rejected');
      }
    } catch (err) {
      setMessage(errorMessage(err));
      setPhase('rejected');
    }
  }, [qc]);

  // Playback clock: only advances while visible & playing.
  const loop = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    const now = performance.now();
    if (phaseRef.current === 'playing') {
      playedRef.current += now - lastTick.current;
      const d = s.creative.durationSeconds * 1000;
      const frac = playedRef.current / d;
      setPlayed(Math.min(1, frac));
      for (const [ev, at] of [['q1', 0.25], ['mid', 0.5], ['q3', 0.75]] as const) {
        if (frac >= at && !fired.current.has(ev)) {
          fired.current.add(ev);
          void send(ev);
        }
      }
      if (frac >= 1 && !fired.current.has('completed')) {
        fired.current.add('completed');
        void send('completed').then(finish);
        return;
      }
    }
    lastTick.current = now;
    raf.current = requestAnimationFrame(loop);
  }, [send, finish]);

  const start = useCallback(
    async (takeOver = false) => {
      setMessage(null);
      setPhase('loading');
      setPlayed(0);
      playedRef.current = 0;
      fired.current = new Set();
      queue.current = Promise.resolve();
      setTakenOver(false);
      try {
        const s = await api<VideoSessionDTO>('/video/sessions', { body: { takeOver } });
        setSession(s);
        sessionRef.current = s;
        t0.current = performance.now();
        // "Load" the creative (in production: the ad SDK's load callback).
        await new Promise((r) => setTimeout(r, 450));
        void send('loaded');
        await new Promise((r) => setTimeout(r, 250));
        void send('started');
        lastTick.current = performance.now();
        setPhase('playing');
        raf.current = requestAnimationFrame(loop);
      } catch (err) {
        setPhase('idle');
        if (err instanceof ApiError && err.code === 'earning_elsewhere') setElsewhere((err.details as { deviceLabel?: string })?.deviceLabel ?? 'another device');
        else if (err instanceof ApiError && err.code === 'cooldown') setTimeout(() => void start(takeOver), 1500);
        else setMessage(errorMessage(err));
      }
    },
    [loop, send, setTakenOver],
  );

  // Tab switching pauses the video; leaving too long ends the session (no reward, no penalty).
  useEffect(() => {
    const onVis = () => {
      if (!sessionRef.current) return;
      if (document.visibilityState === 'hidden' && phaseRef.current === 'playing') {
        hiddenAt.current = Date.now();
        void send('hidden');
        void send('paused');
        setPhase('paused');
      } else if (document.visibilityState === 'visible' && phaseRef.current === 'paused' && hiddenAt.current) {
        const away = Date.now() - hiddenAt.current;
        hiddenAt.current = null;
        void send('visible');
        if (away > HIDDEN_LIMIT_MS) {
          void api(`/video/sessions/${sessionRef.current.id}/abandon`, { body: { reason: 'hidden_too_long' } });
          setMessage('The video stopped because you left for a while. No reward this time — and no penalty.');
          setPhase('stopped');
        } else {
          void send('resumed');
          lastTick.current = performance.now();
          setPhase('playing');
        }
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [send]);

  useEffect(() => {
    if (takenOver && sessionRef.current && ['playing', 'paused', 'loading'].includes(phaseRef.current)) {
      cancelAnimationFrame(raf.current);
      setMessage('You started a video on another device, so this one stopped.');
      setPhase('stopped');
    }
  }, [takenOver]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(raf.current);
      const s = sessionRef.current;
      if (s && ['playing', 'paused', 'loading'].includes(phaseRef.current)) {
        void fetch(`/api/video/sessions/${s.id}/abandon`, { method: 'POST', keepalive: true, credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'cashads' }, body: '{"reason":"closed"}' });
      }
    };
  }, []);

  // "Watch another?" auto-continue.
  useEffect(() => {
    if (phase !== 'rewarded' || !autoNext) return;
    const st = qc.getQueryData<VideoStatusDTO>(qk.video);
    if (st && st.remainingToday <= 0) return;
    setCountdown(3);
    const iv = setInterval(() => setCountdown((c) => (c !== null && c > 1 ? c - 1 : c)), 1000);
    const to = setTimeout(() => {
      setCountdown(null);
      void start();
    }, 3000);
    return () => {
      clearInterval(iv);
      clearTimeout(to);
      setCountdown(null);
    };
  }, [phase, autoNext, start, qc]);

  const pause = () => {
    if (phase === 'playing') {
      void send('paused');
      setPhase('paused');
    } else if (phase === 'paused') {
      void send('resumed');
      lastTick.current = performance.now();
      setPhase('playing');
    }
  };

  const c = session?.creative;
  const remainingSec = c ? Math.max(0, Math.ceil(c.durationSeconds * (1 - played))) : 0;
  const capReached = status && status.remainingToday <= 0;

  return (
    <div>
      <PageHeader title="Watch & earn" description="Short sponsor videos. The reward lands the moment the video ends." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <div className="relative aspect-video overflow-hidden rounded-3xl border border-line bg-slate-950 shadow-lift">
            {c && phase !== 'idle' ? (
              <div className="absolute inset-0 flex flex-col" style={{ background: `radial-gradient(circle at 30% 20%, ${c.accentColor}55, transparent 60%), linear-gradient(135deg, ${c.brandColor}, #020617)` }}>
                <div className="flex items-center justify-between px-5 pt-4 text-xs text-white/80">
                  <span className="rounded-full bg-black/30 px-2 py-0.5">Sponsored · {c.advertiser}</span>
                  <span className="flex items-center gap-2">
                    <Volume2 className="h-3.5 w-3.5" />
                    {phase === 'playing' || phase === 'paused' ? `Reward in ${remainingSec}s` : ''}
                  </span>
                </div>
                <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-white">
                  <span className={cn('text-6xl sm:text-7xl', phase === 'playing' && 'animate-float')}>{c.emoji}</span>
                  <p className={cn('mt-4 max-w-md font-display text-2xl font-extrabold leading-tight transition-all duration-700 sm:text-3xl', played > 0.08 ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0')}>{c.headline}</p>
                  <p className={cn('mt-2 text-sm text-white/80 transition-all duration-700 sm:text-base', played > 0.3 ? 'opacity-100' : 'opacity-0')}>{c.tagline}</p>
                  <span className={cn('mt-5 rounded-full bg-white px-5 py-2 text-sm font-bold transition-all duration-700', played > 0.6 ? 'scale-100 opacity-100' : 'scale-90 opacity-0')} style={{ color: c.brandColor }}>
                    {c.cta}
                  </span>
                </div>
                <div className="h-1.5 bg-white/15">
                  <div className="h-full bg-white transition-[width] duration-200" style={{ width: `${played * 100}%` }} />
                </div>
                {phase === 'paused' && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-center text-white">
                    <div>
                      <Pause className="mx-auto h-10 w-10" />
                      <p className="mt-2 font-semibold">Paused</p>
                      <p className="text-sm text-white/70">Stay on this tab to keep watching.</p>
                    </div>
                  </div>
                )}
                {phase === 'verifying' && <div className="absolute inset-0 flex items-center justify-center bg-black/50 font-semibold text-white">Confirming your reward…</div>}
                {phase === 'rewarded' && (
                  <div className="absolute inset-0 flex animate-fade-in items-center justify-center bg-black/60 text-center text-white">
                    <div className="animate-pop">
                      <p className="tabular font-display text-5xl font-extrabold text-emerald-300">+{formatMoney(lastReward)}</p>
                      <p className="mt-1 text-white/80">added to your balance</p>
                      {countdown !== null && <p className="mt-3 text-sm text-white/70">Next video in {countdown}…</p>}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 to-emerald-950 p-6 text-center text-white">
                <Sparkles className="h-10 w-10 text-emerald-300" />
                <p className="mt-3 text-xl font-bold">{capReached ? 'You’ve watched every video for today' : 'Ready when you are'}</p>
                <p className="mt-1 max-w-sm text-sm text-white/70">{capReached ? 'New videos unlock at midnight. Higher tiers get more per day.' : `Next video pays about ${status ? formatMoney(status.nextRewardMicros) : '—'}. Watch a few in a row for a combo bonus.`}</p>
                {phase === 'loading' && <p className="mt-4 text-sm text-white/70">Loading sponsor…</p>}
              </div>
            )}
          </div>

          {message && (
            <Alert tone="warning" action={<Button size="sm" variant="secondary" onClick={() => void start()}>Try another</Button>}>
              {message}
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {phase === 'playing' || phase === 'paused' ? (
              <Button variant="secondary" onClick={pause}>
                {phase === 'playing' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {phase === 'playing' ? 'Pause' : 'Resume'}
              </Button>
            ) : (
              <Button size="lg" onClick={() => void start()} disabled={!!capReached || phase === 'loading' || phase === 'verifying'} loading={phase === 'loading'}>
                <Play className="h-4 w-4" /> {phase === 'rewarded' ? 'Watch another' : 'Watch a video'}
              </Button>
            )}
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={autoNext} onChange={(e) => setAutoNext(e.target.checked)} className="accent-emerald-600" /> Auto-play next
            </label>
          </div>
        </div>

        <div className="space-y-4">
          {isLoading || !status ? (
            <Skeleton className="h-64 rounded-2xl" />
          ) : (
            <Card>
              <CardBody className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Today</p>
                  <Badge tone={status.comboIndex > 0 ? 'warning' : 'neutral'}>{status.comboIndex > 0 ? `🔥 Combo ×${status.comboIndex} · +${status.comboBonusBps / 100}%` : 'No combo yet'}</Badge>
                </div>
                <div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted">Videos watched</span>
                    <span className="tabular font-semibold">
                      {status.watchedToday}/{status.dailyCap}
                    </span>
                  </div>
                  <Progress value={(status.watchedToday / status.dailyCap) * 100} className="mt-2" />
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Earned from videos today</span>
                  <span className="tabular font-bold text-brand-700 dark:text-brand-400">{formatMoney(status.earnedTodayMicros)}</span>
                </div>
                <p className="text-xs text-muted">Watching in a row adds +5% per video, up to +25%. The combo resets if you take a break of more than 2 minutes.</p>
              </CardBody>
            </Card>
          )}
          <Card>
            <CardBody className="space-y-3 text-sm">
              <p className="flex items-center gap-2 font-semibold">
                <ShieldCheck className="h-4 w-4 text-brand-600" /> Fair & verifiable
              </p>
              <ul className="space-y-2 text-muted">
                <li>• Rewards are verified server-side from the full playback chain (load → start → quartiles → complete).</li>
                <li>• Switching tabs pauses the video. If an ad fails to load, it never counts against your daily limit.</li>
                <li className="flex gap-1.5">
                  <MonitorSmartphone className="mt-0.5 h-4 w-4 shrink-0" /> You can earn on one device at a time and move earning to another device with one tap.
                </li>
              </ul>
              <p className="flex items-start gap-1.5 text-xs text-subtle">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Sponsor slots are filled by direct advertisers. Ad networks with server-side verification plug into the same pipeline.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>

      <Modal
        open={!!elsewhere}
        onClose={() => setElsewhere(null)}
        title="You’re earning on another device"
        description={`A video is active on ${elsewhere}. You can earn on one device at a time.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setElsewhere(null)}>
              Keep it there
            </Button>
            <Button
              onClick={() => {
                setElsewhere(null);
                void start(true);
              }}
            >
              Move earning here
            </Button>
          </>
        }
      />
    </div>
  );
}
