ALTER TYPE "public"."account_type" ADD VALUE 'real_estate';--> statement-breakpoint
ALTER TYPE "public"."account_type" ADD VALUE 'alternative';--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "metadata" text;