import { describe, it, expect, beforeEach, vi } from "vitest";

// Two ways one real-world purchase ended up on screen twice.
//
// 1. Sync deduped by findFirst-then-insert, and nothing serializes a sync for
//    one item — a webhook, the cron, a manual sync and the post-link sync each
//    call it independently. Two overlapping runs both read "not stored yet" and
//    both inserted.
// 2. A posted transaction arrives under a NEW transaction_id and only points
//    back at the pending one it replaces via `pending_transaction_id`. Sync
//    ignored that field and relied entirely on Plaid also sending the pending
//    one in `removed`, so a late or missing removal left both rows in place.
//
// The fake db below enforces the same unique key Postgres does.

type TxnRow = {
  id: string;
  accountId: string;
  tenantId: string;
  plaidTransactionId: string | null;
  name: string;
  amount: string;
  pending: number;
  linkedTransactionId: string | null;
};

const { TRANSACTIONS, ACCOUNTS, PLAID_ITEMS, CATEGORY_RULES, state } = vi.hoisted(() => ({
  TRANSACTIONS: {
    plaidTransactionId: "transactions.plaid_transaction_id",
    accountId: "transactions.account_id",
    tenantId: "transactions.tenant_id",
    id: "transactions.id",
    source: "transactions.source",
  },
  ACCOUNTS: { plaidItemId: "accounts.plaid_item_id" },
  PLAID_ITEMS: { id: "plaid_items.id" },
  CATEGORY_RULES: { tenantId: "category_rules.tenant_id", priority: "category_rules.priority" },
  state: {
    rows: [] as TxnRow[],
    nextId: 1,
    page: null as unknown,
    // Holds both concurrent syncs at the existence check until each has run it,
    // so they interleave the way two real syncs of one item do.
    gate: null as null | { wait: () => Promise<void> },
  },
}));

vi.mock("plaid", () => ({ CountryCode: { Us: "US" }, Products: {} }));

vi.mock("@lasagna/core", () => ({
  eq: (col: unknown, value: unknown) => ["eq", col, value],
  and: (...args: unknown[]) => ["and", ...args],
  sql: (strings: TemplateStringsArray) => ["sql", strings.join("")],
  transactions: TRANSACTIONS,
  accounts: ACCOUNTS,
  plaidItems: PLAID_ITEMS,
  categoryRules: CATEGORY_RULES,
  decrypt: vi.fn(async (t: string) => `decrypted:${t}`),
}));

vi.mock("../env.js", () => ({ env: { ENCRYPTION_KEY: "k" } }));
vi.mock("../taxonomy.js", () => ({
  loadTaxonomy: vi.fn(async () => []),
  resolveCategoryId: () => "category-1",
  activeCategoryId: () => "category-1",
}));
vi.mock("../category-rules.js", () => ({ firstMatchingRule: () => null }));
vi.mock("../transfer-match.js", () => ({ matchTransfersForTenant: vi.fn(async () => 0) }));

function valueFor(where: unknown, col: string): unknown {
  if (!Array.isArray(where)) return undefined;
  if (where[0] === "eq") return where[1] === col ? where[2] : undefined;
  for (const clause of where.slice(1)) {
    const found = valueFor(clause, col);
    if (found !== undefined) return found;
  }
  return undefined;
}

function matches(row: TxnRow, where: unknown): boolean {
  const id = valueFor(where, TRANSACTIONS.id);
  const pid = valueFor(where, TRANSACTIONS.plaidTransactionId);
  const tid = valueFor(where, TRANSACTIONS.tenantId);
  if (id !== undefined && row.id !== id) return false;
  if (pid !== undefined && row.plaidTransactionId !== pid) return false;
  if (tid !== undefined && row.tenantId !== tid) return false;
  return id !== undefined || pid !== undefined;
}

// Postgres UNIQUE (tenant_id, plaid_transaction_id) WHERE plaid_transaction_id
// IS NOT NULL: a plain insert of a key already present raises, ON CONFLICT DO
// NOTHING returns no row instead.
function insertTxn(values: Partial<TxnRow>, doNothing: boolean): TxnRow[] {
  const clash = state.rows.find(
    (r) =>
      r.plaidTransactionId !== null &&
      r.plaidTransactionId === values.plaidTransactionId &&
      r.tenantId === values.tenantId,
  );
  if (clash) {
    if (doNothing) return [];
    throw new Error(
      'duplicate key value violates unique constraint "transactions_tenant_plaid_txn_idx"',
    );
  }
  const row = { id: `row-${state.nextId++}`, linkedTransactionId: null, ...values } as TxnRow;
  state.rows.push(row);
  return [row];
}

vi.mock("../db.js", () => {
  const insert = (table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      let doNothing = false;
      const run = () => (table === TRANSACTIONS ? insertTxn(values as Partial<TxnRow>, doNothing) : []);
      const chain: Record<string, unknown> = {
        onConflictDoNothing: () => {
          doNothing = true;
          return chain;
        },
        returning: () => ({
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
            try {
              return Promise.resolve(run()).then(res, rej);
            } catch (e) {
              return Promise.reject(e).then(res, rej);
            }
          },
        }),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
          try {
            run();
            return Promise.resolve(undefined).then(res, rej);
          } catch (e) {
            return Promise.reject(e).then(res, rej);
          }
        },
      };
      return chain;
    },
  });

  return {
    db: {
      query: {
        plaidItems: {
          findFirst: async () => ({
            id: "item-1",
            tenantId: "tenant-1",
            accessToken: "tok",
            transactionCursor: "cursor-1",
          }),
        },
        accounts: {
          findMany: async () => [{ id: "account-1", plaidAccountId: "plaid-account-1" }],
        },
        transactions: {
          findFirst: async ({ where }: { where: unknown }) => {
            const found = state.rows.find((r) => matches(r, where));
            if (state.gate) await state.gate.wait();
            return found ?? undefined;
          },
        },
      },
      select: () => ({ from: () => ({ where: () => ({ orderBy: async () => [] }) }) }),
      insert,
      update: (table: unknown) => ({
        set: (values: Partial<TxnRow>) => ({
          where: async (where: unknown) => {
            if (table !== TRANSACTIONS) return;
            for (const row of state.rows) if (matches(row, where)) Object.assign(row, values);
          },
        }),
      }),
      delete: (table: unknown) => ({
        where: async (where: unknown) => {
          if (table !== TRANSACTIONS) return;
          state.rows = state.rows.filter((r) => !matches(r, where));
        },
      }),
    },
  };
});

vi.mock("../plaid.js", () => ({
  plaidClient: {
    transactionsSync: vi.fn(async () => ({
      data: {
        added: [],
        modified: [],
        removed: [],
        next_cursor: "cursor-2",
        has_more: false,
        ...(state.page as object),
      },
    })),
  },
}));

import { syncTransactions } from "../transaction-sync.js";

const PURCHASE = {
  account_id: "plaid-account-1",
  date: "2026-09-01",
  name: "CAPITAL ONE DEBIT PURCHASE",
  merchant_name: "Corner Store",
  amount: 24.5,
  personal_finance_category: { primary: "GENERAL_MERCHANDISE", detailed: "GENERAL_MERCHANDISE_OTHER" },
};

describe("syncTransactions duplicate protection", () => {
  beforeEach(() => {
    state.rows = [];
    state.nextId = 1;
    state.gate = null;
    state.page = { added: [{ ...PURCHASE, transaction_id: "plaid-txn-1", pending: false }] };
  });

  it("stores one row when two syncs for the same item overlap", async () => {
    let arrived = 0;
    let release!: () => void;
    const both = new Promise<void>((r) => {
      release = r;
    });
    state.gate = {
      wait: async () => {
        if (++arrived >= 2) release();
        await both;
      },
    };

    await Promise.all([syncTransactions("item-1"), syncTransactions("item-1")]);

    expect(state.rows.filter((r) => r.plaidTransactionId === "plaid-txn-1")).toHaveLength(1);
  });

  it("stores one row when a page is replayed after a lost cursor", async () => {
    await syncTransactions("item-1");
    await syncTransactions("item-1");

    expect(state.rows.filter((r) => r.plaidTransactionId === "plaid-txn-1")).toHaveLength(1);
  });

  it("drops the pending row when its posted transaction arrives without a removal", async () => {
    state.page = { added: [{ ...PURCHASE, transaction_id: "plaid-pending-1", pending: true }] };
    await syncTransactions("item-1");
    expect(state.rows).toHaveLength(1);

    // Plaid posts it under a new id and does NOT send the pending one in `removed`.
    state.page = {
      added: [
        { ...PURCHASE, transaction_id: "plaid-posted-1", pending: false, pending_transaction_id: "plaid-pending-1" },
      ],
    };
    await syncTransactions("item-1");

    expect(state.rows.map((r) => r.plaidTransactionId)).toEqual(["plaid-posted-1"]);
  });

  // The repair path for rows already orphaned: a resync replays every posted
  // transaction, including ones already stored, so the pending row it replaced
  // is cleared even though nothing about the posted row itself changes.
  it("clears an already-orphaned pending row when the posted one is replayed", async () => {
    state.page = {
      added: [
        { ...PURCHASE, transaction_id: "plaid-pending-1", pending: true },
        { ...PURCHASE, transaction_id: "plaid-posted-1", pending: false, amount: 25.75 },
      ],
    };
    await syncTransactions("item-1");
    expect(state.rows).toHaveLength(2);

    // The resync replays the posted transaction, which already exists locally.
    state.page = {
      added: [
        { ...PURCHASE, transaction_id: "plaid-posted-1", pending: false, amount: 25.75, pending_transaction_id: "plaid-pending-1" },
      ],
    };
    await syncTransactions("item-1");

    expect(state.rows.map((r) => r.plaidTransactionId)).toEqual(["plaid-posted-1"]);
  });

  it("clears the transfer link on the partner of a row it drops", async () => {
    state.page = { added: [{ ...PURCHASE, transaction_id: "plaid-pending-1", pending: true }] };
    await syncTransactions("item-1");
    const pending = state.rows[0];
    const partner: TxnRow = {
      id: "row-partner", accountId: "account-2", tenantId: "tenant-1",
      plaidTransactionId: "plaid-partner", name: "Transfer", amount: "-24.50",
      pending: 0, linkedTransactionId: pending.id,
    };
    pending.linkedTransactionId = partner.id;
    state.rows.push(partner);

    state.page = {
      added: [
        { ...PURCHASE, transaction_id: "plaid-posted-1", pending: false, pending_transaction_id: "plaid-pending-1" },
      ],
    };
    await syncTransactions("item-1");

    expect(state.rows.find((r) => r.id === "row-partner")?.linkedTransactionId).toBeNull();
  });
});
