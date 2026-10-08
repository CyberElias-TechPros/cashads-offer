CREATE TABLE "earning_boosts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"bonus_slots" integer NOT NULL,
	"source_ref" text NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_sessions" ADD COLUMN "boost_slots" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "earning_boosts" ADD CONSTRAINT "earning_boosts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "earning_boosts_user_kind_source_uq" ON "earning_boosts" USING btree ("user_id","kind","source_ref");--> statement-breakpoint
CREATE INDEX "earning_boosts_user_active_idx" ON "earning_boosts" USING btree ("user_id","expires_at");