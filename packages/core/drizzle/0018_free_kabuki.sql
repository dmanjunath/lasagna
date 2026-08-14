ALTER TABLE "plaid_items" ADD COLUMN "plaid_item_id" varchar(255);--> statement-breakpoint
ALTER TABLE "plaid_items" ADD CONSTRAINT "plaid_items_plaid_item_id_unique" UNIQUE("plaid_item_id");