CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkins" (
	"user_id" uuid NOT NULL,
	"day" text NOT NULL,
	"streak" integer NOT NULL,
	"bonus_micros" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkins_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"click_id" uuid NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"amount_micros" bigint NOT NULL,
	"completed_at_claimed" timestamp with time zone NOT NULL,
	"note" text,
	"upload_id" uuid,
	"resolution" text,
	"resolved_by_id" uuid,
	"transaction_id" uuid,
	"timeline" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sla_due_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"message" text NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_key" text NOT NULL,
	"fingerprint" text,
	"label" text,
	"user_agent" text,
	"first_ip" text,
	"last_ip" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fraud_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"score" integer NOT NULL,
	"level" text NOT NULL,
	"summary" text NOT NULL,
	"resolution" text,
	"resolved_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"currency" text PRIMARY KEY NOT NULL,
	"rate_per_usd" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kyc_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"document_country" text NOT NULL,
	"document_number_last4" text NOT NULL,
	"document_number_hash" text NOT NULL,
	"legal_name" text NOT NULL,
	"date_of_birth" text NOT NULL,
	"document_upload_id" uuid NOT NULL,
	"selfie_upload_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"reviewed_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"transaction_id" uuid,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_postings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"account" text NOT NULL,
	"amount_micros" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"email" text,
	"ip" text,
	"user_agent" text,
	"success" boolean NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "networks" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"signature_scheme" text NOT NULL,
	"secret_enc" text,
	"param_map" jsonb NOT NULL,
	"ip_allowlist" text[] DEFAULT '{}' NOT NULL,
	"revenue_share_bps" integer,
	"docs_url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"device_id" uuid,
	"ip" text,
	"user_agent" text,
	"status" text DEFAULT 'started' NOT NULL,
	"partner_payout_micros" bigint NOT NULL,
	"base_user_payout_micros" bigint NOT NULL,
	"tier_bonus_micros" bigint DEFAULT 0 NOT NULL,
	"user_payout_micros" bigint NOT NULL,
	"goals_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"returned_at" timestamp with time zone,
	"credited_at" timestamp with time zone,
	"nudged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer_reviews" (
	"user_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offer_reviews_user_id_offer_id_pk" PRIMARY KEY("user_id","offer_id")
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"advertiser" text NOT NULL,
	"short_description" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"icon" text DEFAULT '🎯' NOT NULL,
	"brand_color" text DEFAULT '#10b981' NOT NULL,
	"partner_payout_micros" bigint NOT NULL,
	"estimated_minutes" double precision NOT NULL,
	"data_usage" text DEFAULT 'light' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"goals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"countries" text[] DEFAULT '{}' NOT NULL,
	"platforms" text[] DEFAULT '{"web"}' NOT NULL,
	"hold_hours" integer,
	"conversion_window_hours" integer DEFAULT 72 NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"quality_score" integer DEFAULT 80 NOT NULL,
	"tracking_reliability" double precision,
	"median_credit_seconds" integer,
	"median_minutes" double precision,
	"rating_sum" integer DEFAULT 0 NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"completions" integer DEFAULT 0 NOT NULL,
	"reports_open" integer DEFAULT 0 NOT NULL,
	"tracking_url" text,
	"sandbox_drop_postback" boolean DEFAULT false NOT NULL,
	"sandbox_delay_seconds" integer DEFAULT 3 NOT NULL,
	"partner_content" jsonb DEFAULT '{}'::jsonb NOT NULL,
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
	"text" text NOT NULL,
	"html" text,
	"template" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"provider_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payout_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"method_id" text NOT NULL,
	"label" text,
	"masked" text NOT NULL,
	"hash" text NOT NULL,
	"data_enc" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payout_id" uuid NOT NULL,
	"status" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_methods" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"logo" text NOT NULL,
	"provider" text DEFAULT 'sandbox' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"min_micros" bigint NOT NULL,
	"max_micros" bigint NOT NULL,
	"fee_fixed_micros" bigint DEFAULT 0 NOT NULL,
	"fee_bps" integer DEFAULT 0 NOT NULL,
	"eta_label" text NOT NULL,
	"countries" text[] DEFAULT '{}' NOT NULL,
	"currency" text,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"method_id" text NOT NULL,
	"destination_id" uuid,
	"destination_masked" text NOT NULL,
	"destination_hash" text NOT NULL,
	"destination_enc" text NOT NULL,
	"amount_micros" bigint NOT NULL,
	"fee_micros" bigint NOT NULL,
	"net_micros" bigint NOT NULL,
	"local_currency" text,
	"local_amount" double precision,
	"fx_rate" double precision,
	"status" text NOT NULL,
	"status_reason" text,
	"risk_score_at_request" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"provider_reference" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"reviewed_by_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processing_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plan_claims" (
	"user_id" uuid NOT NULL,
	"day" text NOT NULL,
	"bonus_micros" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_claims_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "postbacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network_id" text NOT NULL,
	"external_tx_id" text,
	"dedupe_key" text,
	"kind" text DEFAULT 'credit' NOT NULL,
	"click_id" uuid,
	"user_id" uuid,
	"offer_id" uuid,
	"goal_id" text,
	"payout_micros" bigint,
	"user_amount_micros" bigint,
	"signature_valid" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"status_reason" text,
	"transaction_id" uuid,
	"ip" text,
	"method" text,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"replays" integer DEFAULT 0 NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_id" uuid NOT NULL,
	"referee_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reject_reason" text,
	"qualified_at" timestamp with time zone,
	"commission_until" timestamp with time zone,
	"earned_micros" bigint DEFAULT 0 NOT NULL,
	"accrued_micros" bigint DEFAULT 0 NOT NULL,
	"accrued_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"weight" integer NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cleared_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sandbox_conversions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"click_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"goal_id" text DEFAULT '' NOT NULL,
	"tx_id" text NOT NULL,
	"postback_sent" boolean DEFAULT false NOT NULL,
	"reversed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"device_id" uuid,
	"device_label" text,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"category" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"related_type" text,
	"related_id" text,
	"assigned_to_id" uuid,
	"sla_due_at" timestamp with time zone NOT NULL,
	"first_response_at" timestamp with time zone,
	"last_message_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_id" uuid,
	"author_role" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"amount_micros" bigint NOT NULL,
	"description" text NOT NULL,
	"reference_type" text,
	"reference_id" text,
	"available_at" timestamp with time zone,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_achievements" (
	"user_id" uuid NOT NULL,
	"achievement_id" text NOT NULL,
	"unlocked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_achievements_user_id_achievement_id_pk" PRIMARY KEY("user_id","achievement_id")
);
--> statement-breakpoint
CREATE TABLE "user_activity_days" (
	"user_id" uuid NOT NULL,
	"day" text NOT NULL,
	CONSTRAINT "user_activity_days_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "user_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"password_hash" text,
	"google_sub" text,
	"phone" text,
	"phone_verified_at" timestamp with time zone,
	"display_name" text NOT NULL,
	"country" text DEFAULT 'US' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"status_reason" text,
	"tier" text DEFAULT 'bronze' NOT NULL,
	"kyc_status" text DEFAULT 'none' NOT NULL,
	"referral_code" text NOT NULL,
	"referred_by_id" uuid,
	"risk_score" integer DEFAULT 0 NOT NULL,
	"risk_level" text DEFAULT 'low' NOT NULL,
	"totp_secret_enc" text,
	"totp_enabled_at" timestamp with time zone,
	"totp_last_step" bigint,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"goal_label" text,
	"goal_target_micros" bigint,
	"streak_current" integer DEFAULT 0 NOT NULL,
	"streak_best" integer DEFAULT 0 NOT NULL,
	"last_checkin_day" text,
	"onboarding_completed_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"signup_ip" text,
	"ip_country" text,
	"is_seed" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"code_hash" text,
	"target" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_ads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"advertiser" text NOT NULL,
	"headline" text NOT NULL,
	"tagline" text NOT NULL,
	"cta" text NOT NULL,
	"brand_color" text NOT NULL,
	"accent_color" text NOT NULL,
	"emoji" text NOT NULL,
	"duration_seconds" integer NOT NULL,
	"partner_payout_micros" bigint NOT NULL,
	"countries" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"completions" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ad_id" uuid NOT NULL,
	"device_id" uuid,
	"device_label" text,
	"status" text DEFAULT 'active' NOT NULL,
	"reward_micros" bigint NOT NULL,
	"partner_payout_micros" bigint NOT NULL,
	"combo_index" integer DEFAULT 0 NOT NULL,
	"combo_bonus_bps" integer DEFAULT 0 NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hidden_ms" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"rejection_reason" text,
	"ip" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"available_micros" bigint DEFAULT 0 NOT NULL,
	"pending_micros" bigint DEFAULT 0 NOT NULL,
	"lifetime_earned_micros" bigint DEFAULT 0 NOT NULL,
	"lifetime_withdrawn_micros" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_submissions" ADD CONSTRAINT "kyc_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_entry_id_ledger_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_clicks" ADD CONSTRAINT "offer_clicks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_clicks" ADD CONSTRAINT "offer_clicks_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_destinations" ADD CONSTRAINT "payout_destinations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referee_id_users_id_fk" FOREIGN KEY ("referee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_sessions" ADD CONSTRAINT "video_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_click_uq" ON "claims" USING btree ("click_id");--> statement-breakpoint
CREATE INDEX "claims_status_idx" ON "claims" USING btree ("status","sla_due_at");--> statement-breakpoint
CREATE INDEX "claims_user_idx" ON "claims" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_user_key_uq" ON "devices" USING btree ("user_id","device_key");--> statement-breakpoint
CREATE INDEX "devices_key_idx" ON "devices" USING btree ("device_key");--> statement-breakpoint
CREATE INDEX "devices_fp_idx" ON "devices" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "fraud_cases_status_idx" ON "fraud_cases" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "fraud_cases_user_idx" ON "fraud_cases" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "jobs_status_run_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_uq" ON "jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "kyc_status_idx" ON "kyc_submissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "kyc_doc_hash_idx" ON "kyc_submissions" USING btree ("document_number_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_idem_uq" ON "ledger_entries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ledger_entries_created_idx" ON "ledger_entries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ledger_postings_account_idx" ON "ledger_postings" USING btree ("account");--> statement-breakpoint
CREATE INDEX "ledger_postings_entry_idx" ON "ledger_postings" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "login_events_user_idx" ON "login_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "login_events_ip_idx" ON "login_events" USING btree ("ip","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "offer_clicks_user_offer_idx" ON "offer_clicks" USING btree ("user_id","offer_id");--> statement-breakpoint
CREATE INDEX "offer_clicks_offer_idx" ON "offer_clicks" USING btree ("offer_id","started_at");--> statement-breakpoint
CREATE INDEX "offer_reports_offer_idx" ON "offer_reports" USING btree ("offer_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "offers_network_ext_uq" ON "offers" USING btree ("network_id","external_id");--> statement-breakpoint
CREATE INDEX "offers_status_cat_idx" ON "offers" USING btree ("status","category");--> statement-breakpoint
CREATE INDEX "outbound_created_idx" ON "outbound_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "payout_dest_user_idx" ON "payout_destinations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payout_dest_hash_idx" ON "payout_destinations" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "payout_events_payout_idx" ON "payout_events" USING btree ("payout_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_idem_uq" ON "payouts" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "payouts_status_idx" ON "payouts" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "payouts_user_idx" ON "payouts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "payouts_dest_hash_idx" ON "payouts" USING btree ("destination_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "postbacks_dedupe_uq" ON "postbacks" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "postbacks_status_idx" ON "postbacks" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "postbacks_user_idx" ON "postbacks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "postbacks_click_idx" ON "postbacks" USING btree ("click_id");--> statement-breakpoint
CREATE INDEX "postbacks_created_idx" ON "postbacks" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_referee_uq" ON "referrals" USING btree ("referee_id");--> statement-breakpoint
CREATE INDEX "referrals_referrer_idx" ON "referrals" USING btree ("referrer_id");--> statement-breakpoint
CREATE INDEX "risk_signals_user_idx" ON "risk_signals" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "risk_signals_code_idx" ON "risk_signals" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_conv_click_goal_uq" ON "sandbox_conversions" USING btree ("click_id","goal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tickets_status_idx" ON "support_tickets" USING btree ("status","sla_due_at");--> statement-breakpoint
CREATE INDEX "tickets_user_idx" ON "support_tickets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ticket_messages_ticket_idx" ON "ticket_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "transactions_user_idx" ON "transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "transactions_pending_idx" ON "transactions" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "transactions_ref_idx" ON "transactions" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "transactions_type_idx" ON "transactions" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX "activity_day_idx" ON "user_activity_days" USING btree ("day");--> statement-breakpoint
CREATE INDEX "user_notes_user_idx" ON "user_notes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_referral_code_uq" ON "users" USING btree ("referral_code");--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_sub_uq" ON "users" USING btree ("google_sub");--> statement-breakpoint
CREATE INDEX "users_referred_by_idx" ON "users" USING btree ("referred_by_id");--> statement-breakpoint
CREATE INDEX "users_risk_idx" ON "users" USING btree ("risk_level");--> statement-breakpoint
CREATE INDEX "users_created_idx" ON "users" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_tokens_hash_uq" ON "verification_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "verification_tokens_user_idx" ON "verification_tokens" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "video_sessions_user_status_idx" ON "video_sessions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "video_sessions_user_created_idx" ON "video_sessions" USING btree ("user_id","created_at");