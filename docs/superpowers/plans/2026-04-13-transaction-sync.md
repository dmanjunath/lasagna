# Transaction Sync & Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Plaid transaction sync with transfer reconciliation, a `source` column to prevent seed/real data mixing, previous-month spend/income on the dashboard, and a daily cron sync.

**Architecture:** Extend the existing `syncItem()` function to call `plaidClient.transactionsSync()` with cursor-based pagination. Add a `source` enum to the transactions table and `transactionCursor` to plaid_items. Update spending-summary to default to previous complete month. Exclude `transfer` category from all totals. Add `node-cron` for daily scheduled sync.

**Tech Stack:** Plaid SDK (`transactionsSync`), Drizzle ORM, Hono, node-cron

---

## File Structure

### New Files
- `packages/api/src/lib/transaction-sync.ts` — Plaid transaction sync logic, category mapping, seed cleanup
- `packages/api/src/lib/cron.ts` — Daily sync scheduler

### Modified Files
- `packages/core/src/schema.ts:130-147,419-435` — Add `transactionCursor` to plaid_items, add `source` enum + column to transactions, unique index on `plaidTransactionId`
- `packages/api/src/lib/sync.ts:15-155` — Call `syncTransactions()` from within `syncItem()`
- `packages/api/src/routes/transactions.ts:76-139` — Default spending-summary to previous month, exclude transfers from totals
- `packages/api/src/routes/transactions.ts:142-195` — Exclude transfers from monthly-trend totals
- `packages/api/src/index.ts` — Start cron scheduler on boot
- `packages/core/src/seed/generators/transactions.ts:240-247` — Set `source: 'seed'` on generated transactions

---

## Task 1: Schema changes

**Files:**
- Modify: `packages/core/src/schema.ts:130-147` (plaid_items)
- Modify: `packages/core/src/schema.ts:419-435` (transactions)

- [ ] **Step 1: Add `transactionCursor` column to plaid_items**

In `packages/core/src/schema.ts`, add after `lastSyncedAt` (line 139):

```typescript
transactionCursor: text("transaction_cursor"),
```

- [ ] **Step 2: Add `source` enum and column to transactions**

Before the transactions table definition (~line 419), add the enum:

```typescript
export const transactionSourceEnum = pgEnum("transaction_source", ["seed", "plaid"]);
```

Add to the transactions table after `pending` (line 433):

```typescript
source: transactionSourceEnum("source").notNull().default("seed"),
```

- [ ] **Step 3: Add unique index on plaidTransactionId**

After the transactions table definition, add:

```typescript
export const transactionsPlaidIdIdx = uniqueIndex("transactions_plaid_id_idx")
  .on(transactions.plaidTransactionId)
  .where(sql`plaid_transaction_id IS NOT NULL`);
```

Note: Drizzle may need this as part of the table definition using `.unique()` or as a separate index. Check Drizzle docs — if partial unique index isn't supported declaratively, use a raw SQL migration or add uniqueness check at insert time.

- [ ] **Step 4: Push schema changes**

```bash
pnpm db:push
```

- [ ] **Step 5: Update seed generator to set source**

In `packages/core/src/seed/generators/transactions.ts`, update the `createTransaction` helper to include `source: 'seed'` in every generated transaction object.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/schema.ts packages/core/src/seed/generators/transactions.ts
git commit -m "feat: add source column to transactions, transactionCursor to plaid_items"
```

---

## Task 2: Plaid transaction sync function

**Files:**
- Create: `packages/api/src/lib/transaction-sync.ts`
- Modify: `packages/api/src/lib/sync.ts`

- [ ] **Step 1: Create category mapping**

Create `packages/api/src/lib/transaction-sync.ts`:

```typescript
import { eq, and, sql, transactions, accounts, plaidItems, decrypt } from "@lasagna/core";
import type { Database } from "@lasagna/core";
import { plaidClient } from "./plaid.js";
import { env } from "./env.js";
import type { Transaction as PlaidTransaction } from "plaid";

// Map Plaid personal_finance_category.primary to our enum
const CATEGORY_MAP: Record<string, string> = {
  INCOME: "income",
  RENT_AND_UTILITIES: "utilities",
  HOME_IMPROVEMENT: "housing",
 D_AND_DRINK: "food_dining",
  GROCERIES: "groceries",
  GENERAL_MERCHANDISE: "shopping",
  TRANSPORTATION: "transportation",
  TRAVEL: "travel",
  ENTERTAINMENT: "entertainment",
  PERSONAL_CARE: "personal_care",
  MEDICAL: "healthcare",
  EDUCATION: "education",
  GOVERNMENT_AND_NON_PROFIT: "taxes",
  TRANSFER_IN: "transfer",
  TRANSFER_OUT: "transfer",
  LOAN_PAYMENTS: "debt_payment",
  BANK_FEES: "other",
};

function mapCategory(plaidCategory: string | undefined): string {
  if (!plaidCategory) return "other";
  return CATEGORY_MAP[plaidCategory] || "other";
}
```

- [ ] **Step 2: Add syncTransactions function**

Continue in `transaction-sync.ts`:

```typescript
import { db } from "./db.js";

export async function syncTransactions(itemId: string): Promise<{ added: number; modified: number; removed: number }> {
  const item = await db.query.plaidItems.findFirst({
    where: eq(plaidItems.id, itemId),
  });
  if (!item) throw new Error(`Plaid item ${itemId} not found`);

  const accessToken = await decrypt(item.accessToken, env.ENCRYPTION_KEY);

  // Get accounts for this item (needed for accountId mapping)
  const itemAccounts = await db.query.accounts.findMany({
    where: eq(accounts.plaidItemId, itemId),
  });
  const plaidAccountIdMap = new Map(itemAccounts.map(a => [a.plaidAccountId, a.id]));

  // First sync? Clean up seeded transactions for these accounts
  if (!item.transactionCursor) {
    const accountIds = itemAccounts.map(a => a.id);
    if (accountIds.length > 0) {
      await db.delete(transactions).where(
        and(
          sql`${transactions.accountId} IN (${sql.join(accountIds.map(id => sql`${id}`), sql`, `)})`,
          sql`${transactions.source} = 'seed'`,
        )
      );
    }
  }

  let cursor = item.transactionCursor ?? undefined;
  let totalAdded = 0;
  let totalModified = 0;
  let totalRemoved = 0;
  let hasMore = true;

  while (hasMore) {
    const resp = await plaidClient.transactionsSync({
      access_token: accessToken,
      cursor,
    });

    const { added, modified, removed, next_cursor, has_more } = resp.data;

    // Process added transactions
    for (const txn of added) {
      const accountId = plaidAccountIdMap.get(txn.account_id);
      if (!accountId) continue;

      await db.insert(transactions).values({
        accountId,
        tenantId: item.tenantId,
        plaidTransactionId: txn.transaction_id,
        date: new Date(txn.date),
        name: txn.name || txn.merchant_name || "Unknown",
        merchantName: txn.merchant_name ?? null,
        amount: txn.amount.toString(),
        category: mapCategory(txn.personal_finance_category?.primary) as any,
        pending: txn.pending ? 1 : 0,
        source: "plaid" as any,
      }).onConflictDoNothing();
      totalAdded++;
    }

    // Process modified transactions
    for (const txn of modified) {
      await db.update(transactions)
        .set({
          name: txn.name || txn.merchant_name || "Unknown",
          merchantName: txn.merchant_name ?? null,
          amount: txn.amount.toString(),
          category: mapCategory(txn.personal_finance_category?.primary) as any,
          pending: txn.pending ? 1 : 0,
        })
        .where(eq(transactions.plaidTransactionId, txn.transaction_id));
      totalModified++;
    }

    // Process removed transactions
    for (const txn of removed) {
      await db.delete(transactions)
        .where(eq(transactions.plaidTransactionId, txn.transaction_id));
      totalRemoved++;
    }

    cursor = next_cursor;
    hasMore = has_more;
  }

  // Save cursor
  await db.update(plaidItems)
    .set({ transactionCursor: cursor ?? null })
    .where(eq(plaidItems.id, itemId));

  return { added: totalAdded, modified: totalModified, removed: totalRemoved };
}
```

- [ ] **Step 3: Integrate into syncItem**

In `packages/api/src/lib/sync.ts`, add import at top:

```typescript
import { syncTransactions } from "./transaction-sync.js";
```

After the investments sync try/catch block (~line 121) and before the success log (~line 123), add:

```typescript
    // Sync transactions
    try {
      await syncTransactions(itemId);
    } catch (e) {
      console.error(`Transaction sync failed for item ${itemId}:`, e);
      // Don't fail the whole sync if transactions fail
    }
```

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/lib/transaction-sync.ts packages/api/src/lib/sync.ts
git commit -m "feat: add Plaid transaction sync with category mapping and seed cleanup"
```

---

## Task 3: Update spending-summary to default to previous month and exclude transfers

**Files:**
- Modify: `packages/api/src/routes/transactions.ts:76-139`

- [ ] **Step 1: Change default date range to previous complete month**

Replace lines 78-84 in the spending-summary endpoint:

```typescript
  const now = new Date();
  const startDate = c.req.query("startDate")
    ? new Date(c.req.query("startDate")!)
    : new Date(now.getFullYear(), now.getMonth() - 1, 1); // Previous month start
  const endDate = c.req.query("endDate")
    ? new Date(c.req.query("endDate")!)
    : new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59); // Previous month end
```

- [ ] **Step 2: Exclude transfers from totals**

In the spending-summary totals calculation (lines 104-113), update to exclude transfers:

```typescript
  let totalSpending = 0;
  let totalIncome = 0;

  const categories = rows.map((row) => {
    const total = parseFloat(row.total || "0");
    const isTransfer = row.category === "transfer";
    if (total < 0 && !isTransfer) {
      totalIncome += Math.abs(total);
    } else if (total > 0 && !isTransfer) {
      totalSpending += total;
    }
    return {
      category: row.category,
      total: Math.round(Math.abs(total) * 100) / 100,
      count: row.count,
      percentage: 0,
    };
  });
```

- [ ] **Step 3: Exclude transfers from monthly-trend totals**

In the monthly-trend endpoint (lines 176-179), update:

```typescript
  for (const row of rows) {
    const month = row.month;
    const amount = parseFloat(row.amount || "0");
    const category = row.category;
    const entry = monthMap.get(month) ?? { income: 0, expenses: 0 };

    if (category !== "transfer") {
      if (amount < 0) {
        entry.income += Math.abs(amount);
      } else {
        entry.expenses += amount;
      }
    }

    monthMap.set(month, entry);
  }
```

This requires adding `category` to the monthly-trend select query. Update the select (line 148-149):

```typescript
  const rows = await db
    .select({
      month: sql<string>`to_char(${transactions.date}, 'YYYY-MM')`,
      amount: transactions.amount,
      category: transactions.category,
    })
```

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routes/transactions.ts
git commit -m "feat: default spending-summary to previous month, exclude transfers from totals"
```

---

## Task 4: Update priorities to exclude transfers

**Files:**
- Modify: `packages/api/src/routes/priorities.ts`

- [ ] **Step 1: Add transfer exclusion to expense query**

The priorities endpoint already queries transactions (from our earlier fix). Update the query to exclude transfers:

```typescript
  const [txnResult] = await db
    .select({ total: sql<string>`coalesce(sum(${transactions.amount}), 0)` })
    .from(transactions)
    .where(and(
      eq(transactions.tenantId, session.tenantId),
      sql`${transactions.amount} > 0`,
      sql`${transactions.category} != 'transfer'`,
      sql`${transactions.date} >= ${thirtyDaysAgo.toISOString().split('T')[0]}`,
    ));
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/routes/priorities.ts
git commit -m "fix: exclude transfers from priorities expense calculation"
```

---

## Task 5: Daily cron sync

**Files:**
- Create: `packages/api/src/lib/cron.ts`
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Install node-cron**

```bash
cd packages/api && pnpm add node-cron && pnpm add -D @types/node-cron
```

- [ ] **Step 2: Create cron scheduler**

Create `packages/api/src/lib/cron.ts`:

```typescript
import cron from "node-cron";
import { db } from "./db.js";
import { eq, plaidItems } from "@lasagna/core";
import { syncItem } from "./sync.js";

export function startCronJobs() {
  // Daily sync at 6am UTC
  cron.schedule("0 6 * * *", async () => {
    console.log("[Cron] Starting daily sync for all active Plaid items...");
    try {
      const items = await db.query.plaidItems.findMany({
        where: eq(plaidItems.status, "active"),
      });
      console.log(`[Cron] Found ${items.length} active items to sync`);

      const results = await Promise.allSettled(
        items.map((item) => syncItem(item.id))
      );

      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;
      console.log(`[Cron] Daily sync complete: ${succeeded} succeeded, ${failed} failed`);
    } catch (err) {
      console.error("[Cron] Daily sync error:", err);
    }
  });

  console.log("[Cron] Daily sync scheduled for 6:00 AM UTC");
}
```

- [ ] **Step 3: Start cron on API boot**

In `packages/api/src/index.ts`, add after the server starts:

```typescript
import { startCronJobs } from "./lib/cron.js";

// After serve() call:
startCronJobs();
```

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/lib/cron.ts packages/api/src/index.ts packages/api/package.json packages/api/pnpm-lock.yaml
git commit -m "feat: add daily cron job for Plaid transaction sync"
```

---

## Task 6: Spending page sync trigger

**Files:**
- Modify: `packages/web/src/pages/spending.tsx`

- [ ] **Step 1: Add sync button to spending page**

In the spending page header area, add a "Sync Transactions" button that calls `api.triggerSync()`:

```typescript
import { RefreshCw } from 'lucide-react';

// In the header/toolbar area of the spending page:
<button
  onClick={async () => {
    setSyncing(true);
    await api.triggerSync().catch(console.error);
    // Wait a few seconds for sync to process, then reload data
    setTimeout(() => {
      loadData();
      setSyncing(false);
    }, 3000);
  }}
  disabled={syncing}
  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-muted hover:text-accent border border-border rounded-lg hover:border-accent/30 transition-colors disabled:opacity-50"
>
  <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
  {syncing ? 'Syncing...' : 'Sync'}
</button>
```

Add state: `const [syncing, setSyncing] = useState(false);`

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/pages/spending.tsx
git commit -m "feat: add sync transactions button to spending page"
```

---

## Task 7: Restart API, push schema, verify

- [ ] **Step 1: Push schema and restart**

```bash
pnpm db:push
docker compose restart api
```

- [ ] **Step 2: Verify with seeded test user**

Run existing Playwright tests to make sure nothing breaks:

```bash
npx playwright test e2e/mobile-chat.spec.ts --reporter=list
```

- [ ] **Step 3: Verify spending-summary returns previous month**

Manually test the API:

```bash
curl http://localhost:3000/api/transactions/spending-summary
```

Should return previous month's data by default.

- [ ] **Step 4: Commit any fixes**

```bash
git add -u && git commit -m "fix: address issues found during verification"
```
