CREATE TABLE "security_classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" varchar(40) NOT NULL,
	"asset_class" varchar(40),
	"category" varchar(80),
	"failed" boolean DEFAULT false NOT NULL,
	"classified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_classifications_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "last_security_classify_at" timestamp with time zone;