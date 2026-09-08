/**
 * Builds one account's worth of preset data: tenant, user, accounts, holdings,
 * transactions and goals. Shared by the demo seed and the App Review seed, which
 * differ only in the user row they stamp on top of it.
 */
import type { Database } from "../db.js";
import { PRESETS } from "./presets.js";
import { createBaseEntities } from "./generators/base.js";
import { generateAssets } from "./generators/assets.js";
import { generateProperty } from "./generators/property.js";
import { generateAlternatives } from "./generators/alternatives.js";
import { generateLoans } from "./generators/loans.js";
import { generateHoldings } from "./generators/holdings.js";
import { generateTransactions } from "./generators/transactions.js";
import { generateGoals } from "./generators/goals.js";

export async function seedPresetAccount(
  db: Database,
  presetKey: keyof typeof PRESETS & string,
): Promise<{ tenantId: string; userId: string }> {
  const config = PRESETS[presetKey];
  if (!config) throw new Error(`Unknown preset "${presetKey}"`);

  const timestamp = Date.now();
  const { tenant, user, plaidItem } = await createBaseEntities(
    db,
    timestamp,
    presetKey,
    config.profile,
  );

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

  return { tenantId: tenant.id, userId: user.id };
}
