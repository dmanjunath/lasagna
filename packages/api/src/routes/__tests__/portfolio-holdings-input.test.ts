import { describe, it, expect, vi } from "vitest";

// A cash-management savings account can report its money market fund as
// holdings. Those holdings already add up to the account balance, so the
// depository step must not add the balance on top as "CASH".

vi.mock("@lasagna/core", () => ({
  eq: (...args: unknown[]) => ["eq", ...args],
  and: (...args: unknown[]) => ["and", ...args],
  inArray: (...args: unknown[]) => ["inArray", ...args],
  desc: (col: unknown) => ["desc", col],
  sql: (strings: TemplateStringsArray) => ["sql", strings.join("?")],
  holdings: { tenantId: "holdings.tenant_id", snapshotAt: "holdings.snapshot_at" },
  securities: { id: "securities.id" },
  accounts: { id: "accounts.id", tenantId: "accounts.tenant_id", type: "accounts.type", excludeFromNetWorth: "accounts.exclude" },
  balanceSnapshots: { accountId: "balance_snapshots.account_id", snapshotAt: "balance_snapshots.snapshot_at" },
}));

const savings = {
  id: "acct-savings",
  name: "Savings",
  type: "depository",
  excludeFromNetWorth: false,
  invertBalance: false,
  holdingsSyncedAt: new Date(),
};
const checking = { ...savings, id: "acct-checking", name: "Checking" };

// Which accounts.findMany call this is, read from its `where`.
function isType(where: unknown, type: string): boolean {
  return JSON.stringify(where).includes(`= '${type}'`);
}

vi.mock("../../lib/db.js", () => ({
  db: {
    query: {
      holdings: {
        findMany: async () => [
          { accountId: savings.id, securityId: "sec-mmf", quantity: "1000", institutionValue: "1000", costBasis: null },
          { accountId: savings.id, securityId: "sec-cash", quantity: "5", institutionValue: "5", costBasis: null },
        ],
      },
      securities: {
        findMany: async () => [
          { id: "sec-mmf", tickerSymbol: "MMF", name: "Treasury Money Market", type: "mutual fund" },
          { id: "sec-cash", tickerSymbol: "CUR", name: "Cash", type: "cash" },
        ],
      },
      accounts: {
        findMany: async ({ where }: { where: unknown }) => {
          if (isType(where, "depository")) return [savings, checking];
          if (isType(where, "investment")) return [];
          return [savings];
        },
      },
      balanceSnapshots: {
        findFirst: async ({ where }: { where: unknown }) =>
          JSON.stringify(where).includes(savings.id) ? { balance: "1005" } : { balance: "200" },
      },
    },
  },
}));

vi.mock("../../lib/security-classifier.js", () => ({
  loadSecurityClassifications: async () => new Map(),
}));

import { getHoldingsInput } from "../portfolio.js";

describe("getHoldingsInput", () => {
  it("counts a depository account with holdings once, from its holdings", async () => {
    const rows = await getHoldingsInput("tenant-1");

    const savingsTotal = rows
      .filter((r) => r.account === "Savings")
      .reduce((s, r) => s + r.value, 0);
    expect(savingsTotal).toBe(1005);
  });

  it("still adds a depository account without holdings as cash", async () => {
    const rows = await getHoldingsInput("tenant-1");

    expect(rows.filter((r) => r.account === "Checking")).toEqual([
      expect.objectContaining({ ticker: "CASH", value: 200 }),
    ]);
  });
});
