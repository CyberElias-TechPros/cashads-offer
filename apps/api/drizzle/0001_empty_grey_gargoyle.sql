CREATE TABLE "wall_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"network_id" text NOT NULL,
	"session_token" text NOT NULL,
	"device_key" text,
	"ip" text,
	"user_agent" text,
	"status" text DEFAULT 'open' NOT NULL,
	"conversions" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"interrupted_at" timestamp with time zone,
	"interruption" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ip_rules" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wall_sessions" ADD CONSTRAINT "wall_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wall_sessions" ADD CONSTRAINT "wall_sessions_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wall_sessions_token_uq" ON "wall_sessions" USING btree ("session_token");--> statement-breakpoint
CREATE INDEX "wall_sessions_user_idx" ON "wall_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "wall_sessions_network_idx" ON "wall_sessions" USING btree ("network_id");