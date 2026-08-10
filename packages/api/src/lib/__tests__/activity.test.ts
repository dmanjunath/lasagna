import { describe, it, expect } from "vitest";
import { estimateLlmCostUsd } from "../activity.js";

describe("estimateLlmCostUsd", () => {
  it("prices a known model per 1M tokens (sonnet: $3 in / $15 out)", () => {
    // 1M in + 1M out = 3 + 15 = $18
    expect(estimateLlmCostUsd("anthropic/claude-sonnet-4.5", 1_000_000, 1_000_000)).toBeCloseTo(18, 6);
    // a realistic chat step: 6k in, 500 out
    expect(estimateLlmCostUsd("anthropic/claude-sonnet-4.5", 6000, 500)).toBeCloseTo(0.0255, 6);
  });

  it("falls back to the default price for unknown models", () => {
    // default $1 in / $3 out per 1M
    expect(estimateLlmCostUsd("some/unknown-model", 1_000_000, 1_000_000)).toBeCloseTo(4, 6);
  });

  it("zero tokens costs zero", () => {
    expect(estimateLlmCostUsd("anthropic/claude-opus-4.7", 0, 0)).toBe(0);
  });
});
