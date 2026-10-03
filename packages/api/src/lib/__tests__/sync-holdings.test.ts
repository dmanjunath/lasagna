import { describe, it, expect, beforeEach, vi } from "vitest";

// Holdings are current state, one row per (account, security). Sync used to
// plain-INSERT the account's whole position list every run, so N syncs left N
// copies of every unchanged position. This drives syncItem twice against a fake
// db that enforces the same unique key Postgres does, and asserts the second run
// refreshes the rows instead of appending a second set.

type HoldingRow = {
  accountId: string;
  securityId: string;
  tenantId: string;
  quantity: string | null;
  institutionPrice: string | null;
  institutionValue: string | null;
  costBasis: string | null;
  snapshotAt: Date;
};

// vi.mock factories are hoisted above every import, so everything they touch
// has to be hoisted with them.
const { HOLDINGS, SYNC_LOG, ACCOUNTS, SECURITIES, BALANCE_SNAPSHOTS, PLAID_ITEMS, state } =
  vi.hoisted(() => ({
    HOLDINGS: { accountId: "holdings.account_id", securityId: "holdings.security_id" },
    SYNC_LOG: { id: "sync_log.id" },
    ACCOUNTS: {
      id: "accounts.id",
      plaidAccountId: "accounts.plaid_account_id",
      plaidItemId: "accounts.plaid_item_id",
    },
    SECURITIES: { plaidSecurityId: "securities.plaid_security_id" },
    BALANCE_SNAPSHOTS: { table: "balance_snapshots" },
    PLAID_ITEMS: { id: "plaid_items.id", tenantId: "plaid_items.tenant_id" },
    // Every row written to `holdings`, in insert order, plus the position
    // quantity Plaid reports on the next call, whether Plaid still lists the
    // option position and the account itself, the balances sync wrote, and
    // what sync stamped on the account.
    state: {
      holdingRows: [] as HoldingRow[],
      quantity: 10,
      optionOpen: false,
      accountListed: true,
      balanceRows: [] as Array<{ accountId: string; balance: string | null }>,
      accountUpdates: [] as Array<Record<string, unknown>>,
    },
  }));

vi.mock("plaid", () => ({ CountryCode: { Us: "US" }, Products: {} }));

vi.mock("@lasagna/core", () => ({
  eq: (col: unknown, value: unknown) => ["eq", col, value],
  and: (...args: unknown[]) => ["and", ...args],
  notInArray: (col: unknown, values: unknown[]) => ["notInArray", col, values],
  holdings: HOLDINGS,
  syncLog: SYNC_LOG,
  accounts: ACCOUNTS,
  securities: SECURITIES,
  balanceSnapshots: BALANCE_SNAPSHOTS,
  plaidItems: PLAID_ITEMS,
  decrypt: vi.fn(async (token: string) => `decrypted:${token}`),
  parseLoanMetadata: () => null,
}));

const account = { id: "account-1", plaidAccountId: "plaid-account-1", frozen: false, metadata: null };
const security = { id: "security-1", plaidSecurityId: "plaid-security-1" };
const option = { id: "security-2", plaidSecurityId: "plaid-security-2" };

// Reads the value out of the mocked `eq(col, value)` / `and(...)` structures so
// the fake db can resolve findFirst by the column sync.ts actually filtered on.
function valueFor(where: unknown, col: string): unknown {
  if (!Array.isArray(where)) return undefined;
  if (where[0] === "eq" || where[0] === "notInArray") {
    return where[1] === col ? where[2] : undefined;
  }
  for (const clause of where.slice(1)) {
    const found = valueFor(clause, col);
    if (found !== undefined) return found;
  }
  return undefined;
}

// Postgres ON CONFLICT (account_id, security_id) DO UPDATE, in memory.
function upsertHolding(values: HoldingRow, set: Partial<HoldingRow>) {
  const existing = state.holdingRows.find(
    (r) => r.accountId === values.accountId && r.securityId === values.securityId,
  );
  if (existing) Object.assign(existing, set);
  else state.holdingRows.push({ ...values });
}

function writeChain(table: unknown, values: Record<string, unknown>) {
  const run = async () => {
    if (table === SYNC_LOG) return [{ id: "sync-log-1" }];
    if (table === BALANCE_SNAPSHOTS) {
      state.balanceRows.push(values as { accountId: string; balance: string | null });
    }
    if (table === HOLDINGS) {
      // Reached only if the upsert clause were dropped — that is the bug.
      state.holdingRows.push(values as HoldingRow);
    }
    return [];
  };
  return {
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      run().then(resolve, reject),
    returning: run,
    onConflictDoUpdate: async ({
      target,
      set,
    }: {
      target: unknown[];
      set: Partial<HoldingRow>;
    }) => {
      expect(target).toEqual([HOLDINGS.accountId, HOLDINGS.securityId]);
      upsertHolding(values as HoldingRow, set);
    },
  };
}

vi.mock("../db.js", () => ({
  db: {
    query: {
      plaidItems: {
        findFirst: async () => ({
          id: "item-1",
          tenantId: "tenant-1",
          accessToken: "encrypted-token",
        }),
      },
      accounts: {
        findFirst: async ({ where }: { where: unknown }) =>
          valueFor(where, ACCOUNTS.plaidAccountId) === account.plaidAccountId ? account : undefined,
        findMany: async () => [account],
      },
      securities: {
        findFirst: async ({ where }: { where: unknown }) =>
          [security, option].find(
            (s) => s.plaidSecurityId === valueFor(where, SECURITIES.plaidSecurityId),
          ),
      },
    },
    // DELETE FROM holdings WHERE account_id = ? [AND security_id NOT IN (?)]
    delete: (table: unknown) => ({
      where: async (where: unknown) => {
        if (table !== HOLDINGS) return;
        const accountId = valueFor(where, HOLDINGS.accountId);
        const kept = (valueFor(where, HOLDINGS.securityId) as string[] | undefined) ?? [];
        state.holdingRows = state.holdingRows.filter(
          (r) => r.accountId !== accountId || kept.includes(r.securityId),
        );
      },
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => writeChain(table, values),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          if (table === ACCOUNTS) state.accountUpdates.push(values);
        },
      }),
    }),
  },
}));

// Plaid returns the account's FULL current position list on every call — the
// reason an append duplicates. The quantity moves between runs so the test can
// tell a refreshed row from a stale one.
vi.mock("../plaid.js", () => ({
  plaidClient: {
    accountsGet: async () => ({
      data: {
        accounts: state.accountListed
          ? [
              {
                account_id: account.plaidAccountId,
                name: "Brokerage",
                type: "investment",
                subtype: "brokerage",
                mask: "1111",
                balances: { current: 1000, available: null, limit: null, iso_currency_code: "USD" },
              },
            ]
          : [],
      },
    }),
    investmentsHoldingsGet: async () => ({
      data: {
        accounts: [{ account_id: account.plaidAccountId }],
        securities: [
          { security_id: security.plaidSecurityId, name: "Fund", ticker_symbol: "FND" },
          { security_id: option.plaidSecurityId, name: "FND Call", type: "derivative" },
        ],
        holdings: [
          {
            account_id: account.plaidAccountId,
            security_id: security.plaidSecurityId,
            quantity: state.quantity,
            institution_price: 100,
            institution_value: state.quantity * 100,
            cost_basis: 900,
          },
          ...(state.optionOpen
            ? [
                {
                  account_id: account.plaidAccountId,
                  security_id: option.plaidSecurityId,
                  quantity: 1,
                  institution_price: 2,
                  institution_value: 200,
                  cost_basis: 150,
                },
              ]
            : []),
        ],
      },
    }),
    liabilitiesGet: async () => ({
      data: { liabilities: { mortgage: [], student: [], credit: [] } },
    }),
  },
}));

vi.mock("../env.js", () => ({ env: { ENCRYPTION_KEY: "k" } }));
vi.mock("../billing.js", () => ({
  isTenantDisabled: async () => false,
  resolveTenantPlan: async () => "free",
}));
vi.mock("../account-limits.js", () => ({ recomputeFrozenAccounts: vi.fn() }));
vi.mock("../activity.js", () => ({ logPlaidEvent: vi.fn() }));
vi.mock("../security-classifier.js", () => ({
  classifyUnknownSecuritiesForTenant: vi.fn(),
}));
vi.mock("../transaction-sync.js", () => ({ syncTransactions: vi.fn() }));

import { syncItem } from "../sync.js";

describe("syncItem holdings write", () => {
  beforeEach(() => {
    state.holdingRows = [];
    state.quantity = 10;
    state.optionOpen = false;
    state.accountListed = true;
    state.balanceRows = [];
    state.accountUpdates = [];
  });

  it("keeps one row per position when the same account syncs twice", async () => {
    await syncItem("item-1");
    expect(state.holdingRows).toHaveLength(1);

    state.quantity = 12;
    await syncItem("item-1");

    expect(state.holdingRows).toHaveLength(1);
    expect(state.holdingRows[0].quantity).toBe("12");
    expect(state.holdingRows[0].institutionValue).toBe("1200");
  });

  it("stamps snapshotAt on refresh so the row reflects the latest sync", async () => {
    await syncItem("item-1");
    const firstSnapshot = state.holdingRows[0].snapshotAt;

    state.quantity = 15;
    await syncItem("item-1");

    expect(state.holdingRows[0].snapshotAt).toBeInstanceOf(Date);
    expect(state.holdingRows[0].snapshotAt.getTime()).toBeGreaterThanOrEqual(
      firstSnapshot?.getTime() ?? 0,
    );
  });

  // An expired option (or a sold position) simply stops appearing in Plaid's
  // list. Its row has to go, or the portfolio shows it as open forever.
  it("removes a position Plaid stopped returning", async () => {
    state.optionOpen = true;
    await syncItem("item-1");
    expect(state.holdingRows.map((r) => r.securityId).sort()).toEqual([
      security.id,
      option.id,
    ]);

    state.optionOpen = false;
    await syncItem("item-1");

    expect(state.holdingRows.map((r) => r.securityId)).toEqual([security.id]);
  });

  it("removes a position the broker reports as 0 shares", async () => {
    await syncItem("item-1");
    expect(state.holdingRows).toHaveLength(1);

    state.quantity = 0;
    await syncItem("item-1");

    expect(state.holdingRows).toHaveLength(0);
  });

  // A closed account drops out of Plaid's account list entirely, so the
  // holdings cleanup never sees it.
  it("zeroes an account Plaid stopped listing and drops its positions", async () => {
    await syncItem("item-1");
    expect(state.holdingRows).toHaveLength(1);

    state.accountListed = false;
    state.balanceRows = [];
    await syncItem("item-1");

    expect(state.holdingRows).toHaveLength(0);
    expect(state.balanceRows).toEqual([
      expect.objectContaining({ accountId: account.id, balance: "0" }),
    ]);
  });

  // The stamp is what lets the portfolio read an empty account as cash
  // instead of guessing a 60/40 split.
  it("stamps the account once Plaid has answered for its holdings", async () => {
    await syncItem("item-1");

    expect(state.accountUpdates).toEqual([{ holdingsSyncedAt: expect.any(Date) }]);
  });
});
