CREATE TYPE "public"."account_type" AS ENUM('depository', 'investment', 'credit', 'loan', 'real_estate', 'alternative');--> statement-breakpoint
CREATE TYPE "public"."edited_by" AS ENUM('user', 'agent');--> statement-breakpoint
CREATE TYPE "public"."filing_status" AS ENUM('single', 'married_joint', 'married_separate', 'head_of_household');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('active', 'completed', 'paused');--> statement-breakpoint
CREATE TYPE "public"."insight_category" AS ENUM('portfolio', 'debt', 'tax', 'savings', 'general');--> statement-breakpoint
CREATE TYPE "public"."insight_urgency" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('free', 'pro');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."plan_type" AS ENUM('net_worth', 'retirement', 'debt_payoff', 'custom');--> statement-breakpoint
CREATE TYPE "public"."risk_tolerance" AS ENUM('conservative', 'moderate_conservative', 'moderate', 'moderate_aggressive', 'aggressive');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "public"."simulation_type" AS ENUM('monte_carlo', 'backtest', 'scenario');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('running', 'success', 'error');--> statement-breakpoint
CREATE TYPE "public"."transaction_category" AS ENUM('income', 'housing', 'transportation', 'food_dining', 'groceries', 'utilities', 'healthcare', 'insurance', 'entertainment', 'shopping', 'personal_care', 'education', 'travel', 'subscriptions', 'savings_investment', 'debt_payment', 'gifts_donations', 'taxes', 'transfer', 'other');--> statement-breakpoint
CREATE TYPE "public"."transaction_source" AS ENUM('seed', 'plaid');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plaid_item_id" uuid NOT NULL,
	"plaid_account_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" "account_type" NOT NULL,
	"subtype" varchar(100),
	"mask" varchar(10),
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "balance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"balance" numeric(19, 4),
	"available" numeric(19, 4),
	"limit" numeric(19, 4),
	"iso_currency_code" varchar(3),
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid,
	"title" text,
	"tags" text[] DEFAULT '{}',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"date_of_birth" timestamp with time zone,
	"annual_income" numeric(19, 2),
	"filing_status" "filing_status",
	"state_of_residence" varchar(2),
	"employment_type" varchar(50),
	"risk_tolerance" "risk_tolerance",
	"retirement_age" integer,
	"employer_match_percent" numeric(5, 2),
	"skipped_priority_steps" text[] DEFAULT '{}',
	"completed_priority_steps" jsonb DEFAULT '[]'::jsonb,
	"has_hdhp" boolean,
	"dependent_count" integer,
	"is_pslf_eligible" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_profiles_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"target_amount" numeric(19, 2) NOT NULL,
	"current_amount" numeric(19, 2) DEFAULT '0' NOT NULL,
	"deadline" timestamp with time zone,
	"category" varchar(50) DEFAULT 'savings' NOT NULL,
	"goal_status" "goal_status" DEFAULT 'active' NOT NULL,
	"icon" varchar(10),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"security_id" uuid NOT NULL,
	"quantity" numeric(19, 6),
	"institution_price" numeric(19, 4),
	"institution_value" numeric(19, 4),
	"cost_basis" numeric(19, 4),
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category" "insight_category" NOT NULL,
	"urgency" "insight_urgency" DEFAULT 'medium' NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"impact" text,
	"impact_color" varchar(10),
	"chat_prompt" text,
	"dismissed_at" timestamp with time zone,
	"acted_on_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"generated_by" varchar(50) DEFAULT 'system' NOT NULL,
	"type" text,
	"source_data" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"tool_calls" text,
	"ui_payload" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plaid_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"access_token" text NOT NULL,
	"institution_id" varchar(255),
	"institution_name" varchar(255),
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"transaction_cursor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"edited_by" "edited_by" NOT NULL,
	"previous_content" text NOT NULL,
	"change_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" "plan_type" NOT NULL,
	"title" text NOT NULL,
	"inputs" text,
	"content" text,
	"status" "plan_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "securities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plaid_security_id" varchar(255) NOT NULL,
	"name" varchar(255),
	"ticker_symbol" varchar(20),
	"type" varchar(100),
	"close_price" numeric(19, 4),
	"close_price_as_of" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "securities_plaid_security_id_unique" UNIQUE("plaid_security_id")
);
--> statement-breakpoint
CREATE TABLE "simulation_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" "simulation_type" NOT NULL,
	"params_hash" varchar(64) NOT NULL,
	"params" text NOT NULL,
	"results" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plaid_item_id" uuid NOT NULL,
	"status" "sync_status" NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tax_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_type" text NOT NULL,
	"gcs_path" text NOT NULL,
	"raw_extraction" jsonb NOT NULL,
	"llm_fields" jsonb NOT NULL,
	"llm_summary" text NOT NULL,
	"tax_year" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"plan" "plan" DEFAULT 'free' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plaid_transaction_id" varchar(255),
	"date" timestamp with time zone NOT NULL,
	"name" varchar(500) NOT NULL,
	"merchant_name" varchar(255),
	"amount" numeric(19, 2) NOT NULL,
	"category" "transaction_category" DEFAULT 'other' NOT NULL,
	"pending" integer DEFAULT 0 NOT NULL,
	"source" "transaction_source" DEFAULT 'seed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" DEFAULT 'owner' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_plaid_item_id_plaid_items_id_fk" FOREIGN KEY ("plaid_item_id") REFERENCES "public"."plaid_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_snapshots" ADD CONSTRAINT "balance_snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_snapshots" ADD CONSTRAINT "balance_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_profiles" ADD CONSTRAINT "financial_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plaid_items" ADD CONSTRAINT "plaid_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_edits" ADD CONSTRAINT "plan_edits_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_edits" ADD CONSTRAINT "plan_edits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_results" ADD CONSTRAINT "simulation_results_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_results" ADD CONSTRAINT "simulation_results_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_log" ADD CONSTRAINT "sync_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_log" ADD CONSTRAINT "sync_log_plaid_item_id_plaid_items_id_fk" FOREIGN KEY ("plaid_item_id") REFERENCES "public"."plaid_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_documents" ADD CONSTRAINT "tax_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;