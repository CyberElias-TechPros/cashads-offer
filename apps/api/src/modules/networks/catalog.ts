import type { NetworkCategory, NetworkKind } from '@lucrum/shared';

/**
 * The Lucrum network catalog: every ad / offerwall / survey network we know how
 * to connect, with the exact adapter dialect, credential env vars and wall URL
 * template. `syncNetworkCatalog` (modules/networks/service.ts) turns this into
 * `networks` rows on every boot:
 *
 *   • env secret present  → row is created/updated and ACTIVE (ready to earn)
 *   • env secret absent   → row is created/updated as PAUSED (visible in admin,
 *                           one env var away from going live)
 *
 * URL templates support the placeholders {user_id} (opaque wall-session token —
 * never the raw user id), {app_token}, {app_id}, {click_id} and {session_id}.
 *
 * Signature schemes are implemented in modules/networks/adapters.ts. Where a
 * network's exact scheme must be confirmed in its dashboard, the entry says so —
 * the adapter families cover the common variants.
 */

export type CatalogAdapter = 'bitlabs' | 'md5wall' | 'cpx' | 'hmacq' | 'hmacurl' | 'pangle_ssv' | 'unsigned';

export interface NetworkCatalogEntry {
  id: string;
  name: string;
  adapter: CatalogAdapter;
  kind: Exclude<NetworkKind, 'native'>;
  /** What this network's inventory is made of. */
  categories: NetworkCategory[];
  /** ISO country codes with strong local inventory. Empty = global. */
  regions: string[];
  signupUrl: string;
  docsUrl: string;
  /**
   * Credential env vars. `secret` is the postback/SSV signing key — setting it
   * activates the network. `sdkKey`/`appId`/`adUnitId` configure the mobile SDK
   * (they ship in the app binary by design — they are public client credentials).
   * `revenueMicros` optionally overrides the estimated per-impression network
   * revenue used for partner rewarded-video creatives.
   */
  env: {
    secret?: string;
    appToken?: string;
    appId?: string;
    sdkKey?: string;
    adUnitId?: string;
    revenueMicros?: string;
  };
  /** Redirect/click tracking URL (offerwall kind). */
  clickUrlTemplate?: string;
  /** Embeddable wall URL (iframe_wall / survey_wall kind). */
  iframeUrlTemplate?: string;
  /** Hostname allowed to render inside our iframe (CSP frame-src). */
  frameHost?: string;
  /** Extra adapter config (e.g. hmacurl hashAlgo / sigParam). */
  adapterConfig?: Record<string, unknown>;
  /** Human note about the signature scheme this adapter implements. */
  signatureNote: string;
  /**
   * Policy warning for networks whose terms restrict incentivized/cash-reward
   * traffic. Surfaced in the admin console and docs.
   */
  policyNote?: string;
  /** Hard flag: excluded from member-facing surfaces (e.g. partner video). */
  policyRestricted?: boolean;
  /** Operator notes: strengths, region behaviour, caveats. */
  notes: string;
}

/** Kinds that expose a member-facing "wall" (task list) to open. */
export const WALL_KINDS: NetworkKind[] = ['offerwall', 'iframe_wall', 'survey_wall'];

export const NETWORK_CATALOG: NetworkCatalogEntry[] = [
  /* ── Africa / Tier-3 champions (launch regions) ─────────────────────────── */

  {
    id: 'cpx-research',
    name: 'CPX Research',
    adapter: 'cpx',
    kind: 'survey_wall',
    categories: ['surveys'],
    regions: ['NG', 'KE', 'GH', 'ZA', 'EG', 'IN', 'PH', 'BR', 'MX', 'US', 'GB', 'DE'],
    signupUrl: 'https://www.cpx-research.com/',
    docsUrl: 'https://docs.cpx-research.com/',
    env: { secret: 'LUCRUM_NET_CPX_SECRET', appId: 'LUCRUM_NET_CPX_APP_ID' },
    iframeUrlTemplate: 'https://cpx-research.com/surveys?app_id={app_id}&ext_user_id={user_id}',
    frameHost: 'cpx-research.com',
    signatureNote:
      'md5(trans_id-user_id-amount-secret) in the `hash` param; status 1 = credit, 2 = reversal.',
    notes:
      'Strongest survey inventory for Nigeria and Africa; pays a small disqualification reward, which keeps users engaged. Web-first iframe — ideal for Lucrum.',
  },
  {
    id: 'bitlabs',
    name: 'BitLabs',
    adapter: 'bitlabs',
    kind: 'survey_wall',
    categories: ['surveys'],
    regions: [],
    signupUrl: 'https://bitlabs.ai/',
    docsUrl: 'https://developer.bitlabs.ai/',
    env: { secret: 'LUCRUM_NET_BITLABS_SECRET', appToken: 'LUCRUM_NET_BITLABS_APP_TOKEN' },
    iframeUrlTemplate: 'https://web.bitlabs.ai/?uid={user_id}&token={app_token}',
    frameHost: 'web.bitlabs.ai',
    signatureNote: 'HMAC-SHA1 hex of the full callback URL minus the `hash` param (per BitLabs docs).',
    notes: 'Modern survey UI, large inventory in developing markets, pays on screen-outs too.',
  },
  {
    id: 'monlix',
    name: 'Monlix',
    adapter: 'md5wall',
    kind: 'offerwall',
    categories: ['microtasks', 'app_installs', 'signups'],
    regions: ['NG', 'KE', 'GH', 'ZA', 'BR', 'IN', 'PH'],
    signupUrl: 'https://monlix.com/',
    docsUrl: 'https://monlix.com/publishers',
    env: { secret: 'LUCRUM_NET_MONLIX_SECRET' },
    clickUrlTemplate: 'https://monlix.com/wall?subId={user_id}&subId2={click_id}',
    signatureNote: 'md5(subId + transId + reward + secret) in the `signature` param.',
    notes:
      'Very popular with African reward-site users; micro-tasks and short-link style offers that do not depend on Tier-1 ad spend.',
  },
  {
    id: 'timewall',
    name: 'TimeWall',
    adapter: 'hmacq',
    kind: 'offerwall',
    categories: ['microtasks', 'video', 'quizzes'],
    regions: [],
    signupUrl: 'https://timewall.io/',
    docsUrl: 'https://docs.timewall.io/',
    env: { secret: 'LUCRUM_NET_TIMEWALL_SECRET', appToken: 'LUCRUM_NET_TIMEWALL_APP_TOKEN' },
    clickUrlTemplate: 'https://timewall.io/wall?user_id={user_id}&app_token={app_token}',
    signatureNote:
      'HMAC-SHA256 hex over the sorted query string minus `sig` (confirm exact scheme in dashboard).',
    notes:
      'Micro-tasks (watch short videos, visit sites, clicks) with guaranteed small payouts — a good fallback when surveys have no fill.',
  },
  {
    id: 'notik',
    name: 'Notik.me',
    adapter: 'hmacq',
    kind: 'offerwall',
    categories: ['signups', 'surveys', 'microtasks'],
    regions: [],
    signupUrl: 'https://notik.me/',
    docsUrl: 'https://notik.me/docs',
    env: { secret: 'LUCRUM_NET_NOTIK_SECRET', appId: 'LUCRUM_NET_NOTIK_APP_ID' },
    clickUrlTemplate: 'https://notik.me/wall?app_id={app_id}&user_id={user_id}',
    signatureNote:
      'HMAC-SHA256 hex over the sorted query string minus `sig` (confirm exact scheme in dashboard).',
    notes:
      'Global CPA/CPL tasks (free web sign-ups, quizzes) that perform across all regions including Africa.',
  },
  {
    id: 'lootably',
    name: 'Lootably',
    adapter: 'hmacq',
    kind: 'iframe_wall',
    categories: ['app_installs', 'surveys', 'signups', 'financial'],
    regions: [],
    signupUrl: 'https://lootably.com/',
    docsUrl: 'https://docs.lootably.com/',
    env: { secret: 'LUCRUM_NET_LOOTABLY_SECRET', appToken: 'LUCRUM_NET_LOOTABLY_APP_TOKEN' },
    iframeUrlTemplate: 'https://lootably.com/wall?user_id={user_id}&app_token={app_token}',
    frameHost: 'lootably.com',
    signatureNote:
      'HMAC-SHA256 hex over the sorted query string minus `sig` (confirm exact scheme in dashboard).',
    notes:
      'Clean web/API-first offerwall with strong cross-device tracking — one of the best fits for a web reward app.',
  },

  /* ── global offerwalls (Tier-1 strong, Africa moderate) ─────────────────── */

  {
    id: 'tapjoy',
    name: 'Tapjoy',
    adapter: 'hmacq',
    kind: 'offerwall',
    categories: ['app_installs', 'surveys', 'signups'],
    regions: ['US', 'GB', 'DE', 'CA', 'AU', 'NG', 'KE', 'ZA'],
    signupUrl: 'https://www.tapjoy.com/',
    docsUrl: 'https://dev.tapjoy.com/',
    env: { secret: 'LUCRUM_NET_TAPJOY_SECRET', appId: 'LUCRUM_NET_TAPJOY_APP_ID' },
    clickUrlTemplate: 'https://www.tapjoy.com/offerwall?app_id={app_id}&user_id={user_id}',
    signatureNote:
      'HMAC-SHA256 hex over the sorted query string minus `sig` (Tapjoy-style; confirm in dashboard).',
    notes:
      'The gold standard for multi-step CPE game tasks (install → reach level N). Huge demand in Tier-1; Africa fill is thinner — keep as one option among many.',
  },
  {
    id: 'adjoe',
    name: 'Adjoe (Playtime)',
    adapter: 'hmacq',
    kind: 'offerwall',
    categories: ['playtime', 'app_installs'],
    regions: [],
    signupUrl: 'https://adjoe.io/',
    docsUrl: 'https://docs.adjoe.io/',
    env: { secret: 'LUCRUM_NET_ADJOE_SECRET', appToken: 'LUCRUM_NET_ADJOE_APP_TOKEN' },
    clickUrlTemplate: 'https://playtime.adjoe.io/?app_token={app_token}&user_id={user_id}',
    signatureNote:
      'HMAC-SHA256 hex over the sorted query string minus `sig` (confirm exact scheme in dashboard).',
    notes:
      'Playtime format: users earn for minutes actively spent in a task app. Works well on web and Android alike.',
  },
  {
    id: 'adgem',
    name: 'AdGem',
    adapter: 'hmacq',
    kind: 'offerwall',
    categories: ['app_installs', 'surveys'],
    regions: [],
    signupUrl: 'https://www.adgem.com/',
    docsUrl: 'https://docs.adgem.com/',
    env: { secret: 'LUCRUM_NET_ADGEM_SECRET', appId: 'LUCRUM_NET_ADGEM_APP_ID' },
    clickUrlTemplate: 'https://www.adgem.com/wall?app_id={app_id}&sub_id={user_id}',
    signatureNote:
      'HMAC-SHA256 hex over the sorted query string minus `sig` (confirm exact scheme in dashboard).',
    notes: 'Gaming-focused milestones with a developer-friendly setup; strong for reach-a-level tasks.',
  },
  {
    id: 'adscend',
    name: 'Adscend Media',
    adapter: 'hmacq',
    kind: 'iframe_wall',
    categories: ['surveys', 'signups', 'financial', 'app_installs'],
    regions: [],
    signupUrl: 'https://www.adscendmedia.com/',
    docsUrl: 'https://help.adscendmedia.com/',
    env: { secret: 'LUCRUM_NET_ADSCEND_SECRET', appId: 'LUCRUM_NET_ADSCEND_APP_ID' },
    iframeUrlTemplate: 'https://www.adscendmedia.com/wall?app_id={app_id}&sub_id={user_id}',
    frameHost: 'www.adscendmedia.com',
    signatureNote:
      'HMAC-SHA256 hex over the sorted query string minus `sig` (confirm exact scheme in dashboard).',
    notes:
      'Veteran network; "Market Cube" brings high-paying survey profiling alongside classic offerwall tasks.',
  },
  {
    id: 'revu',
    name: 'RevenueUniverse (RevU)',
    adapter: 'hmacq',
    kind: 'offerwall',
    categories: ['signups', 'financial', 'surveys'],
    regions: [],
    signupUrl: 'https://www.revenueuniverse.com/',
    docsUrl: 'https://www.revenueuniverse.com/docs',
    env: { secret: 'LUCRUM_NET_REVU_SECRET', appId: 'LUCRUM_NET_REVU_APP_ID' },
    clickUrlTemplate: 'https://www.revenueuniverse.com/wall?app_id={app_id}&user_id={user_id}',
    signatureNote:
      'HMAC-SHA256 hex over the sorted query string minus `sig` (confirm exact scheme in dashboard).',
    notes:
      'SDK-free / iframe-friendly veteran of the desktop reward space: financial trials, casino registrations and sign-up tasks that need no mobile device.',
  },
  {
    id: 'ayet',
    name: 'Ayet Studios',
    adapter: 'hmacq',
    kind: 'iframe_wall',
    categories: ['app_installs', 'surveys', 'video'],
    regions: [],
    signupUrl: 'https://www.ayetstudios.com/',
    docsUrl: 'https://www.ayetstudios.com/docs',
    env: { secret: 'LUCRUM_NET_AYET_SECRET', appId: 'LUCRUM_NET_AYET_APP_ID' },
    iframeUrlTemplate: 'https://www.ayetstudios.com/offerwall?app_id={app_id}&user_id={user_id}',
    frameHost: 'www.ayetstudios.com',
    signatureNote:
      'HMAC-SHA256 hex over the sorted query string minus `sig` (confirm exact scheme in dashboard).',
    notes: 'Reliable iframe/webview offerwall with a broad global task mix.',
  },
  {
    id: 'adgate',
    name: 'AdGate Media (Torox)',
    adapter: 'md5wall',
    kind: 'offerwall',
    categories: ['app_installs', 'signups', 'financial', 'quizzes'],
    regions: [],
    signupUrl: 'https://www.adgatemedia.com/',
    docsUrl: 'https://www.adgatemedia.com/docs',
    env: { secret: 'LUCRUM_NET_ADGATE_SECRET' },
    clickUrlTemplate: 'https://wall.adgatemedia.com/?subId={user_id}&subId2={click_id}',
    signatureNote: 'md5(subId + transId + reward + secret) in the `signature` param (classic AdGate scheme).',
    notes: 'Multi-regional web offers; Torox is the same house’s brand — pick one wall domain per account.',
  },
  {
    id: 'undrads',
    name: 'UndrAds',
    adapter: 'hmacq',
    kind: 'offerwall',
    categories: ['app_installs', 'surveys', 'signups'],
    regions: [],
    signupUrl: 'https://undrads.com/',
    docsUrl: 'https://docs.undrads.com/',
    env: { secret: 'LUCRUM_NET_UNDRADS_SECRET', appToken: 'LUCRUM_NET_UNDRADS_APP_TOKEN' },
    clickUrlTemplate: 'https://undrads.com/wall?user_id={user_id}&app_token={app_token}',
    signatureNote:
      'HMAC-SHA256 hex over the sorted query string minus `sig` (confirm exact scheme in dashboard).',
    notes: 'AI-optimised mixed offerwall with flexible SDK or API integration.',
  },
  {
    id: 'pollfish',
    name: 'Pollfish',
    adapter: 'unsigned',
    kind: 'survey_wall',
    categories: ['surveys'],
    regions: [],
    signupUrl: 'https://www.pollfish.com/',
    docsUrl: 'https://www.pollfish.com/docs/',
    env: { secret: 'LUCRUM_NET_POLLFISH_TOKEN', appToken: 'LUCRUM_NET_POLLFISH_APP_TOKEN' },
    iframeUrlTemplate: 'https://www.pollfish.com/survey?userId={user_id}&api_key={app_token}',
    frameHost: 'www.pollfish.com',
    signatureNote:
      'No HMAC — static shared token (`token` param or bearer) plus a mandatory IP allowlist. Configure Pollfish’s server IPs.',
    notes:
      'Sleek overlay-style survey widget; web-friendly. Because it is unsigned, the IP allowlist is mandatory.',
  },

  /* ── rewarded video / ad mediation (SSV-verified) ───────────────────────── */

  {
    id: 'admob',
    name: 'Google AdMob',
    adapter: 'hmacurl',
    kind: 'ads',
    categories: ['video'],
    regions: [],
    signupUrl: 'https://admob.google.com/',
    docsUrl: 'https://developers.google.com/admob/android/rewarded-ads#server-side_verification',
    env: {
      secret: 'LUCRUM_NET_ADMOB_SSV_SECRET',
      appId: 'LUCRUM_NET_ADMOB_APP_ID',
      adUnitId: 'LUCRUM_NET_ADMOB_AD_UNIT_ID',
    },
    adapterConfig: { hashAlgo: 'sha256', sigParam: 'signature' },
    signatureNote: 'HMAC-SHA256 hex of the full callback URL minus the `signature` param (AdMob SSV).',
    policyRestricted: true,
    policyNote:
      'POLICY-RESTRICTED for cash-reward apps: AdMob allows rewarded video with in-app VIRTUAL rewards (game coins), but paying users real money for ad engagement is invalid/incentivized traffic under Google’s policies — accounts get terminated. Do NOT use for Lucrum’s cash earn flow. AdSense is likewise off-limits (incentivized clicks are prohibited).',
    notes:
      'Largest global mobile ad network. Kept in the catalog for completeness — the adapter works, but the policy warning above applies. Web rewarded needs the AdMob web SDK.',
  },
  {
    id: 'applovin',
    name: 'AppLovin MAX',
    adapter: 'pangle_ssv',
    kind: 'ads',
    categories: ['video'],
    regions: [],
    signupUrl: 'https://www.applovin.com/',
    docsUrl: 'https://dash.applovin.com/documentation/mediation/android/rewarded-ads',
    env: {
      secret: 'LUCRUM_NET_APPLOVIN_SSV_SECRET',
      sdkKey: 'LUCRUM_NET_APPLOVIN_SDK_KEY',
      adUnitId: 'LUCRUM_NET_APPLOVIN_AD_UNIT_ID',
      revenueMicros: 'LUCRUM_NET_APPLOVIN_REVENUE_MICROS',
    },
    signatureNote:
      'sha256(secret:trans_id) in the `sign` param (SSV family; confirm exact scheme in dashboard).',
    notes:
      'Top mediation platform — stack multiple demand sources in one rewarded placement. SSV callback → /api/ssv/applovin.',
  },
  {
    id: 'levelplay',
    name: 'Unity LevelPlay',
    adapter: 'pangle_ssv',
    kind: 'ads',
    categories: ['video'],
    regions: [],
    signupUrl: 'https://www.is.com/',
    docsUrl: 'https://developers.is.com/',
    env: {
      secret: 'LUCRUM_NET_LEVELPLAY_SSV_SECRET',
      appId: 'LUCRUM_NET_LEVELPLAY_APP_ID',
      adUnitId: 'LUCRUM_NET_LEVELPLAY_AD_UNIT_ID',
      revenueMicros: 'LUCRUM_NET_LEVELPLAY_REVENUE_MICROS',
    },
    signatureNote:
      'sha256(secret:trans_id) in the `sign` param (SSV family; confirm exact scheme in dashboard).',
    notes:
      'Unity Ads / ironSource LevelPlay — ideal for game-adjacent reward apps. SSV callback → /api/ssv/levelplay.',
  },
  {
    id: 'inmobi',
    name: 'InMobi',
    adapter: 'unsigned',
    kind: 'ads',
    categories: ['video'],
    regions: [],
    signupUrl: 'https://www.inmobi.com/',
    docsUrl: 'https://support.inmobi.com/',
    env: {
      secret: 'LUCRUM_NET_INMOBI_TOKEN',
      appId: 'LUCRUM_NET_INMOBI_APP_ID',
      adUnitId: 'LUCRUM_NET_INMOBI_AD_UNIT_ID',
      revenueMicros: 'LUCRUM_NET_INMOBI_REVENUE_MICROS',
    },
    signatureNote:
      'No HMAC — static shared token plus a mandatory IP allowlist. Configure InMobi’s callback IPs.',
    notes: 'Global mobile ad network with rewarded video; strong in Asia and Africa.',
  },
  {
    id: 'meta-fan',
    name: 'Meta Audience Network',
    adapter: 'unsigned',
    kind: 'ads',
    categories: ['video'],
    regions: [],
    signupUrl: 'https://www.facebook.com/audiencenetwork',
    docsUrl: 'https://developers.facebook.com/docs/audience-network/',
    env: {
      secret: 'LUCRUM_NET_META_TOKEN',
      adUnitId: 'LUCRUM_NET_META_PLACEMENT_ID',
      revenueMicros: 'LUCRUM_NET_META_REVENUE_MICROS',
    },
    signatureNote: 'No HMAC — static shared token plus a mandatory IP allowlist.',
    policyNote:
      'Verify Meta’s incentivized-traffic terms before enabling for cash rewards; rewarded fill is weak outside games.',
    notes:
      'Rewarded video is SDK-first; useful once the Android app ships. Web fill is limited — keep as a fallback.',
  },
  {
    id: 'pangle',
    name: 'Pangle (TikTok Ads)',
    adapter: 'pangle_ssv',
    kind: 'ads',
    categories: ['video'],
    regions: ['NG', 'KE', 'GH', 'ZA', 'IN', 'PH', 'BR', 'MX'],
    signupUrl: 'https://www.pangle-ads.com/',
    docsUrl: 'https://www.pangle-ads.com/docs/',
    env: {
      secret: 'LUCRUM_NET_PANGLE_SSV_SECRET',
      appId: 'LUCRUM_NET_PANGLE_APP_ID',
      adUnitId: 'LUCRUM_NET_PANGLE_AD_UNIT_ID',
      revenueMicros: 'LUCRUM_NET_PANGLE_REVENUE_MICROS',
    },
    signatureNote:
      'sha256(secret:trans_id) in the `sign` param (Pangle SSV — exact dialect this adapter implements).',
    notes:
      'Strong fill in Nigeria and emerging markets; a top rewarded-video choice for reward apps in Africa.',
  },
  {
    id: 'yango',
    name: 'Yango Ads',
    adapter: 'pangle_ssv',
    kind: 'ads',
    categories: ['video'],
    regions: ['NG', 'KE', 'GH', 'ZA', 'EG'],
    signupUrl: 'https://yangoads.com/',
    docsUrl: 'https://yangoads.com/docs',
    env: {
      secret: 'LUCRUM_NET_YANGO_SSV_SECRET',
      appId: 'LUCRUM_NET_YANGO_APP_ID',
      adUnitId: 'LUCRUM_NET_YANGO_AD_UNIT_ID',
      revenueMicros: 'LUCRUM_NET_YANGO_REVENUE_MICROS',
    },
    signatureNote:
      'sha256(secret:trans_id) in the `sign` param (SSV family; confirm exact scheme in dashboard).',
    notes:
      'Yango (Yandex) — very strong in Nigeria and Francophone Africa; rewarded video with SSV callbacks.',
  },
  {
    id: 'vungle',
    name: 'Vungle (Liftoff)',
    adapter: 'pangle_ssv',
    kind: 'ads',
    categories: ['video'],
    regions: [],
    signupUrl: 'https://www.vungle.com/',
    docsUrl: 'https://support.vungle.com/',
    env: {
      secret: 'LUCRUM_NET_VUNGLE_SSV_SECRET',
      appId: 'LUCRUM_NET_VUNGLE_APP_ID',
      adUnitId: 'LUCRUM_NET_VUNGLE_AD_UNIT_ID',
      revenueMicros: 'LUCRUM_NET_VUNGLE_REVENUE_MICROS',
    },
    signatureNote:
      'SSV family (sha256(secret:trans_id)); confirm whether the account exposes SSV or use a postback dialect.',
    notes: 'Major rewarded-video network with solid Africa fill; widely used in reward apps.',
  },
  {
    id: 'mintegral',
    name: 'Mintegral',
    adapter: 'pangle_ssv',
    kind: 'ads',
    categories: ['video'],
    regions: ['NG', 'KE', 'ZA', 'BR', 'IN', 'PH'],
    signupUrl: 'https://www.mintegral.com/',
    docsUrl: 'https://help.mintegral.com/',
    env: {
      secret: 'LUCRUM_NET_MINTEGRAL_SSV_SECRET',
      appId: 'LUCRUM_NET_MINTEGRAL_APP_ID',
      adUnitId: 'LUCRUM_NET_MINTEGRAL_AD_UNIT_ID',
      revenueMicros: 'LUCRUM_NET_MINTEGRAL_REVENUE_MICROS',
    },
    signatureNote:
      'sha256(secret:trans_id) in the `sign` param (SSV family; confirm exact scheme in dashboard).',
    notes: 'Strong in emerging markets; popular with reward and hypercasual apps.',
  },
  {
    id: 'fyber',
    name: 'Fyber (Digital Turbine Exchange)',
    adapter: 'pangle_ssv',
    kind: 'ads',
    categories: ['video'],
    regions: [],
    signupUrl: 'https://www.fyber.com/',
    docsUrl: 'https://developer.fyber.com/',
    env: {
      secret: 'LUCRUM_NET_FYBER_SSV_SECRET',
      appId: 'LUCRUM_NET_FYBER_APP_ID',
      adUnitId: 'LUCRUM_NET_FYBER_AD_UNIT_ID',
      revenueMicros: 'LUCRUM_NET_FYBER_REVENUE_MICROS',
    },
    signatureNote:
      'sha256(secret:trans_id) in the `sign` param (SSV family; confirm exact scheme in dashboard).',
    notes: 'Mediation/exchange with rewarded inventory; good as a backfill demand source.',
  },
  {
    id: 'chartboost',
    name: 'Chartboost',
    adapter: 'pangle_ssv',
    kind: 'ads',
    categories: ['video'],
    regions: [],
    signupUrl: 'https://www.chartboost.com/',
    docsUrl: 'https://help.chartboost.com/',
    env: {
      secret: 'LUCRUM_NET_CHARTBOOST_SSV_SECRET',
      appId: 'LUCRUM_NET_CHARTBOOST_APP_ID',
      sdkKey: 'LUCRUM_NET_CHARTBOOST_APP_SIGNATURE',
      adUnitId: 'LUCRUM_NET_CHARTBOOST_AD_UNIT_ID',
      revenueMicros: 'LUCRUM_NET_CHARTBOOST_REVENUE_MICROS',
    },
    signatureNote:
      'sha256(secret:trans_id) in the `sign` param (SSV family; confirm exact scheme in dashboard).',
    notes: 'Rewarded-video veteran; Tier-1-heavy fill — pair with Pangle/Yango for Africa.',
  },
];

/* ── derived helpers ───────────────────────────────────────────────────────── */

export const catalogById = new Map(NETWORK_CATALOG.map((n) => [n.id, n]));

export function getCatalogEntry(id: string): NetworkCatalogEntry | undefined {
  return catalogById.get(id);
}

/** Hosts that must be allowed in the production CSP frame-src (embeddable walls). */
export const WALL_FRAME_HOSTS: string[] = [
  ...new Set(NETWORK_CATALOG.map((n) => n.frameHost).filter((h): h is string => Boolean(h))),
].map((h) => `https://${h}`);

/** Which credential env vars are set right now (for the admin console). */
export function catalogEnvStatus(entry: NetworkCatalogEntry): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const key of Object.values(entry.env)) if (key) out[key] = Boolean(process.env[key]);
  return out;
}

/** Does this catalog entry have everything needed to take postbacks? */
export function catalogSecretConfigured(entry: NetworkCatalogEntry): boolean {
  return Boolean(entry.env.secret && process.env[entry.env.secret]);
}
