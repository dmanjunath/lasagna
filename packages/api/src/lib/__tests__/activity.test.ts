import { describe, it, expect } from "vitest";
import { estimateLlmCostUsd, actualLlmCostUsd } from "../activity.js";

describe("estimateLlmCostUsd", () => {
  it("prices a known model per 1M tokens (sonnet: $2 in / $10 out)", () => {
    // 1M in + 1M out = 2 + 10 = $12
    expect(estimateLlmCostUsd("~anthropic/claude-sonnet-latest", 1_000_000, 1_000_000)).toBeCloseTo(12, 6);
    // a realistic chat step: 6k in, 500 out
    expect(estimateLlmCostUsd("~anthropic/claude-sonnet-latest", 6000, 500)).toBeCloseTo(0.017, 6);
  });

  it("falls back to the default price for unknown models", () => {
    // default $1 in / $3 out per 1M
    expect(estimateLlmCostUsd("some/unknown-model", 1_000_000, 1_000_000)).toBeCloseTo(4, 6);
  });

  it("zero tokens costs zero", () => {
    expect(estimateLlmCostUsd("~anthropic/claude-opus-latest", 0, 0)).toBe(0);
  });
});

describe("actualLlmCostUsd", () => {
  it("extracts OpenRouter's actual cost from providerMetadata", () => {
    expect(actualLlmCostUsd({ openrouter: { usage: { cost: 0.0123 } } })).toBe(0.0123);
  });

  it("accepts a zero cost", () => {
    expect(actualLlmCostUsd({ openrouter: { usage: { cost: 0 } } })).toBe(0);
  });

  it("returns undefined when the cost is missing at any level", () => {
    expect(actualLlmCostUsd(undefined)).toBeUndefined();
    expect(actualLlmCostUsd(null)).toBeUndefined();
    expect(actualLlmCostUsd({})).toBeUndefined();
    expect(actualLlmCostUsd({ openrouter: {} })).toBeUndefined();
    expect(actualLlmCostUsd({ openrouter: { usage: {} } })).toBeUndefined();
  });

  it("returns undefined for a NaN or negative cost", () => {
    expect(actualLlmCostUsd({ openrouter: { usage: { cost: NaN } } })).toBeUndefined();
    expect(actualLlmCostUsd({ openrouter: { usage: { cost: -0.5 } } })).toBeUndefined();
    expect(actualLlmCostUsd({ openrouter: { usage: { cost: Infinity } } })).toBeUndefined();
  });

  it("returns undefined when cost is not a number", () => {
    expect(actualLlmCostUsd({ openrouter: { usage: { cost: "0.01" } } })).toBeUndefined();
  });
});
