package app.lucrum.mobile.ads

import android.app.Activity

/**
 * Mobile-SDK credentials for a partner rewarded-video network. These are public
 * client credentials by design (they ship inside the app binary) — the money moves
 * only on the network's signed server-to-server callback, which Lucrum verifies.
 */
data class RewardedSdkConfig(
    val appId: String?,
    val sdkKey: String?,
    val adUnitId: String?,
)

/** What happened when a rewarded video was shown. UX feedback only — never the payout. */
sealed class RewardOutcome {
    data object Rewarded : RewardOutcome()
    data object Dismissed : RewardOutcome()
    data object Unavailable : RewardOutcome()
    data class Error(val message: String) : RewardOutcome()
}

/**
 * One partner network's rewarded-video SDK behind a common interface, so the bridge
 * plugin and the web app stay network-agnostic. Adding a network (Vungle, Mintegral,
 * Fyber, Chartboost, LevelPlay…) = one provider class + one line in RewardedAdsManager.
 *
 * Every provider must pass the session's opaque `transId` to the network as its SSV
 * user id — Lucrum's /api/ssv/<network> endpoint matches on it (never the user UUID).
 */
interface RewardedAdProvider {
    val networkId: String

    /** Initialise the SDK and pre-load. Idempotent. */
    fun initialize(activity: Activity, config: RewardedSdkConfig)

    /** True when an ad is loaded and can be shown immediately. */
    fun isReady(): Boolean

    /** Show a rewarded ad. [transId] is handed to the network as its SSV user id. */
    fun show(activity: Activity, transId: String, onOutcome: (RewardOutcome) -> Unit)
}
