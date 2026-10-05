# Going live: from sandbox to real money

The sandbox simulates every outside party with the **same interfaces** the real integrations use, so going live is
configuration plus provider adapters — not a rewrite. Work through this list in order.

## 1. Company, compliance and policies

- [ ] Register the operating company and open business accounts that can **receive** network payments (Payoneer/Wise
      for USD) and **send** local payouts (Paystack/Flutterwave in Nigeria).
- [ ] Review the Terms, Privacy, Cookie and Earnings policies in `packages/shared/src/content/legal.ts` with a lawyer
      (NDPA 2023 for Nigeria, GDPR/UK GDPR, CCPA). Bump `TERMS_VERSION` when they change.
- [ ] Decide KYC/AML thresholds with your payout partners and set them in **Admin → Settings**
      (`phoneRequiredAboveMicros`, `kycThresholdMicros`, `payoutMaxPerDay`).
- [ ] Confirm the published revenue share (`revenueShareBps`) — it is a public promise.

## 2. Production configuration

```bash
NODE_ENV=production
DATABASE_URL=postgres://…            # managed Postgres with daily backups + PITR
DATA_ENCRYPTION_KEY=<openssl rand -hex 32>   # store in a secret manager; NEVER lose or rotate casually
APP_URL=https://your-domain
SANDBOX_MODE=false
SEED_DEMO=false
TRUST_PROXY=true
METRICS_TOKEN=<random>
```

- The server **refuses to boot** if `DATA_ENCRYPTION_KEY` doesn’t match the key that encrypted the database
  (encryption canary). Keep the key in a secret manager with access logging.
- Put the app behind HTTPS (cookies are `Secure` in production). Point uptime checks at `/api/ready` and Prometheus at
  `/api/metrics` (`Authorization: Bearer <METRICS_TOKEN>`). Alert on `lucrum_ledger_balanced != 1`, failed jobs and
  postback failure rate.
- Create the first admin, enable 2FA for every staff account, and remove demo users if you started from a demo DB.

## 3. Offer networks

Apply to offerwall networks that **allow incentivised traffic** (e.g. AdGate Media, BitLabs, CPX Research,
TheoremReach, Lootably, AyeT-Studios). For each approved network:

1. **Pick or write an adapter** in `apps/api/src/modules/networks/adapters.ts`:
   - `bitlabs` — HEX HMAC-SHA1 of the full callback URL appended as `&hash=` (BitLabs docs).
   - `md5wall` — `signature = md5(subId + transId + reward + secret)`, `status` 1 = credit, 2 = chargeback (the common
     Primewall/Elitewall-style dialect).
   - New dialect? Implement `verify`, `parse`, `respond` (and optionally `checkConversion` if the network exposes a
     conversion-status API — it powers instant Missing Credit resolution).
2. **Insert/activate the network row** (`networks` table): `adapter`, `kind`, encrypted `secret_enc`, and
   `config.clickUrlTemplate` with `{click_id}`, `{user_id}`, `{network_offer_id}` placeholders. Our click id travels as
   the network sub-id — that’s what makes cross-device credit and claims work.
3. **Configure the postback URL** in the network dashboard: `https://your-domain/api/postback/<networkId>?…` using the
   network’s macros, and add the network’s server IPs to **Admin → Networks → IP allowlist**.
4. **Import offers** (per-offer API feeds) into `offers` or embed iframe walls (`kind: 'iframe_wall'`,
   `config.iframeUrlTemplate`). Set countries, estimated minutes, data usage and pay speed honestly — the measured
   medians take over after five completions.
5. Watch **Admin → Postback logs** during the first conversions; use **Replay** after fixing configuration.

## 4. Payout providers

The provider interface lives in `apps/api/src/modules/payouts/providers.ts`
(`send`, optional `poll` and `nameEnquiry`; every call carries the payout id as an idempotency reference).

| Rail                                  | Status              | Notes                                                                                                                                                                                                                                                                                                     |
| ------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nigerian bank transfer — **Paystack** | ✅ adapter included | Set `PAYSTACK_SECRET_KEY` and `SANDBOX_MODE=false`. Configure the webhook `https://your-domain/api/webhooks/paystack` (HMAC-SHA512 verified). Uses transfer recipients + `/transfer`, verifies via `/transfer/verify/:reference`, resolves account names via `/bank/resolve`. Fund your Paystack balance. |
| Airtime & data (NG)                   | to implement        | VTpass / Reloadly / Baxi                                                                                                                                                                                                                                                                                  |
| Mobile money (GH/KE), UPI, GCash, Pix | to implement        | Flutterwave, Safaricom Daraja B2C, regional aggregators                                                                                                                                                                                                                                                   |
| PayPal                                | to implement        | PayPal Payouts API                                                                                                                                                                                                                                                                                        |
| Gift cards                            | to implement        | Tremendous (supports $1+ and many countries)                                                                                                                                                                                                                                                              |
| Lightning / USDT                      | to implement        | A custody/payments provider with an API; never hold hot-wallet keys in the app                                                                                                                                                                                                                            |

`providerFor()` chooses the live adapter per method. Until a rail has a live adapter, remove it from
`PAYOUT_METHODS` (or keep it disabled) — don’t ship the sandbox rail in production.

## 5. Messaging, identity, risk

- **Email:** wire `sendEmail()` in `modules/platform/messaging.ts` to Postmark/SES/Resend (set SPF, DKIM, DMARC).
- **SMS OTP:** wire `sendSms()` to Termii / Africa’s Talking / Twilio; keep the per-hour limits.
- **KYC:** replace the sandbox reviewer (`sandbox.kyc_review` job) with a vendor (Smile ID, Youverify, Dojah) and keep
  documents in private object storage (swap `storeUpload()` to S3/GCS with server-side encryption).
- **IP intelligence:** feed `ipKind()` from MaxMind minFraud / IPQS / ipinfo and enable `fraudIpSignals`.
- **Uploads:** `UPLOAD_DIR` must be persistent storage (or object storage) — never the container filesystem.

## 6. Launch checklist (spec §14.9)

- [ ] Legal docs reviewed and versioned
- [ ] Payment providers integrated and funded; payout limits set
- [ ] Offerwall networks integrated; postback URLs + IP allowlists configured; test conversions verified
- [ ] Fraud thresholds tuned; staff trained on the review queues and appeal policy
- [ ] Admin panel accounts with 2FA; least-privilege roles (support / finance / admin)
- [ ] Support inbox staffed to meet the 24-hour SLA
- [ ] Analytics & monitoring alerts (ledger balance, failed jobs, postback failure rate, payout latency)
- [ ] Backups verified with a restore drill
- [ ] Security review / penetration test passed
- [ ] Load test (target: 10k concurrent members on the read paths)
- [ ] Beta with 100 members; collect payout-speed and claim-SLA metrics before scaling
- [ ] Community channels (Telegram/Discord) live and linked in `PublicConfigDTO.brand.community`
