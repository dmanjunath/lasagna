import type { Database } from "../../db.js";
import { accounts, balanceSnapshots } from "../../schema.js";
import type { AlternativesConfig } from "../types.js";
import { randomVariance } from "../utils.js";

const ALTERNATIVES_MAP: Record<
  keyof AlternativesConfig,
  { name: string; subtype: string }
> = {
  pe: { name: "Private Equity Fund", subtype: "private_equity" },
  hedge: { name: "Hedge Fund", subtype: "hedge_fund" },
  angel: { name: "Angel Investments", subtype: "angel" },
  crypto_alt: { name: "Crypto Holdings", subtype: "crypto" },
};

export async function generateAlternatives(
  db: Database,
  tenantId: string,
  plaidItemId: string,
  config: AlternativesConfig,
  timestamp: number,
): Promise<string[]> {
  const accountIds: string[] = [];
  const now = new Date();

  for (const [key, value] of Object.entries(config)) {
    if (value === undefined || value === 0) continue;

    const mapping = ALTERNATIVES_MAP[key as keyof AlternativesConfig];
    if (!mapping) continue;

    const balance = randomVariance(value);

    const [account] = await db
      .insert(accounts)
      .values({
        tenantId,
        plaidItemId,
        plaidAccountId: `${timestamp}-alt-${key}`,
        name: mapping.name,
        type: "alternative",
        subtype: mapping.subtype,
        mask: null,
        metadata: JSON.stringify({
          fundName: generateFundName(key),
          vintage: 2020 + Math.floor(Math.random() * 4),
          liquidityLockup:
            key === "pe" ? "10 years" : key === "hedge" ? "1 year" : "none",
        }),
      })
      .returning();

    accountIds.push(account.id);

    // Create 30 days of value history
    for (let daysAgo = 30; daysAgo >= 0; daysAgo--) {
      const snapshotDate = new Date(now);
      snapshotDate.setDate(snapshotDate.getDate() - daysAgo);

      await db.insert(balanceSnapshots).values({
        accountId: account.id,
        tenantId,
        balance: String(randomVariance(balance, 1)), // ±1% variance
        isoCurrencyCode: "USD",
        snapshotAt: snapshotDate,
      });
    }
  }

  return accountIds;
}

function generateFundName(type: string): string {
  const prefixes = ["Sequoia", "Andreessen", "Bridgewater", "Citadel", "Tiger"];
  const suffixes = ["Capital", "Partners", "Ventures", "Fund", "Holdings"];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
  return `${prefix} ${suffix}`;
}
