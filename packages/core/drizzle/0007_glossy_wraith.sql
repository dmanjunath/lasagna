CREATE TYPE "public"."activity_event_kind" AS ENUM('llm', 'plaid');--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"kind" "activity_event_kind" NOT NULL,
	"source" varchar(40) NOT NULL,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webauthn_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"transports" text,
	"device_name" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "comped_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sessions_revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_events_kind_created_idx" ON "activity_events" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX "activity_events_tenant_created_idx" ON "activity_events" USING btree ("tenant_id","created_at");