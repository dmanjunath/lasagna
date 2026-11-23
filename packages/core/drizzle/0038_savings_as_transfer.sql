-- Money moved into your own savings or brokerage is a transfer, not spending.
-- New households are seeded with "Savings & Investment" under the Transfers
-- group already (DEFAULT_TAXONOMY). This moves it there for existing households.
--
-- Data only, no schema change. It touches only the category's group: no
-- transaction is rewritten. A category the user moved to another group
-- themselves is left where they put it (only one still under the default
-- Financial group moves). Safe to run more than once.
UPDATE "categories" AS c
SET "group_id" = tg."id"
FROM "category_groups" AS fg, "category_groups" AS tg
WHERE c."system_key" = 'savings_investment'
  AND fg."id" = c."group_id" AND fg."system_key" = 'financial'
  AND tg."tenant_id" = c."tenant_id" AND tg."system_key" = 'transfers';
