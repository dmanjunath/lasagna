import { describe, it, expect, vi, beforeEach } from "vitest";

// classifySecurity's only side effects are the model call and usage logging.
// Mock the model + telemetry, and stub db/activity so importing the module
// doesn't try to open a real DB connection.
const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (...args: unknown[]) => generateObject(...args) }));
vi.mock("../db.js", () => ({ db: {} }));
vi.mock("../activity.js", () => ({ logLlmUsage: vi.fn(), actualLlmCostUsd: () => undefined }));
vi.mock("../../agent/index.js", () => ({
  getModel: () => ({}) as never,
  getModelSlug: () => "google/gemini-3.1-flash-lite",
}));
// The llm boundary (lib/llm.ts) builds the tenant alias map before every call —
// a DB read. Stub the scrubber with identity fns so no DB is touched and the
// prompts/objects pass through unchanged.
vi.mock("../pii-scrubber.js", () => ({
  buildAliasMap: async () => ({ forward: new Map(), reverse: new Map() }),
  scrub: (x: unknown) => x,
  descrub: (x: unknown) => x,
  descrubObject: (x: unknown) => x,
}));

import { classifySecurity } from "../security-classifier.js";

const okUsage = { inputTokens: 10, outputTokens: 5 };

beforeEach(() => {
  generateObject.mockReset();
});

describe("classifySecurity", () => {
  it("returns a validated classification for a confident, in-taxonomy answer", async () => {
    generateObject.mockResolvedValue({
      object: { assetClass: "International Stocks", category: "Individual Stocks", confidence: 0.9 },
      usage: okUsage,
    });
    const result = await classifySecurity("tenant-1", { symbol: "RY.TO", name: "Royal Bank", securityType: "equity" });
    expect(result).toEqual({ assetClass: "International Stocks", category: "Individual Stocks" });
  });

  it("falls back to null when confidence is below the floor", async () => {
    generateObject.mockResolvedValue({
      object: { assetClass: "US Stocks", category: "Individual Stocks", confidence: 0.4 },
      usage: okUsage,
    });
    const result = await classifySecurity("tenant-1", { symbol: "ZZZZ" });
    expect(result).toBeNull();
  });

  it("falls back to null when the asset class is outside the taxonomy", async () => {
    // Guards against a model that slips a value past the schema constraint.
    generateObject.mockResolvedValue({
      object: { assetClass: "Commodities", category: "Gold", confidence: 0.95 },
      usage: okUsage,
    });
    const result = await classifySecurity("tenant-1", { symbol: "GLD" });
    expect(result).toBeNull();
  });

  it("truncates an overlong category and never throws", async () => {
    generateObject.mockResolvedValue({
      object: { assetClass: "Bonds", category: "x".repeat(200), confidence: 0.8 },
      usage: okUsage,
    });
    const result = await classifySecurity("tenant-1", { symbol: "BONDX" });
    expect(result?.assetClass).toBe("Bonds");
    expect(result?.category.length).toBeLessThanOrEqual(60);
  });

  it("returns null (never throws) when the model call fails", async () => {
    generateObject.mockRejectedValue(new Error("network down"));
    const result = await classifySecurity("tenant-1", { symbol: "OOPS" });
    expect(result).toBeNull();
  });
});
