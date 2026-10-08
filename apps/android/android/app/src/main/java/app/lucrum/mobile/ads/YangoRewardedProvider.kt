package app.lucrum.mobile.ads

import android.app.Activity
import android.os.Handler
import android.os.Looper
import com.yango.mobile.ads.common.AdError
import com.yango.mobile.ads.common.AdRequestConfiguration
import com.yango.mobile.ads.common.MobileAds
import com.yango.mobile.ads.rewarded.Reward
import com.yango.mobile.ads.rewarded.RewardedAd
import com.yango.mobile.ads.rewarded.RewardedAdEventListener
import com.yango.mobile.ads.rewarded.RewardedAdLoadCallback
import com.yango.mobile.ads.rewarded.RewardedAdLoader

/**
 * Yango Ads rewarded video — very strong in Nigeria and Francophone Africa.
 *
 * Written against the Yango Mobile Ads Android SDK (com.yango.ads:mobileads) — verify
 * exact class/method names against the current SDK docs before building.
 *
 * SSV: the dashboard callback URL is https://<your-domain>/api/ssv/yango and the
 * user id travels with the ad request so the signed callback echoes our opaque
 * session token back to us.
 */
class YangoRewardedProvider : RewardedAdProvider {

    override val networkId = "yango"

    private val main = Handler(Looper.getMainLooper())
    private var adUnitId: String? = null
    private var sdkInitialised = false
    @Volatile private var ready = false
    private var showing = false
    private var rewarded = false
    private var onOutcome: ((RewardOutcome) -> Unit)? = null

    override fun initialize(activity: Activity, config: RewardedSdkConfig) {
        val unit = config.adUnitId
        if (unit.isNullOrBlank()) return
        adUnitId = unit
        if (sdkInitialised) return
        sdkInitialised = true
        MobileAds.initialize(activity)
    }

    override fun isReady(): Boolean = ready

    override fun show(activity: Activity, transId: String, onOutcome: (RewardOutcome) -> Unit) {
        val unit = adUnitId
        if (unit.isNullOrBlank()) {
            onOutcome(RewardOutcome.Error("Yango ad unit id is not configured"))
            return
        }
        this.onOutcome = onOutcome
        showing = true
        rewarded = false
        ready = false
        // The SSV callback echoes this back as the user id — our opaque session token.
        val request = AdRequestConfiguration.Builder(unit)
            .setUserData(transId)
            .build()
        RewardedAdLoader.loadAd(activity, request, object : RewardedAdLoadCallback {
            override fun onAdLoaded(ad: RewardedAd) {
                ready = true
                ad.setAdEventListener(object : RewardedAdEventListener {
                    override fun onAdShown() {}

                    override fun onAdDismissed() {
                        main.post {
                            val wasRewarded = rewarded
                            showing = false
                            ready = false
                            emit(if (wasRewarded) RewardOutcome.Rewarded else RewardOutcome.Dismissed)
                        }
                    }

                    override fun onAdClicked() {}

                    override fun onAdFailedToShow(error: AdError) {
                        main.post {
                            showing = false
                            emit(RewardOutcome.Error(error?.description ?: "ad failed to show"))
                        }
                    }

                    override fun onRewarded(reward: Reward) {
                        rewarded = true
                    }
                })
                main.post { if (showing) ad.show(activity) }
            }

            override fun onAdFailedToLoad(error: AdError) {
                ready = false
                main.post { emit(RewardOutcome.Unavailable) }
            }
        })
    }

    private fun emit(outcome: RewardOutcome) {
        onOutcome?.invoke(outcome)
        onOutcome = null
    }
}
