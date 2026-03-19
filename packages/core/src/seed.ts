import { createDb } from "./db.js";
import {
  tenants,
  users,
  plaidItems,
  accounts,
  balanceSnapshots,
  securities,
  holdings,
} from "./schema.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = createDb(DATABASE_URL);

async function seed() {
  console.log("Seeding database...");

  // Create a default tenant
  const [tenant] = await db
    .insert(tenants)
    .values({ name: "Local Dev" })
    .returning();
  console.log(`Created tenant: ${tenant.id}`);

  // Create a default user (password: "password123" — bcrypt hash)
  const [user] = await db
    .insert(users)
    .values({
      tenantId: tenant.id,
      email: "dev@lasagna.local",
      passwordHash:
        "$2a$10$K7L1OJ45/4Y2nIvhRVpCe.FSmhDdWoXehVzJptJ/op0lSsvqNu/1u",
      role: "owner",
    })
    .returning();
  console.log(`Created user: ${user.email}`);

  // Create a fake plaid item (simulating a linked bank)
  const [plaidItem] = await db
    .insert(plaidItems)
    .values({
      tenantId: tenant.id,
      accessToken: "seed-fake-access-token",
      institutionId: "ins_1",
      institutionName: "Seed Bank",
      status: "active",
      lastSyncedAt: new Date(),
    })
    .returning();
  console.log(`Created plaid item: ${plaidItem.id}`);

  // Create accounts
  const [checking] = await db
    .insert(accounts)
    .values({
      tenantId: tenant.id,
      plaidItemId: plaidItem.id,
      plaidAccountId: "seed-checking-001",
      name: "Checking Account",
      type: "depository",
      subtype: "checking",
      mask: "1234",
    })
    .returning();

  const [savings] = await db
    .insert(accounts)
    .values({
      tenantId: tenant.id,
      plaidItemId: plaidItem.id,
      plaidAccountId: "seed-savings-001",
      name: "Savings Account",
      type: "depository",
      subtype: "savings",
      mask: "5678",
    })
    .returning();

  const [investment] = await db
    .insert(accounts)
    .values({
      tenantId: tenant.id,
      plaidItemId: plaidItem.id,
      plaidAccountId: "seed-investment-001",
      name: "Brokerage Account",
      type: "investment",
      subtype: "brokerage",
      mask: "9012",
    })
    .returning();

  const [creditCard] = await db
    .insert(accounts)
    .values({
      tenantId: tenant.id,
      plaidItemId: plaidItem.id,
      plaidAccountId: "seed-credit-001",
      name: "Credit Card",
      type: "credit",
      subtype: "credit card",
      mask: "3456",
    })
    .returning();

  console.log(
    `Created accounts: ${[checking, savings, investment, creditCard].map((a) => a.name).join(", ")}`,
  );

  // Create balance snapshots over the past 30 days
  const now = new Date();
  for (let daysAgo = 30; daysAgo >= 0; daysAgo--) {
    const snapshotDate = new Date(now);
    snapshotDate.setDate(snapshotDate.getDate() - daysAgo);

    await db.insert(balanceSnapshots).values([
      {
        accountId: checking.id,
        tenantId: tenant.id,
        balance: String(5000 + Math.random() * 2000),
        available: String(4800 + Math.random() * 2000),
        isoCurrencyCode: "USD",
        snapshotAt: snapshotDate,
      },
      {
        accountId: savings.id,
        tenantId: tenant.id,
        balance: String(25000 + Math.random() * 1000),
        available: String(25000 + Math.random() * 1000),
        isoCurrencyCode: "USD",
        snapshotAt: snapshotDate,
      },
      {
        accountId: investment.id,
        tenantId: tenant.id,
        balance: String(50000 + daysAgo * -100 + Math.random() * 500),
        isoCurrencyCode: "USD",
        snapshotAt: snapshotDate,
      },
      {
        accountId: creditCard.id,
        tenantId: tenant.id,
        balance: String(-(1500 + Math.random() * 500)),
        limit: "10000",
        isoCurrencyCode: "USD",
        snapshotAt: snapshotDate,
      },
    ]);
  }
  console.log("Created balance snapshots (30 days of history)");

  // Create securities and holdings for the investment account
  const [aapl] = await db
    .insert(securities)
    .values({
      plaidSecurityId: "seed-sec-aapl",
      name: "Apple Inc.",
      tickerSymbol: "AAPL",
      type: "equity",
      closePrice: "195.50",
      closePriceAsOf: now,
    })
    .returning();

  const [vti] = await db
    .insert(securities)
    .values({
      plaidSecurityId: "seed-sec-vti",
      name: "Vanguard Total Stock Market ETF",
      tickerSymbol: "VTI",
      type: "etf",
      closePrice: "245.30",
      closePriceAsOf: now,
    })
    .returning();

  const [bnd] = await db
    .insert(securities)
    .values({
      plaidSecurityId: "seed-sec-bnd",
      name: "Vanguard Total Bond Market ETF",
      tickerSymbol: "BND",
      type: "etf",
      closePrice: "72.80",
      closePriceAsOf: now,
    })
    .returning();

  await db.insert(holdings).values([
    {
      accountId: investment.id,
      tenantId: tenant.id,
      securityId: aapl.id,
      quantity: "50",
      institutionPrice: "195.50",
      institutionValue: "9775.00",
      costBasis: "8500.00",
      snapshotAt: now,
    },
    {
      accountId: investment.id,
      tenantId: tenant.id,
      securityId: vti.id,
      quantity: "100",
      institutionPrice: "245.30",
      institutionValue: "24530.00",
      costBasis: "22000.00",
      snapshotAt: now,
    },
    {
      accountId: investment.id,
      tenantId: tenant.id,
      securityId: bnd.id,
      quantity: "200",
      institutionPrice: "72.80",
      institutionValue: "14560.00",
      costBasis: "14800.00",
      snapshotAt: now,
    },
  ]);
  console.log("Created securities and holdings");

  console.log("Seed complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
