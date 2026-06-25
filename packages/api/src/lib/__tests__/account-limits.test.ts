import { describe, it, expect } from "vitest";
import { accountIdsToFreeze } from "../account-limits.js";

describe("accountIdsToFreeze", () => {
  const ordered = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];

  it("freezes nothing when under the limit", () => {
    expect(accountIdsToFreeze(ordered.slice(0, 2), 3)).toEqual([]);
  });

  it("freezes nothing when exactly at the limit", () => {
    expect(accountIdsToFreeze(ordered.slice(0, 3), 3)).toEqual([]);
  });

  it("freezes the newest beyond the limit, keeping the oldest active", () => {
    expect(accountIdsToFreeze(ordered, 3)).toEqual(["d", "e"]);
  });

  it("freezes none for a high (pro) limit", () => {
    expect(accountIdsToFreeze(ordered, 50)).toEqual([]);
  });
});
