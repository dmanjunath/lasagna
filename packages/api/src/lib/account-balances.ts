import { eq, and, desc, accounts, balanceSnapshots } from "@lasagna/core";
import { db } from "./db.js";

/**
 * Single source of truth for "fetch every account with its latest balance and
 * apply the user's per-account overrides". Before this existed, the
 * fetch-latest-snapshot loop and the hardcoded liability set were copy-pasted
 * across the net-worth, debts, chat-tool, insights, priorities and portfolio
 * code paths — so a flag honored in one place was silently ignored in another.
 * Everything that sums balances should go through here.
 */

export const LIABILITY_TYPES = new Set(["credit", "loan"]);

export interface AccountWithBalance {
  id: string;
  tenantId: string;
  plaidItemId: string;
  plaidAccountId: string;
  name: string;
  type: string;
  subtype: string | null;
  mask: string | null;
  metadata: string | null;
  excludeFromNetWorth: boolean;
  excludeTransactions: boolean;
  invertBalance: boolean;
  /** Latest snapshot balance, parsed (0 when the account has no snapshot). */
  rawBalance: number;
  /** rawBalance with the user's invert override applied. Use this for sums. */
  effectiveBalance: number;
  available: string | null;
  currency: string;
  asOf: Date | null;
}

export async function fetchAccountsWithBalances(
  tenantId: string,
): Promise<AccountWithBalance[]> {
  const accts = await db.query.accounts.findMany({
    where: eq(accounts.tenantId, tenantId),
  });

  return Promise.all(
    accts.map(async (acct) => {
      const latest = await db.query.balanceSnapshots.findFirst({
        where: eq(balanceSnapshots.accountId, acct.id),
        orderBy: [desc(balanceSnapshots.snapshotAt)],
      });
      const rawBalance = parseFloat(latest?.balance ?? "0");
      return {
        id: acct.id,
        tenantId: acct.tenantId,
        plaidItemId: acct.plaidItemId,
        plaidAccountId: acct.plaidAccountId,
        name: acct.name,
        type: acct.type,
        subtype: acct.subtype,
        mask: acct.mask,
        metadata: acct.metadata,
        excludeFromNetWorth: acct.excludeFromNetWorth,
        excludeTransactions: acct.excludeTransactions,
        invertBalance: acct.invertBalance,
        rawBalance,
        effectiveBalance: acct.invertBalance ? -rawBalance : rawBalance,
        available: latest?.available ?? null,
        currency: latest?.isoCurrencyCode ?? "USD",
        asOf: latest?.snapshotAt ?? null,
      };
    }),
  );
}

/**
 * An account's contribution to net worth: zero when excluded, otherwise the
 * effective balance with liabilities (credit/loan) counted negative. Matches
 * the prior `liability ? -Math.abs(bal) : bal` convention exactly for accounts
 * with no overrides set, so non-flagged accounts see no change.
 */
export function netWorthContribution(a: {
  type: string;
  effectiveBalance: number;
  excludeFromNetWorth: boolean;
}): number {
  if (a.excludeFromNetWorth) return 0;
  return LIABILITY_TYPES.has(a.type)
    ? -Math.abs(a.effectiveBalance)
    : a.effectiveBalance;
}

/** IDs of accounts whose transactions the user has hidden from spending views. */
export async function excludedTxnAccountIds(tenantId: string): Promise<string[]> {
  const rows = await db.query.accounts.findMany({
    where: and(
      eq(accounts.tenantId, tenantId),
      eq(accounts.excludeTransactions, true),
    ),
    columns: { id: true },
  });
  return rows.map((r) => r.id);
}
