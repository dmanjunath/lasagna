ALTER TABLE "accounts" ADD COLUMN "property_account_id" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_property_account_id_accounts_id_fk" FOREIGN KEY ("property_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_property_account_idx" ON "accounts" USING btree ("property_account_id");--> statement-breakpoint
-- Property↔mortgage link backfill: the old feature stored `linkedAccountId` inside
-- accounts.metadata (JSON text) on EITHER side of the pair — bidirectional, no referential
-- integrity. This one-time backfill converges both directions onto the new `property_account_id`
-- FK (always set on the debt side) and strips the legacy key from every visited row.
-- `::text` casts on id comparisons mean a bad value selects nothing instead of throwing.
-- The debt-side pass runs first; the property-side pass only fills rows where
-- `property_account_id IS NULL` so the debt side's own link wins on disagreement.
-- Side effect: visited rows' metadata is round-tripped through jsonb (key order/whitespace normalised).
DO $$
DECLARE
  r RECORD;
  linked text;
BEGIN
  FOR r IN
    SELECT id, tenant_id, type, metadata FROM accounts
    WHERE metadata IS NOT NULL AND position('linkedAccountId' in metadata) > 0
  LOOP
    BEGIN
      linked := (r.metadata::jsonb)->>'linkedAccountId';
      IF linked IS NOT NULL THEN
        IF r.type IN ('credit', 'loan') THEN
          UPDATE accounts d SET property_account_id = p.id
          FROM accounts p
          WHERE d.id = r.id AND p.id::text = linked
            AND p.tenant_id = r.tenant_id AND p.type = 'real_estate';
        ELSIF r.type = 'real_estate' THEN
          UPDATE accounts d SET property_account_id = r.id
          WHERE d.id::text = linked AND d.tenant_id = r.tenant_id
            AND d.type IN ('credit', 'loan') AND d.property_account_id IS NULL;
        END IF;
      END IF;
      UPDATE accounts SET metadata = CASE
        WHEN (metadata::jsonb - 'linkedAccountId') = '{}'::jsonb THEN NULL
        ELSE (metadata::jsonb - 'linkedAccountId')::text END
      WHERE id = r.id;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- any per-row failure (typically malformed JSON): skip this row, leave it untouched
    END;
  END LOOP;
END $$;