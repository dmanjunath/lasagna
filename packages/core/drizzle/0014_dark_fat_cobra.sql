ALTER TYPE "public"."role" ADD VALUE 'viewer';--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" "role" DEFAULT 'member' NOT NULL,
	"token" text NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"date_of_birth" timestamp with time zone,
	"annual_income" numeric(19, 2),
	"employment_type" varchar(50),
	"risk_tolerance" "risk_tolerance",
	"retirement_age" integer,
	"employer_match_percent" numeric(5, 2),
	"has_hdhp" boolean,
	"is_pslf_eligible" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "chat_threads" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invites_pending_tenant_email_idx" ON "invites" USING btree ("tenant_id","email") WHERE "invites"."accepted_at" IS NULL AND "invites"."revoked_at" IS NULL;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Backfill: copy each tenant's existing personal profile fields into a
-- user_profiles row for that tenant's OWNER. Household fields stay on
-- financial_profiles. Idempotent via ON CONFLICT on the unique user_id.
INSERT INTO "user_profiles" (
  "tenant_id", "user_id", "date_of_birth", "annual_income", "employment_type",
  "risk_tolerance", "retirement_age", "employer_match_percent", "has_hdhp", "is_pslf_eligible"
)
SELECT fp."tenant_id", u."id", fp."date_of_birth", fp."annual_income", fp."employment_type",
       fp."risk_tolerance", fp."retirement_age", fp."employer_match_percent", fp."has_hdhp", fp."is_pslf_eligible"
FROM "financial_profiles" fp
JOIN "users" u ON u."tenant_id" = fp."tenant_id" AND u."role" = 'owner'
ON CONFLICT ("user_id") DO NOTHING;--> statement-breakpoint
-- Backfill: existing chat threads belong to the tenant OWNER.
UPDATE "chat_threads" ct
SET "user_id" = u."id"
FROM "users" u
WHERE u."tenant_id" = ct."tenant_id" AND u."role" = 'owner' AND ct."user_id" IS NULL;