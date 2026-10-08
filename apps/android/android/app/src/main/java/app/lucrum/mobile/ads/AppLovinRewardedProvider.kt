package app.lucrum.mobile.ads

import android.app.Activity
import android.os.Handler
import android.os.Looper
import com.applovin.mediation.MaxAd
import com.applovin.mediation.MaxError
import com.applovin.mediation.MaxReward
import com.applovin.mediation.MaxRewardedAdListener
import com.applovin.mediation.ads.MaxRewardedAd
import com.applovin.sdk.AppLovinSdk

/**
 * AppLovin MAX rewarded video.
 *
 * Written against the AppLovin MAX Android SDK (com.applovin:applovin-sdk) — verify
 * exact listener method names against the current SDK docs before building.
 *
 * SSV: the dashboard callback URL is https://<your-domain>/api/ssv/applovin and the
 * user id is passed with `setExtraParameter("user_id", transId)` so the signed
 * callback echoes our opaque session token back to us.
 */
class AppLovinRewardedProvider : RewardedAdProvider {

    override val networkId = "applovin"

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
        // SDK key is configured in the dashboard; the app just needs to initialise.
        AppLovinSdk.getInstance(activity).initializeSdk { }
    }

    override fun isReady(): Boolean = ready

    override fun show(activity: Activity, transId: String, onOutcome: (RewardOutcome) -> Unit) {
        val unit = adUnitId
        if (unit.isNullOrBlank()) {
            onOutcome(RewardOutcome.Error("AppLovin ad unit id is not configured"))
            return
        }
        this.onOutcome = onOutcome
        showing = true
        rewarded = false
        ready = false
        val ad = MaxRewardedAd.getInstance(unit, activity)
        // The SSV callback echoes this back as `user_id` — our opaque session token.
        ad.setExtraParameter("user_id", transId)
        ad.setListener(object : MaxRewardedAdListener {
            override fun onRewardedAdLoaded(ad: MaxAd) {
                ready = true
                main.post { if (showing) ad.showAd() }
            }

            override fun onRewardedAdLoadFailed(adUnitId: String, error: MaxError?) {
                ready = false
                main.post { emit(RewardOutcome.Unavailable) }
            }

            override fun onRewardedAdDisplayed(ad: MaxAd) {}

            override fun onRewardedAdHidden(ad: MaxAd) {
                main.post {
                    val wasRewarded = rewarded
                    showing = false
                    ready = false
                    emit(if (wasRewarded) RewardOutcome.Rewarded else RewardOutcome.Dismissed)
                }
            }

            override fun onRewardedAdClicked(ad: MaxAd) {}

            override fun onUserRewarded(ad: MaxAd, reward: MaxReward) {
                rewarded = true
            }
        })
        ad.loadAd()
    }

    private fun emit(outcome: RewardOutcome) {
        onOutcome?.invoke(outcome)
        onOutcome = null
    }
}
