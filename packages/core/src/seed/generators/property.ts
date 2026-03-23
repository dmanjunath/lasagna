import type { Database } from "../../db.js";
import { accounts, balanceSnapshots } from "../../schema.js";
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
          squareFeet: isPrimary ? 2500 : 1800,
          yearBuilt: 2010 + Math.floor(Math.random() * 10),
        }),
      })
      .returning();

    accountIds.push(account.id);

    // Create 30 days of value history (property values don't change much)
    for (let daysAgo = 30; daysAgo >= 0; daysAgo--) {
      const snapshotDate = new Date(now);
      snapshotDate.setDate(snapshotDate.getDate() - daysAgo);

      await db.insert(balanceSnapshots).values({
        accountId: account.id,
        tenantId,
        balance: String(randomVariance(balance, 0.5)), // ±0.5% variance for property
        isoCurrencyCode: "USD",
        snapshotAt: snapshotDate,
      });
    }
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
