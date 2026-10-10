package app.lucrum.mobile.ads

import android.app.Activity
import android.os.Handler
import android.os.Looper
import com.bytedance.sdk.openadsdk.api.reward.PAGRewardVideoAd
import com.bytedance.sdk.openadsdk.api.reward.PAGRewardVideoAdInteractionCallback
import com.bytedance.sdk.openadsdk.api.reward.PAGRewardVideoAdLoadCallback
import com.bytedance.sdk.openadsdk.api.reward.PAGRewardVideoRequest
import com.bytedance.sdk.openadsdk.api.init.PAGConfig
import com.bytedance.sdk.openadsdk.api.init.PAGSdk

/**
 * Pangle (TikTok Ads) rewarded video — strong fill in Nigeria and emerging markets.
 *
 * Written against the Pangle global Android SDK (com.pangle.global:ads-sdk) — verify
 * exact class/method names against the current SDK docs before building.
 *
 * SSV: the dashboard callback URL is https://<your-domain>/api/ssv/pangle and the
 * user id is passed with `PAGRewardVideoRequest.Builder().setUserID(transId)` so the
 * signed callback echoes our opaque session token back to us.
 */
class PangleRewardedProvider : RewardedAdProvider {

    override val networkId = "pangle"

    private val main = Handler(Looper.getMainLooper())
    private var appId: String? = null
    private var adUnitId: String? = null
    private var sdkInitialised = false
    @Volatile private var ready = false
    private var showing = false
    private var rewarded = false
    private var onOutcome: ((RewardOutcome) -> Unit)? = null

    override fun initialize(activity: Activity, config: RewardedSdkConfig) {
        val app = config.appId
        val unit = config.adUnitId
        if (app.isNullOrBlank() || unit.isNullOrBlank()) return
        appId = app
        adUnitId = unit
        if (sdkInitialised) return
        sdkInitialised = true
        PAGSdk.init(activity, PAGConfig.Builder().appId(app).build())
    }

    override fun isReady(): Boolean = ready

    override fun show(activity: Activity, transId: String, onOutcome: (RewardOutcome) -> Unit) {
        val unit = adUnitId
        if (unit.isNullOrBlank()) {
            onOutcome(RewardOutcome.Error("Pangle ad unit id is not configured"))
            return
        }
        this.onOutcome = onOutcome
        showing = true
        rewarded = false
        ready = false
        // The SSV callback echoes this back as the user id — our opaque session token.
        val request = PAGRewardVideoRequest.Builder()
            .setAdUnitID(unit)
            .setUserID(transId)
            .build()
        PAGRewardVideoAd.loadAd(activity, request, object : PAGRewardVideoAdLoadCallback {
            override fun onError(code: Int, message: String?) {
                ready = false
                main.post { emit(RewardOutcome.Unavailable) }
            }

            override fun onRewardVideoAdLoaded(ad: PAGRewardVideoAd?) {
                if (ad == null) {
                    main.post { emit(RewardOutcome.Unavailable) }
                    return
                }
                ready = true
                ad.setAdInteractionListener(object : PAGRewardVideoAdInteractionCallback {
                    override fun onAdShowed() {}

                    override fun onAdClicked() {}

                    override fun onVideoAdPlay() {}

                    override fun onVideoAdComplete() {
                        rewarded = true
                    }

                    override fun onAdDismissed() {
                        main.post {
                            val wasRewarded = rewarded
                            showing = false
                            ready = false
                            emit(if (wasRewarded) RewardOutcome.Rewarded else RewardOutcome.Dismissed)
                        }
                    }
                })
                main.post { if (showing) ad.showAd(activity) }
            }
        })
    }

    private fun emit(outcome: RewardOutcome) {
        onOutcome?.invoke(outcome)
        onOutcome = null
    }
}
