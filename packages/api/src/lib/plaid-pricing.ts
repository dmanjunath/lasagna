/**
 * Pure Plaid cost model. NO Plaid client / db / heavy imports here — this module
 * is imported by the admin spend route, which must not pull the Plaid or LLM
 * graph in just to price a connection.
 *
 * Plaid bills per Item (connection) per month by product, not per API call:
 *  - Transactions is always in `products`, so an Item is billed for it whenever
 *    it has a transaction-bearing account (depository / credit).
 *  - Investments (Holdings) and Liabilities are billed per the same account-type
 *    logic the sync layer uses to decide whether to call each endpoint.
 * Multiple accounts under one Item are included in the single monthly charge.
 * Balance is $0 because we use the free /accounts/get, not /accounts/balance/get.
 */

/** USD per Item-month by product, from the real Plaid invoice. */
export const PLAID_MONTHLY_RATE = {
  transactions: 0.3,
  investments: 0.18,
  liabilities: 0.2,
} as const;

/**
 * Which paid products this Item's accounts could actually return data for.
 *
 * Investments and Liabilities sit in `additional_consented_products`, so the
 * first successful call to either endpoint enrolls the Item in a monthly
 * subscription that cannot be removed short of /item/remove. Calling on an Item
 * that has no matching account therefore buys a permanent charge for data that
 * can never exist — which is how ~$1.34/month of the bill accrued.
 *
 * Deliberately biased toward calling. Skipping wrongly loses a user's holdings
 * silently, which costs far more than $0.18:
 *  - `brokerage` is Plaid's legacy type for an investment account.
 *  - `other` means Plaid could not classify it, so we must not assume it empty.
 *
 * Transactions is absent on purpose. It is always in `products`, so it is billed
 * at Item creation regardless, and account type does not predict it anyway: a
 * loan-only Item yields mortgage payments, while a brokerage holding a sweep
 * account yields nothing.
 */
export function productsForAccountTypes(types: Iterable<string>): {
  investments: boolean;
  liabilities: boolean;
} {
  const t = new Set(types);
  const unclassified = t.has("other");
  return {
    investments: t.has("investment") || t.has("brokerage") || unclassified,
    liabilities: t.has("credit") || t.has("loan") || unclassified,
  };
}

/**
 * Monthly USD Plaid bills for one Item, given its accounts' types. Sums the
 * applicable per-product rates. An Item is billed for Transactions when it holds
 * a transaction-bearing account (depository / credit, or unclassified `other`);
 * Investments / Liabilities follow productsForAccountTypes.
 */
export function monthlyPlaidCostForAccountTypes(types: Iterable<string>): number {
  const t = new Set(types);
  const { investments, liabilities } = productsForAccountTypes(t);
  const transactions = t.has("depository") || t.has("credit") || t.has("other");
  let cost = 0;
  if (transactions) cost += PLAID_MONTHLY_RATE.transactions;
  if (investments) cost += PLAID_MONTHLY_RATE.investments;
  if (liabilities) cost += PLAID_MONTHLY_RATE.liabilities;
  return cost;
}
