# Ad & offer networks: the full integration guide

Lucrum connects to **offerwalls, survey walls and rewarded-video networks** through a
catalog-driven system. You do not edit code to add a network — you set credentials.

```
apps/api/src/modules/networks/
├── catalog.ts     # every network we know: adapter dialect, env vars, wall URL templates
├── adapters.ts    # postback signature dialects (verify / parse / respond per network family)
└── service.ts     # catalog sync (boot), member wall listing, tracked wall sessions
```

## How connecting a network works

1. **Sign up** with the network as a publisher (links in the table below).
2. **Set env vars** on the API server (`.env`):

   ```bash
   LUCRUM_NET_CPX_SECRET=…      # postback signing secret (REQUIRED — activates the network)
   LUCRUM_NET_CPX_APP_ID=…      # app id (goes into wall URLs)
   LUCRUM_NET_BITLABS_SECRET=…
   LUCRUM_NET_BITLABS_APP_TOKEN=…
   # … one pair per network, see the table.
   ```

3. **Restart the API.** `syncNetworkCatalog` runs on boot: networks with credentials
   become `active` and start earning immediately; networks without credentials appear
   in **Admin → Networks** as `paused` with their env var names shown — one variable
   away from live.
4. **Point the postback URL** at us (from the network dashboard):

   ```
   https://your-domain/api/postback/<networkId>
   ```

   Rewarded-video SSV networks use `https://your-domain/api/ssv/<networkId>` instead.

5. **Add the network's server IPs** to the network's IP allowlist (**Admin → Networks**).
   This is mandatory for `unsigned` networks and recommended everywhere.
6. Watch the first conversions in **Admin → Postback logs**; **Replay** re-runs any
   stored postback through the full verification pipeline.

No redeploy is needed to _pause_ a network — that's an admin toggle.

## The catalog

Signature schemes are implemented in `adapters.ts`. Where a network's exact scheme
must be confirmed in its dashboard, the entry says so — the adapter families cover
the common variants, and adding a new dialect is one object in `adapters.ts`.

### Surveys (best first fill for web + Africa)

| Network          | Adapter    | Kind                 | Env vars                                                     | Regions                     | Notes                                                                                                               |
| ---------------- | ---------- | -------------------- | ------------------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **CPX Research** | `cpx`      | survey wall (iframe) | `LUCRUM_NET_CPX_SECRET`, `LUCRUM_NET_CPX_APP_ID`             | NG, KE, GH, ZA, EG + global | Strongest African survey inventory; pays disqualification rewards. Postback: `md5(trans_id-user_id-amount-secret)`. |
| **BitLabs**      | `bitlabs`  | survey wall (iframe) | `LUCRUM_NET_BITLABS_SECRET`, `LUCRUM_NET_BITLABS_APP_TOKEN`  | global                      | Modern UI, pays on screen-outs. Postback: HMAC-SHA1 hex of the full callback URL minus `hash`.                      |
| **Pollfish**     | `unsigned` | survey wall (iframe) | `LUCRUM_NET_POLLFISH_TOKEN`, `LUCRUM_NET_POLLFISH_APP_TOKEN` | global                      | No HMAC — **IP allowlist mandatory**.                                                                               |

### Offerwalls (tasks, app trials, sign-ups, playtime)

| Network                    | Adapter   | Kind                | Env vars                                                      | Regions                 | Notes                                                                              |
| -------------------------- | --------- | ------------------- | ------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| **Tapjoy**                 | `hmacq`   | offerwall (browser) | `LUCRUM_NET_TAPJOY_SECRET`, `LUCRUM_NET_TAPJOY_APP_ID`        | Tier-1 strong, NG/KE/ZA | Gold standard for multi-step CPE game tasks.                                       |
| **Adjoe**                  | `hmacq`   | offerwall (browser) | `LUCRUM_NET_ADJOE_SECRET`, `LUCRUM_NET_ADJOE_APP_TOKEN`       | global                  | Playtime format — pay per minute actively spent in an app.                         |
| **AdGem**                  | `hmacq`   | offerwall (browser) | `LUCRUM_NET_ADGEM_SECRET`, `LUCRUM_NET_ADGEM_APP_ID`          | global                  | Gaming milestones, developer-friendly.                                             |
| **Lootably**               | `hmacq`   | offerwall (iframe)  | `LUCRUM_NET_LOOTABLY_SECRET`, `LUCRUM_NET_LOOTABLY_APP_TOKEN` | global                  | Web/API-first, strong cross-device tracking.                                       |
| **Monlix**                 | `md5wall` | offerwall (browser) | `LUCRUM_NET_MONLIX_SECRET`                                    | Africa strong           | Micro-tasks + app installs that don't depend on Tier-1 ad spend.                   |
| **Adscend Media**          | `hmacq`   | offerwall (iframe)  | `LUCRUM_NET_ADSCEND_SECRET`, `LUCRUM_NET_ADSCEND_APP_ID`      | global                  | "Market Cube" survey profiling + classic walls.                                    |
| **RevenueUniverse (RevU)** | `hmacq`   | offerwall (browser) | `LUCRUM_NET_REVU_SECRET`, `LUCRUM_NET_REVU_APP_ID`            | global                  | SDK-free veteran; financial trials, sign-ups.                                      |
| **Ayet Studios**           | `hmacq`   | offerwall (iframe)  | `LUCRUM_NET_AYET_SECRET`, `LUCRUM_NET_AYET_APP_ID`            | global                  | Broad global task mix, webview-friendly.                                           |
| **AdGate Media (Torox)**   | `md5wall` | offerwall (browser) | `LUCRUM_NET_ADGATE_SECRET`                                    | global                  | Classic `md5(subId+transId+reward+secret)` scheme.                                 |
| **UndrAds**                | `hmacq`   | offerwall (browser) | `LUCRUM_NET_UNDRADS_SECRET`, `LUCRUM_NET_UNDRADS_APP_TOKEN`   | global                  | AI-optimised mixed wall, SDK or API.                                               |
| **Notik.me**               | `hmacq`   | offerwall (browser) | `LUCRUM_NET_NOTIK_SECRET`, `LUCRUM_NET_NOTIK_APP_ID`          | global                  | CPA/CPL sign-ups and quizzes, all regions.                                         |
| **TimeWall**               | `hmacq`   | offerwall (browser) | `LUCRUM_NET_TIMEWALL_SECRET`, `LUCRUM_NET_TIMEWALL_APP_TOKEN` | global                  | Micro-tasks with guaranteed small payouts — good fallback when surveys don't fill. |

### Rewarded video & mediation (SSV-verified; strongest on the Android app)

> ⚠️ **Policy warning — AdMob/AdSense are effectively off-limits for Lucrum.** AdMob allows rewarded
> video with in-app _virtual_ rewards (game coins), but paying users **real cash** for ad engagement is
> invalid/incentivized traffic under Google's policies — reward apps doing this get terminated. AdSense
> likewise prohibits incentivized clicks. The networks below explicitly allow incentivized rewarded
> traffic — that is their business. The `admob` catalog entry is kept for completeness but carries a
> `policyNote` flag; do not enable it for the cash earn flow.

| Network                   | Adapter      | Env vars                           | Postback              | Regions                | Notes                                                                              |
| ------------------------- | ------------ | ---------------------------------- | --------------------- | ---------------------- | ---------------------------------------------------------------------------------- |
| **Pangle (TikTok Ads)**   | `pangle_ssv` | `LUCRUM_NET_PANGLE_SSV_SECRET`     | `/api/ssv/pangle`     | NG/KE/GH/ZA + emerging | Strong Africa fill; top video pick for reward apps.                                |
| **Yango Ads**             | `pangle_ssv` | `LUCRUM_NET_YANGO_SSV_SECRET`      | `/api/ssv/yango`      | NG/KE/GH/ZA/EG         | Very strong in Nigeria & Francophone Africa.                                       |
| **AppLovin MAX**          | `pangle_ssv` | `LUCRUM_NET_APPLOVIN_SSV_SECRET`   | `/api/ssv/applovin`   | global                 | Most-used mediation in reward apps; stack demand sources.                          |
| **Unity LevelPlay**       | `pangle_ssv` | `LUCRUM_NET_LEVELPLAY_SSV_SECRET`  | `/api/ssv/levelplay`  | global                 | ironSource/Unity Ads; ideal for game-adjacent apps.                                |
| **Vungle (Liftoff)**      | `pangle_ssv` | `LUCRUM_NET_VUNGLE_SSV_SECRET`     | `/api/ssv/vungle`     | global                 | Major rewarded network, solid Africa fill.                                         |
| **Mintegral**             | `pangle_ssv` | `LUCRUM_NET_MINTEGRAL_SSV_SECRET`  | `/api/ssv/mintegral`  | emerging markets       | Popular with reward/hypercasual apps.                                              |
| **Fyber (DT Exchange)**   | `pangle_ssv` | `LUCRUM_NET_FYBER_SSV_SECRET`      | `/api/ssv/fyber`      | global                 | Good backfill demand.                                                              |
| **Chartboost**            | `pangle_ssv` | `LUCRUM_NET_CHARTBOOST_SSV_SECRET` | `/api/ssv/chartboost` | Tier-1 heavy           | Pair with Pangle/Yango for Africa.                                                 |
| **InMobi**                | `unsigned`   | `LUCRUM_NET_INMOBI_TOKEN`          | `/api/ssv/inmobi`     | global                 | Strong Asia/Africa. **IP allowlist mandatory.**                                    |
| **Meta Audience Network** | `unsigned`   | `LUCRUM_NET_META_TOKEN`            | `/api/ssv/meta-fan`   | global                 | Weak rewarded fill; verify incentivized-traffic terms. **IP allowlist mandatory.** |
| ~~Google AdMob~~          | `hmacurl`    | `LUCRUM_NET_ADMOB_SSV_SECRET`      | `/api/ssv/admob`      | —                      | **Policy-restricted for cash rewards — do not enable** (see warning above).        |

On the web these networks' rewarded formats need their web SDKs; on Android, the top
three are **compiled into `apps/android`** (AppLovin MAX, Pangle, Yango Ads — see
`apps/android/README.md`) and surface on the Watch page automatically. Their SSV
endpoints (`/api/ssv/<network>`) verify the networks' signed callbacks, and members
are credited only server-side. Adding another video network to the app = one provider
class + one line in `RewardedAdsManager`.

**For a cash-reward app on Android, the offerwall SDKs earn more than video.** Tapjoy (CPE milestones),
Adjoe (Playtime — pay per minute played) and AdGem (game milestones) are the highest-value integrations;
their SDKs drop into `apps/android` and their postbacks already work through `/api/postback/<networkId>`.

## Adapter dialects

| Dialect      | Signature                                                                                     | Used by                                         |
| ------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `bitlabs`    | HMAC-SHA1 hex of full callback URL minus `hash` param                                         | BitLabs                                         |
| `md5wall`    | `md5(subId + transId + reward + secret)` in `signature`                                       | AdGate, Monlix, Primewall/Elitewall-style walls |
| `cpx`        | `md5(trans_id-user_id-amount-secret)` in `hash`                                               | CPX Research                                    |
| `hmacq`      | HMAC-SHA256 hex over sorted query minus `sig`                                                 | Tapjoy-style modern walls                       |
| `hmacurl`    | HMAC (sha256 default, `hashAlgo`/`sigParam` configurable) over full URL minus signature param | AdMob SSV, BitLabs-style URL signing            |
| `pangle_ssv` | `sha256(secret:trans_id)` in `sign`                                                           | Pangle-style rewarded SSV                       |
| `unsigned`   | static token (`token` param or bearer) — **IP allowlist mandatory**                           | Pollfish, InMobi, Meta FAN                      |

Adding a network = one adapter object in `adapters.ts` + one entry in `catalog.ts`.

## How members use walls (and how tracking stays safe)

- **Earn page → "Task walls & surveys"** lists every active wall network, geo-filtered
  to the member's country, with each network's live postback success rate.
- Opening a wall creates a **wall session** (`wall_sessions` table) and hands the
  network a signed URL carrying an **opaque session token** — never the raw user id.
- Embeddable walls (`iframe_wall`, `survey_wall`) open in a sandboxed modal; the rest
  open in the device browser (Custom Tab on Android) so tracking sees a real browser.
  In **data-saver mode** everything opens externally — heavy walls cost too much data.
- Postbacks carrying the session token resolve back to the member through
  `wall_sessions` and credit the ledger atomically (idempotent per network transaction id).
  Sessions stay resolvable for **30 days** — milestone tasks ("reach level 20") take weeks.
- If the member's connection drops mid-task, the app logs an **interrupted session**
  (`POST /api/networks/sessions/interrupted`) — evidence for a Missing Credit claim
  if the postback never arrives. Lucrum still pays even when tracking fails.

## Fraud & compliance for web reward traffic

Web reward apps are prime targets for bot farms, VPNs and emulator abuse. Layers in
place:

1. **Per-network IP allowlists** on every postback endpoint (`Admin → Networks`).
2. **Cryptographic postback verification** — every dialect above; unsigned networks
   require a shared token + allowlist.
3. **IP reputation lookups** — set `IPQS_API_KEY` (IP Quality Score) and the API
   flags VPN/proxy/Tor/datacenter IPs at sign-up and at wall-open, with a 24h cache
   (`modules/fraud/iprep.ts`). Fails open — a provider outage never blocks earning.
4. **Explainable fraud scoring** — every score point is a named, reviewable flag
   (shared device, disposable email, velocity, ad tampering…), with automatic
   _pause_ (never auto-ban) above the block threshold.
5. **Payout holds & escrow** — payouts above the auto-approve fraud score are held
   for human review; high-value earnings sit behind provider floors and shown fees.
6. **S2S-only crediting** — members can never credit themselves from the browser;
   the network must ping the server with a valid signature.

## Admin checklist per network

- [ ] Env credentials set → network shows `active` after restart
- [ ] Postback/SSV URL configured in the network dashboard
- [ ] Network server IPs added to the IP allowlist
- [ ] Wall URL template verified (open the wall as a member, complete a task)
- [ ] First postback visible in **Admin → Postback logs** with `signatureValid: true`
- [ ] Reliability badge on the Earn page starts moving (30-day postback success rate)
