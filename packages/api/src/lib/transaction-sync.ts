import { eq, and, sql, transactions, accounts, plaidItems, decrypt, categoryRules } from "@lasagna/core";
import { db } from "./db.js";
import { plaidClient } from "./plaid.js";
import { env } from "./env.js";
import { firstMatchingRule, type RuleCriteria } from "./category-rules.js";
import { matchTransfersForTenant } from "./transfer-match.js";
import { loadTaxonomy, resolveCategoryId, activeCategoryId, type TenantCategory } from "./taxonomy.js";

// Two-tier Plaid mapping: detailed category first (higher fidelity), then
// primary, then "other" as the true last resort. Keys are Plaid's v2
// personal_finance_category taxonomy.
const DETAILED_MAP: Record<string, string> = {
  LOAN_PAYMENTS_CREDIT_CARD_PAYMENT: "transfer", // paying a card is a transfer, not new debt
  FOOD_AND_DRINK_GROCERIES: "groceries",
  RENT_AND_UTILITIES_RENT: "housing",
  GOVERNMENT_AND_NON_PROFIT_DONATIONS: "gifts_donations",
  GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT: "taxes",
  GENERAL_SERVICES_INSURANCE: "insurance",
  GENERAL_SERVICES_EDUCATION: "education",
  GENERAL_SERVICES_AUTOMOTIVE: "transportation",
  GENERAL_SERVICES_CHILDCARE: "personal_care",
  // Plaid dumps virtually all SaaS/cloud subscriptions (OpenAI, AWS, VPNs,
  // Google One…) into this bucket; in practice it's software, not plumbers.
  // A non-SaaS service landing here is a one-off rule/edit away from correct.
  GENERAL_SERVICES_OTHER_GENERAL_SERVICES: "software_saas",
  TRANSPORTATION_GAS: "gas",
  TRANSPORTATION_PARKING: "parking_tolls",
  LOAN_PAYMENTS_MORTGAGE_PAYMENT: "housing",
  LOAN_PAYMENTS_CAR_PAYMENT: "car_payment",
  RENT_AND_UTILITIES_INTERNET_AND_CABLE: "internet_phone",
  RENT_AND_UTILITIES_TELEPHONE: "internet_phone",
  FOOD_AND_DRINK_COFFEE: "coffee_shops",
  GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES: "clothing",
  GENERAL_MERCHANDISE_ELECTRONICS: "electronics",
  PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS: "fitness",
};

const PRIMARY_MAP: Record<string, string> = {
  INCOME: "income",
  TRANSFER_IN: "transfer",
  TRANSFER_OUT: "transfer",
  LOAN_PAYMENTS: "debt_payment",
  BANK_FEES: "bank_fees",
  ENTERTAINMENT: "entertainment",
  FOOD_AND_DRINK: "food_dining",
  GENERAL_MERCHANDISE: "shopping",
  HOME_IMPROVEMENT: "home_improvement",
  MEDICAL: "healthcare",
  PERSONAL_CARE: "personal_care",
  GENERAL_SERVICES: "other",
  GOVERNMENT_AND_NON_PROFIT: "taxes",
  TRANSPORTATION: "transportation",
  TRAVEL: "travel",
  RENT_AND_UTILITIES: "utilities",
};

export function mapCategory(plaidCategory: { primary?: string; detailed?: string } | null | undefined): string {
  if (!plaidCategory) return "other";
  if (plaidCategory.detailed && DETAILED_MAP[plaidCategory.detailed]) return DETAILED_MAP[plaidCategory.detailed];
  if (plaidCategory.primary && PRIMARY_MAP[plaidCategory.primary]) return PRIMARY_MAP[plaidCategory.primary];
  return "other";
}

// Plaid mapping first, then the tenant's rules (first match wins).
// The taxonomy id is the sole category output; mapCategory still produces
// systemKeys as the resolver's input. Null id is impossible for a seeded
// tenant (Other always exists), hence the assertion.
export function categorize(
  taxonomy: TenantCategory[],
  rules: RuleCriteria[],
  txn: { name: string; merchantName: string | null; amount: string; accountId: string },
  plaidCategory: { primary?: string; detailed?: string } | null | undefined,
): { categoryId: string; categorySource: "auto" | "rule" } {
  const mappedKey = mapCategory(plaidCategory);
  const mappedId = resolveCategoryId(taxonomy, mappedKey);
  const rule = firstMatchingRule(rules, { ...txn, categoryId: mappedId });
  const finalId = rule ? activeCategoryId(taxonomy, rule.setCategoryId) : mappedId;
  return { categoryId: finalId!, categorySource: rule ? "rule" : "auto" };
}

export async function syncTransactions(itemId: string): Promise<{ added: number; modified: number; removed: number }> {
  const item = await db.query.plaidItems.findFirst({
    where: eq(plaidItems.id, itemId),
  });
  if (!item) throw new Error(`Plaid item ${itemId} not found`);

  const tenantRules = await db.select().from(categoryRules)
    .where(eq(categoryRules.tenantId, item.tenantId))
    .orderBy(categoryRules.priority);

  const taxonomy = await loadTaxonomy(item.tenantId);

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
        const { categoryId, categorySource } = categorize(taxonomy, tenantRules, {
          name: txn.name || txn.merchant_name || "Unknown",
          merchantName: txn.merchant_name ?? null,
          amount: txn.amount.toString(),
          accountId,
        }, txn.personal_finance_category);
        await db.insert(transactions).values({
          accountId,
          tenantId: item.tenantId,
          plaidTransactionId: txn.transaction_id,
          date: new Date(txn.date),
          name: txn.name || txn.merchant_name || "Unknown",
          merchantName: txn.merchant_name ?? null,
          amount: txn.amount.toString(),
          categoryId,
          categorySource: categorySource as any,
          plaidCategoryPrimary: txn.personal_finance_category?.primary ?? null,
          plaidCategoryDetailed: txn.personal_finance_category?.detailed ?? null,
          pending: txn.pending ? 1 : 0,
          source: "plaid" as any,
        });
        totalAdded++;
      } else if (existing.categorySource === "auto" || existing.categorySource === "rule") {
        const { categoryId, categorySource } = categorize(taxonomy, tenantRules, {
          name: existing.name,
          merchantName: existing.merchantName,
          amount: existing.amount,
          accountId: existing.accountId,
        }, txn.personal_finance_category);
        await db.update(transactions)
          .set({
            categoryId,
            categorySource: categorySource as any,
            plaidCategoryPrimary: txn.personal_finance_category?.primary ?? null,
            plaidCategoryDetailed: txn.personal_finance_category?.detailed ?? null,
          })
          .where(eq(transactions.plaidTransactionId, txn.transaction_id));
      }
    }

    // Process modified transactions
    for (const txn of modified) {
      const existing = await db.query.transactions.findFirst({
        where: eq(transactions.plaidTransactionId, txn.transaction_id),
      });
      if (!existing) continue;
      const name = txn.name || txn.merchant_name || "Unknown";
      const fields: Record<string, unknown> = {
        amount: txn.amount.toString(),
        pending: txn.pending ? 1 : 0,
        plaidCategoryPrimary: txn.personal_finance_category?.primary ?? null,
        plaidCategoryDetailed: txn.personal_finance_category?.detailed ?? null,
      };
      if (!existing.merchantEditedAt) {
        fields.name = name;
        fields.merchantName = txn.merchant_name ?? null;
      }
      if (existing.categorySource === "auto" || existing.categorySource === "rule") {
        const renamed = !!existing.merchantEditedAt;
        const { categoryId, categorySource } = categorize(taxonomy, tenantRules, {
          name: renamed ? existing.name : name,
          merchantName: renamed ? existing.merchantName : (txn.merchant_name ?? null),
          amount: txn.amount.toString(), accountId: existing.accountId,
        }, txn.personal_finance_category);
        fields.categoryId = categoryId;
        fields.categorySource = categorySource;
      }
      await db.update(transactions).set(fields as any)
        .where(eq(transactions.plaidTransactionId, txn.transaction_id));
      totalModified++;
    }

    // Process removed transactions
    for (const txn of removed) {
      if (txn.transaction_id) {
        const existing = await db.query.transactions.findFirst({
          where: eq(transactions.plaidTransactionId, txn.transaction_id),
        });
        if (existing?.linkedTransactionId) {
          await db.update(transactions)
            .set({ linkedTransactionId: null })
            .where(eq(transactions.id, existing.linkedTransactionId));
        }
        await db.delete(transactions)
          .where(eq(transactions.plaidTransactionId, txn.transaction_id));
        totalRemoved++;
      }
    }

    cursor = next_cursor;
    hasMore = has_more;
  }

  const paired = await matchTransfersForTenant(item.tenantId);
  if (paired > 0) console.log(`[TransferMatch] Item ${itemId}: linked ${paired} pair(s)`);

  // Save cursor
  await db.update(plaidItems)
    .set({ transactionCursor: cursor ?? null })
    .where(eq(plaidItems.id, itemId));

  console.log(`[TransactionSync] Item ${itemId}: +${totalAdded} ~${totalModified} -${totalRemoved}`);
  return { added: totalAdded, modified: totalModified, removed: totalRemoved };
}
