CREATE TYPE "public"."financial_path_step_status" AS ENUM('pending', 'done', 'not_applicable');--> statement-breakpoint
ALTER TABLE "financial_path_steps" ADD COLUMN "status" "financial_path_step_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_path_steps" ADD COLUMN "note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_path_steps" ADD COLUMN "status_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "financial_paths" ADD COLUMN "pending_reason" varchar(40);