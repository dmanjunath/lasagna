CREATE TYPE "public"."recurring_frequency" AS ENUM('weekly', 'biweekly', 'monthly', 'quarterly', 'annually');--> statement-breakpoint
CREATE TYPE "public"."ui_mode" AS ENUM('simple', 'advanced');--> statement-breakpoint
CREATE TABLE "recurring_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid,
	"name" varchar(255) NOT NULL,
	"merchant_name" varchar(255),
	"amount" numeric(19, 2) NOT NULL,
	"frequency" "recurring_frequency" NOT NULL,
	"category" "transaction_category" DEFAULT 'other' NOT NULL,
	"next_due_date" timestamp with time zone,
	"last_seen_date" timestamp with time zone,
	"confidence" numeric(3, 2),
	"reasoning" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"dismissed_at" timestamp with time zone,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "apr" numeric(6, 4);--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "apy" numeric(6, 4);--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "linked_account_id" uuid;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "insights" ADD COLUMN "snoozed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "name" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ui_mode" "ui_mode" DEFAULT 'simple' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_daily" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_bills" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_weekly_email" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_linked_account_id_accounts_id_fk" FOREIGN KEY ("linked_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;