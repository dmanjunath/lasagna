import { describe, it, expect } from "vitest";
import { accountIdsToFreeze, countInstitutions } from "../account-limits.js";

// The rows the helper sees come from recomputeFrozenAccounts: oldest-first,
// `manual` set when the item's institution is "manual", and `institutionKey`
// = institutionId ?? `item:<item id>`.
const at = (institutionKey: string, ...ids: string[]) =>
  ids.map((id) => ({ id, institutionKey }));

describe("accountIdsToFreeze", () => {
  it("freezes nothing when under the institution limit", () => {
    expect(accountIdsToFreeze([...at("bank1", "a"), ...at("bank2", "b")], 2)).toEqual([]);
  });

  it("freezes every account at institutions beyond the limit", () => {
    const ordered = [
      ...at("bank1", "a"),
      ...at("bank2", "b"),
      ...at("bank3", "c", "d"),
      ...at("bank4", "e"),
    ];
    expect(accountIdsToFreeze(ordered, 2)).toEqual(["c", "d", "e"]);
  });

  it("never freezes extra accounts inside an already-counted institution", () => {
    const ordered = [
      ...at("bank1", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "a10"),
      ...at("bank2", "b1", "b2"),
    ];
    expect(accountIdsToFreeze(ordered, 2)).toEqual([]);
  });

  it("counts two items at one institution as one slot", () => {
    // The re-link case: a second item at bank1 must not consume bank2's slot.
    const ordered = [
      ...at("bank1", "a"),
      ...at("bank1", "a-relinked"),
      ...at("bank2", "b"),
      ...at("bank3", "c"),
    ];
    expect(accountIdsToFreeze(ordered, 2)).toEqual(["c"]);
  });

  it("counts each null-institution item as its own institution", () => {
    // Two nulls can't be proven to be the same bank, so they key by item id.
    const ordered = [
      ...at("item:i1", "a"),
      ...at("item:i2", "b"),
      ...at("item:i3", "c"),
    ];
    expect(accountIdsToFreeze(ordered, 2)).toEqual(["c"]);
  });

  it("still consumes a slot for an errored item", () => {
    // Status is not an input: an errored item is still linked, still re-authable
    // and still billed, so it holds its slot.
    const ordered = [...at("bank1", "a"), ...at("bank2-errored", "b"), ...at("bank3", "c")];
    expect(accountIdsToFreeze(ordered, 2)).toEqual(["c"]);
  });

  it("freezes none for a high (pro) limit", () => {
    const ordered = Array.from({ length: 12 }, (_, i) => ({
      id: `a${i}`,
      institutionKey: `bank${i}`,
    }));
    expect(accountIdsToFreeze(ordered, 50)).toEqual([]);
  });

  it("never freezes manual accounts and doesn't count them toward the limit", () => {
    const mixed = [
      { id: "m1", manual: true, institutionKey: "manual" },
      ...at("bank1", "a"),
      ...at("bank2", "b"),
      { id: "m2", manual: true, institutionKey: "manual" },
      ...at("bank3", "c"),
    ];
    expect(accountIdsToFreeze(mixed, 2)).toEqual(["c"]);
  });

  it("freezes nothing when only manual accounts exceed the limit", () => {
    // Every seeded tenant is this shape: one "manual" item, 0 institutions used.
    const manual = ["m1", "m2", "m3", "m4"].map((id) => ({
      id,
      manual: true,
      institutionKey: "manual",
    }));
    expect(accountIdsToFreeze(manual, 2)).toEqual([]);
  });

  it("is idempotent: the same input always yields the same freeze set", () => {
    const ordered = [
      ...at("bank1", "a"),
      ...at("bank2", "b", "b2"),
      ...at("bank3", "c"),
      ...at("bank1", "a-relinked"),
    ];
    const first = accountIdsToFreeze(ordered, 2);
    const second = accountIdsToFreeze(ordered, 2);
    expect(first).toEqual(["c"]);
    expect(second).toEqual(first);
  });
});

// countInstitutions answers "how many slots is this tenant using?" for the meter,
// off the very rows accountIdsToFreeze consumes. The rows are one per ACCOUNT
// (loadInstitutionSlots inner-joins accounts to items), which is what keeps an
// institution holding zero accounts out of both answers.
describe("countInstitutions", () => {
  const slot = (institutionKey: string, id: string, manual = false) => ({ id, manual, institutionKey });

  it("counts an institution once however many accounts it holds", () => {
    const slots = [slot("bank1", "a1"), slot("bank1", "a2"), slot("bank1", "a3"), slot("bank2", "b1")];
    expect(countInstitutions(slots)).toBe(2);
  });

  it("does not count an institution that holds no accounts", () => {
    // An item that errored before its first account pull contributes no rows at
    // all, so a tenant with two working banks plus that item reads 2, not 3 —
    // and 2 is also what freezes. Counting items instead produced "2 of 3
    // syncing" with nothing frozen.
    const twoBanksPlusAnEmptyThird = [slot("bank1", "a1"), slot("bank2", "b1")];
    expect(countInstitutions(twoBanksPlusAnEmptyThird)).toBe(2);
    expect(accountIdsToFreeze(twoBanksPlusAnEmptyThird, 2)).toEqual([]);
  });

  it("counts two items at one institution as one slot", () => {
    expect(countInstitutions([slot("bank1", "a"), slot("bank1", "a-relinked"), slot("bank2", "b")])).toBe(2);
  });

  it("counts each null-institution item as its own institution", () => {
    expect(countInstitutions([slot("item:i1", "a"), slot("item:i2", "b")])).toBe(2);
  });

  it("excludes manual accounts", () => {
    const slots = [slot("manual", "m1", true), slot("manual", "m2", true), slot("bank1", "a")];
    expect(countInstitutions(slots)).toBe(1);
  });

  it("is 0 for a tenant with nothing linked", () => {
    expect(countInstitutions([])).toBe(0);
  });

  it("agrees with the freeze set: count over the cap means something is frozen", () => {
    const slots = [slot("bank1", "a"), slot("bank2", "b"), slot("bank3", "c")];
    expect(countInstitutions(slots)).toBe(3);
    // The nudge says how many institutions are frozen as count - cap, so the two
    // have to move together.
    expect(accountIdsToFreeze(slots, 2)).toEqual(["c"]);
    expect(countInstitutions(slots) - 2).toBe(1);
  });
});
