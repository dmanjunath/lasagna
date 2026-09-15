/**
 * The record/replay layer for model calls.
 *
 * The properties worth holding, in order of how expensive it is to lose them:
 *
 *  1. Replay never reaches the network. A layer that quietly falls through to a
 *     paid call defeats its own purpose, so a miss THROWS.
 *  2. Production can never run it. Serving one household a recorded answer that
 *     was generated for another is the catastrophe this guards against.
 *  3. Nothing with a real name, an email or an account-number-shaped digit run
 *     is ever written, because these files go to a public repo.
 *  4. Replay hands back the provider's own shape, so cost accounting, usage
 *     logging and the parse/failure branches downstream all still run.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// The model call. In replay mode it must never be reached at all.
const generateText = vi.fn();
const generateObject = vi.fn();
vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateText(...args),
  generateObject: (...args: unknown[]) => generateObject(...args),
}));

// pii-scrubber and activity both reach for the db. Capture the usage rows
// instead of writing them, so a replayed call's metering is observable.
const usageRows: Record<string, unknown>[] = [];
vi.mock("../db.js", () => ({
  db: {
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        usageRows.push(row);
        return Promise.resolve();
      },
    }),
  },
}));

import {
  throughFixtures,
  fixtureKey,
  fixtureMode,
  fixturePath,
  assertRecordable,
  FixturePiiError,
  type FixtureCall,
  type FixtureFile,
} from "../llm-fixtures.js";
import { llmGenerateText, llmGenerateObject } from "../llm.js";
import type { AliasMap } from "../pii-scrubber.js";

/** No names at all: the request is trivially already scrubbed. */
const emptyMap: AliasMap = { forward: new Map(), reverse: new Map() };
/** One real name and its alias, as buildAliasMap would produce. */
const trustMap: AliasMap = {
  forward: new Map([["Bloggs Family Trust", "Account 1"]]),
  reverse: new Map([["Account 1", "Bloggs Family Trust"]]),
};

let dir: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "llm-fixtures-"));
  process.env.LLM_FIXTURE_DIR = dir;
  process.env.APP_ENV = "dev";
  delete process.env.LLM_FIXTURES;
  generateText.mockReset();
  generateObject.mockReset();
  usageRows.length = 0;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env = { ...savedEnv };
});

function textCall(over: Partial<FixtureCall["request"]> = {}): FixtureCall {
  return {
    kind: "text",
    source: "chat",
    request: {
      model: { modelId: "~anthropic/claude-sonnet-latest" },
      system: "You are a financial planning assistant.",
      messages: [{ role: "user", content: "How is Account 1 doing?" }],
      maxOutputTokens: 8192,
      ...over,
    },
    aliasMap: emptyMap,
  };
}

/** A recorded response, made the only way one may be made: by recording. */
async function record(call: FixtureCall, response: object): Promise<string> {
  process.env.LLM_FIXTURES = "record";
  await throughFixtures(call, async () => response);
  process.env.LLM_FIXTURES = "replay";
  return fixturePath(call.source, fixtureKey(call));
}

// ── Modes ────────────────────────────────────────────────────────────────────

describe("modes", () => {
  it("defaults to off, so a deployment and the unit suite are untouched", () => {
    expect(fixtureMode()).toBe("off");
  });

  it("passes an unknown value off rather than guessing", () => {
    process.env.LLM_FIXTURES = "yes-please";
    expect(fixtureMode()).toBe("off");
  });

  it("off makes the real call", async () => {
    const real = { text: "from the provider" };
    const out = await throughFixtures(textCall(), async () => real);
    expect(out).toBe(real);
  });

  // The catastrophe case. A replayed answer served to a real household is
  // someone else's financial advice with their numbers in it.
  it.each(["record", "replay"])("refuses %s in production", (mode) => {
    process.env.LLM_FIXTURES = mode;
    process.env.APP_ENV = "production";
    expect(() => fixtureMode()).toThrow(/production/i);
  });

  it("production is checked on the call, not only at startup", async () => {
    process.env.LLM_FIXTURES = "replay";
    process.env.APP_ENV = "production";
    await expect(throughFixtures(textCall(), async () => ({ text: "x" }))).rejects.toThrow(
      /LLM_FIXTURES=replay is set in production/,
    );
  });
});

// ── Keying ───────────────────────────────────────────────────────────────────

describe("keying", () => {
  it("is stable for the same call", () => {
    expect(fixtureKey(textCall())).toBe(fixtureKey(textCall()));
  });

  it("does not depend on the order the request was built in", () => {
    const a: FixtureCall = {
      kind: "text",
      source: "chat",
      request: { model: "m", system: "s", prompt: "p" },
      aliasMap: emptyMap,
    };
    const b: FixtureCall = {
      kind: "text",
      source: "chat",
      request: { prompt: "p", system: "s", model: "m" },
      aliasMap: emptyMap,
    };
    expect(fixtureKey(a)).toBe(fixtureKey(b));
  });

  // The owner's requirement: the fixture tracks the model it was recorded from.
  it("changes when the model changes", () => {
    expect(fixtureKey(textCall({ model: { modelId: "google/gemini-3.5-flash" } }))).not.toBe(
      fixtureKey(textCall()),
    );
  });

  it.each([
    ["system prompt", { system: "You are something else." }],
    ["messages", { messages: [{ role: "user", content: "different" }] }],
    ["tool set", { tools: { get_accounts: {} } }],
    ["toolChoice", { toolChoice: "required" }],
    ["temperature", { temperature: 0.9 }],
    ["output cap", { maxOutputTokens: 4000 }],
  ])("changes when the %s changes", (_label, over) => {
    expect(fixtureKey(textCall(over))).not.toBe(fixtureKey(textCall()));
  });

  it("changes when a structured call's schema shape changes", () => {
    const withSchema = (schema: unknown): FixtureCall => ({
      kind: "object",
      source: "insights",
      request: { model: "m", prompt: "p", schema },
      aliasMap: emptyMap,
    });
    const a = withSchema(z.object({ insights: z.array(z.object({ title: z.string() })) }));
    const b = withSchema(z.object({ insights: z.array(z.object({ headline: z.string() })) }));
    expect(fixtureKey(a)).not.toBe(fixtureKey(b));
  });
});

// ── A miss must be loud ──────────────────────────────────────────────────────

describe("replay miss", () => {
  beforeEach(() => {
    process.env.LLM_FIXTURES = "replay";
  });

  it("throws instead of calling out, and says how to record it", async () => {
    const run = vi.fn();
    await expect(throughFixtures(textCall(), run as never)).rejects.toThrow(
      /LLM fixture miss[\s\S]*source:\s+chat[\s\S]*key:\s+[0-9a-f]{32}[\s\S]*LLM_FIXTURES=record pnpm -F @lasagna\/api record:llm/,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("names the model, so a stale recording is diagnosable", async () => {
    await expect(throughFixtures(textCall(), async () => ({}))).rejects.toThrow(
      /~anthropic\/claude-sonnet-latest/,
    );
  });

  // The failure this layer exists to prevent: a quiet empty response would make
  // every test downstream pass while proving nothing.
  it("never returns an empty response instead of throwing", async () => {
    await expect(throughFixtures(textCall(), async () => ({}))).rejects.toThrow();
  });
});

// ── The PII guard ────────────────────────────────────────────────────────────

describe("the PII guard", () => {
  const clean: FixtureFile = {
    source: "chat",
    kind: "text",
    model: "m",
    recordedAt: "2026-01-01T00:00:00.000Z",
    promptExcerpt: "How is Account 1 doing?",
    response: { text: "Account 1 grew 2% last month.", finishReason: "stop" },
  };
  const scrubbedRequest = { model: "m", system: "You advise on Account 1.", prompt: "How is it?" };

  it("accepts an alias-only fixture", () => {
    expect(() => assertRecordable(clean, scrubbedRequest, trustMap)).not.toThrow();
  });

  it("rejects an email address", () => {
    const f = { ...clean, response: { text: "Email taylor.smith@example.com to confirm." } };
    expect(() => assertRecordable(f, scrubbedRequest, emptyMap)).toThrow(FixturePiiError);
    expect(() => assertRecordable(f, scrubbedRequest, emptyMap)).toThrow(
      /email address \("taylor\.smith@example\.com"\)/,
    );
  });

  it("rejects an account-number-shaped digit run", () => {
    const f = { ...clean, response: { text: "Routing 021000021 account 4417123456789." } };
    expect(() => assertRecordable(f, scrubbedRequest, emptyMap)).toThrow(/digit run/);
  });

  it("leaves money and dates alone", () => {
    const f = { ...clean, response: { text: "On 2026-01-31 you held $1,284,500.42 (12345678)." } };
    expect(() => assertRecordable(f, scrubbedRequest, emptyMap)).not.toThrow();
  });

  // The structural half. A real name in the REQUEST means the scrubber missed
  // it, and the model was about to be shown it.
  it("rejects a real name that survived into the outbound request", () => {
    const leaky = { model: "m", prompt: "Top up the Bloggs Family Trust." };
    expect(() => assertRecordable(clean, leaky, trustMap)).toThrow(FixturePiiError);
    expect(() => assertRecordable(clean, leaky, trustMap)).toThrow(
      /request still contains "Bloggs Family Trust"/,
    );
  });

  // Found by the first real recording. "Roth IRA" is a seeded account NAME, so
  // it is in the alias map, but it is also ordinary financial vocabulary. The
  // request correctly carried the alias; the model then said "Roth IRA" about
  // nobody. Rejecting that would reject every honest recording.
  it("allows the model to use vocabulary that happens to be an account name", () => {
    const rothMap: AliasMap = {
      forward: new Map([["Roth IRA", "Account 1"]]),
      reverse: new Map([["Account 1", "Roth IRA"]]),
    };
    const f = { ...clean, response: { text: "Max out a Roth IRA before taxable investing." } };
    expect(() => assertRecordable(f, scrubbedRequest, rothMap)).not.toThrow();
  });

  // Found by the second real recording. A 4-digit account mask is a forward-only
  // strip, and it turns up by chance inside a simulation figure. The scrubber is
  // whole-word, so it is not a hit there, and this guard must agree with it.
  it("agrees with the scrubber that a mask inside a larger number is not a hit", () => {
    const maskMap: AliasMap = { forward: new Map([["3872", ""]]), reverse: new Map() };
    const req = { model: "m", prompt: "The median ending balance is 238725.43." };
    expect(() => assertRecordable(clean, req, maskMap)).not.toThrow();
  });

  it("still catches that same mask standing on its own", () => {
    const maskMap: AliasMap = { forward: new Map([["3872", ""]]), reverse: new Map() };
    const req = { model: "m", prompt: "The account ending 3872 is overdrawn." };
    expect(() => assertRecordable(clean, req, maskMap)).toThrow(/"3872"/);
  });

  it("refuses the write, leaving no file behind", async () => {
    process.env.LLM_FIXTURES = "record";
    const call = {
      ...textCall({ prompt: "Move it into the Bloggs Family Trust.", messages: undefined }),
      aliasMap: trustMap,
    };
    await expect(throughFixtures(call, async () => ({ text: "Done." }))).rejects.toThrow(
      FixturePiiError,
    );
    expect(() => readFileSync(fixturePath("chat", fixtureKey(call)), "utf8")).toThrow();
  });
});

// ── Record, then replay ──────────────────────────────────────────────────────

describe("record then replay", () => {
  const recorded = {
    text: "Account 1 is ahead of plan.",
    toolCalls: [{ toolName: "get_accounts", input: { limit: 5 } }],
    finishReason: "stop",
    usage: { inputTokens: 16204, outputTokens: 893 },
    providerMetadata: { openrouter: { usage: { cost: 0.0784 } } },
  };

  it("writes a readable fixture with the metadata a human needs", async () => {
    const path = await record(textCall(), recorded);
    const file = JSON.parse(readFileSync(path, "utf8")) as FixtureFile;
    expect(file.source).toBe("chat");
    expect(file.model).toBe("~anthropic/claude-sonnet-latest");
    expect(file.promptExcerpt).toContain("financial planning assistant");
    expect(file.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(file.response.text).toBe(recorded.text);
    expect(file.usage).toEqual(recorded.usage);
  });

  it("announces what the call cost, since recording is the mode that spends", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await record(textCall(), recorded);
    expect(log.mock.calls.flat().join(" ")).toMatch(
      /RECORDED \(this call was billed\).*source=chat.*model=~anthropic\/claude-sonnet-latest.*in=16204tok out=893tok cost=\$0\.0784/,
    );
    log.mockRestore();
  });

  it("replays the provider's shape, cost and usage included", async () => {
    await record(textCall(), recorded);
    const run = vi.fn();
    const out = (await throughFixtures(textCall(), run as never)) as typeof recorded;
    expect(run).not.toHaveBeenCalled();
    expect(out.text).toBe(recorded.text);
    expect(out.toolCalls).toEqual(recorded.toolCalls);
    expect(out.finishReason).toBe("stop");
    expect(out.usage).toEqual(recorded.usage);
    expect(out.providerMetadata).toEqual(recorded.providerMetadata);
  });

  it("returns byte-identical output for the same input twice", async () => {
    await record(textCall(), recorded);
    const a = await throughFixtures(textCall(), async () => ({}));
    const b = await throughFixtures(textCall(), async () => ({}));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  // Budget protection: a multi-step agent loop that failed on step 3 must not
  // re-buy steps 1 and 2 when the recording is re-run.
  it("record does not re-bill a prompt it already has", async () => {
    await record(textCall(), recorded);
    process.env.LLM_FIXTURES = "record";
    const run = vi.fn();
    const out = (await throughFixtures(textCall(), run as never)) as typeof recorded;
    expect(run).not.toHaveBeenCalled();
    expect(out.text).toBe(recorded.text);
  });

  // The insights path bills, spends its whole output budget reasoning, and
  // throws. Without capturing that, the single most expensive surface in the
  // app would have no fixture and would re-bill on every local page load.
  describe("a call that failed", () => {
    const boom = () => {
      const e = new Error("No object generated: the model did not return a response.");
      e.name = "AI_NoObjectGeneratedError";
      return e;
    };

    it("is recorded, and replays as the same error", async () => {
      process.env.LLM_FIXTURES = "record";
      const call = textCall({ system: "Fail me.", prompt: "go", messages: undefined });
      await expect(
        throughFixtures(call, async () => {
          throw boom();
        }),
      ).rejects.toThrow("No object generated");

      process.env.LLM_FIXTURES = "replay";
      const run = vi.fn();
      await expect(throughFixtures(call, run as never)).rejects.toMatchObject({
        name: "AI_NoObjectGeneratedError",
        message: "No object generated: the model did not return a response.",
      });
      expect(run).not.toHaveBeenCalled();
    });

    it("says plainly that the billed call returned nothing", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      process.env.LLM_FIXTURES = "record";
      await expect(
        throughFixtures(textCall({ system: "Fail me too.", messages: undefined }), async () => {
          throw boom();
        }),
      ).rejects.toThrow();
      expect(log.mock.calls.flat().join(" ")).toMatch(
        /RECORDED A FAILURE \(this call was billed and returned nothing\)/,
      );
      log.mockRestore();
    });
  });

  it("round-trips a structured-output call", async () => {
    const call: FixtureCall = {
      kind: "object",
      source: "insights",
      request: {
        model: "~anthropic/claude-sonnet-latest",
        prompt: "data",
        schema: z.object({ insights: z.array(z.object({ title: z.string() })) }),
      },
      aliasMap: emptyMap,
    };
    await record(call, { object: { insights: [{ title: "Move cash to the 4.2% account" }] } });
    const out = (await throughFixtures(call, async () => ({}))) as {
      object: { insights: { title: string }[] };
    };
    expect(out.object.insights[0]?.title).toBe("Move cash to the 4.2% account");
  });
});

// ── Through the real boundary ────────────────────────────────────────────────

/**
 * The layer is only worth anything if it works where it is actually installed.
 * These drive lib/llm.ts itself, with the network physically unavailable.
 */
describe("through lib/llm.ts", () => {
  const map: AliasMap = {
    forward: new Map([["Joe's Rainy Day Fund", "Account 1"]]),
    reverse: new Map([["Account 1", "Joe's Rainy Day Fund"]]),
  };

  /** Any outbound request at all fails the test, rather than costing money. */
  function severNetwork(): () => void {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("NETWORK: a replayed call tried to reach the provider");
    }) as typeof fetch;
    return () => {
      globalThis.fetch = realFetch;
    };
  }

  it("serves a recorded text call with no network and no provider call", async () => {
    const call = textCall({ system: "You advise on Account 1.", prompt: "How is it doing?" });
    call.request.messages = undefined;
    await record(call, {
      text: "Account 1 is ahead of plan.",
      finishReason: "stop",
      usage: { inputTokens: 100, outputTokens: 20 },
      providerMetadata: { openrouter: { usage: { cost: 0.0042 } } },
    });

    const restore = severNetwork();
    try {
      const result = await llmGenerateText(
        { tenantId: "t1", source: "chat", aliasMap: map },
        {
          model: { modelId: "~anthropic/claude-sonnet-latest" } as never,
          system: "You advise on Joe's Rainy Day Fund.",
          prompt: "How is it doing?",
          maxOutputTokens: 8192,
        },
      );
      expect(generateText).not.toHaveBeenCalled();
      // Descrubbing still runs on the way back: the fixture stores the alias,
      // the caller gets the real name. Skipping the network skips only the
      // network.
      expect(result.text).toBe("Joe's Rainy Day Fund is ahead of plan.");
      // And the provider's reported cost survives, so accounting is real.
      expect(result.costUsd).toBe(0.0042);
      expect(result.usage?.inputTokens).toBe(100);
    } finally {
      restore();
    }
  });

  it("serves a recorded structured call with no network", async () => {
    const schema = z.object({ line: z.string() });
    const call: FixtureCall = {
      kind: "object",
      source: "insights",
      request: {
        model: { modelId: "~anthropic/claude-sonnet-latest" },
        system: "Write one line.",
        prompt: "About Account 1.",
        schema,
      },
      aliasMap: emptyMap,
    };
    await record(call, {
      object: { line: "Account 1 is ahead of plan." },
      usage: { inputTokens: 90, outputTokens: 12 },
      providerMetadata: { openrouter: { usage: { cost: 0.0011 } } },
    });

    const restore = severNetwork();
    try {
      const result = await llmGenerateObject<{ line: string }>(
        { tenantId: "t1", source: "insights", aliasMap: map },
        {
          model: { modelId: "~anthropic/claude-sonnet-latest" } as never,
          schema,
          system: "Write one line.",
          prompt: "About Joe's Rainy Day Fund.",
        },
      );
      expect(generateObject).not.toHaveBeenCalled();
      expect(result.object.line).toBe("Joe's Rainy Day Fund is ahead of plan.");
      expect(result.costUsd).toBe(0.0011);
    } finally {
      restore();
    }
  });

  // Cost visibility is the whole reason this exists, so a replayed call must
  // still land in the activity table exactly as a billed one would — with the
  // real numbers the recording captured, not zeroes. lib/llm.ts meters every
  // call itself, so this asserts the boundary's own row, not a hand-rolled one.
  it("still meters: a replayed call writes its usage row", async () => {
    const call = textCall({ system: "Meter me.", prompt: "go" });
    call.request.messages = undefined;
    await record(call, {
      text: "done",
      finishReason: "stop",
      usage: { inputTokens: 16204, outputTokens: 893 },
      providerMetadata: { openrouter: { usage: { cost: 0.0784 } } },
    });

    const restore = severNetwork();
    try {
      await llmGenerateText(
        { tenantId: "t1", source: "chat", aliasMap: map },
        {
          model: { modelId: "~anthropic/claude-sonnet-latest" } as never,
          system: "Meter me.",
          prompt: "go",
          maxOutputTokens: 8192,
        },
      );
    } finally {
      restore();
    }

    expect(usageRows).toHaveLength(1);
    expect(usageRows[0]).toMatchObject({
      kind: "llm",
      source: "chat",
      model: "~anthropic/claude-sonnet-latest",
      inputTokens: 16204,
      outputTokens: 893,
      costUsd: "0.078400",
    });
  });
});

// ── The committed fixtures themselves ────────────────────────────────────────

/**
 * Every fixture in the repo re-checked against the guard. A file that was edited
 * by hand to "fix" something, or recorded before a guard existed, fails here
 * rather than in a public repo.
 */
describe("the committed fixtures", () => {
  it("all pass the PII guard", () => {
    const rootPath = fileURLToPath(new URL("../../../fixtures/llm/", import.meta.url));
    if (!existsSync(rootPath)) return;
    for (const source of readdirSync(rootPath, { withFileTypes: true })) {
      if (!source.isDirectory()) continue;
      for (const name of readdirSync(join(rootPath, source.name))) {
        if (!name.endsWith(".json")) continue;
        const file = JSON.parse(
          readFileSync(join(rootPath, source.name, name), "utf8"),
        ) as FixtureFile;
        expect(
          () => assertRecordable(file, { model: file.model }, emptyMap),
          `${source.name}/${name}`,
        ).not.toThrow();
        expect(file.model, `${source.name}/${name} must record its model`).toBeTruthy();
        expect(file.recordedAt, `${source.name}/${name} must record when`).toBeTruthy();
      }
    }
  });

  it("is keyed by filename, so an edited or misfiled one cannot hide", () => {
    // Guards the directory layout the miss message points at: <source>/<key>.json
    const rootPath = fileURLToPath(new URL("../../../fixtures/llm/", import.meta.url));
    if (!existsSync(rootPath)) return;
    for (const source of readdirSync(rootPath, { withFileTypes: true })) {
      if (!source.isDirectory()) continue;
      for (const name of readdirSync(join(rootPath, source.name))) {
        if (!name.endsWith(".json")) continue;
        expect(name, `${source.name}/${name}`).toMatch(/^[0-9a-f]{32}\.json$/);
      }
    }
  });
});
