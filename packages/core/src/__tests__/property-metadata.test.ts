import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parsePropertyMetadata } from "../property-metadata.js";

describe("parsePropertyMetadata", () => {
  it("parses a full rental property blob", () => {
    const raw = JSON.stringify({
      address: "12 Maple St",
      monthlyRent: 2400,
      annualInsurance: 1800,
      annualMaintenance: 3000,
    });
    assert.deepEqual(parsePropertyMetadata(raw), {
      address: "12 Maple St",
      monthlyRent: 2400,
      annualInsurance: 1800,
      annualMaintenance: 3000,
    });
  });

  it("ignores unknown keys and keeps known ones", () => {
    const raw = JSON.stringify({ address: "1 Elm", weird: true, interestRate: 4 });
    assert.deepEqual(parsePropertyMetadata(raw), { address: "1 Elm" });
  });

  it("drops wrong-typed values", () => {
    const raw = JSON.stringify({ address: 42, monthlyRent: "lots" });
    assert.deepEqual(parsePropertyMetadata(raw), {});
  });

  it("returns null for null, empty, malformed, and non-object JSON", () => {
    assert.equal(parsePropertyMetadata(null), null);
    assert.equal(parsePropertyMetadata(""), null);
    assert.equal(parsePropertyMetadata("{not json"), null);
    assert.equal(parsePropertyMetadata("[1,2]"), null);
  });
});
