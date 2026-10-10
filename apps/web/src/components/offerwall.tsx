import { useMutation } from '@tanstack/react-query';
import { Check, ExternalLink, LayoutGrid, MonitorSmartphone, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  type InterruptedSessionReportDTO,
  type NetworkCategory,
  type NetworkDTO,
  type NetworkWallDTO,
} from '@lucrum/shared';
import { errorMessage, post } from '../lib/api';
import { useMe, useNetworks } from '../lib/queries';
import { isNativeApp, openExternal } from '../lib/native';
import { cn, pct } from '../lib/utils';
import { toast } from '../store/ui';
import { Badge, Button, Card, EmptyState, Modal, Skeleton } from './ui';

const CATEGORY_LABELS: Record<NetworkCategory, string> = {
  surveys: 'Surveys',
  app_installs: 'App trials',
  playtime: 'Playtime',
  signups: 'Sign-ups',
  financial: 'Financial',
  video: 'Video',
  quizzes: 'Quizzes',
  microtasks: 'Micro-tasks',
};

const PENDING_KEY = 'lucrum.pendingWallSession';

interface PendingSession {
  sessionId?: string;
  networkId: string;
  startedAt: string;
  savedAt: number;
}

/**
 * Connection resilience for wall tasks. Users in our launch markets lose
 * connectivity mid-task all the time (ISP drops, blackouts, tower switches).
 * When the browser reports `offline` while a wall session is open, we persist it
 * locally; when the connection returns we report it to the server, which logs an
 * interrupted session — evidence for a Missing Credit claim if the postback
 * never arrives.
 */
function useConnectionResilience(session: NetworkWallDTO | null) {
  const reported = useRef(false);
  useEffect(() => {
    if (!session) return;
    reported.current = false;
    const startedAt = new Date().toISOString();
    const pending: PendingSession = {
      sessionId: session.sessionId,
      networkId: session.networkId,
      startedAt,
      savedAt: Date.now(),
    };
    const onOffline = () => {
      try {
        localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
      } catch {
        /* storage unavailable — nothing we can do offline */
      }
      toast.info(
        'Connection lost',
        'Don’t worry — your task session is saved. If it doesn’t pay within 2 hours, use Missing credit in Activity.',
      );
    };
    const onOnline = () => {
      let saved: PendingSession | null = null;
      try {
        const raw = localStorage.getItem(PENDING_KEY);
        saved = raw ? (JSON.parse(raw) as PendingSession) : null;
        localStorage.removeItem(PENDING_KEY);
      } catch {
        /* ignore */
      }
      if (!saved || reported.current) return;
      reported.current = true;
      void post<InterruptedSessionReportDTO>('/networks/sessions/interrupted', {
        sessionId: saved.sessionId,
        networkId: saved.networkId,
        startedAt: saved.startedAt,
        networkType: (navigator as Navigator & { connection?: { effectiveType?: string } }).connection
          ?.effectiveType,
        reason: 'connection_lost',
      })
        .then((r) => toast.success('Session logged', r.guidance))
        .catch(() => undefined);
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [session]);
}

/**
 * Launcher for the connected offerwall / survey networks. Embedded walls open in a
 * sandboxed modal; everything else opens in the device browser (Custom Tab on
 * Android) so offerwall tracking sees a real browser, not a WebView.
 */
export function OfferwallLauncher() {
  const { data: me } = useMe();
  const { data: networks, isLoading } = useNetworks();
  const [active, setActive] = useState<{ network: NetworkDTO; wall: NetworkWallDTO } | null>(null);
  useConnectionResilience(active?.wall ?? null);

  const dataSaver = Boolean(me?.prefs.dataSaver);

  const open = useMutation({
    mutationFn: (network: NetworkDTO) => post<NetworkWallDTO>(`/networks/${network.id}/wall`),
    onSuccess: (wall, network) => setActive({ network, wall }),
    onError: (err) => toast.error('Couldn’t open this wall', errorMessage(err)),
  });

  const close = () => setActive(null);

  // External walls open straight in the browser — no modal.
  const openExternalWall = async (network: NetworkDTO) => {
    try {
      const wall = await post<NetworkWallDTO>(`/networks/${network.id}/wall`);
      setActive({ network, wall });
      await openExternal(wall.url);
    } catch (err) {
      toast.error('Couldn’t open this wall', errorMessage(err));
    }
  };

  const handleOpen = (network: NetworkDTO) => {
    // Data-saver (or a non-embeddable wall): skip the heavy iframe, go to the browser.
    if (dataSaver || !network.embeddable) void openExternalWall(network);
    else open.mutate(network);
  };

  return (
    <section aria-label="Task walls and surveys" className="mb-8">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Task walls & surveys</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Whole catalogues from our partner networks — surveys, app trials, sign-ups and micro-tasks.
          </p>
        </div>
        {isNativeApp() && (
          <Badge tone="neutral" dot>
            Native app · tracking protected
          </Badge>
        )}
      </div>

      {isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      )}

      {!isLoading && (networks ?? []).length === 0 && (
        <Card className="border-dashed">
          <EmptyState
            icon={<LayoutGrid className="size-8" />}
            title="More task walls are being connected"
            body="New survey and task networks go live as they’re approved. The tasks below are ready right now."
          />
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(networks ?? []).map((network) => (
          <Card key={network.id} className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <LayoutGrid className="size-4" />
                </span>
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">{network.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {network.embeddable ? 'Opens here' : 'Opens in your browser'}
                  </p>
                </div>
              </div>
              {network.postbackSuccessRate !== null && (
                <Badge tone={network.postbackSuccessRate >= 0.9 ? 'success' : 'warning'} dot>
                  {pct(network.postbackSuccessRate)} pays
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {network.categories.slice(0, 4).map((c) => (
                <span
                  key={c}
                  className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                >
                  {CATEGORY_LABELS[c] ?? c}
                </span>
              ))}
            </div>
            <Button
              size="sm"
              block
              loading={open.isPending && open.variables?.id === network.id}
              onClick={() => handleOpen(network)}
            >
              {network.embeddable && !dataSaver ? (
                <>
                  <MonitorSmartphone className="size-4" /> Open tasks
                </>
              ) : (
                <>
                  <ExternalLink className="size-4" /> Open in browser
                </>
              )}
            </Button>
          </Card>
        ))}
      </div>

      {active && (
        <Modal
          open
          onClose={close}
          size="lg"
          title={active.network.name}
          footer={
            <div className="flex w-full items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <ShieldCheck className="size-3.5 text-emerald-500" />
                Tracked session — connection drops are logged automatically
              </span>
              <Button size="sm" variant="secondary" onClick={() => void openExternal(active.wall.url)}>
                <ExternalLink className="size-4" /> Open in browser
              </Button>
            </div>
          }
        >
          <div className="relative aspect-[3/4] max-h-[70vh] w-full overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700">
            {/* Sandbox keeps the wall's scripts scoped; same-origin lets it use storage/cookies it needs. */}
            <iframe
              src={active.wall.url}
              title={`${active.network.name} tasks`}
              className="h-full w-full border-0"
              loading="lazy"
              sandbox="allow-forms allow-popups allow-scripts allow-same-origin allow-downloads"
            />
          </div>
          <p className="mt-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            {navigator.onLine ? (
              <>
                <Wifi className="size-3.5 text-emerald-500" /> Connected — complete a task and it credits
                automatically.
              </>
            ) : (
              <>
                <WifiOff className="size-3.5 text-amber-500" /> You’re offline — reconnect to finish and get
                paid.
              </>
            )}
            <span className="ml-auto inline-flex items-center gap-1">
              <Check className="size-3.5" /> Pays even if tracking fails
            </span>
          </p>
        </Modal>
      )}
    </section>
  );
}

/** Compact indicator for layouts that only need the count of available walls. */
export function OfferwallSummary() {
  const { data: networks } = useNetworks();
  const n = networks?.length ?? 0;
  return (
    <span className={cn('inline-flex items-center gap-1.5', n === 0 && 'opacity-60')}>
      <LayoutGrid className="size-4" />
      {n} task {n === 1 ? 'wall' : 'walls'}
    </span>
  );
}
