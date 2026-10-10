import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Sparkles, Video, Zap } from 'lucide-react';
import { useRef } from 'react';
import { type AdCreativeDTO, type AdSessionDTO, type BoostStartDTO } from '@lucrum/shared';
import { Button, Card } from './ui';
import { errorMessage, post } from '../lib/api';
import { initRewardedAd, isNativeApp, showRewardedAd } from '../lib/native';
import { qk, useAdsNetworks, useBoosts } from '../lib/queries';
import { toast } from '../store/ui';

/**
 * Earning-rate boost card (the platform's rate-monetization lever):
 * watch ONE ad — a real partner-network video inside the Android app, an in-app
 * video on the web — and unlock extra daily video slots. The ad impression is paid
 * by the ad networks, so the boost monetizes through inventory we already sell.
 *
 * The unlock happens server-side when the video's signed SSV reward lands;
 * the client can never grant itself slots.
 */
export function BoostCard({
  onWatchInline,
}: {
  /** Web path: hand the boost session to the page's video player. */
  onWatchInline: (creative: AdCreativeDTO, session: AdSessionDTO) => void;
}) {
  const { data: status } = useBoosts();
  const { data: networks } = useAdsNetworks(isNativeApp());
  const qc = useQueryClient();
  const initialised = useRef(new Set<string>());

  const watch = useMutation({
    mutationFn: async () => {
      const native = isNativeApp() && networks && networks.length > 0;
      const started = await post<BoostStartDTO>(
        '/boosts/ad/start',
        native ? { networkId: networks[0]!.id } : {},
      );
      if (started.kind === 'partner' && started.networkId) {
        // Native path: a real partner-network video through the SDK bridge.
        const network = networks!.find((n) => n.id === started.networkId)!;
        if (!initialised.current.has(network.id)) {
          await initRewardedAd(network.id, network.sdk);
          initialised.current.add(network.id);
        }
        const result = await showRewardedAd(network.id, started.transId);
        if (result?.status === 'rewarded') {
          await post(`/ads/partner-sessions/${started.session.id}/native-complete`);
        } else if (result?.status === 'unavailable') {
          toast.info('No video right now', 'Try again in a minute.');
        } else if (result?.status === 'dismissed') {
          toast.info('Video closed', 'Watch to the end to unlock the boost.');
        }
        return started;
      }
      // Inline path: the page's player takes over with this session.
      onWatchInline(started.creative!, started.session);
      return started;
    },
    onSuccess: async (started) => {
      await qc.invalidateQueries({ queryKey: qk.boosts });
      qc.invalidateQueries({ queryKey: ['ads'] });
      qc.invalidateQueries({ queryKey: qk.wallet });
      toast.success(
        'Boost video started',
        `Watch it to the end and +${started.boost.slots} videos unlock for today.`,
      );
    },
    onError: (err) => toast.error('Couldn’t start the boost video', errorMessage(err)),
  });

  if (!status) return null;
  const boosted = status.bonusSlots > 0;

  return (
    <Card className="mt-5 border-emerald-500/30 bg-emerald-500/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <Zap className="size-5" />
          </span>
          <div>
            <p className="font-semibold text-slate-900 dark:text-white">
              Earn faster today
              {boosted && <span className="ml-2 text-emerald-600 dark:text-emerald-400">· boosted</span>}
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Videos today:{' '}
              <span className="tabular font-semibold text-slate-900 dark:text-white">
                {status.videosUsedToday}/{status.effectiveAdCap}
              </span>
              {boosted && (
                <span className="tabular text-emerald-600 dark:text-emerald-400">
                  {' '}
                  (+{status.bonusSlots} boosted)
                </span>
              )}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          loading={watch.isPending}
          disabled={status.boostsRemainingToday === 0 || status.slotsPerBoostAd === 0}
          onClick={() => watch.mutate()}
        >
          {watch.isPending ? <Loader2 className="size-4 animate-spin" /> : <Video className="size-4" />}
          {status.boostsRemainingToday > 0
            ? `Watch 1 ad → +${status.slotsPerBoostAd} videos`
            : 'Boost limit reached today'}
        </Button>
      </div>

      {status.active.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {status.active.map((b) => (
            <span
              key={b.id}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300"
            >
              <Sparkles className="size-3" />
              {b.label} · {new Date(b.expiresAt).toLocaleDateString()}
            </span>
          ))}
        </div>
      )}

      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        Boost ads are real ads from our partner networks — the impression pays for your extra slots. Boosts
        reset at midnight UTC.
      </p>
    </Card>
  );
}
