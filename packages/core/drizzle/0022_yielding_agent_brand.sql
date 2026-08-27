CREATE TYPE "public"."financial_path_source" AS ENUM('model', 'deterministic');--> statement-breakpoint
CREATE TYPE "public"."financial_path_status" AS ENUM('active', 'superseded');--> statement-breakpoint
CREATE TABLE "financial_path_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"path_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"candidate_key" varchar(100) NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	CONSTRAINT "financial_path_steps_path_position_uniq" UNIQUE("path_id","position")
);
--> statement-breakpoint
CREATE TABLE "financial_paths" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" varchar(40) NOT NULL,
	"inputs_fingerprint" varchar(64) NOT NULL,
	"model" text,
	"order_source" "financial_path_source" NOT NULL,
	"status" "financial_path_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "financial_path_steps" ADD CONSTRAINT "financial_path_steps_path_id_financial_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "public"."financial_paths"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_path_steps" ADD CONSTRAINT "financial_path_steps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_paths" ADD CONSTRAINT "financial_paths_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "financial_paths_tenant_status_idx" ON "financial_paths" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_paths_one_active_per_tenant" ON "financial_paths" USING btree ("tenant_id") WHERE "status" = 'active';