import { describe, it, expect } from "vitest";
import { resolveModelLevel } from "../model-gate.js";

describe("resolveModelLevel", () => {
  it("free + no requested level → free model", () => {
    expect(resolveModelLevel("free", undefined)).toBe("free");
  });

  it("pro + no requested level → floored to medium (Sonnet)", () => {
    expect(resolveModelLevel("pro", undefined)).toBe("medium");
  });

  it("pro + a below-Sonnet level → floored up to medium", () => {
    expect(resolveModelLevel("pro", "free")).toBe("medium");
    expect(resolveModelLevel("pro", "fast")).toBe("medium");
    expect(resolveModelLevel("pro", "fast-claude")).toBe("medium");
    expect(resolveModelLevel("pro", "medium-google")).toBe("medium");
  });

  it("pro + medium stays medium", () => {
    expect(resolveModelLevel("pro", "medium")).toBe("medium");
  });

  it("free + a premium level → silently served the free model (no throw)", () => {
    // Free tenants have no model picker; a stale/default premium level from the
    // client must NOT reject — it serves the free model.
    expect(resolveModelLevel("free", "frontier")).toBe("free");
    expect(resolveModelLevel("free", "medium")).toBe("free");
  });

  it("free + explicitly the free level → free model", () => {
    expect(resolveModelLevel("free", "free")).toBe("free");
  });

  it("pro + an explicit premium level → passes through", () => {
    expect(resolveModelLevel("pro", "frontier")).toBe("frontier");
  });
});
