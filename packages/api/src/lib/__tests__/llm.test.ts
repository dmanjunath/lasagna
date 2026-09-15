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
// The boundary meters every call. Capture the rows instead of writing them, and
// keep the real cost reader so what lands in a row is what the boundary derived.
const logged: Array<Record<string, unknown>> = [];
vi.mock("../activity.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../activity.js")>()),
  logLlmUsage: (row: Record<string, unknown>) => void logged.push(row),
}));

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
  logged.length = 0;
});

describe("llmGenerateText descrubOutput", () => {
  it("descrubs the returned text by default", async () => {
    generateText.mockResolvedValue({ text: "Top up Account 1 monthly." });
    const result = await llmGenerateText(
      { tenantId: "t1", source: "chat", aliasMap: map },
      { model: {} as never, prompt: "hi" },
    );
    expect(result.text).toBe('Top up Joe\'s "Rainy Day" Fund monthly.');
  });

  it("returns raw alias-form text when descrubOutput is false", async () => {
    const json = '[{"name": "Account 1", "amount": 42}]';
    generateText.mockResolvedValue({ text: json });
    const result = await llmGenerateText(
      { tenantId: "t1", source: "chat", aliasMap: map, descrubOutput: false },
      { model: {} as never, prompt: "hi" },
    );
    expect(result.text).toBe(json);
    // The point: the raw text stays parseable; the descrubbed form would not.
    expect(() => JSON.parse(result.text)).not.toThrow();
  });

  it("descrubbed names containing quotes break JSON parsing (why raw is needed)", async () => {
    generateText.mockResolvedValue({ text: '[{"name": "Account 1"}]' });
    const result = await llmGenerateText(
      { tenantId: "t1", source: "chat", aliasMap: map },
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
      { tenantId: "t1", source: "chat", aliasMap: map },
      { model: {} as never, schema, prompt: "hi" },
    );
    expect(result.object.line).toBe('Top up Joe\'s "Rainy Day" Fund monthly.');
  });

  it("leaves the object alone when descrubOutput is false", async () => {
    generateObject.mockResolvedValue({ object: { line: "This comes after your auto loan." } });
    const result = await llmGenerateObject<{ line: string }>(
      { tenantId: "t1", source: "chat", aliasMap: debtMap, descrubOutput: false },
      { model: {} as never, schema, prompt: "hi" },
    );
    expect(result.object.line).toBe("This comes after your auto loan.");
  });

  it("descrubbing a debt alias doubles the noun (why the path opts out)", async () => {
    generateObject.mockResolvedValue({ object: { line: "This comes after your auto loan." } });
    const result = await llmGenerateObject<{ line: string }>(
      { tenantId: "t1", source: "chat", aliasMap: debtMap },
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
      { tenantId: "t1", source: "chat", aliasMap: map },
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
      { tenantId: "t1", source: "chat", aliasMap: map },
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

/**
 * Metering at the boundary.
 *
 * The rule these hold is that spend and visibility cannot come apart: a call
 * that reaches a model writes a usage row, and it does so on the way out
 * WHATEVER happens. Logging used to be hand-rolled at each call site, which
 * meant it was only ever reached on the success path — two model calls per
 * strategy section billed and logged nothing, and "strategy" disappeared from
 * the activity table while the feature was still running every day.
 */
describe("usage metering", () => {
  const schema = z.object({ line: z.string() });
  const model = { modelId: "~anthropic/claude-sonnet-latest" } as never;
  // A prebuilt (empty) map, so the boundary never reaches for the db.
  const noNames: AliasMap = { forward: new Map(), reverse: new Map() };

  it("records a successful text call with its tokens and reported cost", async () => {
    generateText.mockResolvedValue({
      text: "ok",
      usage: { inputTokens: 16000, outputTokens: 900 },
      providerMetadata: { openrouter: { usage: { cost: 0.0784 } } },
    });
    await llmGenerateText({ tenantId: "t1", source: "insights", aliasMap: noNames }, { model, prompt: "hi" });

    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      tenantId: "t1",
      source: "insights",
      model: "~anthropic/claude-sonnet-latest",
      inputTokens: 16000,
      outputTokens: 900,
      costUsd: 0.0784,
    });
  });

  it("records a text call that THREW — the spend it hides is the point", async () => {
    generateText.mockRejectedValue(new Error("provider 502"));

    await expect(
      llmGenerateText({ tenantId: "t1", source: "insights", aliasMap: noNames }, { model, prompt: "hi" }),
    ).rejects.toThrow("provider 502");

    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ tenantId: "t1", source: "insights" });
  });

  it("records an object call that THREW", async () => {
    generateObject.mockRejectedValue(new Error("No object generated"));

    await expect(
      llmGenerateObject<{ line: string }>(
        { tenantId: "t1", source: "strategy", aliasMap: noNames },
        { model, schema, prompt: "hi" },
      ),
    ).rejects.toThrow("No object generated");

    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ tenantId: "t1", source: "strategy" });
  });

  it("meters the model that actually ran, not a tier name", async () => {
    generateObject.mockResolvedValue({ object: { line: "ok" } });
    await llmGenerateObject<{ line: string }>(
      { tenantId: "t1", source: "chat", aliasMap: noNames },
      { model: { modelId: "moonshotai/kimi-k2.6" } as never, schema, prompt: "hi" },
    );
    expect(logged[0]).toMatchObject({ model: "moonshotai/kimi-k2.6" });
  });

  it("writes exactly one row per call, so nothing is double-counted", async () => {
    generateText.mockResolvedValue({ text: "ok" });
    await llmGenerateText({ tenantId: "t1", source: "chat", aliasMap: noNames }, { model, prompt: "one" });
    await llmGenerateText({ tenantId: "t1", source: "chat", aliasMap: noNames }, { model, prompt: "two" });
    expect(logged).toHaveLength(2);
  });
});
