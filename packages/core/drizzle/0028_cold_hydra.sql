CREATE TYPE "public"."insight_effort" AS ENUM('quick', 'moderate', 'involved');--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "effort" "insight_effort";