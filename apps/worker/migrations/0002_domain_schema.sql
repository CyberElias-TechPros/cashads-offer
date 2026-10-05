-- Port of the Lucrum PostgreSQL baseline to SQLite/D1.
-- Verify this migration in a disposable D1 database before production.

CREATE TABLE "achievements" (
	"user_id" TEXT NOT NULL,
	"code" text NOT NULL,
	"unlocked_at" TEXT DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT "achievements_user_id_code_pk" PRIMARY KEY("user_id","code")
);

CREATE TABLE "ad_creatives" (
	"id" text PRIMARY KEY NOT NULL,
	"network_id" text NOT NULL,
	"advertiser" text NOT NULL,
	"title" text NOT NULL,
	"tagline" text NOT NULL,
	"duration_seconds" integer NOT NULL,
	"revenue_micros" INTEGER NOT NULL,
	"lite" INTEGER DEFAULT true NOT NULL,
	"theme" TEXT NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "ad_sessions" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"user_id" TEXT NOT NULL,
	"creative_id" text NOT NULL,
	"device_key" text NOT NULL,
	"trans_id" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"events" TEXT DEFAULT '[]'::TEXT NOT NULL,
	"visible_ms" integer DEFAULT 0 NOT NULL,
	"reward_micros" INTEGER DEFAULT 0 NOT NULL,
	"bonus_micros" INTEGER DEFAULT 0 NOT NULL,
	"combo_level" integer DEFAULT 0 NOT NULL,
	"rejection_reason" text,
	"ledger_txn_id" TEXT,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL,
	"completed_at" TEXT,
	"expires_at" TEXT NOT NULL
);

CREATE TABLE "admin_notes" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"user_id" TEXT NOT NULL,
	"author_id" TEXT,
	"note" text NOT NULL,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "audit_logs" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"actor_id" TEXT,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"before" TEXT,
	"after" TEXT,
	"ip" text,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "charities" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"icon" text NOT NULL,
	"url" text NOT NULL,
	"impact_unit" text NOT NULL,
	"impact_unit_micros" INTEGER NOT NULL,
	"active" INTEGER DEFAULT true NOT NULL
);

CREATE TABLE "claim_events" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"claim_id" TEXT NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "claims" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"user_id" TEXT NOT NULL,
	"click_id" TEXT NOT NULL,
	"offer_id" TEXT NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"resolution" text,
	"amount_micros" INTEGER NOT NULL,
	"note" text NOT NULL,
	"completed_at_estimate" TEXT,
	"screenshot_path" text,
	"auto_filed" INTEGER DEFAULT false NOT NULL,
	"sla_due_at" TEXT NOT NULL,
	"resolved_at" TEXT,
	"resolved_by" TEXT,
	"rejection_reason" text,
	"chase_network" INTEGER DEFAULT false NOT NULL,
	"ledger_txn_id" TEXT,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL,
	"updated_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "conversions" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"network_id" text NOT NULL,
	"network_txn_id" text NOT NULL,
	"click_id" TEXT,
	"user_id" TEXT NOT NULL,
	"offer_id" TEXT,
	"title" text NOT NULL,
	"kind" text DEFAULT 'complete' NOT NULL,
	"payout_micros" INTEGER NOT NULL,
	"user_amount_micros" INTEGER NOT NULL,
	"platform_amount_micros" INTEGER NOT NULL,
	"status" text DEFAULT 'credited' NOT NULL,
	"source" text DEFAULT 'postback' NOT NULL,
	"duration_seconds" integer,
	"postback_log_id" TEXT,
	"ledger_txn_id" TEXT,
	"credited_at" TEXT DEFAULT (datetime('now')) NOT NULL,
	"reversed_at" TEXT
);

CREATE TABLE "daily_plans" (
	"user_id" TEXT NOT NULL,
	"plan_date" date NOT NULL,
	"offer_ids" TEXT NOT NULL,
	"bonus_paid" INTEGER DEFAULT false NOT NULL,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT "daily_plans_user_id_plan_date_pk" PRIMARY KEY("user_id","plan_date")
);

CREATE TABLE "devices" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"user_id" TEXT NOT NULL,
	"device_key" text NOT NULL,
	"fingerprint_hash" text,
	"label" text NOT NULL,
	"user_agent" text,
	"last_ip" text,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL,
	"last_seen_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "donations" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"user_id" TEXT NOT NULL,
	"charity_id" text NOT NULL,
	"amount_micros" INTEGER NOT NULL,
	"source" text NOT NULL,
	"ledger_txn_id" TEXT,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "earning_locks" (
	"user_id" TEXT PRIMARY KEY NOT NULL,
	"device_key" text NOT NULL,
	"device_label" text NOT NULL,
	"expires_at" TEXT NOT NULL
);

CREATE TABLE "feature_requests" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"user_id" TEXT NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"votes" integer DEFAULT 0 NOT NULL,
	"shipped_at" TEXT,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "feature_votes" (
	"user_id" TEXT NOT NULL,
	"request_id" TEXT NOT NULL,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT "feature_votes_user_id_request_id_pk" PRIMARY KEY("user_id","request_id")
);

CREATE TABLE "fraud_flags" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"user_id" TEXT NOT NULL,
	"type" text NOT NULL,
	"severity" integer NOT NULL,
	"details" TEXT DEFAULT '{}'::TEXT NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" TEXT,
	"resolved_at" TEXT,
	"resolution_note" text,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL,
	"updated_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "ip_rules" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"cidr" text NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" TEXT DEFAULT '{}'::TEXT NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"run_at" TEXT DEFAULT (datetime('now')) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"last_error" text,
	"dedupe_key" text,
	"locked_at" TEXT,
	"completed_at" TEXT,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "kyc_submissions" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"user_id" TEXT NOT NULL,
	"id_type" text NOT NULL,
	"id_number_enc" text NOT NULL,
	"id_number_masked" text NOT NULL,
	"full_name" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"document_path" text,
	"selfie_path" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewer_note" text,
	"reviewed_by" TEXT,
	"reviewed_at" TEXT,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "ledger_accounts" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"code" text NOT NULL,
	"user_id" TEXT,
	"kind" text NOT NULL,
	"normal_side" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"balance_micros" INTEGER DEFAULT 0 NOT NULL,
	"allow_negative" INTEGER DEFAULT false NOT NULL,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT "ledger_accounts_non_negative" CHECK ("ledger_accounts"."allow_negative" or "ledger_accounts"."balance_micros" >= 0)
);

CREATE TABLE "ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"transaction_id" TEXT NOT NULL,
	"account_id" TEXT NOT NULL,
	"direction" text NOT NULL,
	"amount_micros" INTEGER NOT NULL,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT "ledger_entries_positive" CHECK ("ledger_entries"."amount_micros" > 0)
);

CREATE TABLE "ledger_transactions" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"type" text NOT NULL,
	"user_id" TEXT,
	"idempotency_key" text NOT NULL,
	"description" text NOT NULL,
	"reference_type" text,
	"reference_id" text,
	"metadata" TEXT,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "lesson_attempts" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"user_id" TEXT NOT NULL,
	"lesson_id" text NOT NULL,
	"score" double precision NOT NULL,
	"passed" INTEGER NOT NULL,
	"reward_micros" INTEGER DEFAULT 0 NOT NULL,
	"ledger_txn_id" TEXT,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "login_events" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"user_id" TEXT,
	"email" text NOT NULL,
	"success" INTEGER NOT NULL,
	"reason" text,
	"ip" text,
	"user_agent" text,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "networks" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"adapter" text NOT NULL,
	"kind" text NOT NULL,
	"secret_enc" text,
	"ip_allowlist" TEXT DEFAULT '[]'::TEXT NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"config" TEXT DEFAULT '{}'::TEXT NOT NULL,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "notifications" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"user_id" TEXT NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"read_at" TEXT,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "offer_clicks" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"user_id" TEXT NOT NULL,
	"offer_id" TEXT NOT NULL,
	"device_key" text,
	"ip" text,
	"user_agent" text,
	"status" text DEFAULT 'started' NOT NULL,
	"started_at" TEXT DEFAULT (datetime('now')) NOT NULL,
	"reported_at" TEXT,
	"credited_at" TEXT,
	"expires_at" TEXT NOT NULL,
	"conversion_id" TEXT,
	"check_count" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "offer_ratings" (
	"user_id" TEXT NOT NULL,
	"offer_id" TEXT NOT NULL,
	"value" integer NOT NULL,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT "offer_ratings_user_id_offer_id_pk" PRIMARY KEY("user_id","offer_id")
);

CREATE TABLE "offer_reports" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"user_id" TEXT NOT NULL,
	"offer_id" TEXT NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" TEXT,
	"resolved_at" TEXT,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "offers" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"network_id" text NOT NULL,
	"network_offer_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"advertiser" text NOT NULL,
	"category" text NOT NULL,
	"steps" TEXT DEFAULT '[]'::TEXT NOT NULL,
	"payout_micros" INTEGER NOT NULL,
	"user_payout_override_micros" INTEGER,
	"est_minutes" double precision NOT NULL,
	"data_mb" double precision DEFAULT 1 NOT NULL,
	"pay_speed" text DEFAULT 'instant' NOT NULL,
	"countries" TEXT DEFAULT '[]'::TEXT NOT NULL,
	"icon" text DEFAULT '🎯' NOT NULL,
	"color" text DEFAULT '#10b981' NOT NULL,
	"tags" TEXT DEFAULT '[]'::TEXT NOT NULL,
	"is_lite" INTEGER DEFAULT false NOT NULL,
	"max_per_user" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"status_reason" text,
	"status_changed_at" TEXT,
	"stat_clicks" integer DEFAULT 0 NOT NULL,
	"stat_conversions" integer DEFAULT 0 NOT NULL,
	"stat_missing_claims" integer DEFAULT 0 NOT NULL,
	"stat_thumbs_up" integer DEFAULT 0 NOT NULL,
	"stat_thumbs_down" integer DEFAULT 0 NOT NULL,
	"stat_reports_open" integer DEFAULT 0 NOT NULL,
	"stat_median_seconds" integer,
	"stat_samples" integer DEFAULT 0 NOT NULL,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL,
	"updated_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "outbound_messages" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"user_id" TEXT,
	"channel" text NOT NULL,
	"to" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"meta" TEXT,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "payout_destinations" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"user_id" TEXT NOT NULL,
	"method_id" text NOT NULL,
	"label" text NOT NULL,
	"details_enc" text NOT NULL,
	"details_hash" text NOT NULL,
	"masked" text NOT NULL,
	"verified_name" text,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL,
	"last_used_at" TEXT,
	"deleted_at" TEXT
);

CREATE TABLE "payout_events" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"payout_id" TEXT NOT NULL,
	"status" text NOT NULL,
	"message" text NOT NULL,
	"actor" text DEFAULT 'system' NOT NULL,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "payouts" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"user_id" TEXT NOT NULL,
	"method_id" text NOT NULL,
	"destination_id" TEXT,
	"details_enc" text NOT NULL,
	"details_hash" text NOT NULL,
	"destination_masked" text NOT NULL,
	"amount_micros" INTEGER NOT NULL,
	"fee_micros" INTEGER NOT NULL,
	"net_micros" INTEGER NOT NULL,
	"local_currency" text NOT NULL,
	"fx_rate" double precision NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"status_reason" text,
	"review_reasons" TEXT DEFAULT '[]'::TEXT NOT NULL,
	"provider_reference" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" TEXT,
	"idempotency_key" text NOT NULL,
	"request_txn_id" TEXT,
	"final_txn_id" TEXT,
	"requested_at" TEXT DEFAULT (datetime('now')) NOT NULL,
	"processing_at" TEXT,
	"completed_at" TEXT,
	"updated_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "poll_responses" (
	"user_id" TEXT NOT NULL,
	"poll_id" text NOT NULL,
	"option_index" integer NOT NULL,
	"reward_micros" INTEGER NOT NULL,
	"ledger_txn_id" TEXT,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT "poll_responses_user_id_poll_id_pk" PRIMARY KEY("user_id","poll_id")
);

CREATE TABLE "postback_logs" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"network_id" text NOT NULL,
	"method" text NOT NULL,
	"url" text NOT NULL,
	"query" TEXT DEFAULT '{}'::TEXT NOT NULL,
	"body" TEXT,
	"headers" TEXT DEFAULT '{}'::TEXT NOT NULL,
	"ip" text,
	"signature_valid" INTEGER,
	"status" text DEFAULT 'received' NOT NULL,
	"error_code" text,
	"error_message" text,
	"network_txn_id" text,
	"click_id" text,
	"user_id" text,
	"conversion_id" TEXT,
	"processing_ms" integer,
	"replay_of" TEXT,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "referrals" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"referrer_id" TEXT NOT NULL,
	"referee_id" TEXT NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"qualified_at" TEXT,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "sandbox_network_conversions" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"network_id" text NOT NULL,
	"click_id" TEXT NOT NULL,
	"network_txn_id" text NOT NULL,
	"user_ref" text NOT NULL,
	"network_offer_id" text NOT NULL,
	"payout_micros" INTEGER NOT NULL,
	"kind" text DEFAULT 'complete' NOT NULL,
	"delivery_mode" text NOT NULL,
	"status" text DEFAULT 'converted' NOT NULL,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "sessions" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"user_id" TEXT NOT NULL,
	"token_hash" text NOT NULL,
	"device_id" TEXT,
	"label" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL,
	"last_used_at" TEXT DEFAULT (datetime('now')) NOT NULL,
	"expires_at" TEXT NOT NULL,
	"revoked_at" TEXT
);

CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" TEXT NOT NULL,
	"updated_at" TEXT DEFAULT (datetime('now')) NOT NULL,
	"updated_by" TEXT
);

CREATE TABLE "streaks" (
	"user_id" TEXT PRIMARY KEY NOT NULL,
	"current" integer DEFAULT 0 NOT NULL,
	"longest" integer DEFAULT 0 NOT NULL,
	"last_claim_date" date,
	"updated_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "ticket_messages" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"ticket_id" TEXT NOT NULL,
	"author_type" text NOT NULL,
	"author_id" TEXT,
	"body" text NOT NULL,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "tickets" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"user_id" TEXT,
	"email" text,
	"subject" text NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"sla_due_at" TEXT NOT NULL,
	"assigned_to" TEXT,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL,
	"updated_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "users" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"email" text NOT NULL,
	"email_verified_at" TEXT,
	"password_hash" text,
	"display_name" text,
	"full_name" text,
	"phone_enc" text,
	"phone_hash" text,
	"phone_last4" text,
	"phone_verified_at" TEXT,
	"country" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"display_currency" text DEFAULT 'USD' NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"ban_reason_code" text,
	"ban_message" text,
	"banned_at" TEXT,
	"balance_frozen" INTEGER DEFAULT false NOT NULL,
	"referral_code" text NOT NULL,
	"referred_by" TEXT,
	"kyc_status" text DEFAULT 'none' NOT NULL,
	"fraud_score" integer DEFAULT 0 NOT NULL,
	"tier" text DEFAULT 'bronze' NOT NULL,
	"totp_secret_enc" text,
	"totp_enabled_at" TEXT,
	"totp_last_step" INTEGER,
	"recovery_codes" TEXT,
	"prefs" TEXT NOT NULL,
	"onboarding_done_at" TEXT,
	"terms_version" text,
	"terms_accepted_at" TEXT,
	"signup_ip" text,
	"is_demo" INTEGER DEFAULT false NOT NULL,
	"last_seen_at" TEXT,
	"deleted_at" TEXT,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL,
	"updated_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE "verification_tokens" (
	"id" TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	"user_id" TEXT NOT NULL,
	"type" text NOT NULL,
	"token_hash" text NOT NULL,
	"meta" TEXT,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" TEXT NOT NULL,
	"used_at" TEXT,
	"created_at" TEXT DEFAULT (datetime('now')) NOT NULL
);

ALTER TABLE "achievements" ADD CONSTRAINT "achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ad_sessions" ADD CONSTRAINT "ad_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ad_sessions" ADD CONSTRAINT "ad_sessions_creative_id_ad_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."ad_creatives"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "admin_notes" ADD CONSTRAINT "admin_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "admin_notes" ADD CONSTRAINT "admin_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "claims" ADD CONSTRAINT "claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "claims" ADD CONSTRAINT "claims_click_id_offer_clicks_id_fk" FOREIGN KEY ("click_id") REFERENCES "public"."offer_clicks"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "claims" ADD CONSTRAINT "claims_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "claims" ADD CONSTRAINT "claims_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_click_id_offer_clicks_id_fk" FOREIGN KEY ("click_id") REFERENCES "public"."offer_clicks"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "daily_plans" ADD CONSTRAINT "daily_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "donations" ADD CONSTRAINT "donations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "donations" ADD CONSTRAINT "donations_charity_id_charities_id_fk" FOREIGN KEY ("charity_id") REFERENCES "public"."charities"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "earning_locks" ADD CONSTRAINT "earning_locks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "feature_requests" ADD CONSTRAINT "feature_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "feature_votes" ADD CONSTRAINT "feature_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "feature_votes" ADD CONSTRAINT "feature_votes_request_id_feature_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."feature_requests"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "kyc_submissions" ADD CONSTRAINT "kyc_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "kyc_submissions" ADD CONSTRAINT "kyc_submissions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "lesson_attempts" ADD CONSTRAINT "lesson_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "offer_clicks" ADD CONSTRAINT "offer_clicks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "offer_clicks" ADD CONSTRAINT "offer_clicks_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "offer_ratings" ADD CONSTRAINT "offer_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "offer_ratings" ADD CONSTRAINT "offer_ratings_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "offer_reports" ADD CONSTRAINT "offer_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "offer_reports" ADD CONSTRAINT "offer_reports_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "offer_reports" ADD CONSTRAINT "offer_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "offers" ADD CONSTRAINT "offers_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payout_destinations" ADD CONSTRAINT "payout_destinations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payout_events" ADD CONSTRAINT "payout_events_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_destination_id_payout_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."payout_destinations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "poll_responses" ADD CONSTRAINT "poll_responses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referee_id_users_id_fk" FOREIGN KEY ("referee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "streaks" ADD CONSTRAINT "streaks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_users_id_fk" FOREIGN KEY ("referred_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
CREATE UNIQUE INDEX "ad_sessions_trans_uq" ON "ad_sessions" ("trans_id");
CREATE INDEX "ad_sessions_user_idx" ON "ad_sessions" ("user_id","created_at");
CREATE INDEX "admin_notes_user_idx" ON "admin_notes" ("user_id");
CREATE INDEX "audit_created_idx" ON "audit_logs" ("created_at");
CREATE INDEX "audit_target_idx" ON "audit_logs" ("target_type","target_id");
CREATE INDEX "claim_events_claim_idx" ON "claim_events" ("claim_id","created_at");
CREATE UNIQUE INDEX "claims_click_uq" ON "claims" ("click_id");
CREATE INDEX "claims_status_idx" ON "claims" ("status","sla_due_at");
CREATE INDEX "claims_user_idx" ON "claims" ("user_id","created_at");
CREATE UNIQUE INDEX "conversions_network_txn_uq" ON "conversions" ("network_id","network_txn_id");
CREATE INDEX "conversions_user_idx" ON "conversions" ("user_id","credited_at");
CREATE INDEX "conversions_offer_idx" ON "conversions" ("offer_id");
CREATE INDEX "conversions_click_idx" ON "conversions" ("click_id");
CREATE INDEX "conversions_credited_idx" ON "conversions" ("credited_at");
CREATE UNIQUE INDEX "devices_user_key_uq" ON "devices" ("user_id","device_key");
CREATE INDEX "devices_key_idx" ON "devices" ("device_key");
CREATE INDEX "devices_fp_idx" ON "devices" ("fingerprint_hash");
CREATE INDEX "donations_user_idx" ON "donations" ("user_id");
CREATE INDEX "donations_charity_idx" ON "donations" ("charity_id");
CREATE INDEX "feature_requests_votes_idx" ON "feature_requests" ("votes");
CREATE INDEX "fraud_flags_user_idx" ON "fraud_flags" ("user_id");
CREATE INDEX "fraud_flags_status_idx" ON "fraud_flags" ("status","created_at");
CREATE INDEX "jobs_due_idx" ON "jobs" ("status","run_at");
CREATE UNIQUE INDEX "jobs_dedupe_uq" ON "jobs" ("dedupe_key") WHERE "jobs"."dedupe_key" is not null;
CREATE INDEX "kyc_user_idx" ON "kyc_submissions" ("user_id");
CREATE INDEX "kyc_status_idx" ON "kyc_submissions" ("status");
CREATE UNIQUE INDEX "ledger_accounts_code_uq" ON "ledger_accounts" ("code");
CREATE INDEX "ledger_accounts_user_idx" ON "ledger_accounts" ("user_id");
CREATE INDEX "ledger_entries_account_idx" ON "ledger_entries" ("account_id","created_at");
CREATE INDEX "ledger_entries_txn_idx" ON "ledger_entries" ("transaction_id");
CREATE UNIQUE INDEX "ledger_txn_idem_uq" ON "ledger_transactions" ("idempotency_key");
CREATE INDEX "ledger_txn_user_idx" ON "ledger_transactions" ("user_id","created_at");
CREATE INDEX "ledger_txn_type_idx" ON "ledger_transactions" ("type","created_at");
CREATE INDEX "ledger_txn_ref_idx" ON "ledger_transactions" ("reference_type","reference_id");
CREATE INDEX "lesson_attempts_user_idx" ON "lesson_attempts" ("user_id","lesson_id");
CREATE UNIQUE INDEX "lesson_attempts_passed_uq" ON "lesson_attempts" ("user_id","lesson_id") WHERE "lesson_attempts"."passed";
CREATE INDEX "login_events_user_idx" ON "login_events" ("user_id","created_at");
CREATE INDEX "login_events_email_idx" ON "login_events" ("email","created_at");
CREATE INDEX "notifications_user_idx" ON "notifications" ("user_id","created_at");
CREATE INDEX "clicks_user_idx" ON "offer_clicks" ("user_id","started_at");
CREATE INDEX "clicks_offer_idx" ON "offer_clicks" ("offer_id");
CREATE INDEX "clicks_status_idx" ON "offer_clicks" ("status");
CREATE UNIQUE INDEX "offer_reports_user_offer_uq" ON "offer_reports" ("user_id","offer_id");
CREATE INDEX "offer_reports_status_idx" ON "offer_reports" ("status");
CREATE UNIQUE INDEX "offers_network_offer_uq" ON "offers" ("network_id","network_offer_id");
CREATE INDEX "offers_status_idx" ON "offers" ("status");
CREATE INDEX "offers_category_idx" ON "offers" ("category");
CREATE INDEX "outbound_created_idx" ON "outbound_messages" ("created_at");
CREATE INDEX "payout_dest_user_idx" ON "payout_destinations" ("user_id");
CREATE INDEX "payout_dest_hash_idx" ON "payout_destinations" ("details_hash");
CREATE INDEX "payout_events_payout_idx" ON "payout_events" ("payout_id","created_at");
CREATE UNIQUE INDEX "payouts_idem_uq" ON "payouts" ("user_id","idempotency_key");
CREATE INDEX "payouts_user_idx" ON "payouts" ("user_id","requested_at");
CREATE INDEX "payouts_status_idx" ON "payouts" ("status","requested_at");
CREATE INDEX "payouts_completed_idx" ON "payouts" ("completed_at");
CREATE INDEX "poll_responses_poll_idx" ON "poll_responses" ("poll_id");
CREATE INDEX "postback_logs_created_idx" ON "postback_logs" ("created_at");
CREATE INDEX "postback_logs_click_idx" ON "postback_logs" ("click_id");
CREATE INDEX "postback_logs_status_idx" ON "postback_logs" ("status","created_at");
CREATE UNIQUE INDEX "referrals_referee_uq" ON "referrals" ("referee_id");
CREATE INDEX "referrals_referrer_idx" ON "referrals" ("referrer_id");
CREATE UNIQUE INDEX "sandbox_conv_click_uq" ON "sandbox_network_conversions" ("network_id","click_id");
CREATE UNIQUE INDEX "sandbox_conv_txn_uq" ON "sandbox_network_conversions" ("network_txn_id");
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" ("token_hash");
CREATE INDEX "sessions_user_idx" ON "sessions" ("user_id");
CREATE INDEX "ticket_messages_ticket_idx" ON "ticket_messages" ("ticket_id","created_at");
CREATE INDEX "tickets_status_idx" ON "tickets" ("status","sla_due_at");
CREATE INDEX "tickets_user_idx" ON "tickets" ("user_id");
CREATE UNIQUE INDEX "users_email_uq" ON "users" ("email");
CREATE UNIQUE INDEX "users_referral_code_uq" ON "users" ("referral_code");
CREATE UNIQUE INDEX "users_phone_hash_uq" ON "users" ("phone_hash") WHERE "users"."phone_hash" is not null and "users"."deleted_at" is null;
CREATE INDEX "users_referred_by_idx" ON "users" ("referred_by");
CREATE INDEX "users_created_idx" ON "users" ("created_at");
CREATE INDEX "users_status_idx" ON "users" ("status");
CREATE UNIQUE INDEX "verification_tokens_hash_uq" ON "verification_tokens" ("token_hash");
CREATE INDEX "verification_tokens_user_idx" ON "verification_tokens" ("user_id","type");