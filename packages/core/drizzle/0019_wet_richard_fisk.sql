-- Holdings become current-state: one row per (account, security).
--
-- Sync used to plain-INSERT every position on every run, so the table holds N
-- copies of each position after N syncs. Collapse those first — keeping the row
-- with the newest snapshot_at, tie-broken on id so the result is deterministic —
-- otherwise the UNIQUE constraint below cannot be created on existing data.
DELETE FROM "holdings" h
USING "holdings" keep
WHERE h."account_id" = keep."account_id"
  AND h."security_id" = keep."security_id"
  AND (h."snapshot_at", h."id") < (keep."snapshot_at", keep."id");--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_account_id_security_id_unique" UNIQUE("account_id","security_id");
