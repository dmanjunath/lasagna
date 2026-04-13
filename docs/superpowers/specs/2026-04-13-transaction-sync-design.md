# Transaction Sync & Reconciliation

## Problem

The app has no Plaid transaction sync. Monthly spend, income, and savings numbers are either missing (for real Plaid users) or come from seeded fake data. Credit card payments would be double-counted without reconciliation. Seeded and real data can mix in the same account.

## Solution

Add pull-based Plaid transaction sync using `transactionsSync()`, a `source` column to prevent seed/real data mixing, transfer exclusion for spend/income reconciliation, and a daily scheduled sync.

## Schema Changes

### `transactions` table

Add column:
- `source` — enum `('seed', 'plaid')`, not null, default `'seed'`

Add constraint:
- Unique index on `plaidTransactionId` where not null (prevent duplicate Plaid inserts)

Backfill: all existing transactions get `source = 'seed'`.

### `plaid_items` table

Add column:
- `transactionCursor` — text, nullable (stores Plaid's sync cursor for incremental fetches)

## Plaid Transaction Sync

### Trigger Points

- **Manual:** User visits spending page or clicks sync button
- **Scheduled:** Daily cron (6am) syncs all active Plaid items
- **API:** `POST /api/sync` (existing endpoint, extended to include transactions)

### Sync Flow (per Plaid item)

1. Read `transactionCursor` from `plaid_items` (null on first sync)
2. Call `plaidClient.transactionsSync({ access_token, cursor })` in a loop until `has_more === false`
3. Process results:
   - **added**: Insert each transaction with `source = 'plaid'`, mapped category, and `plaidTransactionId`
   - **modified**: Update existing transaction matched by `plaidTransactionId`
   - **removed**: Delete transaction matched by `plaidTransactionId`
4. Save new cursor to `plaid_items.transactionCursor`

### First Sync — Seed Data Cleanup

Before inserting Plaid transactions for the first time (cursor is null):
- Delete all transactions with `source = 'seed'` for accounts belonging to that Plaid item
- This ensures seeded and real data never mix in the same account

### Category Mapping

Map Plaid's `personal_finance_category.primary` to our enum:

| Plaid Category | Our Category |
|----------------|-------------|
| `INCOME` | `income` |
| `RENT_AND_UTILITIES` | `utilities` |
| `HOME_IMPROVEMENT` | `housing` |
| `FOOD_AND_DRINK` | `food_dining` |
| `GENERAL_MERCHANDISE` | `shopping` |
| `TRANSPORTATION` | `transportation` |
| `TRAVEL` | `travel` |
| `ENTERTAINMENT` | `entertainment` |
| `PERSONAL_CARE` | `personal_care` |
| `MEDICAL` | `healthcare` |
| `EDUCATION` | `education` |
| `GOVERNMENT_AND_NON_PROFIT` | `taxes` |
| `TRANSFER_IN` | `transfer` |
| `TRANSFER_OUT` | `transfer` |
| `LOAN_PAYMENTS` | `debt_payment` |
| `BANK_FEES` | `other` |
| Everything else | `other` |

Unmapped or missing categories default to `other`.

## Reconciliation: Spend & Income Totals

### Core Rule

Transactions with `category = 'transfer'` are **stored in the database** but **excluded from all spend/income/savings totals**. This handles credit card payments, account-to-account transfers, and similar inter-account movements without heuristic matching.

Why this works: Plaid categorizes credit card payments as `TRANSFER_OUT` / `TRANSFER_IN`. By mapping these to `transfer` and excluding from totals, a $2,000 CC payment from checking doesn't count as a $2,000 expense.

### Calculations

- **Monthly Spend** = sum of positive-amount, non-transfer transactions
- **Monthly Income** = absolute value of negative-amount, non-transfer transactions
- **Monthly Savings** = Income − Spend
- **When either is zero/missing**: show "—"

### Dashboard Shows Previous Complete Month

The Dashboard's "Monthly Income" and "Monthly Spend" tiles show the **previous complete calendar month**, not the current partial month. If today is April 13, the dashboard shows March totals. This avoids misleading partial-month numbers.

- `spending-summary` endpoint default period changes to previous complete month when called without explicit date params
- Spending page continues to show current month (for in-progress tracking)
- Monthly trend endpoint already returns per-month data; just needs transfer exclusion added

## Scheduled Daily Sync

A daily cron job (6am) syncs transactions for all active Plaid items:

1. Query all `plaid_items` with `status = 'active'`
2. For each item, run the transaction sync flow (+ balance sync)
3. Log results (items synced, transactions added/modified/removed)

Implementation: `node-cron` inside the API server process. Internal endpoint `POST /api/sync/all` that iterates all items. The cron triggers this endpoint.

## What Changes

| Component | Change |
|-----------|--------|
| `packages/core/src/schema.ts` | Add `source` enum + column to transactions, add `transactionCursor` to plaid_items, unique constraint on `plaidTransactionId` |
| `packages/api/src/lib/sync.ts` | Add `syncTransactions()` with Plaid transactionsSync, category mapping, seed cleanup |
| `packages/api/src/routes/transactions.ts` | Default spending-summary to previous complete month, exclude transfers from totals |
| `packages/api/src/routes/priorities.ts` | Exclude transfers from expense query |
| `packages/api/src/server.ts` | Add node-cron daily sync schedule |
| `packages/web/src/pages/spending.tsx` | Add sync trigger button |

## What Stays the Same

- Transaction list endpoint (works as-is, just gets more data)
- Plaid link setup (already requests `Products.Transactions`)
- Chat, retirement, goals pages (consume same APIs, benefit automatically)
- Dashboard display logic (already shows "—" when no data; now gets real data)
