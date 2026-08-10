CREATE TABLE "goal_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_accounts_goal_id_account_id_unique" UNIQUE("goal_id","account_id")
);
--> statement-breakpoint
ALTER TABLE "goals" DROP CONSTRAINT "goals_linked_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "exclude_from_net_worth" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "exclude_transactions" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "invert_balance" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "frozen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "subscription_status" varchar(50);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "current_period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "goal_accounts" ADD CONSTRAINT "goal_accounts_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_accounts" ADD CONSTRAINT "goal_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_accounts" ADD CONSTRAINT "goal_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" DROP COLUMN "linked_account_id";