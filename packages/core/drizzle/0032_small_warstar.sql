ALTER TABLE "financial_profiles" ADD COLUMN "last_spend_cuts_generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "producer" varchar(32) DEFAULT 'insights-engine' NOT NULL;--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "monthly_value" numeric(19, 2);--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "one_time_value" numeric(19, 2);--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "evidence" text;--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "insights_tenant_dedupe_key_idx" ON "insights" USING btree ("tenant_id","dedupe_key") WHERE "insights"."dedupe_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "insights_tenant_producer_idx" ON "insights" USING btree ("tenant_id","producer");