import { describe, it, expect, vi } from "vitest";

/**
 * The aliases buildAliasMap gives accounts.
 *
 * A debt account used to get its bare subtype or type as its alias when it was
 * the only one of its kind: "credit", "credit card", "auto". Those are
 * ordinary words, and descrub restores every whole-word match of an alias, so
 * a model sentence about "your two credit card balances" came back naming the
 * one manual card aliased "credit". Debt aliases are now always numbered.
 */

type Row = Record<string, unknown>;
let accountRows: Row[] = [];

vi.mock("../db.js", async () => {
  const core = await import("@lasagna/core");
  const rowsFor = (table: unknown): Row[] => (table === core.accounts ? accountRows : []);
  const chain = () => {
    let table: unknown;
    const self: Record<string, unknown> = {
      from: (t: unknown) => ((table = t), self),
      where: () => self,
      orderBy: () => self,
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(rowsFor(table)).then(res, rej),
    };
    return self;
  };
  return { db: { select: () => chain() } };
});

import { buildAliasMap, descrub, scrub } from "../pii-scrubber.js";

const acct = (id: string, name: string, type: string, subtype: string | null, mask: string | null = null) => ({
  id, name, type, subtype, mask, metadata: null,
});

describe("account aliases", () => {
  it("numbers a debt alias even when it is the only one of its kind", async () => {
    accountRows = [acct("1", "Northwind Rewards Visa", "credit", null)];
    const map = await buildAliasMap("t");
    expect(map.forward.get("Northwind Rewards Visa")).toBe("credit 1");
  });

  it("leaves ordinary words in a model reply alone", async () => {
    // The real household: two Plaid cards both named "CREDIT CARD", and one
    // manual card with no subtype.
    accountRows = [
      acct("1", "CREDIT CARD", "credit", "credit card", "1111"),
      acct("2", "CREDIT CARD", "credit", "credit card", "2222"),
      acct("3", "Northwind Rewards Visa", "credit", null),
    ];
    const map = await buildAliasMap("t");
    const reply = "Your two credit card balances total $4,210. Keep paying them in full.";
    expect(descrub(reply, map)).toBe(reply);
  });

  it("gives identical names one alias, which restores to that name", async () => {
    accountRows = [
      acct("1", "CREDIT CARD", "credit", "credit card"),
      acct("2", "CREDIT CARD", "credit", "credit card"),
      acct("3", "Amex Gold", "credit", "credit card"),
    ];
    const map = await buildAliasMap("t");
    expect(map.forward.get("CREDIT CARD")).toBe("credit card 1");
    expect(map.forward.get("Amex Gold")).toBe("credit card 2");
    expect(descrub("Pay credit card 2 first.", map)).toBe("Pay Amex Gold first.");
  });

  it("still keeps every real account name out of what the model sees", async () => {
    accountRows = [
      acct("1", "Northwind Rewards Visa", "credit", null, "4321"),
      acct("2", "Harbor Checking", "depository", "checking", "9999"),
    ];
    const map = await buildAliasMap("t");
    const out = JSON.stringify(
      scrub({ accounts: [{ name: "Northwind Rewards Visa" }, { name: "Harbor Checking", mask: "9999" }] }, map),
    );
    expect(out).not.toContain("Northwind");
    expect(out).not.toContain("Harbor");
    expect(out).not.toContain("9999");
  });
});
