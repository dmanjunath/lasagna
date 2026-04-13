import { eq, and, sql, transactions, accounts, plaidItems, decrypt } from "@lasagna/core";
import { db } from "./db.js";
import { plaidClient } from "./plaid.js";
import { env } from "./env.js";

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
      for (const accountId of accountIds) {
        await db.delete(transactions).where(
          and(
            eq(transactions.accountId, accountId),
            sql`${transactions.source} = 'seed'`,
          )
        );
      }
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

      // Check if already exists (in case of retry)
      const existing = txn.transaction_id
        ? await db.query.transactions.findFirst({
            where: eq(transactions.plaidTransactionId, txn.transaction_id),
          })
        : null;

      if (!existing) {
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
        });
        totalAdded++;
      }
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
      if (txn.transaction_id) {
        await db.delete(transactions)
          .where(eq(transactions.plaidTransactionId, txn.transaction_id));
        totalRemoved++;
      }
    }

    cursor = next_cursor;
    hasMore = has_more;
  }

  // Save cursor
  await db.update(plaidItems)
    .set({ transactionCursor: cursor ?? null })
    .where(eq(plaidItems.id, itemId));

  console.log(`[TransactionSync] Item ${itemId}: +${totalAdded} ~${totalModified} -${totalRemoved}`);
  return { added: totalAdded, modified: totalModified, removed: totalRemoved };
}
