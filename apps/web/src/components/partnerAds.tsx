import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CirclePlay, Loader2, Smartphone, Video } from 'lucide-react';
import { useRef, useState } from 'react';
import { type AdsNetworkDTO, type AdSessionDTO, type PartnerSessionDTO, formatUsd } from '@lucrum/shared';
import { Button, Card } from './ui';
import { ApiError, errorMessage, get, post } from '../lib/api';
import { initRewardedAd, isNativeApp, showRewardedAd } from '../lib/native';
import { qk, useAdsNetworks } from '../lib/queries';
import { toast } from '../store/ui';

/**
 * Partner rewarded video (AppLovin MAX, Pangle, Yango, …) — only inside the native
 * Android app, where the network SDKs are compiled in. Flow:
 *
 *   1. POST /api/ads/partner-sessions  → server creates the session (honest reward)
 *   2. native SDK plays the video with the session's opaque transId as its SSV user id
 *   3. the SDK's "rewarded" event is UX feedback only — we mark the session verifying
 *   4. the network's SIGNED server-to-server callback credits the ledger (SSE updates
 *      the balance live). The client can never credit itself.
 */
export function PartnerVideos() {
  const { data: networks } = useAdsNetworks(isNativeApp());
  const qc = useQueryClient();
  const [activeNetwork, setActiveNetwork] = useState<string | null>(null);
  const initialised = useRef(new Set<string>());

  const watch = useMutation({
    mutationFn: async (network: AdsNetworkDTO) => {
      setActiveNetwork(network.id);
      // 1. Server-side session.
      const ps = await post<PartnerSessionDTO>('/ads/partner-sessions', { networkId: network.id });
      // 2. Make sure the native SDK is initialised for this network (once).
      if (!initialised.current.has(network.id)) {
        await initRewardedAd(network.id, network.sdk);
        initialised.current.add(network.id);
      }
      const result = await showRewardedAd(network.id, ps.transId);
      // 3. Client-side "rewarded" — mark verifying and wait for the signed SSV callback.
      if (result?.status === 'rewarded') {
        await post<AdSessionDTO>(`/ads/partner-sessions/${ps.session.id}/native-complete`);
        let s = await get<AdSessionDTO>(`/ads/sessions/${ps.session.id}`);
        const started = Date.now();
        while (s.status === 'verifying' && Date.now() - started < 15_000) {
          await new Promise((r) => setTimeout(r, 700));
          s = await get<AdSessionDTO>(`/ads/sessions/${ps.session.id}`);
        }
        return { network, ps, result: s };
      }
      return { network, ps, result: null, sdkResult: result };
    },
    onSuccess: ({ network, ps, result, sdkResult }) => {
      qc.invalidateQueries({ queryKey: qk.wallet });
      qc.invalidateQueries({ queryKey: ['ads'] });
      if (result?.status === 'rewarded') {
        toast.success(
          'Video verified',
          `${formatUsd(result.rewardMicros + result.bonusMicros)} is on its way to your wallet.`,
        );
      } else if (sdkResult?.status === 'dismissed') {
        toast.info('Video closed', 'No reward this time — watch to the end to earn.');
      } else if (sdkResult?.status === 'unavailable') {
        toast.info('No video right now', `${network.name} has no ad to show — try again in a minute.`);
      } else {
        toast.info(
          'Video ended',
          'If it doesn’t credit within a few minutes, check Activity → Missing credit.',
        );
      }
      void ps;
    },
    onError: (err, network) => {
      if (err instanceof ApiError && err.code === 'EARNING_ON_OTHER_DEVICE') {
        toast.error('Earning on another device', 'Only one device can earn at a time.');
      } else {
        toast.error('Couldn’t start the video', errorMessage(err));
      }
      void network;
    },
    onSettled: () => setActiveNetwork(null),
  });

  if (!isNativeApp() || !networks || networks.length === 0) return null;

  return (
    <section aria-label="Partner videos" className="mt-8">
      <div className="mb-3 flex items-center gap-2">
        <Smartphone className="size-4 text-emerald-500" />
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">More videos</h2>
        <span className="text-sm text-slate-500 dark:text-slate-400">from our partner networks</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {networks.map((network) => (
          <Card key={network.id} className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Video className="size-4" />
              </span>
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">{network.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  ≈ {formatUsd(network.rewardMicros)} per video
                </p>
              </div>
            </div>
            <Button
              size="sm"
              block
              loading={watch.isPending && activeNetwork === network.id}
              onClick={() => watch.mutate(network)}
            >
              {watch.isPending && activeNetwork === network.id ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CirclePlay className="size-4" />
              )}
              Watch & earn
            </Button>
          </Card>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
        Videos are verified server-side by each network — your reward lands automatically, even if the
        confirmation takes a few seconds.
      </p>
    </section>
  );
}
