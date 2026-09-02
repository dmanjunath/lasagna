ALTER TABLE "financial_profiles" ADD COLUMN "tax_summary" text;--> statement-breakpoint
ALTER TABLE "financial_profiles" ADD COLUMN "tax_summary_fingerprint" varchar(64);--> statement-breakpoint
ALTER TABLE "financial_profiles" ADD COLUMN "tax_summary_generated_at" timestamp with time zone;