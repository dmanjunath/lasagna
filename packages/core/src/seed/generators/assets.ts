import type { Database } from "../../db.js";
import { accounts, balanceSnapshots } from "../../schema.js";
import type { AssetConfig } from "../types.js";
import { randomVariance } from "../utils.js";

const ACCOUNT_TYPE_MAP: Record<
  keyof AssetConfig,
  { type: "depository" | "investment"; subtype: string }
> = {
  cash: { type: "depository", subtype: "checking" },
  savings: { type: "depository", subtype: "savings" },
  roth_401k: { type: "investment", subtype: "roth_401k" },
  trad_401k: { type: "investment", subtype: "401k" },
  roth_ira: { type: "investment", subtype: "roth_ira" },
  trad_ira: { type: "investment", subtype: "ira" },
  brokerage: { type: "investment", subtype: "brokerage" },
  hsa: { type: "investment", subtype: "hsa" },
  "529": { type: "investment", subtype: "529" },
  crypto: { type: "investment", subtype: "crypto" },
  cd: { type: "depository", subtype: "cd" },
  money_market: { type: "depository", subtype: "money market" },
};

export async function generateAssets(
  db: Database,
  tenantId: string,
  plaidItemId: string,
  config: AssetConfig,
  timestamp: number,
): Promise<{ accountId: string; key: string }[]> {
  const createdAccounts: { accountId: string; key: string }[] = [];
  const now = new Date();

  for (const [key, value] of Object.entries(config)) {
    if (value === undefined || value === 0) continue;

    const mapping = ACCOUNT_TYPE_MAP[key as keyof AssetConfig];
    if (!mapping) continue;

    const balance = randomVariance(value);

    const [account] = await db
      .insert(accounts)
      .values({
        tenantId,
        plaidItemId,
        plaidAccountId: `${timestamp}-${key}`,
        name: formatAccountName(key),
        type: mapping.type,
        subtype: mapping.subtype,
        mask: generateMask(),
      })
      .returning();

    createdAccounts.push({ accountId: account.id, key });

    // Create 30 days of balance history
    for (let daysAgo = 30; daysAgo >= 0; daysAgo--) {
      const snapshotDate = new Date(now);
      snapshotDate.setDate(snapshotDate.getDate() - daysAgo);

      await db.insert(balanceSnapshots).values({
        accountId: account.id,
        tenantId,
        balance: String(randomVariance(balance, 2)),
        available: String(randomVariance(balance * 0.98, 2)),
        isoCurrencyCode: "USD",
        snapshotAt: snapshotDate,
      });
    }
  }

  return createdAccounts;
}

function formatAccountName(key: string): string {
  const names: Record<string, string> = {
    cash: "Checking Account",
    savings: "Savings Account",
    roth_401k: "Roth 401(k)",
    trad_401k: "Traditional 401(k)",
    roth_ira: "Roth IRA",
    trad_ira: "Traditional IRA",
    brokerage: "Brokerage Account",
    hsa: "Health Savings Account",
    "529": "529 College Savings",
    crypto: "Crypto Account",
    cd: "Certificate of Deposit",
    money_market: "Money Market Account",
  };
  return names[key] || key;
}

function generateMask(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}
