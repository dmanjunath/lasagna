import { describe, it, expect, vi } from "vitest";

// account-deletion.ts imports plaid.ts at module level which reads env vars;
// mock it so these pure-function tests stay DB/network-free.
vi.mock("../plaid.js", () => ({ plaidClient: {} }));

import { deleteTenantAccount, type DeletionDeps } from "../account-deletion.js";

function fakeDeps(overrides: Partial<DeletionDeps> = {}): DeletionDeps {
  return {
    listEncryptedPlaidTokens: vi.fn(async () => ["tok-1", "tok-2"]),
    removePlaidItem: vi.fn(async () => {}),
    getStripeSubscriptionId: vi.fn(async () => "sub_1"),
    cancelStripeSubscription: vi.fn(async () => {}),
    listWorkosUserIds: vi.fn(async () => ["wu_1"]),
    deleteWorkosUser: vi.fn(async () => {}),
    deleteTenantRow: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("deleteTenantAccount", () => {
  it("removes plaid items, cancels stripe, deletes workos users, then deletes the tenant", async () => {
    const deps = fakeDeps();
    const result = await deleteTenantAccount("t1", deps);
    expect(deps.removePlaidItem).toHaveBeenCalledTimes(2);
    expect(deps.cancelStripeSubscription).toHaveBeenCalledWith("sub_1");
    expect(deps.deleteWorkosUser).toHaveBeenCalledWith("wu_1");
    expect(deps.deleteTenantRow).toHaveBeenCalledWith("t1");
    expect(result).toEqual({ plaidRemoved: 2, plaidFailed: 0 });
  });
  it("proceeds with deletion when plaid removal fails (best-effort)", async () => {
    const deps = fakeDeps({ removePlaidItem: vi.fn(async () => { throw new Error("plaid down"); }) });
    const result = await deleteTenantAccount("t1", deps);
    expect(result).toEqual({ plaidRemoved: 0, plaidFailed: 2 });
    expect(deps.deleteTenantRow).toHaveBeenCalledWith("t1");
  });
  it("proceeds when stripe/workos cleanup fails", async () => {
    const deps = fakeDeps({
      cancelStripeSubscription: vi.fn(async () => { throw new Error("stripe down"); }),
      deleteWorkosUser: vi.fn(async () => { throw new Error("workos down"); }),
    });
    await deleteTenantAccount("t1", deps);
    expect(deps.deleteTenantRow).toHaveBeenCalledWith("t1");
  });
});
