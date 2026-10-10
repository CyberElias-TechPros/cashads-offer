# Lucrum for Android

The Lucrum Android app is a [Capacitor](https://capacitorjs.com/) shell over the
Lucrum PWA (`apps/web`), plus a small native bridge that fixes the three things a
plain WebView can't do for a rewards app:

| Capability                                       | Why it matters                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GAID device id** (`LucrumBridge.getDeviceId`)  | Ad networks (Tapjoy, Adjoe, AdGem, AdMob, AppLovin…) attribute installs and pay postbacks per **device**. The web app's random id means Android installs would never credit. The app adopts the GAID as the Lucrum device id at startup — unless the user opted out of ad tracking (`limitAdTracking`), in which case we keep the web id. |
| **Browser escape** (`LucrumBridge.openExternal`) | Offerwall links must open in a **real browser** (Custom Tab), not the in-app WebView. WebViews strip the referrer data networks need for tracking, so tasks would complete but never pay. The web app calls this for every external wall/task link when running natively.                                                                 |
| **Network info** (`LucrumBridge.getNetworkInfo`) | Powers data-saver behaviour on metered/slow connections (important in our launch markets).                                                                                                                                                                                                                                                |

The web app talks to the bridge through `window.Capacitor.nativePromise`
(`apps/web/src/lib/native.ts`) — **no `@capacitor/core` dependency on the web side**.
In a browser everything degrades gracefully to `null`.

## Project layout

```
apps/android
├── capacitor.config.ts          # appId app.lucrum.mobile, webDir ../web/dist
├── package.json                 # @lucrum/android workspace
└── android/                     # native project (Capacitor 8.5.3 template)
    ├── app/src/main/java/app/lucrum/mobile/
    │   ├── MainActivity.kt          # BridgeActivity + registers LucrumBridgePlugin
    │   └── LucrumBridgePlugin.kt    # GAID / network info / Custom Tabs / app info
    ├── app/src/main/AndroidManifest.xml  # INTERNET, ACCESS_NETWORK_STATE, AD_ID, deep links
    └── app/src/main/res/            # brand colors, splash, adaptive icons
```

## Build & run

Requirements: **JDK 21**, **Android Studio** (or the Android SDK with
`ANDROID_HOME` set), and the Lucrum web app built once.

```bash
# from the repo root
npm install
npm run android -- sync        # builds apps/web and syncs it into the Android project
npm run android -- open        # opens android/ in Android Studio
# then press Run ▶ (or: npm run android -- run)
```

Handy scripts (run from `apps/android` or via `npm run android -- <cmd>` from the root):

```bash
npx cap copy        # copy web assets only (fast)
npx cap sync        # copy + update native plugins
npx cap open android
npx cap run android # build + install on a connected device/emulator
```

## Configuration notes

- **`webDir: ../web/dist`** — the app loads the built PWA from the app bundle over
  an `https` scheme (`server.androidScheme`), so the first launch works offline.
- **Deep links** — `https://lucrum-app.vercel.app` is declared as an App Links
  host (`android:autoVerify="true"`) plus a `lucrum://` scheme fallback. Host the
  `assetlinks.json` from the web app to complete verification.
- **Security** — `allowBackup="false"` (no money-adjacent data in backups),
  `usesCleartextTraffic="false"`, and `com.google.android.gms.permission.AD_ID`
  declared for GAID. The web app's session cookie is `Secure` + `HttpOnly`.
- **Release builds** — set `minifyEnabled true` + R8 rules for the bridge, and
  sign with a release keystore. `versionCode`/`versionName` live in
  `android/app/build.gradle`.

## Partner rewarded-video SDKs (built in)

Three rewarded-video networks are compiled into the app and served through the
`LucrumBridge` plugin — **AppLovin MAX**, **Pangle** and **Yango Ads** (the strongest
fill for Nigeria/Africa). AdMob/AdSense are deliberately **not** integrated: paying
users real cash for ad engagement violates Google's invalid-traffic policy.

```
android/app/src/main/java/app/lucrum/mobile/ads/
├── RewardedAdProvider.kt        # common interface + RewardOutcome
├── RewardedAdsManager.kt        # registry — add a network = one provider + one line
├── AppLovinRewardedProvider.kt
├── PangleRewardedProvider.kt
└── YangoRewardedProvider.kt
```

**How a video earns (money only moves server-side):**

1. Web app: `POST /api/ads/partner-sessions { networkId }` → server creates an ad
   session with an honest pre-set reward and returns the opaque `transId`.
2. Web app: `LucrumBridge.initRewardedAd(network, sdk)` (once) then
   `LucrumBridge.showRewardedAd(network, transId)`.
3. The provider hands `transId` to the network as its SSV user id.
4. The SDK's "rewarded" event is UX feedback only → web app calls
   `POST /api/ads/partner-sessions/:id/native-complete` (session → `verifying`).
5. The network's **signed SSV callback** hits `/api/ssv/<network>` → Lucrum verifies
   the signature, matches `trans_id`, and credits the ledger. The client can never
   credit itself. Live balance updates arrive over the existing SSE stream.

The Watch page (`/app/watch`) shows a **"More videos"** section automatically when
running inside the native app.

### Wiring up live keys

For each network, on the API server (`.env` — see `.env.example`):

```bash
LUCRUM_NET_APPLOVIN_SSV_SECRET=…  LUCRUM_NET_APPLOVIN_SDK_KEY=…  LUCRUM_NET_APPLOVIN_AD_UNIT_ID=…
LUCRUM_NET_PANGLE_SSV_SECRET=…    LUCRUM_NET_PANGLE_APP_ID=…    LUCRUM_NET_PANGLE_AD_UNIT_ID=…
LUCRUM_NET_YANGO_SSV_SECRET=…     LUCRUM_NET_YANGO_APP_ID=…     LUCRUM_NET_YANGO_AD_UNIT_ID=…
# Optional: LUCRUM_NET_<NAME>_REVENUE_MICROS=… to change the estimated per-impression revenue.
```

Then in each network's dashboard, set the **server-side callback URL**:

```
https://<your-domain>/api/ssv/applovin
https://<your-domain>/api/ssv/pangle
https://<your-domain>/api/ssv/yango
```

using the network's macros for `trans_id` / user id so the signed callback echoes our
session token. The catalog sync creates the partner creative rows automatically; the
networks appear on the Watch page once active.

### Adding another video network

Vungle, Mintegral, Fyber, Chartboost and LevelPlay are already in the server catalog
(one env var away). To compile them into the app: add the SDK dependency in
`app/build.gradle`, write a `RewardedAdProvider` (the three above are the template),
register it in `RewardedAdsManager`, and add ProGuard keeps in `proguard-rules.pro`.

> ⚠️ **Verify the SDK API surface before building.** The providers are written against
> each network's documented Android SDK, but SDK APIs change — check the current docs
> for exact class/method names (each provider file says which SDK it targets). The
> provider interface localises any adjustments to one file per network.

## Troubleshooting

- **`cap sync` fails with missing `../web/dist`** — run `npm run build -w @lucrum/web` first.
- **Gradle sync fails** — install JDK 21 and the Android SDK (compileSdk **36**,
  minSdk **24**), accept the licenses (`sdkmanager --licenses`).
- **GAID returns empty on test devices** — expected without Play Services; the
  bridge falls back to `ANDROID_ID`.
