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
import type {
  SeedConfig,
  SeedResult,
  AssetConfig,
  PropertyConfig,
  AlternativesConfig,
  LoanConfig,
} from "./types.js";
import { parseKeyValuePairs, parseAmount } from "./utils.js";
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

async function seedUser(
  config: SeedConfig,
  presetName?: string,
): Promise<SeedResult> {
  const timestamp = Date.now();

  // Create base entities
  const { tenant, user, plaidItem } = await createBaseEntities(
    db,
    timestamp,
    presetName,
  );

  let createdAccounts: { accountId: string; key: string }[] = [];

  // Generate assets
  if (config.assets) {
    const assetAccounts = await generateAssets(
      db,
      tenant.id,
      plaidItem.id,
      config.assets,
      timestamp,
    );
    createdAccounts = createdAccounts.concat(assetAccounts);
  }

  // Generate property
  if (config.property) {
    await generateProperty(
      db,
      tenant.id,
      plaidItem.id,
      config.property,
      timestamp,
    );
  }

  // Generate alternatives
  if (config.alternatives) {
    await generateAlternatives(
      db,
      tenant.id,
      plaidItem.id,
      config.alternatives,
      timestamp,
    );
  }

  // Generate loans
  if (config.loans) {
    await generateLoans(db, tenant.id, plaidItem.id, config.loans, timestamp);
  }

  // Generate holdings for investment accounts
  if (createdAccounts.length > 0) {
    await generateHoldings(db, tenant.id, createdAccounts, timestamp);
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
      // Keep as string for rate parsing later
      (config.loans as Record<string, string>)[key] = value;
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
  } else if (
    Object.keys(cliConfig).some((k) => cliConfig[k as keyof SeedConfig])
  ) {
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
