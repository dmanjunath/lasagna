/**
 * PII boundary conformance: no LLM call may see raw user data.
 *
 * Every model call must go through `lib/llm.ts`, which anonymizes the full
 * outbound payload with the tenant alias map and restores real names only on
 * the way back to the user. This test makes that rule STRUCTURAL: the suite
 * fails if any other file imports the model-call functions from "ai", or talks
 * to a provider endpoint directly — so adding an LLM call without anonymization
 * is impossible to do silently.
 *
 * Exceptions are DELIBERATE and documented below. Adding one means editing this
 * file, which puts the decision in front of a reviewer.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

// ── The choke point + documented exceptions ──────────────────────────────────

// Files allowed to import generateText/generateObject/streamText from "ai".
const MODEL_CALL_ALLOWLIST = new Set([
  // The ONLY sanctioned caller: scrubs outbound, descrubs inbound.
  "lib/llm.ts",
  // EXCEPTION: parses text the user PASTED for import (bank statements). The
  // raw text IS the feature input; it cannot be aliased before it is parsed.
  // The user explicitly submits it for processing.
  "routes/quick-import.ts",
]);

// Files allowed to reference a provider endpoint directly.
const PROVIDER_URL_ALLOWLIST = new Set([
  // Model CLIENT construction (base URLs), not payload-carrying calls.
  "agent/agent.ts",
  // EXCEPTION: vision extraction of the user's own uploaded tax document.
  // An image cannot be aliased before it is read; the user explicitly
  // uploads it for extraction.
  "lib/tax-vision-extraction.ts",
  // Base URL construction for the vision providers, not payload-carrying calls.
  "lib/vision/vertex.ts",
]);

const MODEL_CALL_IMPORT_RE =
  /import\s*(?:type\s*)?\{[^}]*\b(generateText|generateObject|streamText)\b[^}]*\}\s*from\s*["']ai["']/;
const PROVIDER_URL_RE =
  /openrouter\.ai|api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis|aiplatform\.googleapis|api\.sailresearch\.com/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "__tests__" || name === "node_modules" || name === "dist") continue;
      walk(p, out);
    } else if (name.endsWith(".ts") && !name.endsWith(".d.ts") && !name.endsWith(".test.ts")) {
      out.push(p);
    }
  }
  return out;
}

describe("LLM boundary — no raw user data reaches a model", () => {
  const files = walk(SRC);

  it("only lib/llm.ts (and documented exceptions) may call model functions", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const rel = relative(SRC, f);
      if (MODEL_CALL_ALLOWLIST.has(rel)) continue;
      if (MODEL_CALL_IMPORT_RE.test(readFileSync(f, "utf8"))) offenders.push(rel);
    }
    expect(
      offenders,
      `These files call the model directly and BYPASS anonymization. Route them through lib/llm.ts (llmGenerateText/llmGenerateObject), or — only for a feature whose input is inherently raw — add a documented exception in llm-boundary.test.ts: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("no direct provider-endpoint calls outside documented exceptions", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const rel = relative(SRC, f);
      if (PROVIDER_URL_ALLOWLIST.has(rel)) continue;
      if (PROVIDER_URL_RE.test(readFileSync(f, "utf8"))) offenders.push(rel);
    }
    expect(
      offenders,
      `These files reference a provider endpoint directly, evading the anonymization boundary: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("the sanctioned caller actually anonymizes", () => {
    const llm = readFileSync(join(SRC, "lib/llm.ts"), "utf8");
    for (const required of ["buildAliasMap", "scrub", "descrub"]) {
      expect(llm, `lib/llm.ts must use ${required}`).toContain(required);
    }
  });
});
