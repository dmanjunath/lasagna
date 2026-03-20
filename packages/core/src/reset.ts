import { execSync } from "child_process";
import { sql } from "drizzle-orm";
import { createDb } from "./db.js";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

// Safety check: only allow reset on localhost
const url = new URL(DATABASE_URL);
const allowedHosts = ["localhost", "0.0.0.0", "127.0.0.1", "db"];
const isLocal = allowedHosts.includes(url.hostname);

if (!isLocal) {
  console.error(`db:reset is only allowed on local databases (${allowedHosts.join(", ")})`);
  console.error(`Current host: ${url.hostname}`);
  console.error("This is a safety measure to prevent accidental data loss.");
  process.exit(1);
}

const db = createDb(DATABASE_URL);

// Tables to clear (preserves users and tenants)
const tablesToTruncate = [
  "sync_log",
  "holdings",
  "securities",
  "balance_snapshots",
  "accounts",
  "plaid_items",
];

async function reset() {
  console.log("Resetting database (preserving users and tenants)...");

  for (const table of tablesToTruncate) {
    await db.execute(sql.raw(`TRUNCATE TABLE "${table}" CASCADE`));
    console.log(`  Truncated ${table}`);
  }

  console.log("\nRunning db:push to ensure schema is up to date...");
  execSync("pnpm db:push", { stdio: "inherit", cwd: process.cwd() });

  console.log("\nDatabase reset complete!");
  process.exit(0);
}

reset().catch((err) => {
  console.error("Reset failed:", err);
  process.exit(1);
});
