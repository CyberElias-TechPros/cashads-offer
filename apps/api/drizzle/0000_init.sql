CREATE TABLE "achievements" (
	"user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "achievements_user_id_code_pk" PRIMARY KEY("user_id","code")
);
--> statement-breakpoint
CREATE TABLE "ad_creatives" (
	"id" text PRIMARY KEY NOT NULL,
	"network_id" text NOT NULL,
	"advertiser" text NOT NULL,
	"title" text NOT NULL,
	"tagline" text NOT NULL,
	"duration_seconds" integer NOT NULL,
	"revenue_micros" bigint NOT NULL,
	"lite" boolean DEFAULT true NOT NULL,
	"theme" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"creative_id" text NOT NULL,
	"device_key" text NOT NULL,
	"trans_id" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visible_ms" integer DEFAULT 0 NOT NULL,
	"reward_micros" bigint DEFAULT 0 NOT NULL,
	"bonus_micros" bigint DEFAULT 0 NOT NULL,
	"combo_level" integer DEFAULT 0 NOT NULL,
	"rejection_reason" text,
	"ledger_txn_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"author_id" uuid,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charities" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"icon" text NOT NULL,
	"url" text NOT NULL,
	"impact_unit" text NOT NULL,
	"impact_unit_micros" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"click_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"resolution" text,
	"amount_micros" bigint NOT NULL,
	"note" text NOT NULL,
	"completed_at_estimate" timestamp with time zone,
	"screenshot_path" text,
	"auto_filed" boolean DEFAULT false NOT NULL,
	"sla_due_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"rejection_reason" text,
	"chase_network" boolean DEFAULT false NOT NULL,
	"ledger_txn_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" text NOT NULL,
	"network_txn_id" text NOT NULL,
	"click_id" uuid,
	"user_id" uuid NOT NULL,
	"offer_id" uuid,
	"title" text NOT NULL,
	"kind" text DEFAULT 'complete' NOT NULL,
	"payout_micros" bigint NOT NULL,
	"user_amount_micros" bigint NOT NULL,
	"platform_amount_micros" bigint NOT NULL,
	"status" text DEFAULT 'credited' NOT NULL,
	"source" text DEFAULT 'postback' NOT NULL,
	"duration_seconds" integer,
	"postback_log_id" uuid,
	"ledger_txn_id" uuid,
	"credited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "daily_plans" (
	"user_id" uuid NOT NULL,
	"plan_date" date NOT NULL,
	"offer_ids" jsonb NOT NULL,
	"bonus_paid" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_plans_user_id_plan_date_pk" PRIMARY KEY("user_id","plan_date")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_key" text NOT NULL,
	"fingerprint_hash" text,
	"label" text NOT NULL,
	"user_agent" text,
	"last_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "donations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"charity_id" text NOT NULL,
	"amount_micros" bigint NOT NULL,
	"source" text NOT NULL,
	"ledger_txn_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "earning_locks" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"device_key" text NOT NULL,
	"device_label" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"votes" integer DEFAULT 0 NOT NULL,
	"shipped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_votes" (
	"user_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_votes_user_id_request_id_pk" PRIMARY KEY("user_id","request_id")
);
--> statement-breakpoint
CREATE TABLE "fraud_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"severity" integer NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ip_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cidr" text NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"last_error" text,
	"dedupe_key" text,
	"locked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kyc_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"id_type" text NOT NULL,
	"id_number_enc" text NOT NULL,
	"id_number_masked" text NOT NULL,
	"full_name" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"document_path" text,
	"selfie_path" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewer_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"normal_side" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"balance_micros" bigint DEFAULT 0 NOT NULL,
	"allow_negative" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_accounts_non_negative" CHECK ("ledger_accounts"."allow_negative" or "ledger_accounts"."balance_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"amount_micros" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_positive" CHECK ("ledger_entries"."amount_micros" > 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"user_id" uuid,
	"idempotency_key" text NOT NULL,
	"description" text NOT NULL,
	"reference_type" text,
	"reference_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lesson_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lesson_id" text NOT NULL,
	"score" double precision NOT NULL,
	"passed" boolean NOT NULL,
	"reward_micros" bigint DEFAULT 0 NOT NULL,
	"ledger_txn_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"email" text NOT NULL,
	"success" boolean NOT NULL,
	"reason" text,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "networks" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"adapter" text NOT NULL,
	"kind" text NOT NULL,
	"secret_enc" text,
	"ip_allowlist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer_clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"device_key" text,
	"ip" text,
	"user_agent" text,
	"status" text DEFAULT 'started' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reported_at" timestamp with time zone,
	"credited_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"conversion_id" uuid,
	"check_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer_ratings" (
	"user_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"value" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offer_ratings_user_id_offer_id_pk" PRIMARY KEY("user_id","offer_id")
);
--> statement-breakpoint
CREATE TABLE "offer_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" text NOT NULL,
	"network_offer_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"advertiser" text NOT NULL,
	"category" text NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payout_micros" bigint NOT NULL,
	"user_payout_override_micros" bigint,
	"est_minutes" double precision NOT NULL,
	"data_mb" double precision DEFAULT 1 NOT NULL,
	"pay_speed" text DEFAULT 'instant' NOT NULL,
	"countries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"icon" text DEFAULT '🎯' NOT NULL,
	"color" text DEFAULT '#10b981' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_lite" boolean DEFAULT false NOT NULL,
	"max_per_user" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"status_reason" text,
	"status_changed_at" timestamp with time zone,
	"stat_clicks" integer DEFAULT 0 NOT NULL,
	"stat_conversions" integer DEFAULT 0 NOT NULL,
	"stat_missing_claims" integer DEFAULT 0 NOT NULL,
	"stat_thumbs_up" integer DEFAULT 0 NOT NULL,
	"stat_thumbs_down" integer DEFAULT 0 NOT NULL,
	"stat_reports_open" integer DEFAULT 0 NOT NULL,
	"stat_median_seconds" integer,
	"stat_samples" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"channel" text NOT NULL,
	"to" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"method_id" text NOT NULL,
	"label" text NOT NULL,
	"details_enc" text NOT NULL,
	"details_hash" text NOT NULL,
	"masked" text NOT NULL,
	"verified_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payout_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payout_id" uuid NOT NULL,
	"status" text NOT NULL,
	"message" text NOT NULL,
	"actor" text DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"method_id" text NOT NULL,
	"destination_id" uuid,
	"details_enc" text NOT NULL,
	"details_hash" text NOT NULL,
	"destination_masked" text NOT NULL,
	"amount_micros" bigint NOT NULL,
	"fee_micros" bigint NOT NULL,
	"net_micros" bigint NOT NULL,
	"local_currency" text NOT NULL,
	"fx_rate" double precision NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"status_reason" text,
	"review_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider_reference" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"request_txn_id" uuid,
	"final_txn_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processing_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poll_responses" (
	"user_id" uuid NOT NULL,
	"poll_id" text NOT NULL,
	"option_index" integer NOT NULL,
	"reward_micros" bigint NOT NULL,
	"ledger_txn_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poll_responses_user_id_poll_id_pk" PRIMARY KEY("user_id","poll_id")
);
--> statement-breakpoint
CREATE TABLE "postback_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" text NOT NULL,
	"method" text NOT NULL,
	"url" text NOT NULL,
	"query" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"body" jsonb,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"signature_valid" boolean,
	"status" text DEFAULT 'received' NOT NULL,
	"error_code" text,
	"error_message" text,
	"network_txn_id" text,
	"click_id" text,
	"user_id" text,
	"conversion_id" uuid,
	"processing_ms" integer,
	"replay_of" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_id" uuid NOT NULL,
	"referee_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"qualified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sandbox_network_conversions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" text NOT NULL,
	"click_id" uuid NOT NULL,
	"network_txn_id" text NOT NULL,
	"user_ref" text NOT NULL,
	"network_offer_id" text NOT NULL,
	"payout_micros" bigint NOT NULL,
	"kind" text DEFAULT 'complete' NOT NULL,
	"delivery_mode" text NOT NULL,
	"status" text DEFAULT 'converted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"device_id" uuid,
	"label" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "streaks" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"current" integer DEFAULT 0 NOT NULL,
	"longest" integer DEFAULT 0 NOT NULL,
	"last_claim_date" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_type" text NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"email" text,
	"subject" text NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"sla_due_at" timestamp with time zone NOT NULL,
	"assigned_to" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"password_hash" text,
	"display_name" text,
	"full_name" text,
	"phone_enc" text,
	"phone_hash" text,
	"phone_last4" text,
	"phone_verified_at" timestamp with time zone,
	"country" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"display_currency" text DEFAULT 'USD' NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"ban_reason_code" text,
	"ban_message" text,
	"banned_at" timestamp with time zone,
	"balance_frozen" boolean DEFAULT false NOT NULL,
	"referral_code" text NOT NULL,
	"referred_by" uuid,
	"kyc_status" text DEFAULT 'none' NOT NULL,
	"fraud_score" integer DEFAULT 0 NOT NULL,
	"tier" text DEFAULT 'bronze' NOT NULL,
	"totp_secret_enc" text,
	"totp_enabled_at" timestamp with time zone,
	"totp_last_step" bigint,
	"recovery_codes" jsonb,
	"prefs" jsonb NOT NULL,
	"onboarding_done_at" timestamp with time zone,
	"terms_version" text,
	"terms_accepted_at" timestamp with time zone,
	"signup_ip" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"token_hash" text NOT NULL,
	"meta" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_sessions" ADD CONSTRAINT "ad_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_sessions" ADD CONSTRAINT "ad_sessions_creative_id_ad_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."ad_creatives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_notes" ADD CONSTRAINT "admin_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_notes" ADD CONSTRAINT "admin_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_click_id_offer_clicks_id_fk" FOREIGN KEY ("click_id") REFERENCES "public"."offer_clicks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_click_id_offer_clicks_id_fk" FOREIGN KEY ("click_id") REFERENCES "public"."offer_clicks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversions" ADD CONSTRAINT "conversions_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_plans" ADD CONSTRAINT "daily_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_charity_id_charities_id_fk" FOREIGN KEY ("charity_id") REFERENCES "public"."charities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "earning_locks" ADD CONSTRAINT "earning_locks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_requests" ADD CONSTRAINT "feature_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_votes" ADD CONSTRAINT "feature_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_votes" ADD CONSTRAINT "feature_votes_request_id_feature_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."feature_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_submissions" ADD CONSTRAINT "kyc_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_submissions" ADD CONSTRAINT "kyc_submissions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_attempts" ADD CONSTRAINT "lesson_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_clicks" ADD CONSTRAINT "offer_clicks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_clicks" ADD CONSTRAINT "offer_clicks_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_ratings" ADD CONSTRAINT "offer_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_ratings" ADD CONSTRAINT "offer_ratings_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_reports" ADD CONSTRAINT "offer_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_reports" ADD CONSTRAINT "offer_reports_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_reports" ADD CONSTRAINT "offer_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_destinations" ADD CONSTRAINT "payout_destinations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_events" ADD CONSTRAINT "payout_events_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_destination_id_payout_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."payout_destinations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_responses" ADD CONSTRAINT "poll_responses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referee_id_users_id_fk" FOREIGN KEY ("referee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streaks" ADD CONSTRAINT "streaks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_users_id_fk" FOREIGN KEY ("referred_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_sessions_trans_uq" ON "ad_sessions" USING btree ("trans_id");--> statement-breakpoint
CREATE INDEX "ad_sessions_user_idx" ON "ad_sessions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "admin_notes_user_idx" ON "admin_notes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "claim_events_claim_idx" ON "claim_events" USING btree ("claim_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_click_uq" ON "claims" USING btree ("click_id");--> statement-breakpoint
CREATE INDEX "claims_status_idx" ON "claims" USING btree ("status","sla_due_at");--> statement-breakpoint
CREATE INDEX "claims_user_idx" ON "claims" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversions_network_txn_uq" ON "conversions" USING btree ("network_id","network_txn_id");--> statement-breakpoint
CREATE INDEX "conversions_user_idx" ON "conversions" USING btree ("user_id","credited_at");--> statement-breakpoint
CREATE INDEX "conversions_offer_idx" ON "conversions" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "conversions_click_idx" ON "conversions" USING btree ("click_id");--> statement-breakpoint
CREATE INDEX "conversions_credited_idx" ON "conversions" USING btree ("credited_at");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_user_key_uq" ON "devices" USING btree ("user_id","device_key");--> statement-breakpoint
CREATE INDEX "devices_key_idx" ON "devices" USING btree ("device_key");--> statement-breakpoint
CREATE INDEX "devices_fp_idx" ON "devices" USING btree ("fingerprint_hash");--> statement-breakpoint
CREATE INDEX "donations_user_idx" ON "donations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "donations_charity_idx" ON "donations" USING btree ("charity_id");--> statement-breakpoint
CREATE INDEX "feature_requests_votes_idx" ON "feature_requests" USING btree ("votes");--> statement-breakpoint
CREATE INDEX "fraud_flags_user_idx" ON "fraud_flags" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "fraud_flags_status_idx" ON "fraud_flags" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_uq" ON "jobs" USING btree ("dedupe_key") WHERE "jobs"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "kyc_user_idx" ON "kyc_submissions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "kyc_status_idx" ON "kyc_submissions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_code_uq" ON "ledger_accounts" USING btree ("code");--> statement-breakpoint
CREATE INDEX "ledger_accounts_user_idx" ON "ledger_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_idx" ON "ledger_entries" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_txn_idx" ON "ledger_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_txn_idem_uq" ON "ledger_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ledger_txn_user_idx" ON "ledger_transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_txn_type_idx" ON "ledger_transactions" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX "ledger_txn_ref_idx" ON "ledger_transactions" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "lesson_attempts_user_idx" ON "lesson_attempts" USING btree ("user_id","lesson_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_attempts_passed_uq" ON "lesson_attempts" USING btree ("user_id","lesson_id") WHERE "lesson_attempts"."passed";--> statement-breakpoint
CREATE INDEX "login_events_user_idx" ON "login_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "login_events_email_idx" ON "login_events" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "clicks_user_idx" ON "offer_clicks" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "clicks_offer_idx" ON "offer_clicks" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "clicks_status_idx" ON "offer_clicks" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "offer_reports_user_offer_uq" ON "offer_reports" USING btree ("user_id","offer_id");--> statement-breakpoint
CREATE INDEX "offer_reports_status_idx" ON "offer_reports" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "offers_network_offer_uq" ON "offers" USING btree ("network_id","network_offer_id");--> statement-breakpoint
CREATE INDEX "offers_status_idx" ON "offers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "offers_category_idx" ON "offers" USING btree ("category");--> statement-breakpoint
CREATE INDEX "outbound_created_idx" ON "outbound_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "payout_dest_user_idx" ON "payout_destinations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payout_dest_hash_idx" ON "payout_destinations" USING btree ("details_hash");--> statement-breakpoint
CREATE INDEX "payout_events_payout_idx" ON "payout_events" USING btree ("payout_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_idem_uq" ON "payouts" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "payouts_user_idx" ON "payouts" USING btree ("user_id","requested_at");--> statement-breakpoint
CREATE INDEX "payouts_status_idx" ON "payouts" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "payouts_completed_idx" ON "payouts" USING btree ("completed_at");--> statement-breakpoint
CREATE INDEX "poll_responses_poll_idx" ON "poll_responses" USING btree ("poll_id");--> statement-breakpoint
CREATE INDEX "postback_logs_created_idx" ON "postback_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "postback_logs_click_idx" ON "postback_logs" USING btree ("click_id");--> statement-breakpoint
CREATE INDEX "postback_logs_status_idx" ON "postback_logs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_referee_uq" ON "referrals" USING btree ("referee_id");--> statement-breakpoint
CREATE INDEX "referrals_referrer_idx" ON "referrals" USING btree ("referrer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_conv_click_uq" ON "sandbox_network_conversions" USING btree ("network_id","click_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_conv_txn_uq" ON "sandbox_network_conversions" USING btree ("network_txn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ticket_messages_ticket_idx" ON "ticket_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "tickets_status_idx" ON "tickets" USING btree ("status","sla_due_at");--> statement-breakpoint
CREATE INDEX "tickets_user_idx" ON "tickets" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_referral_code_uq" ON "users" USING btree ("referral_code");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_hash_uq" ON "users" USING btree ("phone_hash") WHERE "users"."phone_hash" is not null and "users"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "users_referred_by_idx" ON "users" USING btree ("referred_by");--> statement-breakpoint
CREATE INDEX "users_created_idx" ON "users" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_tokens_hash_uq" ON "verification_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "verification_tokens_user_idx" ON "verification_tokens" USING btree ("user_id","type");