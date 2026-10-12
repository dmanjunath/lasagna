import { describe, it, expect, vi } from "vitest";

vi.mock("../db.js", () => ({ db: {} }));

import { isEstimateDue } from "../value-estimate.js";

const now = new Date("2026-11-01T19:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
const address = "1 Example St, Springfield";

describe("isEstimateDue", () => {
  it("skips a property with no address", () => {
    expect(isEstimateDue(null, now)).toBe(false);
    expect(isEstimateDue({ address: "  " }, now)).toBe(false);
  });

  it("requests one for an address whose first trigger never ran", () => {
    expect(isEstimateDue({ address }, now)).toBe(true);
  });

  it("refreshes a market estimate from last month, whatever its status", () => {
    for (const status of ["ready", "failed", "pending"] as const) {
      const meta = { address, valueEstimate: { snapshotId: "s", status, requestedAt: daysAgo(31) } };
      expect(isEstimateDue(meta, now)).toBe(true);
    }
  });

  it("leaves an estimate requested this month alone", () => {
    const meta = { address, valueEstimate: { snapshotId: "s", status: "ready" as const, requestedAt: daysAgo(10) } };
    expect(isEstimateDue(meta, now)).toBe(false);
  });

  it("never re-estimates a value the user set", () => {
    const old = { snapshotId: "s", status: "ready" as const, requestedAt: daysAgo(90) };
    expect(isEstimateDue({ address, valueEstimate: { ...old, override: true } }, now)).toBe(false);
    expect(isEstimateDue({ address, valueEstimate: { ...old, advisory: true } }, now)).toBe(false);
  });

  it("refreshes an estimate with an unreadable request date", () => {
    const meta = { address, valueEstimate: { snapshotId: "s", status: "ready" as const, requestedAt: "" } };
    expect(isEstimateDue(meta, now)).toBe(true);
  });
});
