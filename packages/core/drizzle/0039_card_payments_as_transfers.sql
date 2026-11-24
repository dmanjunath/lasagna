-- A credit card or loan payment is a transfer, never income. Plaid labels the
-- card side of a payment inconsistently (LOAN_PAYMENTS, TRANSFER_IN, or
-- INCOME_SALARY on an "AUTOMATIC PAYMENT - THANK YOU"), so some landed in the
-- Income category and counted as money in. New rows are fixed at sync
-- (packages/api/src/lib/transaction-sync.ts, isDebtPayment). This moves the
-- existing ones.
--
-- Data only, no schema change. Only rows the app categorized itself
-- (category_source 'auto'): a user's or a rule's choice is left alone. Only
-- money arriving (amount < 0) on a credit or loan account, currently in an
-- income-group category or uncategorized, and only when Plaid filed it as a
-- loan payment or transfer in, or its name reads like a payment. Refund
-- wording is excluded, and so is income that is not a payment (rental
-- payouts, statement credits). Moves it to the household's Transfer category.
-- No transaction amount changes. Safe to run more than once.
--
-- Health check (read only), to list any income still on debt accounts:
--   SELECT t.tenant_id, t.date, t.name, t.amount, t.category_source,
--          t.plaid_category_primary, t.plaid_category_detailed
--   FROM transactions t
--   JOIN accounts a ON a.id = t.account_id
--   JOIN categories c ON c.id = t.category_id
--   JOIN category_groups g ON g.id = c.group_id
--   WHERE a.type IN ('credit', 'loan') AND t.amount < 0 AND g.type = 'income'
--   ORDER BY t.date DESC;
UPDATE "transactions" AS t
SET "category_id" = tc."id"
FROM "accounts" AS a, "categories" AS tc
WHERE a."id" = t."account_id"
  AND a."type" IN ('credit', 'loan')
  AND t."amount" < 0
  AND t."category_source" = 'auto'
  AND tc."tenant_id" = t."tenant_id" AND tc."system_key" = 'transfer'
  AND (
    t."category_id" IS NULL
    OR EXISTS (
      SELECT 1 FROM "categories" AS c JOIN "category_groups" AS g ON g."id" = c."group_id"
      WHERE c."id" = t."category_id" AND g."type" = 'income'
    )
  )
  AND (t."name" || ' ' || coalesce(t."merchant_name", '')) !~* '\y(refund|return|credit adj)'
  AND (
    t."plaid_category_primary" IN ('LOAN_PAYMENTS', 'TRANSFER_IN')
    OR (t."name" || ' ' || coalesce(t."merchant_name", '')) ~* '\y(payment|thank you|autopay|auto pay|e-?payment|online pmt|pymt)\y'
  );
