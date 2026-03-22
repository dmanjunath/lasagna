/**
 * Database Seed Script
 *
 * Modes:
 * - Normal mode: Creates dev@lasagna.local user with sample data
 * - E2E mode (E2E_SEED=true): Creates unique timestamped user and outputs JSON credentials
 *
 * Usage:
 *   pnpm --filter @lasagna/core db:seed       # Normal mode
 *   E2E_SEED=true pnpm --filter @lasagna/core db:seed  # E2E mode
 */

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

// Password hashing using PBKDF2 (same as API package)
const ITERATIONS = 100_000;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPassword(password: string): Promise<string> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await globalThis.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    key,
    KEY_LENGTH * 8,
  );
  return `${bytesToHex(salt)}:${bytesToHex(new Uint8Array(derived))}`;
}

// Check if running in E2E mode
const isE2EMode = process.env.E2E_SEED === "true";

async function seed() {
  const timestamp = Date.now();

  // Determine user credentials based on mode
  const userEmail = isE2EMode
    ? `e2e-test-${timestamp}@lasagna.local`
    : "dev@lasagna.local";
  const userPassword = isE2EMode ? "testpassword123" : "password123";
  const tenantName = isE2EMode ? `E2E Test ${timestamp}` : "Local Dev";

  if (!isE2EMode) {
    console.log("Seeding database...");
  }

  // Create tenant
  const [tenant] = await db
    .insert(tenants)
    .values({ name: tenantName })
    .returning();

  if (!isE2EMode) {
    console.log(`Created tenant: ${tenant.id}`);
  }

  // Hash password and create user
  const passwordHash = await hashPassword(userPassword);
  const [user] = await db
    .insert(users)
    .values({
      tenantId: tenant.id,
      email: userEmail,
      passwordHash,
      role: "owner",
    })
    .returning();

  if (!isE2EMode) {
    console.log(`Created user: ${user.email}`);
  }

  // Create a fake plaid item (simulating a linked bank)
  const itemId = isE2EMode ? `e2e-${timestamp}` : "seed";
  const [plaidItem] = await db
    .insert(plaidItems)
    .values({
      tenantId: tenant.id,
      accessToken: `${itemId}-fake-access-token`,
      institutionId: isE2EMode ? "ins_e2e" : "ins_1",
      institutionName: isE2EMode ? "E2E Test Bank" : "Seed Bank",
      status: "active",
      lastSyncedAt: new Date(),
    })
    .returning();

  if (!isE2EMode) {
    console.log(`Created plaid item: ${plaidItem.id}`);
  }

  // Create accounts
  const [checking] = await db
    .insert(accounts)
    .values({
      tenantId: tenant.id,
      plaidItemId: plaidItem.id,
      plaidAccountId: `${itemId}-checking-001`,
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
      plaidAccountId: `${itemId}-savings-001`,
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
      plaidAccountId: `${itemId}-investment-001`,
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
      plaidAccountId: `${itemId}-credit-001`,
      name: "Credit Card",
      type: "credit",
      subtype: "credit card",
      mask: "3456",
    })
    .returning();

  if (!isE2EMode) {
    console.log(
      `Created accounts: ${[checking, savings, investment, creditCard].map((a) => a.name).join(", ")}`,
    );
  }

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

  if (!isE2EMode) {
    console.log("Created balance snapshots (30 days of history)");
  }

  // Create securities - use unique IDs per run to avoid conflicts
  const securityPrefix = isE2EMode ? `e2e-${timestamp}` : "seed";

  const [aapl] = await db
    .insert(securities)
    .values({
      plaidSecurityId: `${securityPrefix}-sec-aapl`,
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
      plaidSecurityId: `${securityPrefix}-sec-vti`,
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
      plaidSecurityId: `${securityPrefix}-sec-bnd`,
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

  if (!isE2EMode) {
    console.log("Created securities and holdings");
    console.log("Seed complete!");
  } else {
    // E2E mode: output JSON credentials for test setup
    const testUser = {
      email: userEmail,
      password: userPassword,
      userId: user.id,
      tenantId: tenant.id,
      timestamp,
    };
    console.log(JSON.stringify(testUser));
  }

  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
