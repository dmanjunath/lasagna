CREATE TYPE "public"."onboarding_stage" AS ENUM('profile', 'income', 'lifestyle', 'accounts', 'complete');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarding_stage" "onboarding_stage";