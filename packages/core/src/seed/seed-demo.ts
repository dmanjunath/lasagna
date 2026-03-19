/**
 * Creates the demo user (demo@lasagnafi.com / lasagna123) with the 1.8M Taylor preset.
 * Idempotent: if the user already exists, only ensures isDemo=true.
 * Run via: pnpm db:seed-demo
 */
import { createDb } from "../db.js";
import { users } from "../schema.js";
import { eq } from "drizzle-orm";
import { PRESETS } from "./presets.js";
import { hashPassword } from "./utils.js";
import { createBaseEntities } from "./generators/base.js";
import { generateAssets } from "./generators/assets.js";
import { generateProperty } from "./generators/property.js";
import { generateAlternatives } from "./generators/alternatives.js";
import { generateLoans } from "./generators/loans.js";
import { generateHoldings } from "./generators/holdings.js";
import { generateTransactions } from "./generators/transactions.js";
import { generateGoals } from "./generators/goals.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const db = createDb(DATABASE_URL);

const DEMO_EMAIL = "demo@lasagnafi.com";
const DEMO_PASSWORD = "lasagna123";

async function seedDemo() {
  // Idempotency check
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, DEMO_EMAIL));

  if (existing) {
    await db
      .update(users)
      .set({ isDemo: true })
      .where(eq(users.email, DEMO_EMAIL));
    console.log("Demo user already exists. Ensured isDemo=true.");
    return;
  }

  const timestamp = Date.now();
  const config = PRESETS["1.8M"];

  // Create base entities (tenant, user with auto-generated email, plaidItem)
  const { tenant, user, plaidItem } = await createBaseEntities(
    db,
    timestamp,
    "1.8M",
    config.profile,
  );

  // Override generated email/password and set isDemo flag
  await db
    .update(users)
    .set({
      email: DEMO_EMAIL,
      passwordHash: await hashPassword(DEMO_PASSWORD),
      isDemo: true,
    })
    .where(eq(users.id, user.id));

  // Run generators — identical call pattern to seedUser() in seed/index.ts
  let createdAccounts: { accountId: string; key: string }[] = [];

  if (config.assets) {
    const assetAccounts = await generateAssets(
      db, tenant.id, plaidItem.id, config.assets, timestamp,
    );
    createdAccounts = createdAccounts.concat(assetAccounts);
  }

  if (config.property) {
    await generateProperty(db, tenant.id, plaidItem.id, config.property, timestamp);
  }

  if (config.alternatives) {
    await generateAlternatives(db, tenant.id, plaidItem.id, config.alternatives, timestamp);
  }

  let loanAccountIds: string[] = [];
  if (config.loans) {
    loanAccountIds = await generateLoans(db, tenant.id, plaidItem.id, config.loans, timestamp);
  }

  if (createdAccounts.length > 0) {
    await generateHoldings(db, tenant.id, createdAccounts, timestamp);
  }

  const checkingAccount = createdAccounts.find((a) => a.key === "cash");
  const creditCardAccountId =
    config.loans?.credit_card !== undefined && loanAccountIds.length > 0
      ? loanAccountIds[0]
      : undefined;
  const annualIncome = config.profile?.annualIncome ?? 85000;

  if (checkingAccount) {
    const creditId = creditCardAccountId ?? checkingAccount.accountId;
    await generateTransactions(
      db, tenant.id, checkingAccount.accountId, creditId, annualIncome / 12,
    );
  }

  // Goals — same computation as seed/index.ts lines 116-131
  const totalSavings = (config.assets?.savings ?? 0) + (config.assets?.cash ?? 0);
  const totalInvestments =
    (config.assets?.trad_401k ?? 0) +
    (config.assets?.roth_401k ?? 0) +
    (config.assets?.trad_ira ?? 0) +
    (config.assets?.roth_ira ?? 0) +
    (config.assets?.brokerage ?? 0) +
    (config.assets?.hsa ?? 0);
  const hasDebt = !!config.loans && Object.keys(config.loans).length > 0;
  const totalDebt = config.loans
    ? Object.values(config.loans).reduce((sum, v) => {
        const amount = typeof v === "number" ? v : parseFloat(String(v).split("@")[0]) || 0;
        return sum + amount;
      }, 0)
    : 0;

  await generateGoals(db, tenant.id, annualIncome, totalSavings, totalInvestments, hasDebt, totalDebt);

  console.log(`Demo user created: ${DEMO_EMAIL} / ${DEMO_PASSWORD} (tenantId: ${tenant.id})`);
}

seedDemo().catch((err) => {
  console.error("Failed to seed demo user:", err);
  process.exit(1);
});
