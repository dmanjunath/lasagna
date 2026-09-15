-- Collapse the duplicate transactions a racing sync left behind, then make them
-- impossible.
--
-- `transactions` never constrained Plaid's transaction id, and sync deduped it
-- with a read-then-write. Nothing serializes a sync for one item -- a webhook,
-- the cron, a manual sync and the post-link sync each trigger it independently
-- -- so two overlapping runs both read "not stored yet" and both inserted.
--
-- The index at the bottom is the fix. The two statements above it exist
-- because Postgres will not build a unique index over rows that already
-- violate it, so an install carrying duplicates fails the migration without
-- them.
--
-- WHICH COPY SURVIVES: the one carrying the user's work, and only then the
-- oldest. The copies are identical as Plaid delivered them, so the sole thing
-- that distinguishes them is what the user did to one -- a re-category, a
-- note, a rename, an exclusion, or a transfer pairing. Ranking on age alone
-- silently deletes that work whenever the user happened to edit the newer row.

-- `linked_transaction_id` carries no foreign key, so a transfer whose partner
-- is about to be deleted would be left pointing at a row that is gone.
UPDATE "transactions" SET "linked_transaction_id" = NULL
WHERE "linked_transaction_id" IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY tenant_id, plaid_transaction_id
      ORDER BY (
        category_source = 'manual' OR notes IS NOT NULL
        OR merchant_edited_at IS NOT NULL OR excluded_at IS NOT NULL
        OR linked_transaction_id IS NOT NULL
      ) DESC, created_at, id
    ) AS rn
    FROM "transactions" WHERE plaid_transaction_id IS NOT NULL
  ) ranked WHERE rn > 1
);--> statement-breakpoint

DELETE FROM "transactions" WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY tenant_id, plaid_transaction_id
      ORDER BY (
        category_source = 'manual' OR notes IS NOT NULL
        OR merchant_edited_at IS NOT NULL OR excluded_at IS NOT NULL
        OR linked_transaction_id IS NOT NULL
      ) DESC, created_at, id
    ) AS rn
    FROM "transactions" WHERE plaid_transaction_id IS NOT NULL
  ) ranked WHERE rn > 1
);--> statement-breakpoint

CREATE UNIQUE INDEX "transactions_tenant_plaid_txn_idx" ON "transactions" USING btree ("tenant_id","plaid_transaction_id") WHERE "transactions"."plaid_transaction_id" IS NOT NULL;
