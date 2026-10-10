package app.lucrum.mobile

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.browser.customtabs.CustomTabsIntent
import app.lucrum.mobile.ads.RewardOutcome
import app.lucrum.mobile.ads.RewardedAdsManager
import app.lucrum.mobile.ads.RewardedSdkConfig
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.gms.ads.identifier.AdvertisingIdClient

/**
 * Lucrum native bridge.
 *
 * The web app (apps/web) reaches this through `window.Capacitor.nativePromise`
 * (see apps/web/src/lib/native.ts) — the web side has no @capacitor/core dependency.
 *
 * Why these methods exist:
 *  • getDeviceId    — GAID is the device identifier ad networks trust for install
 *                     attribution on Android (the web's random id is not). The app
 *                     adopts it as the Lucrum device id at startup — unless the user
 *                     opted out of ad tracking, in which case we keep the web id.
 *  • getNetworkInfo — lets the PWA react to metered/slow connections (data-saver).
 *  • openExternal   — opens task links in a Custom Tab (a real browser) instead of
 *                     the WebView: in-app WebViews strip the referrer data that
 *                     offerwall networks need, which breaks install tracking.
 *  • getAppInfo     — version info for support/debug screens.
 */
@CapacitorPlugin(name = "LucrumBridge")
class LucrumBridgePlugin : Plugin() {

    @PluginMethod
    fun getDeviceId(call: PluginCall) {
        // AdvertisingIdClient must not be called on the main thread.
        Thread {
            try {
                val info = AdvertisingIdClient.getAdvertisingIdInfo(context)
                val ret = JSObject()
                ret.put("advertisingId", info.id ?: "")
                ret.put("limitAdTracking", info.isLimitAdTrackingEnabled)
                ret.put("source", if (info.id != null) "gaid" else "android_id")
                call.resolve(ret)
            } catch (e: Exception) {
                // No Play Services (some OEM ROMs) — fall back to ANDROID_ID.
                val ret = JSObject()
                ret.put("advertisingId", androidId())
                ret.put("limitAdTracking", false)
                ret.put("source", "android_id")
                call.resolve(ret)
            }
        }.start()
    }

    @PluginMethod
    fun getNetworkInfo(call: PluginCall) {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.activeNetwork?.let { cm.getNetworkCapabilities(it) }
        val type = when {
            caps == null -> "none"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            else -> "other"
        }
        val ret = JSObject()
        ret.put("type", type)
        ret.put("metered", cm.isActiveNetworkMetered)
        call.resolve(ret)
    }

    @PluginMethod
    fun openExternal(call: PluginCall) {
        val url = call.getString("url")
        if (url.isNullOrBlank()) {
            call.reject("url is required")
            return
        }
        try {
            CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(url))
            call.resolve()
        } catch (e: Exception) {
            // No Custom Tabs provider — fall back to a plain browser intent.
            try {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(intent)
                call.resolve()
            } catch (err: Exception) {
                call.reject("could not open browser", err)
            }
        }
    }

    @PluginMethod
    fun getAppInfo(call: PluginCall) {
        val ret = JSObject()
        try {
            val pi = if (Build.VERSION.SDK_INT >= 33) {
                context.packageManager.getPackageInfo(
                    context.packageName,
                    PackageManager.PackageInfoFlags.of(0),
                )
            } else {
                @Suppress("DEPRECATION")
                context.packageManager.getPackageInfo(context.packageName, 0)
            }
            ret.put("versionName", pi.versionName ?: "")
            ret.put(
                "versionCode",
                if (Build.VERSION.SDK_INT >= 28) pi.longVersionCode else pi.versionCode.toLong(),
            )
        } catch (e: Exception) {
            ret.put("versionName", "")
            ret.put("versionCode", 0)
        }
        ret.put("packageName", context.packageName)
        call.resolve(ret)
    }

    /* ── partner rewarded video ─────────────────────────────────────────────── */

    /**
     * Initialise a partner network's rewarded-video SDK. Called by the web app with
     * the credentials served by GET /api/ads/networks (public client credentials).
     */
    @PluginMethod
    fun initRewardedAd(call: PluginCall) {
        val network = call.getString("network")
        if (network.isNullOrBlank()) {
            call.reject("network is required")
            return
        }
        val provider = RewardedAdsManager.provider(network)
        if (provider == null) {
            call.reject("unknown network: $network (supported: ${RewardedAdsManager.supportedNetworks()})")
            return
        }
        val activity = bridge.activity
        if (activity == null) {
            call.reject("activity unavailable")
            return
        }
        try {
            provider.initialize(
                activity,
                RewardedSdkConfig(
                    appId = call.getString("appId"),
                    sdkKey = call.getString("sdkKey"),
                    adUnitId = call.getString("adUnitId"),
                ),
            )
            call.resolve()
        } catch (e: Exception) {
            call.reject("init failed for $network", e)
        }
    }

    /**
     * Show a rewarded video. `transId` is the Lucrum ad-session token from
     * POST /api/ads/partner-sessions — the network echoes it in its signed SSV
     * callback, which is what actually credits the member (the result below is
     * UX feedback only).
     */
    @PluginMethod
    fun showRewardedAd(call: PluginCall) {
        val network = call.getString("network")
        val transId = call.getString("transId")
        if (network.isNullOrBlank() || transId.isNullOrBlank()) {
            call.reject("network and transId are required")
            return
        }
        val provider = RewardedAdsManager.provider(network)
        if (provider == null) {
            call.reject("unknown network: $network")
            return
        }
        val activity = bridge.activity
        if (activity == null) {
            call.reject("activity unavailable")
            return
        }
        val main = Handler(Looper.getMainLooper())
        var resolved = false
        val finish: (RewardOutcome) -> Unit = { outcome ->
            if (resolved) return@finish
            resolved = true
            val ret = JSObject()
            when (outcome) {
                is RewardOutcome.Rewarded -> ret.put("status", "rewarded")
                is RewardOutcome.Dismissed -> ret.put("status", "dismissed")
                is RewardOutcome.Unavailable -> ret.put("status", "unavailable")
                is RewardOutcome.Error -> {
                    ret.put("status", "error")
                    ret.put("message", outcome.message)
                }
            }
            main.post { call.resolve(ret) }
        }
        // Safety net: never leave the web app hanging if the SDK goes quiet.
        main.postDelayed({ finish(RewardOutcome.Unavailable) }, 120_000)
        try {
            provider.show(activity, transId, finish)
        } catch (e: Exception) {
            finish(RewardOutcome.Error(e.message ?: "show failed"))
        }
    }

    private fun androidId(): String =
        Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID) ?: ""
}
