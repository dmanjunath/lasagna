import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock only the model call — the real scrubber runs, so this exercises the
// actual descrub-on-the-way-back behavior of the boundary.
const generateText = vi.fn();
const generateObject = vi.fn();
vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateText(...args),
  generateObject: (...args: unknown[]) => generateObject(...args),
}));
// pii-scrubber imports the db module; stub it so no connection is attempted.
// buildAliasMap is never called because every test passes a prebuilt aliasMap.
vi.mock("../db.js", () => ({ db: {} }));

import { llmGenerateText, llmGenerateObject } from "../llm.js";
import type { AliasMap } from "../pii-scrubber.js";
import { z } from "zod";

// A real account name containing a double quote — descrubbing it INTO a JSON
// string corrupts the payload, which is why JSON-parsing callers need the raw
// alias-form text.
const map: AliasMap = {
  forward: new Map([['Joe\'s "Rainy Day" Fund', "Account 1"]]),
  reverse: new Map([["Account 1", 'Joe\'s "Rainy Day" Fund']]),
};

// A debt account's alias is its SUBTYPE, which is an ordinary English noun. The
// reverse map therefore rewrites plain prose, not just placeholders.
const debtMap: AliasMap = {
  forward: new Map([["Auto Loan", "auto"]]),
  reverse: new Map([["auto", "Auto Loan"]]),
};

beforeEach(() => {
  generateText.mockReset();
  generateObject.mockReset();
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

describe("llmGenerateObject descrubOutput", () => {
  const schema = z.object({ line: z.string() });

  it("descrubs object strings by default", async () => {
    generateObject.mockResolvedValue({ object: { line: "Top up Account 1 monthly." } });
    const result = await llmGenerateObject<{ line: string }>(
      { tenantId: "t1", aliasMap: map },
      { model: {} as never, schema, prompt: "hi" },
    );
    expect(result.object.line).toBe('Top up Joe\'s "Rainy Day" Fund monthly.');
  });

  it("leaves the object alone when descrubOutput is false", async () => {
    generateObject.mockResolvedValue({ object: { line: "This comes after your auto loan." } });
    const result = await llmGenerateObject<{ line: string }>(
      { tenantId: "t1", aliasMap: debtMap, descrubOutput: false },
      { model: {} as never, schema, prompt: "hi" },
    );
    expect(result.object.line).toBe("This comes after your auto loan.");
  });

  it("descrubbing a debt alias doubles the noun (why the path opts out)", async () => {
    generateObject.mockResolvedValue({ object: { line: "This comes after your auto loan." } });
    const result = await llmGenerateObject<{ line: string }>(
      { tenantId: "t1", aliasMap: debtMap },
      { model: {} as never, schema, prompt: "hi" },
    );
    expect(result.object.line).toBe("This comes after your Auto Loan loan.");
  });
});

// The OUTBOUND half of the boundary. Everything above only asserts what comes
// back, so removing the scrub from either call site still passes. These read the
// arguments the model actually received, so the scrub cannot be dropped quietly.
describe("outbound scrubbing", () => {
  const schema = z.object({ line: z.string() });
  const real = 'Joe\'s "Rainy Day" Fund';

  it("llmGenerateText sends the alias, never the real name", async () => {
    generateText.mockResolvedValue({ text: "ok" });
    await llmGenerateText(
      { tenantId: "t1", aliasMap: map },
      {
        model: {} as never,
        system: `You advise on ${real}.`,
        messages: [{ role: "user", content: `Move $50 into ${real}.` }],
      },
    );
    const sent = (generateText.mock.calls[0]?.[0] ?? {}) as {
      system?: string;
      messages?: unknown;
    };
    expect(sent.system).toBe("You advise on Account 1.");
    expect(JSON.stringify(sent.messages)).toContain("Move $50 into Account 1.");
    expect(JSON.stringify([sent.system, sent.messages])).not.toContain("Rainy Day");
  });

  it("llmGenerateObject sends the alias, never the real name", async () => {
    generateObject.mockResolvedValue({ object: { line: "ok" } });
    await llmGenerateObject<{ line: string }>(
      { tenantId: "t1", aliasMap: map },
      {
        model: {} as never,
        schema,
        system: `You advise on ${real}.`,
        prompt: `How much is in ${real}?`,
      },
    );
    const sent = (generateObject.mock.calls[0]?.[0] ?? {}) as {
      system?: string;
      prompt?: string;
    };
    expect(sent.system).toBe("You advise on Account 1.");
    expect(sent.prompt).toBe("How much is in Account 1?");
    expect(JSON.stringify([sent.system, sent.prompt])).not.toContain("Rainy Day");
  });
});
