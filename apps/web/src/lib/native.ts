/**
 * Bridge to the native Android shell (apps/android — Capacitor).
 *
 * The Capacitor runtime injects `window.Capacitor` with `nativePromise`, which
 * reaches plugins registered in MainActivity (LucrumBridgePlugin). The web app
 * never depends on @capacitor/core — it just talks to the injected runtime.
 *
 * In a browser (or the PWA) none of this exists and every helper degrades to null.
 */

interface CapacitorRuntime {
  isNativePlatform?: () => boolean;
  nativePromise?: (plugin: string, method: string, args?: Record<string, unknown>) => Promise<unknown>;
}

declare global {
  interface Window {
    Capacitor?: CapacitorRuntime;
  }
}

export function isNativeApp(): boolean {
  try {
    return Boolean(window.Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

/** Call a method on the LucrumBridge native plugin. Null in browsers / on failure. */
export async function nativeCall<T>(method: string, args: Record<string, unknown> = {}): Promise<T | null> {
  const cap = window.Capacitor;
  if (!cap?.nativePromise) return null;
  try {
    return (await cap.nativePromise('LucrumBridge', method, args)) as T;
  } catch {
    return null;
  }
}

export interface NativeDeviceId {
  advertisingId: string;
  limitAdTracking: boolean;
  source: 'gaid' | 'android_id';
}

export interface NativeNetworkInfo {
  type: 'wifi' | 'cellular' | 'other' | 'none';
  metered: boolean;
}

export interface NativeAppInfo {
  versionName: string;
  versionCode: number;
}

/** GAID (the device id ad networks trust on Android) via the native bridge. */
export function nativeDeviceId() {
  return nativeCall<NativeDeviceId>('getDeviceId');
}

export function nativeNetworkInfo() {
  return nativeCall<NativeNetworkInfo>('getNetworkInfo');
}

export function nativeAppInfo() {
  return nativeCall<NativeAppInfo>('getAppInfo');
}

/**
 * Opens a URL in the device's real browser (Custom Tab) instead of the WebView.
 * Critical for task tracking: in-app WebViews strip the referrer data offerwall
 * networks need to attribute installs. Falls back to window.open on web.
 */
export async function openExternal(url: string): Promise<void> {
  if (isNativeApp()) {
    const ok = await nativeCall<null>('openExternal', { url });
    if (ok !== null) return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/* ── partner rewarded video (native SDK networks) ──────────────────────────── */

export interface NativeRewardedSdk {
  appId?: string | null;
  sdkKey?: string | null;
  adUnitId?: string | null;
}

export interface NativeRewardedResult {
  status: 'rewarded' | 'dismissed' | 'unavailable' | 'error';
  message?: string;
}

/** Initialise a partner network's rewarded-video SDK (idempotent per network). */
export function initRewardedAd(network: string, sdk: NativeRewardedSdk) {
  return nativeCall<null>('initRewardedAd', { network, ...sdk });
}

/**
 * Shows a rewarded video from a partner network. The network's signed SSV callback
 * credits the session server-side — this result is UX feedback, not the payout.
 */
export function showRewardedAd(network: string, transId: string) {
  return nativeCall<NativeRewardedResult>('showRewardedAd', { network, transId });
}
