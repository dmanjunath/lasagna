# Dynamic Seed Data Generator Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing seed.ts with a modular, CLI-driven seed system supporting configurable net worth profiles and asset compositions.

**Architecture:** Modular generator system with separate files for each asset category (assets, property, alternatives, loans). CLI parses flags and either uses presets or explicit key:value pairs. Each seed creates a timestamped user with JSON output.

**Tech Stack:** TypeScript, Drizzle ORM, minimist (CLI parsing)

---

## File Structure

```
packages/core/src/seed/
├── index.ts           # CLI entry point, orchestrates generators
├── types.ts           # SeedConfig, AssetConfig, PropertyConfig, etc.
├── presets.ts         # 9 preset definitions (negative → 75M)
├── generators/
│   ├── base.ts        # Creates tenant, user, plaid item
│   ├── assets.ts      # Depository + investment accounts
│   ├── property.ts    # Real estate accounts
│   ├── alternatives.ts # Alternative investment accounts
│   ├── loans.ts       # Loan accounts with interest rates
│   └── holdings.ts    # Securities and holdings for investment accounts
└── utils.ts           # parseAmount, randomVariance, password hashing
```

---

### Task 1: Schema Migration - Add Account Types and Metadata

**Files:**
- Modify: `packages/core/src/schema.ts:16-21`
- Create: `packages/core/drizzle/0003_add_account_types.sql` (auto-generated)

- [ ] **Step 1: Update accountTypeEnum in schema.ts**

```typescript
export const accountTypeEnum = pgEnum("account_type", [
  "depository",
  "investment",
  "credit",
  "loan",
  "real_estate",
  "alternative",
]);
```

- [ ] **Step 2: Add metadata column to accounts table**

Add after the `mask` field in the accounts table:

```typescript
  metadata: text("metadata"), // JSON string for loan details, etc.
```

- [ ] **Step 3: Generate and apply migration**

Run:
```bash
cd packages/core && pnpm drizzle-kit generate && pnpm db:push
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/schema.ts packages/core/drizzle/
git commit -m "feat(schema): add real_estate, alternative account types and metadata column"
```

---

### Task 2: Create Seed Types

**Files:**
- Create: `packages/core/src/seed/types.ts`

- [ ] **Step 1: Create types.ts with all type definitions**

```typescript
export interface AssetConfig {
  cash?: number;
  savings?: number;
  roth_401k?: number;
  trad_401k?: number;
  roth_ira?: number;
  trad_ira?: number;
  brokerage?: number;
  hsa?: number;
  "529"?: number;
  crypto?: number;
  cd?: number;
  money_market?: number;
}

export interface PropertyConfig {
  primary?: number;
  [key: `rental${number}`]: number;
}

export interface AlternativesConfig {
  pe?: number;
  hedge?: number;
  angel?: number;
  crypto_alt?: number;
}

export interface LoanConfig {
  credit_card?: number | string; // number or "amount@rate"
  student_loan?: number | string;
  car?: number | string;
  primary_mortgage?: number | string;
  [key: `rental${number}_mortgage`]: number | string;
}

export interface SeedConfig {
  assets?: AssetConfig;
  property?: PropertyConfig;
  alternatives?: AlternativesConfig;
  loans?: LoanConfig;
}

export interface SeedResult {
  email: string;
  password: string;
  userId: string;
  tenantId: string;
  timestamp: number;
}

export const DEFAULT_INTEREST_RATES: Record<string, number> = {
  credit_card: 24.99,
  student_loan: 6.5,
  car: 7.5,
  primary_mortgage: 6.75,
  rental_mortgage: 7.25,
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/seed/types.ts
git commit -m "feat(seed): add type definitions for seed config"
```

---

### Task 3: Create Seed Utilities

**Files:**
- Create: `packages/core/src/seed/utils.ts`

- [ ] **Step 1: Create utils.ts with helper functions**

```typescript
// Password hashing using PBKDF2
const ITERATIONS = 100_000;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashPassword(password: string): Promise<string> {
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

/**
 * Parse amount strings like "50k", "1.5M", "100000"
 */
export function parseAmount(value: string | number): number {
  if (typeof value === "number") return value;

  const cleaned = value.trim().toLowerCase();
  const match = cleaned.match(/^([\d.]+)(k|m)?$/);

  if (!match) {
    throw new Error(`Invalid amount format: ${value}`);
  }

  const num = parseFloat(match[1]);
  const suffix = match[2];

  if (suffix === "k") return num * 1_000;
  if (suffix === "m") return num * 1_000_000;
  return num;
}

/**
 * Parse loan value with optional interest rate: "50k@5.9" or "50k"
 */
export function parseLoanValue(value: string | number): { amount: number; rate?: number } {
  if (typeof value === "number") return { amount: value };

  const parts = value.split("@");
  const amount = parseAmount(parts[0]);
  const rate = parts[1] ? parseFloat(parts[1]) : undefined;

  return { amount, rate };
}

/**
 * Parse key:value pairs from CLI flag
 * e.g., "cash:50k,brokerage:1.5M" -> { cash: 50000, brokerage: 1500000 }
 */
export function parseKeyValuePairs(input: string): Record<string, string> {
  const result: Record<string, string> = {};

  if (!input) return result;

  const pairs = input.split(",");
  for (const pair of pairs) {
    const [key, value] = pair.split(":");
    if (key && value) {
      result[key.trim()] = value.trim();
    }
  }

  return result;
}

/**
 * Apply random variance to a value (default ±5%)
 */
export function randomVariance(value: number, percent: number = 5): number {
  const factor = 1 + (Math.random() * 2 - 1) * (percent / 100);
  return Math.round(value * factor * 100) / 100;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/seed/utils.ts
git commit -m "feat(seed): add utility functions for parsing and hashing"
```

---

### Task 4: Create Base Generator

**Files:**
- Create: `packages/core/src/seed/generators/base.ts`

- [ ] **Step 1: Create base.ts for tenant/user/plaid item creation**

```typescript
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { tenants, users, plaidItems } from "../../schema.js";
import { hashPassword } from "../utils.js";

export interface BaseEntities {
  tenant: typeof tenants.$inferSelect;
  user: typeof users.$inferSelect;
  plaidItem: typeof plaidItems.$inferSelect;
}

export async function createBaseEntities(
  db: PostgresJsDatabase,
  timestamp: number,
  presetName?: string,
): Promise<BaseEntities> {
  const suffix = presetName ? `-${presetName}` : "";
  const tenantName = `Seed ${timestamp}${suffix}`;
  const userEmail = `seed-${timestamp}${suffix}@lasagna.local`;
  const userPassword = "password123";

  // Create tenant
  const [tenant] = await db
    .insert(tenants)
    .values({ name: tenantName })
    .returning();

  // Create user
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

  // Create plaid item for manual accounts
  const [plaidItem] = await db
    .insert(plaidItems)
    .values({
      tenantId: tenant.id,
      accessToken: `manual-${timestamp}`,
      institutionId: "manual",
      institutionName: "Manual Entry",
      status: "active",
      lastSyncedAt: new Date(),
    })
    .returning();

  return { tenant, user, plaidItem };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/seed/generators/base.ts
git commit -m "feat(seed): add base generator for tenant/user/plaid item"
```

---

### Task 5: Create Assets Generator

**Files:**
- Create: `packages/core/src/seed/generators/assets.ts`

- [ ] **Step 1: Create assets.ts for depository and investment accounts**

```typescript
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { accounts, balanceSnapshots } from "../../schema.js";
import type { AssetConfig } from "../types.js";
import { randomVariance } from "../utils.js";

const ACCOUNT_TYPE_MAP: Record<keyof AssetConfig, { type: "depository" | "investment"; subtype: string }> = {
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
  db: PostgresJsDatabase,
  tenantId: string,
  plaidItemId: string,
  config: AssetConfig,
  timestamp: number,
): Promise<string[]> {
  const accountIds: string[] = [];
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

    accountIds.push(account.id);

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

  return accountIds;
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/seed/generators/assets.ts
git commit -m "feat(seed): add assets generator for depository/investment accounts"
```

---

### Task 6: Create Property Generator

**Files:**
- Create: `packages/core/src/seed/generators/property.ts`

- [ ] **Step 1: Create property.ts for real estate accounts**

```typescript
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { accounts, balanceSnapshots } from "../../schema.js";
import type { PropertyConfig } from "../types.js";
import { randomVariance } from "../utils.js";

export async function generateProperty(
  db: PostgresJsDatabase,
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
        name: isPrimary ? "Primary Residence" : `Rental Property ${key.replace("rental", "")}`,
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/seed/generators/property.ts
git commit -m "feat(seed): add property generator for real estate accounts"
```

---

### Task 7: Create Alternatives Generator

**Files:**
- Create: `packages/core/src/seed/generators/alternatives.ts`

- [ ] **Step 1: Create alternatives.ts for PE/hedge/angel accounts**

```typescript
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { accounts, balanceSnapshots } from "../../schema.js";
import type { AlternativesConfig } from "../types.js";
import { randomVariance } from "../utils.js";

const ALTERNATIVES_MAP: Record<keyof AlternativesConfig, { name: string; subtype: string }> = {
  pe: { name: "Private Equity Fund", subtype: "private_equity" },
  hedge: { name: "Hedge Fund", subtype: "hedge_fund" },
  angel: { name: "Angel Investments", subtype: "angel" },
  crypto_alt: { name: "Crypto Holdings", subtype: "crypto" },
};

export async function generateAlternatives(
  db: PostgresJsDatabase,
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
          liquidityLockup: key === "pe" ? "10 years" : key === "hedge" ? "1 year" : "none",
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/seed/generators/alternatives.ts
git commit -m "feat(seed): add alternatives generator for PE/hedge/angel accounts"
```

---

### Task 8: Create Loans Generator

**Files:**
- Create: `packages/core/src/seed/generators/loans.ts`

- [ ] **Step 1: Create loans.ts for loan and credit accounts**

```typescript
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { accounts, balanceSnapshots } from "../../schema.js";
import type { LoanConfig } from "../types.js";
import { DEFAULT_INTEREST_RATES, parseLoanValue, randomVariance } from "../utils.js";

const LOAN_TYPE_MAP: Record<string, { type: "credit" | "loan"; subtype: string; name: string }> = {
  credit_card: { type: "credit", subtype: "credit card", name: "Credit Card" },
  student_loan: { type: "loan", subtype: "student", name: "Student Loan" },
  car: { type: "loan", subtype: "auto", name: "Auto Loan" },
  primary_mortgage: { type: "loan", subtype: "mortgage", name: "Primary Mortgage" },
};

export async function generateLoans(
  db: PostgresJsDatabase,
  tenantId: string,
  plaidItemId: string,
  config: LoanConfig,
  timestamp: number,
): Promise<string[]> {
  const accountIds: string[] = [];
  const now = new Date();

  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) continue;

    const { amount, rate } = parseLoanValue(value);
    if (amount === 0) continue;

    // Determine loan type and defaults
    let mapping = LOAN_TYPE_MAP[key];
    let defaultRateKey = key;

    // Handle rental mortgages dynamically
    if (!mapping && key.includes("_mortgage")) {
      const rentalNum = key.replace("_mortgage", "").replace("rental", "");
      mapping = { type: "loan", subtype: "mortgage", name: `Rental ${rentalNum} Mortgage` };
      defaultRateKey = "rental_mortgage";
    }

    if (!mapping) continue;

    const interestRate = rate ?? DEFAULT_INTEREST_RATES[defaultRateKey] ?? 7.0;
    const balance = -Math.abs(randomVariance(amount)); // Loans are negative

    const [account] = await db
      .insert(accounts)
      .values({
        tenantId,
        plaidItemId,
        plaidAccountId: `${timestamp}-loan-${key}`,
        name: mapping.name,
        type: mapping.type,
        subtype: mapping.subtype,
        mask: generateMask(),
        metadata: JSON.stringify({
          interestRate,
          termMonths: key.includes("mortgage") ? 360 : key === "car" ? 60 : key === "student_loan" ? 120 : null,
          originationDate: generateOriginationDate(),
        }),
      })
      .returning();

    accountIds.push(account.id);

    // Create 30 days of balance history
    for (let daysAgo = 30; daysAgo >= 0; daysAgo--) {
      const snapshotDate = new Date(now);
      snapshotDate.setDate(snapshotDate.getDate() - daysAgo);

      await db.insert(balanceSnapshots).values({
        accountId: account.id,
        tenantId,
        balance: String(randomVariance(balance, 0.1)),
        limit: mapping.type === "credit" ? String(Math.abs(balance) * 2) : null,
        isoCurrencyCode: "USD",
        snapshotAt: snapshotDate,
      });
    }
  }

  return accountIds;
}

function generateMask(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function generateOriginationDate(): string {
  const yearsAgo = Math.floor(Math.random() * 5) + 1;
  const date = new Date();
  date.setFullYear(date.getFullYear() - yearsAgo);
  return date.toISOString().split("T")[0];
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/seed/generators/loans.ts
git commit -m "feat(seed): add loans generator with interest rates"
```

---

### Task 9: Create Holdings Generator

**Files:**
- Create: `packages/core/src/seed/generators/holdings.ts`

- [ ] **Step 1: Create holdings.ts for securities and investment holdings**

```typescript
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { securities, holdings, accounts } from "../../schema.js";
import { eq } from "drizzle-orm";
import { randomVariance } from "../utils.js";

const SECURITIES_POOL = [
  { ticker: "AAPL", name: "Apple Inc.", type: "equity", price: 195.5 },
  { ticker: "MSFT", name: "Microsoft Corporation", type: "equity", price: 420.0 },
  { ticker: "GOOGL", name: "Alphabet Inc.", type: "equity", price: 175.0 },
  { ticker: "AMZN", name: "Amazon.com Inc.", type: "equity", price: 185.0 },
  { ticker: "NVDA", name: "NVIDIA Corporation", type: "equity", price: 880.0 },
  { ticker: "VTI", name: "Vanguard Total Stock Market ETF", type: "etf", price: 265.0 },
  { ticker: "VXUS", name: "Vanguard Total International Stock ETF", type: "etf", price: 60.0 },
  { ticker: "BND", name: "Vanguard Total Bond Market ETF", type: "etf", price: 73.0 },
  { ticker: "VOO", name: "Vanguard S&P 500 ETF", type: "etf", price: 485.0 },
  { ticker: "VNQ", name: "Vanguard Real Estate ETF", type: "etf", price: 85.0 },
  { ticker: "SCHD", name: "Schwab US Dividend Equity ETF", type: "etf", price: 78.0 },
  { ticker: "QQQ", name: "Invesco QQQ Trust", type: "etf", price: 480.0 },
  { ticker: "BRK.B", name: "Berkshire Hathaway Inc.", type: "equity", price: 410.0 },
  { ticker: "JPM", name: "JPMorgan Chase & Co.", type: "equity", price: 195.0 },
  { ticker: "V", name: "Visa Inc.", type: "equity", price: 280.0 },
  { ticker: "JNJ", name: "Johnson & Johnson", type: "equity", price: 155.0 },
  { ticker: "PG", name: "Procter & Gamble Co.", type: "equity", price: 165.0 },
  { ticker: "BTC", name: "Bitcoin", type: "cryptocurrency", price: 65000.0 },
  { ticker: "ETH", name: "Ethereum", type: "cryptocurrency", price: 3500.0 },
  { ticker: "SOL", name: "Solana", type: "cryptocurrency", price: 150.0 },
];

export async function generateHoldings(
  db: PostgresJsDatabase,
  tenantId: string,
  investmentAccountIds: string[],
  timestamp: number,
): Promise<void> {
  const now = new Date();

  for (const accountId of investmentAccountIds) {
    // Get account to determine subtype
    const [account] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, accountId));

    if (!account) continue;

    // Get target balance from latest snapshot
    const accountBalance = await getAccountBalance(db, accountId);
    if (accountBalance <= 0) continue;

    // Select securities based on account type
    const selectedSecurities = selectSecuritiesForAccount(account.subtype || "brokerage");

    // Allocate balance across securities
    const allocations = allocateBalance(accountBalance, selectedSecurities.length);

    for (let i = 0; i < selectedSecurities.length; i++) {
      const secData = selectedSecurities[i];
      const allocation = allocations[i];

      // Create or get security
      const security = await getOrCreateSecurity(db, secData, timestamp);

      // Calculate quantity
      const price = randomVariance(secData.price, 2);
      const quantity = allocation / price;
      const value = quantity * price;

      await db.insert(holdings).values({
        accountId,
        tenantId,
        securityId: security.id,
        quantity: String(quantity.toFixed(6)),
        institutionPrice: String(price.toFixed(2)),
        institutionValue: String(value.toFixed(2)),
        costBasis: String((value * randomVariance(0.9, 10)).toFixed(2)),
        snapshotAt: now,
      });
    }
  }
}

async function getAccountBalance(db: PostgresJsDatabase, accountId: string): Promise<number> {
  const result = await db.execute<{ balance: string }>(
    `SELECT balance FROM balance_snapshots WHERE account_id = '${accountId}' ORDER BY snapshot_at DESC LIMIT 1`
  );
  return parseFloat(result.rows[0]?.balance || "0");
}

function selectSecuritiesForAccount(subtype: string): typeof SECURITIES_POOL {
  const isCrypto = subtype === "crypto";
  const isRetirement = ["401k", "roth_401k", "ira", "roth_ira"].includes(subtype);

  if (isCrypto) {
    return SECURITIES_POOL.filter((s) => s.type === "cryptocurrency");
  }

  if (isRetirement) {
    // Retirement: mostly ETFs
    const etfs = SECURITIES_POOL.filter((s) => s.type === "etf");
    return shuffleArray(etfs).slice(0, 5);
  }

  // Brokerage: mix of stocks and ETFs
  const nonCrypto = SECURITIES_POOL.filter((s) => s.type !== "cryptocurrency");
  return shuffleArray(nonCrypto).slice(0, 8);
}

function allocateBalance(total: number, count: number): number[] {
  const weights = Array.from({ length: count }, () => Math.random());
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (w / sum) * total);
}

async function getOrCreateSecurity(
  db: PostgresJsDatabase,
  data: typeof SECURITIES_POOL[number],
  timestamp: number,
) {
  const plaidId = `seed-${timestamp}-${data.ticker}`;

  const existing = await db
    .select()
    .from(securities)
    .where(eq(securities.plaidSecurityId, plaidId));

  if (existing.length > 0) return existing[0];

  const [security] = await db
    .insert(securities)
    .values({
      plaidSecurityId: plaidId,
      name: data.name,
      tickerSymbol: data.ticker,
      type: data.type,
      closePrice: String(randomVariance(data.price, 2)),
      closePriceAsOf: new Date(),
    })
    .returning();

  return security;
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/seed/generators/holdings.ts
git commit -m "feat(seed): add holdings generator for securities"
```

---

### Task 10: Create Presets

**Files:**
- Create: `packages/core/src/seed/presets.ts`

- [ ] **Step 1: Create presets.ts with all 9 net worth tiers**

```typescript
import type { SeedConfig } from "./types.js";

export const PRESETS: Record<string, SeedConfig> = {
  negative: {
    assets: { cash: 2000 },
    loans: { credit_card: 8000, student_loan: 40000, car: 12000 },
  },

  "100k": {
    assets: {
      cash: 15000,
      savings: 25000,
      trad_401k: 50000,
      brokerage: 15000,
    },
    loans: { credit_card: 3000, car: 5000 },
  },

  "750k": {
    assets: {
      cash: 30000,
      savings: 50000,
      roth_401k: 150000,
      trad_401k: 200000,
      brokerage: 250000,
      hsa: 20000,
    },
    property: { primary: 450000 },
    loans: { primary_mortgage: 400000 },
  },

  "1.8M": {
    assets: {
      cash: 50000,
      savings: 100000,
      roth_401k: 200000,
      trad_401k: 300000,
      brokerage: 600000,
    },
    property: { primary: 800000, rental1: 400000 },
    loans: { primary_mortgage: 500000, rental1_mortgage: 150000 },
  },

  "4M": {
    assets: {
      cash: 100000,
      savings: 200000,
      roth_401k: 300000,
      trad_401k: 500000,
      brokerage: 1500000,
    },
    property: { primary: 1200000, rental1: 600000 },
    alternatives: { pe: 300000 },
    loans: { primary_mortgage: 500000, rental1_mortgage: 200000 },
  },

  "7M": {
    assets: {
      cash: 150000,
      savings: 200000,
      roth_401k: 400000,
      trad_401k: 600000,
      brokerage: 2500000,
    },
    property: { primary: 2000000, rental1: 800000, rental2: 700000 },
    alternatives: { pe: 500000, hedge: 300000 },
    loans: { primary_mortgage: 700000, rental1_mortgage: 150000, rental2_mortgage: 100000 },
  },

  "12M": {
    assets: {
      cash: 250000,
      savings: 300000,
      roth_401k: 500000,
      trad_401k: 1000000,
      brokerage: 4000000,
    },
    property: { primary: 2500000, rental1: 1000000, rental2: 500000 },
    alternatives: { pe: 1200000, hedge: 500000, angel: 300000 },
    loans: { primary_mortgage: 500000, rental1_mortgage: 200000, rental2_mortgage: 50000 },
  },

  "25M": {
    assets: {
      cash: 500000,
      savings: 500000,
      roth_401k: 700000,
      trad_401k: 1300000,
      brokerage: 8000000,
    },
    property: { primary: 4000000, rental1: 2000000, rental2: 1500000, rental3: 500000 },
    alternatives: { pe: 4000000, hedge: 1500000, angel: 500000 },
    loans: { primary_mortgage: 300000, rental1_mortgage: 100000, rental2_mortgage: 100000 },
  },

  "75M": {
    assets: {
      cash: 1000000,
      savings: 1000000,
      roth_401k: 1000000,
      trad_401k: 2000000,
      brokerage: 25000000,
    },
    property: { primary: 8000000, rental1: 5000000, rental2: 4000000, rental3: 3000000 },
    alternatives: { pe: 15000000, hedge: 7000000, angel: 3000000 },
    loans: { primary_mortgage: 500000, rental1_mortgage: 300000, rental2_mortgage: 200000 },
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/seed/presets.ts
git commit -m "feat(seed): add preset definitions for 9 net worth tiers"
```

---

### Task 11: Create CLI Entry Point

**Files:**
- Create: `packages/core/src/seed/index.ts`

- [ ] **Step 1: Create index.ts with CLI parsing and orchestration**

```typescript
/**
 * Dynamic Seed Script
 *
 * Usage:
 *   pnpm db:seed --preset=100k
 *   pnpm db:seed --assets="cash:50k,brokerage:1M" --property="primary:500k"
 *   pnpm db:seed --preset=750k --preset=1.8M  # multiple users
 */

import minimist from "minimist";
import { createDb } from "../db.js";
import { PRESETS } from "./presets.js";
import type { SeedConfig, SeedResult, AssetConfig, PropertyConfig, AlternativesConfig, LoanConfig } from "./types.js";
import { parseKeyValuePairs, parseAmount, parseLoanValue } from "./utils.js";
import { createBaseEntities } from "./generators/base.js";
import { generateAssets } from "./generators/assets.js";
import { generateProperty } from "./generators/property.js";
import { generateAlternatives } from "./generators/alternatives.js";
import { generateLoans } from "./generators/loans.js";
import { generateHoldings } from "./generators/holdings.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = createDb(DATABASE_URL);

async function seedUser(config: SeedConfig, presetName?: string): Promise<SeedResult> {
  const timestamp = Date.now();

  // Create base entities
  const { tenant, user, plaidItem } = await createBaseEntities(db, timestamp, presetName);

  const investmentAccountIds: string[] = [];

  // Generate assets
  if (config.assets) {
    const assetIds = await generateAssets(db, tenant.id, plaidItem.id, config.assets, timestamp);
    // Track investment accounts for holdings
    const investmentTypes = ["roth_401k", "trad_401k", "roth_ira", "trad_ira", "brokerage", "hsa", "529", "crypto"];
    for (const key of Object.keys(config.assets)) {
      if (investmentTypes.includes(key)) {
        investmentAccountIds.push(...assetIds.filter((_, i) => Object.keys(config.assets!)[i] === key));
      }
    }
  }

  // Generate property
  if (config.property) {
    await generateProperty(db, tenant.id, plaidItem.id, config.property, timestamp);
  }

  // Generate alternatives
  if (config.alternatives) {
    await generateAlternatives(db, tenant.id, plaidItem.id, config.alternatives, timestamp);
  }

  // Generate loans
  if (config.loans) {
    await generateLoans(db, tenant.id, plaidItem.id, config.loans, timestamp);
  }

  // Generate holdings for investment accounts
  if (investmentAccountIds.length > 0) {
    await generateHoldings(db, tenant.id, investmentAccountIds, timestamp);
  }

  return {
    email: user.email,
    password: "password123",
    userId: user.id,
    tenantId: tenant.id,
    timestamp,
  };
}

function parseCliConfig(args: minimist.ParsedArgs): SeedConfig {
  const config: SeedConfig = {};

  if (args.assets) {
    const parsed = parseKeyValuePairs(args.assets);
    config.assets = {} as AssetConfig;
    for (const [key, value] of Object.entries(parsed)) {
      (config.assets as Record<string, number>)[key] = parseAmount(value);
    }
  }

  if (args.property) {
    const parsed = parseKeyValuePairs(args.property);
    config.property = {} as PropertyConfig;
    for (const [key, value] of Object.entries(parsed)) {
      (config.property as Record<string, number>)[key] = parseAmount(value);
    }
  }

  if (args.alternatives) {
    const parsed = parseKeyValuePairs(args.alternatives);
    config.alternatives = {} as AlternativesConfig;
    for (const [key, value] of Object.entries(parsed)) {
      (config.alternatives as Record<string, number>)[key] = parseAmount(value);
    }
  }

  if (args.loans) {
    const parsed = parseKeyValuePairs(args.loans);
    config.loans = {} as LoanConfig;
    for (const [key, value] of Object.entries(parsed)) {
      (config.loans as Record<string, string>)[key] = value; // Keep as string for rate parsing
    }
  }

  return config;
}

function mergeConfigs(base: SeedConfig, override: SeedConfig): SeedConfig {
  return {
    assets: { ...base.assets, ...override.assets },
    property: { ...base.property, ...override.property },
    alternatives: { ...base.alternatives, ...override.alternatives },
    loans: { ...base.loans, ...override.loans },
  };
}

async function main() {
  const args = minimist(process.argv.slice(2));
  const results: SeedResult[] = [];

  // Handle presets (can be string or array)
  let presets: string[] = [];
  if (args.preset) {
    presets = Array.isArray(args.preset) ? args.preset : [args.preset];
  }

  // Get CLI overrides
  const cliConfig = parseCliConfig(args);

  if (presets.length > 0) {
    // Create user for each preset
    for (const presetName of presets) {
      const presetConfig = PRESETS[presetName];
      if (!presetConfig) {
        console.error(`Unknown preset: ${presetName}`);
        console.error(`Available presets: ${Object.keys(PRESETS).join(", ")}`);
        process.exit(1);
      }

      const config = mergeConfigs(presetConfig, cliConfig);
      const result = await seedUser(config, presetName);
      results.push(result);
    }
  } else if (Object.keys(cliConfig).some((k) => cliConfig[k as keyof SeedConfig])) {
    // Create user with explicit config
    const result = await seedUser(cliConfig);
    results.push(result);
  } else {
    // Default: create 100k preset
    const result = await seedUser(PRESETS["100k"], "100k");
    results.push(result);
  }

  // Output results as JSON
  if (results.length === 1) {
    console.log(JSON.stringify(results[0]));
  } else {
    console.log(JSON.stringify(results));
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/seed/index.ts
git commit -m "feat(seed): add CLI entry point with preset and flag support"
```

---

### Task 12: Update Package.json and Remove Old Seed

**Files:**
- Modify: `packages/core/package.json`
- Delete: `packages/core/src/seed.ts`

- [ ] **Step 1: Install minimist**

```bash
cd packages/core && pnpm add minimist && pnpm add -D @types/minimist
```

- [ ] **Step 2: Update package.json scripts**

Change the db:seed script to use the new module:

```json
"db:seed": "tsx src/seed/index.ts"
```

- [ ] **Step 3: Delete old seed.ts**

```bash
rm packages/core/src/seed.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/package.json packages/core/pnpm-lock.yaml
git rm packages/core/src/seed.ts
git commit -m "chore(seed): migrate to modular seed system, remove old seed.ts"
```

---

### Task 13: Test the Seed System

**Files:**
- None (manual testing)

- [ ] **Step 1: Reset and push schema**

```bash
pnpm db:reset && pnpm db:push
```

- [ ] **Step 2: Test default preset**

```bash
pnpm db:seed
```

Expected: JSON output with user credentials

- [ ] **Step 3: Test specific preset**

```bash
pnpm db:seed --preset=negative
pnpm db:seed --preset=75M
```

- [ ] **Step 4: Test explicit values**

```bash
pnpm db:seed --assets="cash:50k,brokerage:500k" --loans="car:20k"
```

- [ ] **Step 5: Test multiple presets**

```bash
pnpm db:seed --preset=negative --preset=100k --preset=750k
```

Expected: JSON array with 3 user credentials

- [ ] **Step 6: Commit any fixes if needed**

---

### Task 14: Update E2E Tests

**Files:**
- Modify: Any e2e tests that use the old seed format

- [ ] **Step 1: Search for E2E_SEED usage**

```bash
grep -r "E2E_SEED" packages/ e2e/
```

- [ ] **Step 2: Update any tests to use new CLI format**

The new seed always outputs JSON, so tests should just parse the output.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test: update e2e tests for new seed system"
```

---

Plan complete and saved to `docs/superpowers/plans/2026-03-23-dynamic-seed-data.md`. Ready to execute?
