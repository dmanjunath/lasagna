/**
 * Report what Plaid actually bills for, per Item.
 *
 * /item/get returns `billed_products` (what you are charged a monthly
 * subscription for) and `available_products` (enabled but not yet accessed, so
 * not yet billed). Read-only and free — Item endpoints are not billed products.
 *
 * Prices are Plaid's per-Item monthly subscription rates and are EDITABLE — check
 * your own invoice, since rates vary by contract.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx packages/api/scripts/audit-plaid-products.ts
 */

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required, e.g. DATABASE_URL=postgresql://user:pass@localhost:5432/lasagna");
  process.exit(1);
}

import { createDb, plaidItems, accounts, decrypt, eq } from "@lasagna/core";
import { plaidClient } from "../src/lib/plaid.js";
import { env } from "../src/lib/env.js";

/** USD per Item per month. Products absent here are free or pay-per-call. */
const MONTHLY_PRICE: Record<string, number> = {
  transactions: 0.3,
  investments: 0.18,
  liabilities: 0.2,
  recurring_transactions: 0.18,
  auth: 0.3,
  identity: 0.2,
  income: 0.75,
  assets: 5.0,
};

/**
 * Which account types make a product able to return anything at all.
 *
 * `brokerage` is Plaid's legacy type for what is really an investment account —
 * omitting it would skip holdings for those Items and silently break portfolio
 * sync to save $0.18.
 *
 * Transactions is deliberately absent. Account type does not predict it: a
 * loan-only Item can produce transactions (mortgage payments), while a Vanguard
 * Item holding a depository sweep account produces none. Only the actual
 * transaction count answers that, so this heuristic must not guess.
 */
const NEEDED_BY: Record<string, (types: Set<string>) => boolean> = {
  investments: (t) => t.has("investment") || t.has("brokerage"),
  liabilities: (t) => t.has("credit") || t.has("loan"),
};

const db = createDb(process.env.DATABASE_URL);

async function main() {
  const items = await db.query.plaidItems.findMany();
  const linked = items.filter((i) => !i.accessToken.startsWith("manual-"));
  console.log(`${linked.length} linked Item(s)\n`);

  let total = 0;
  let wasted = 0;
  const rows: string[] = [];

  for (const item of linked) {
    const label = (item.institutionName ?? item.id).padEnd(12);
    try {
      const accessToken = await decrypt(item.accessToken, env.ENCRYPTION_KEY);
      const { data } = await plaidClient.itemGet({ access_token: accessToken });

      const acctRows = await db
        .select({ type: accounts.type })
        .from(accounts)
        .where(eq(accounts.plaidItemId, item.id));
      const types = new Set(acctRows.map((a) => a.type));

      const billed = data.item.billed_products ?? [];
      const cost = billed.reduce((sum, p) => sum + (MONTHLY_PRICE[p] ?? 0), 0);
      total += cost;

      // Billed, but no account of a type the product can describe.
      const dead = billed.filter((p) => NEEDED_BY[p] && !NEEDED_BY[p](types));
      const deadCost = dead.reduce((sum, p) => sum + (MONTHLY_PRICE[p] ?? 0), 0);
      wasted += deadCost;

      // Enabled but never accessed, so not yet billed. Calling any of these
      // endpoints starts a subscription that only /item/remove can end.
      const armed = (data.item.available_products ?? []).filter((p) => MONTHLY_PRICE[p]);

      rows.push(
        `${label} $${cost.toFixed(2)}/mo  billed=[${billed.join(", ")}]` +
          `  accounts=[${[...types].sort().join(", ") || "none"}]` +
          (dead.length ? `  DEAD=[${dead.join(", ")}] $${deadCost.toFixed(2)}` : "") +
          (armed.length ? `\n${" ".repeat(13)}would start billing if called: [${armed.join(", ")}]` : ""),
      );
    } catch (e) {
      let detail = e instanceof Error ? e.message : String(e);
      if (e && typeof e === "object" && "response" in e) {
        const err = e as { response?: { data?: { error_code?: string } } };
        if (err.response?.data?.error_code) detail = err.response.data.error_code;
      }
      rows.push(`${label} ERROR ${detail}`);
    }
  }

  for (const r of rows) console.log(r);
  console.log(`\nTotal: $${total.toFixed(2)}/mo`);
  console.log(`Of which billed for account types this Item does not have: $${wasted.toFixed(2)}/mo`);
  process.exit(0);
}

main();
