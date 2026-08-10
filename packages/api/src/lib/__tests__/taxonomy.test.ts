import { describe, it, expect } from "vitest";
import { DEFAULT_TAXONOMY } from "@lasagna/core";
import { resolveCategoryId, activeCategoryId, UUID_RE, type TenantCategory } from "../taxonomy.js";

const cat = (id: string, systemKey: string | null, disabled = false): TenantCategory => ({
  id, systemKey, disabledAt: disabled ? new Date() : null,
  groupId: "g1", groupType: "expense", name: systemKey ?? "Custom",
});
const TAX = [cat("id-groc", "groceries"), cat("id-gas", "gas"), cat("id-sub", "subscriptions", true), cat("id-other", "other"), cat("id-custom", null)];

describe("resolveCategoryId", () => {
  it("maps a systemKey to the tenant's category id", () => {
    expect(resolveCategoryId(TAX, "groceries")).toBe("id-groc");
  });
  it("falls back to Other when the target is disabled", () => {
    expect(resolveCategoryId(TAX, "subscriptions")).toBe("id-other");
  });
  it("falls back to Other for unknown keys", () => {
    expect(resolveCategoryId(TAX, "nope")).toBe("id-other");
  });
  it("returns null only when the taxonomy has no Other row", () => {
    expect(resolveCategoryId([], "groceries")).toBeNull();
  });
});

describe("activeCategoryId", () => {
  it("passes through an enabled id (including custom)", () => {
    expect(activeCategoryId(TAX, "id-custom")).toBe("id-custom");
  });
  it("falls back to Other for a disabled or missing id", () => {
    expect(activeCategoryId(TAX, "id-sub")).toBe("id-other");
    expect(activeCategoryId(TAX, "id-gone")).toBe("id-other");
    expect(activeCategoryId(TAX, null)).toBe("id-other");
  });
});

describe("UUID_RE", () => {
  it("distinguishes ids from keys", () => {
    expect(UUID_RE.test("3f2b8c1a-9d4e-4f6a-8b2c-1d3e5f7a9b0c")).toBe(true);
    expect(UUID_RE.test("groceries")).toBe(false);
  });
});

describe("DEFAULT_TAXONOMY shape guard", () => {
  it("seeds exactly 14 groups", () => {
    expect(DEFAULT_TAXONOMY).toHaveLength(14);
  });
  it("seeds 32 unique category systemKeys", () => {
    const keys = DEFAULT_TAXONOMY.flatMap((g) => g.categories.map((c) => c.systemKey));
    expect(keys).toHaveLength(32);
    expect(new Set(keys).size).toBe(32);
  });
  it("covers every historical transaction_category enum value", () => {
    // The pg enum is gone (phase 4), but rows migrated from it live on under
    // these systemKeys — they must never disappear from the default taxonomy.
    const HISTORICAL_ENUM_KEYS = [
      "income", "housing", "transportation", "food_dining", "groceries",
      "utilities", "healthcare", "insurance", "entertainment", "shopping",
      "personal_care", "education", "travel", "subscriptions",
      "savings_investment", "debt_payment", "gifts_donations", "taxes",
      "transfer", "other",
    ];
    const keys = new Set(DEFAULT_TAXONOMY.flatMap((g) => g.categories.map((c) => c.systemKey)));
    for (const legacy of HISTORICAL_ENUM_KEYS) {
      expect(keys.has(legacy), `missing legacy key ${legacy}`).toBe(true);
    }
  });
});
