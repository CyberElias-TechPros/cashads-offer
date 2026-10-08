package app.lucrum.mobile.ads

/**
 * Registry of the partner rewarded-video providers compiled into the app.
 * Adding a network (Vungle, Mintegral, Fyber, Chartboost, LevelPlay…) = one provider
 * class implementing [RewardedAdProvider] + one line in [providers].
 */
object RewardedAdsManager {

    private val providers: Map<String, RewardedAdProvider> = listOf(
        AppLovinRewardedProvider(),
        PangleRewardedProvider(),
        YangoRewardedProvider(),
    ).associateBy { it.networkId }

    fun provider(networkId: String): RewardedAdProvider? = providers[networkId]

    fun supportedNetworks(): List<String> = providers.keys.sorted()
}
