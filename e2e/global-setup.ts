import { execSync } from "child_process";
import { writeFileSync } from "fs";
import path from "path";

/**
 * Global setup for Playwright tests.
 *
 * Creates a unique test user with timestamped email and seeds sample financial data.
 * The test user credentials are written to e2e/.test-user.json for auth.setup.ts to use.
 *
 * Each test run creates a new user, so data is isolated per run and users persist in DB.
 */
export default async function globalSetup() {
  console.log("\n[E2E Setup] Creating test user with seeded financial data...");

  const rootDir = path.resolve(__dirname, "..");
  const testUserPath = path.join(rootDir, "e2e/.test-user.json");

  try {
    // Run the seed script in E2E mode and capture JSON output
    // E2E_SEED=true creates a new user with timestamped email and outputs JSON credentials
    const output = execSync("pnpm --filter @lasagna/core db:seed", {
      cwd: rootDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        E2E_SEED: "true",
        DOTENV_CONFIG_PATH: path.join(rootDir, ".env"),
      },
    });

    // The seed script outputs JSON on the last line in E2E mode
    const lines = output.trim().split("\n");
    const jsonLine = lines[lines.length - 1];
    const testUser = JSON.parse(jsonLine);

    // Write test user credentials to file for auth.setup.ts
    writeFileSync(testUserPath, JSON.stringify(testUser, null, 2));

    console.log(`[E2E Setup] Created test user: ${testUser.email}`);
    console.log(`[E2E Setup] User ID: ${testUser.userId}`);
    console.log(`[E2E Setup] Tenant ID: ${testUser.tenantId}`);
    console.log("[E2E Setup] Database seeded with 30 days of financial data\n");
  } catch (error) {
    console.error("[E2E Setup] Failed to seed database:", error);
    throw error;
  }
}
