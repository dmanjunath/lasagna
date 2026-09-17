CREATE TABLE "plan_regeneration_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source" varchar(40) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "financial_plans" ADD COLUMN "regen_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plan_regeneration_attempts" ADD CONSTRAINT "plan_regeneration_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_regen_attempts_tenant_created_idx" ON "plan_regeneration_attempts" USING btree ("tenant_id","created_at");