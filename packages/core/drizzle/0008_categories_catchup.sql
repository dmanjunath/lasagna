-- Categories feature catch-up: the entire custom-categories schema (enums, tables,
-- transactions/recurring columns) was applied locally via db:push and never migrated,
-- so prod is missing it. This migration creates it AND migrates existing data:
--   1. enums + tables
--   2. new columns (category_id added NULLABLE for now)
--   3. seed the default taxonomy for every existing tenant
--   4. backfill category_id from the old `category` enum via matching system_key (lossless)
--   5. set category_id NOT NULL, add FKs + indexes
--   6. drop the old `category` column + transaction_category type
-- Also folds in users.has_password (idempotent) — this migration supersedes the
-- earlier hand-authored 0008, which had no snapshot and broke drizzle-kit migrate.
-- Runs in a single transaction (drizzle-kit migrate), so a failure rolls back cleanly.

-- ── 0. users.has_password (idempotent; prod may already have it via hotfix) ──
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "has_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- ── 1. Enums ──────────────────────────────────────────────────────────────
CREATE TYPE "public"."category_group_type" AS ENUM('income', 'expense', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."category_source" AS ENUM('auto', 'rule', 'transfer', 'manual');--> statement-breakpoint

-- ── 2. Tables ─────────────────────────────────────────────────────────────
CREATE TABLE "category_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"type" "category_group_type" NOT NULL,
	"system_key" varchar(40),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_groups_tenant_id_system_key_unique" UNIQUE("tenant_id","system_key")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"system_key" varchar(40),
	"emoji" varchar(8),
	"disabled_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_tenant_id_system_key_unique" UNIQUE("tenant_id","system_key")
);
--> statement-breakpoint
CREATE TABLE "category_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"priority" integer NOT NULL,
	"merchant_contains" varchar(255),
	"amount_equals" numeric(19, 2),
	"amount_min" numeric(19, 2),
	"amount_max" numeric(19, 2),
	"account_id" uuid,
	"match_category_id" uuid,
	"set_category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_group_id_category_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."category_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_groups" ADD CONSTRAINT "category_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_match_category_id_categories_id_fk" FOREIGN KEY ("match_category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_set_category_id_categories_id_fk" FOREIGN KEY ("set_category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- ── 3. New columns (category_id NULLABLE until backfilled) ─────────────────
ALTER TABLE "transactions" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "plaid_category_primary" varchar(64);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "plaid_category_detailed" varchar(96);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "category_source" "category_source" DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "linked_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "merchant_edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "excluded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD COLUMN "category_id" uuid;--> statement-breakpoint

-- ── 4. Seed the default taxonomy for every existing tenant ────────────────
INSERT INTO "category_groups" ("tenant_id", "name", "type", "system_key", "sort_order")
SELECT t.id, g.name, g.gtype::"category_group_type", g.system_key, g.sort_order
FROM "tenants" t
CROSS JOIN (VALUES
	('Income','income','income',0),
	('Auto & Transport','expense','auto_transport',10),
	('Housing','expense','housing',20),
	('Bills & Utilities','expense','bills_utilities',30),
	('Food & Dining','expense','food_dining',40),
	('Shopping','expense','shopping',50),
	('Health & Wellness','expense','health_wellness',60),
	('Entertainment','expense','entertainment',70),
	('Travel','expense','travel',80),
	('Education','expense','education',90),
	('Giving','expense','giving',100),
	('Financial','expense','financial',110),
	('Transfers','transfer','transfers',120),
	('Other','expense','other',130)
) AS g(name, gtype, system_key, sort_order)
ON CONFLICT ("tenant_id","system_key") DO NOTHING;--> statement-breakpoint
INSERT INTO "categories" ("tenant_id", "group_id", "name", "system_key", "sort_order")
SELECT t.id, cg.id, c.name, c.system_key, c.sort_order
FROM "tenants" t
CROSS JOIN (VALUES
	('Income','income',0,'income'),
	('Transportation','transportation',0,'auto_transport'),
	('Car Payment','car_payment',10,'auto_transport'),
	('Gas','gas',20,'auto_transport'),
	('Parking & Tolls','parking_tolls',30,'auto_transport'),
	('Auto Maintenance','auto_maintenance',40,'auto_transport'),
	('Housing','housing',0,'housing'),
	('Home Improvement','home_improvement',10,'housing'),
	('Utilities','utilities',0,'bills_utilities'),
	('Internet & Phone','internet_phone',10,'bills_utilities'),
	('Insurance','insurance',20,'bills_utilities'),
	('Subscriptions','subscriptions',30,'bills_utilities'),
	('Groceries','groceries',0,'food_dining'),
	('Dining Out','food_dining',10,'food_dining'),
	('Coffee Shops','coffee_shops',20,'food_dining'),
	('Shopping','shopping',0,'shopping'),
	('Clothing','clothing',10,'shopping'),
	('Electronics','electronics',20,'shopping'),
	('Healthcare','healthcare',0,'health_wellness'),
	('Personal Care','personal_care',10,'health_wellness'),
	('Fitness','fitness',20,'health_wellness'),
	('Entertainment','entertainment',0,'entertainment'),
	('Travel','travel',0,'travel'),
	('Education','education',0,'education'),
	('Gifts & Donations','gifts_donations',0,'giving'),
	('Debt Payment','debt_payment',0,'financial'),
	('Savings & Investment','savings_investment',10,'financial'),
	('Taxes','taxes',20,'financial'),
	('Bank Fees','bank_fees',30,'financial'),
	('Software & SaaS','software_saas',40,'financial'),
	('Transfer','transfer',0,'transfers'),
	('Other','other',0,'other')
) AS c(name, system_key, sort_order, group_key)
JOIN "category_groups" cg ON cg."tenant_id" = t.id AND cg."system_key" = c.group_key
ON CONFLICT ("tenant_id","system_key") DO NOTHING;--> statement-breakpoint

-- ── 5. Backfill category_id from the old `category` enum (lossless: old value = system_key) ──
UPDATE "transactions" tx SET "category_id" = c."id"
FROM "categories" c
WHERE c."tenant_id" = tx."tenant_id" AND c."system_key" = tx."category"::text AND tx."category_id" IS NULL;--> statement-breakpoint
UPDATE "transactions" tx SET "category_id" = c."id"
FROM "categories" c
WHERE tx."category_id" IS NULL AND c."tenant_id" = tx."tenant_id" AND c."system_key" = 'other';--> statement-breakpoint
UPDATE "recurring_transactions" rt SET "category_id" = c."id"
FROM "categories" c
WHERE c."tenant_id" = rt."tenant_id" AND c."system_key" = rt."category"::text AND rt."category_id" IS NULL;--> statement-breakpoint
UPDATE "recurring_transactions" rt SET "category_id" = c."id"
FROM "categories" c
WHERE rt."category_id" IS NULL AND c."tenant_id" = rt."tenant_id" AND c."system_key" = 'other';--> statement-breakpoint

-- ── 6. Enforce NOT NULL, add FKs + indexes, drop the old column + type ────
ALTER TABLE "transactions" ALTER COLUMN "category_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ALTER COLUMN "category_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_tenant_category_idx" ON "transactions" USING btree ("tenant_id","category_id");--> statement-breakpoint
CREATE INDEX "transactions_tenant_date_idx" ON "transactions" USING btree ("tenant_id","date");--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "category";--> statement-breakpoint
ALTER TABLE "recurring_transactions" DROP COLUMN "category";--> statement-breakpoint
DROP TYPE "public"."transaction_category";
