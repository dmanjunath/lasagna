import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock only the model call — the real scrubber runs, so this exercises the
// actual descrub-on-the-way-back behavior of the boundary.
const generateText = vi.fn();
vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateText(...args),
  generateObject: vi.fn(),
}));
// pii-scrubber imports the db module; stub it so no connection is attempted.
// buildAliasMap is never called because every test passes a prebuilt aliasMap.
vi.mock("../db.js", () => ({ db: {} }));

import { llmGenerateText } from "../llm.js";
import type { AliasMap } from "../pii-scrubber.js";

// A real account name containing a double quote — descrubbing it INTO a JSON
// string corrupts the payload, which is why JSON-parsing callers need the raw
// alias-form text.
const map: AliasMap = {
  forward: new Map([['Joe\'s "Rainy Day" Fund', "Account 1"]]),
  reverse: new Map([["Account 1", 'Joe\'s "Rainy Day" Fund']]),
};

beforeEach(() => {
  generateText.mockReset();
});

describe("llmGenerateText descrubOutput", () => {
  it("descrubs the returned text by default", async () => {
    generateText.mockResolvedValue({ text: "Top up Account 1 monthly." });
    const result = await llmGenerateText(
      { tenantId: "t1", aliasMap: map },
      { model: {} as never, prompt: "hi" },
    );
    expect(result.text).toBe('Top up Joe\'s "Rainy Day" Fund monthly.');
  });

  it("returns raw alias-form text when descrubOutput is false", async () => {
    const json = '[{"name": "Account 1", "amount": 42}]';
    generateText.mockResolvedValue({ text: json });
    const result = await llmGenerateText(
      { tenantId: "t1", aliasMap: map, descrubOutput: false },
      { model: {} as never, prompt: "hi" },
    );
    expect(result.text).toBe(json);
    // The point: the raw text stays parseable; the descrubbed form would not.
    expect(() => JSON.parse(result.text)).not.toThrow();
  });

  it("descrubbed names containing quotes break JSON parsing (why raw is needed)", async () => {
    generateText.mockResolvedValue({ text: '[{"name": "Account 1"}]' });
    const result = await llmGenerateText(
      { tenantId: "t1", aliasMap: map },
      { model: {} as never, prompt: "hi" },
    );
    expect(() => JSON.parse(result.text)).toThrow();
  });
});
