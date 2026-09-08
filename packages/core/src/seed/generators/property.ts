import type { Database } from "../../db.js";
import { accounts, balanceSnapshots } from "../../schema.js";
import { balanceHistory } from "./history.js";
import type { PropertyConfig } from "../types.js";
import { randomVariance } from "../utils.js";

export async function generateProperty(
  db: Database,
  tenantId: string,
  plaidItemId: string,
  config: PropertyConfig,
  timestamp: number,
): Promise<string[]> {
  const accountIds: string[] = [];
  const now = new Date();

  for (const [key, value] of Object.entries(config)) {
    if (value === undefined || value === 0) continue;

    const isPrimary = key === "primary";
    const balance = randomVariance(value);

    const [account] = await db
      .insert(accounts)
      .values({
        tenantId,
        plaidItemId,
        plaidAccountId: `${timestamp}-property-${key}`,
        name: isPrimary
          ? "Primary Residence"
          : `Rental Property ${key.replace("rental", "")}`,
        type: "real_estate",
        subtype: isPrimary ? "primary" : "rental",
        mask: null,
        metadata: JSON.stringify({
          address: generateAddress(isPrimary),
        }),
      })
      .returning();

    accountIds.push(account.id);

    // A year of value history. Property moves slowly, so it appreciates gently
    // and carries almost no day-to-day noise.
    await db.insert(balanceSnapshots).values(
      balanceHistory(now, balance, 0.04, 0.001).map((p) => ({
        accountId: account.id,
        tenantId,
        balance: p.balance.toFixed(2),
        isoCurrencyCode: "USD",
        snapshotAt: p.snapshotAt,
      })),
    );
  }

  return accountIds;
}

function generateAddress(isPrimary: boolean): string {
  const streetNum = Math.floor(100 + Math.random() * 9000);
  const streets = ["Oak St", "Maple Ave", "Pine Rd", "Cedar Ln", "Elm Dr"];
  const cities = ["Austin", "Denver", "Portland", "Nashville", "Raleigh"];
  const street = streets[Math.floor(Math.random() * streets.length)];
  const city = cities[Math.floor(Math.random() * cities.length)];
  return `${streetNum} ${street}, ${city}`;
}
