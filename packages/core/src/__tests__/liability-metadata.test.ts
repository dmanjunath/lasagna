import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseLoanMetadata } from "../liability-metadata.js";

describe("parseLoanMetadata", () => {
  it("returns null for null input", () => {
    assert.equal(parseLoanMetadata(null), null);
  });

  it("returns null for empty string", () => {
    assert.equal(parseLoanMetadata(""), null);
  });

  it("returns null for malformed JSON", () => {
    assert.equal(parseLoanMetadata("{bad json"), null);
  });

  it("returns null for legacy seed metadata without type field", () => {
    const legacy = JSON.stringify({ interestRate: 6.5, termMonths: 360, originationDate: "2020-01-01" });
    assert.equal(parseLoanMetadata(legacy), null);
  });

  it("returns null for unknown type value", () => {
    const unknown = JSON.stringify({ type: "heloc", source: "plaid" });
    assert.equal(parseLoanMetadata(unknown), null);
  });

  it("parses a valid mortgage metadata object", () => {
    const raw = JSON.stringify({
      type: "mortgage",
      source: "plaid",
      maturityDate: "2050-01-01",
      interestRatePercentage: 3.5,
      lastSyncedAt: "2026-04-16T00:00:00.000Z",
    });
    const result = parseLoanMetadata(raw);
    assert.ok(result !== null);
    assert.equal(result!.type, "mortgage");
    assert.equal(result!.source, "plaid");
    if (result!.type === "mortgage") {
      assert.equal(result.maturityDate, "2050-01-01");
      assert.equal(result.interestRatePercentage, 3.5);
    }
  });

  it("parses a valid student loan metadata object", () => {
    const raw = JSON.stringify({
      type: "student_loan",
      source: "manual",
      expectedPayoffDate: "2032-06-01",
      interestRatePercentage: 5.0,
      minimumPaymentAmount: 250,
    });
    const result = parseLoanMetadata(raw);
    assert.ok(result !== null);
    assert.equal(result!.type, "student_loan");
    assert.equal(result!.source, "manual");
    if (result!.type === "student_loan") {
      assert.equal(result.expectedPayoffDate, "2032-06-01");
    }
  });

  it("parses a valid credit card metadata object", () => {
    const raw = JSON.stringify({
      type: "credit_card",
      source: "plaid",
      minimumPaymentAmount: 35,
      aprs: [{ aprType: "purchase_apr", aprPercentage: 21.99 }],
      lastSyncedAt: "2026-04-16T00:00:00.000Z",
    });
    const result = parseLoanMetadata(raw);
    assert.ok(result !== null);
    assert.equal(result!.type, "credit_card");
    if (result!.type === "credit_card") {
      assert.equal(result.aprs![0].aprPercentage, 21.99);
    }
  });

  it("parses a valid other_loan metadata object", () => {
    const raw = JSON.stringify({
      type: "other_loan",
      source: "manual",
      maturityDate: "2028-09-01",
      interestRatePercentage: 7.5,
    });
    const result = parseLoanMetadata(raw);
    assert.ok(result !== null);
    assert.equal(result!.type, "other_loan");
  });

  it("accepts partial metadata — all optional fields absent is valid", () => {
    const raw = JSON.stringify({ type: "mortgage", source: "plaid" });
    const result = parseLoanMetadata(raw);
    assert.ok(result !== null);
    assert.equal(result!.type, "mortgage");
  });
});
