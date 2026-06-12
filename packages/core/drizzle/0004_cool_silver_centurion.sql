ALTER TABLE "users" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "ui_mode";--> statement-breakpoint
DROP TYPE "public"."ui_mode";
