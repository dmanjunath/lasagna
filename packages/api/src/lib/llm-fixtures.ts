/**
 * Record/replay for model calls, so ordinary local work costs nothing and
 * returns the same answer every time.
 *
 * $44 of provider spend in 48 hours came from local testing, and 92% of it
 * bought a response nobody could use. The fix is not a cheaper model: it is to
 * stop paying for the same prompt twice. Record a call once, replay it forever.
 *
 * THE RULE, which is the entire point:
 *
 *   A fixture is what the real model returned when it was given exactly the
 *   prompt the app sends. Nothing else is a fixture.
 *
 * A hand-written response is unrepresentatively good, because whoever wrote it
 * knew the codebase and knew what the test wanted to see. A test passing
 * against one proves nothing about production. See fixtures/llm/README.md.
 *
 * Three modes, from LLM_FIXTURES:
 *   off     real provider call. The ONLY mode production may run.
 *   record  real provider call, saved as a fixture, and the price announced.
 *   replay  served from the fixture. Never falls through to the network.
 *
 * Interception sits at the PROVIDER boundary inside lib/llm.ts: the request has
 * already been scrubbed and the response has not yet been descrubbed, so a
 * fixture holds aliases ("Account 1") and never a real name. `assertRecordable`
 * makes that a check rather than a promise.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as zod from "zod";
import { env } from "./env.js";
import type { LlmSource } from "./activity.js";
import { scrub, type AliasMap } from "./pii-scrubber.js";

export type FixtureMode = "off" | "record" | "replay";

/** Where a call came from. Names the fixture's directory. */
export type FixtureSource = LlmSource;

/** Text calls and structured-output calls store different response halves. */
export type FixtureKind = "text" | "object";

/**
 * The scrubbed call, as it goes on the wire. Everything here is hashed into the
 * key, because everything here changes what the real model would answer.
 */
export interface FixtureRequest {
  /** The model the caller built. The slug is read off it. */
  model: unknown;
  system?: unknown;
  prompt?: unknown;
  messages?: unknown;
  tools?: unknown;
  toolChoice?: unknown;
  temperature?: unknown;
  maxOutputTokens?: unknown;
  /** Structured-output calls only. */
  schema?: unknown;
}

export interface FixtureCall {
  kind: FixtureKind;
  source: FixtureSource;
  /** ALREADY SCRUBBED. Handed straight to the provider by the caller. */
  request: FixtureRequest;
  /**
   * The tenant's alias map, used to prove the request really is post-scrub.
   * See `assertRecordable`.
   */
  aliasMap: AliasMap;
}

/** What lands on disk. Readable on purpose: a human skims this directory. */
export interface FixtureFile {
  source: FixtureSource;
  kind: FixtureKind;
  model: string;
  recordedAt: string;
  /** First few hundred characters of the scrubbed prompt, for skimming. */
  promptExcerpt: string;
  /** The provider's response, exactly as it came back, before any descrubbing. */
  response: {
    text?: string;
    toolCalls?: unknown;
    finishReason?: unknown;
    object?: unknown;
  };
  usage?: unknown;
  /** Carries the provider's reported cost, so replay exercises cost accounting. */
  providerMetadata?: unknown;
  /**
   * Set when the call FAILED. A provider error is billed like any other call,
   * and on the insights path it is the usual outcome, not the rare one: the
   * model spends the whole output budget reasoning and returns nothing, so
   * generateObject throws. Without capturing that, the most expensive surface
   * in the app would have no fixture and would re-bill on every local page
   * load, which is the exact loop this layer exists to break. Replay re-throws
   * an equivalent error, so the failure branch downstream runs for free.
   */
  error?: { name: string; message: string };
}

// ── Mode ─────────────────────────────────────────────────────────────────────

/**
 * A fixture layer running in production would serve one household's recorded
 * answer to another, so production gets exactly one mode. Throwing beats
 * silently forcing "off": a deployment that asked for fixtures has a config bug
 * worth seeing, and a quiet downgrade is how it would survive to the next one.
 */
function assertNotProduction(mode: FixtureMode): void {
  const appEnv = env.APP_ENV.toLowerCase();
  if (appEnv !== "production" && appEnv !== "prod") return;
  throw new Error(
    `LLM_FIXTURES=${mode} is set in production. The LLM fixture layer is a local development tool: ` +
      `replaying a recorded answer for a real household would hand them another household's advice, ` +
      `and recording would write their data to disk. Unset LLM_FIXTURES (or set it to "off") here.`,
  );
}

export function fixtureMode(): FixtureMode {
  const raw = env.LLM_FIXTURES;
  if (raw !== "record" && raw !== "replay") return "off";
  assertNotProduction(raw);
  return raw;
}

// ── Keying ───────────────────────────────────────────────────────────────────

/** The provider slug, which the fixture tracks: a different model is a miss. */
export function modelSlugOf(model: unknown): string {
  if (typeof model === "string") return model;
  const id = (model as { modelId?: unknown } | null | undefined)?.modelId;
  return typeof id === "string" && id.length > 0 ? id : "unknown-model";
}

/** Key-order-independent JSON, so the same call always hashes the same. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * A zod schema reduced to its JSON Schema shape. The shape is part of what the
 * model is asked to produce, so two different shapes must not share a fixture.
 *
 * A schema that will not convert falls back to its top-level keys, which is
 * weaker: two unconvertible schemas from the same source with the same keys
 * would collide. That is logged rather than swallowed.
 */
export function schemaShape(schema: unknown): unknown {
  if (schema === undefined) return undefined;
  try {
    return zod.toJSONSchema(schema as never);
  } catch (e) {
    console.warn(
      `[llm-fixtures] Could not reduce the output schema to JSON Schema: ${
        e instanceof Error ? e.message : String(e)
      }. Falling back to its top-level keys for the fixture key.`,
    );
    const shape = (schema as { shape?: Record<string, unknown> } | null | undefined)?.shape;
    return shape ? Object.keys(shape).sort() : "unconvertible-schema";
  }
}

/** Tool NAMES only: the full tool schemas are large and reformat on upgrades. */
function toolNames(tools: unknown): string[] | undefined {
  if (!tools || typeof tools !== "object") return undefined;
  return Object.keys(tools as Record<string, unknown>).sort();
}

export function fixtureKey(call: FixtureCall): string {
  const material = {
    v: 1,
    kind: call.kind,
    model: modelSlugOf(call.request.model),
    system: call.request.system,
    prompt: call.request.prompt,
    messages: call.request.messages,
    tools: toolNames(call.request.tools),
    toolChoice: call.request.toolChoice,
    temperature: call.request.temperature,
    maxOutputTokens: call.request.maxOutputTokens,
    schema: call.kind === "object" ? schemaShape(call.request.schema) : undefined,
  };
  return createHash("sha256").update(stableStringify(material)).digest("hex").slice(0, 32);
}

// ── Storage ──────────────────────────────────────────────────────────────────

/** `packages/api/fixtures/llm` from either src/ (tsx) or dist/ (node). */
function fixtureRoot(): string {
  return env.LLM_FIXTURE_DIR || fileURLToPath(new URL("../../fixtures/llm/", import.meta.url));
}

export function fixturePath(source: FixtureSource, key: string): string {
  return join(fixtureRoot(), source, `${key}.json`);
}

/** Repo-relative, so an error message points at something a human can open. */
function displayPath(source: FixtureSource, key: string): string {
  return `packages/api/fixtures/llm/${source}/${key}.json`;
}

// ── The PII guard ────────────────────────────────────────────────────────────

// An address survives scrubbing only if the alias map missed it, and an account
// number never had an alias at all. Both are caught here rather than in review.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// Nine or more digits in a row, not part of a decimal. Money and dates never
// look like this; account and routing numbers do.
const LONG_DIGIT_RUN_RE = /(?<![\d.])\d{9,}(?![\d.])/;

export class FixturePiiError extends Error {}

/** Name what survived, so the message points at the scrubber rule to fix. */
function describeSurvivor(outbound: string, aliasMap: AliasMap): string {
  for (const [real] of aliasMap.forward) {
    if (!real) continue;
    const escaped = real.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const lead = /^\w/.test(real) ? "\\b" : "";
    const trail = /\w$/.test(real) ? "\\b" : "";
    if (new RegExp(lead + escaped + trail).test(outbound)) {
      return `the request still contains "${real}", which the alias map says is a real name.`;
    }
  }
  return "the request still contains something the alias map recognises as real.";
}

/**
 * The reason a fixture may be committed to a public repo at all. Two checks,
 * and they deliberately look at different halves of the call.
 *
 * The REQUEST is checked against the alias map. `scrubOpts` has already run, so
 * a real name surviving here means the scrubber missed it — and if the model
 * never saw a real name, it cannot have put one in its answer. Checking the
 * request is what makes "capture happens post-scrub" structural rather than a
 * promise, and it covers the whole outbound payload rather than the excerpt.
 *
 * The RESPONSE is checked for email addresses and account-number-shaped digit
 * runs, which need no alias map to recognise.
 *
 * The response is deliberately NOT checked against the alias map. An account
 * named "Roth IRA" or "Credit Card" is also ordinary financial vocabulary: the
 * request correctly carries "Account 1", and the model then writes "Roth IRA"
 * on its own, about nobody. Refusing that would reject every honest recording
 * while catching no leak.
 */
export function assertRecordable(
  file: FixtureFile,
  request: FixtureRequest,
  aliasMap: AliasMap,
): void {
  // Only the fields scrubOpts scrubs. `model` and `tools` carry functions and
  // provider internals, not user data, and do not serialize meaningfully.
  const outbound = [request.system, request.prompt, request.messages];
  // Scrubbing is idempotent, so scrubbing an already-scrubbed payload changes
  // nothing. If it DOES change something, the first pass missed it. Asking the
  // scrubber rather than re-implementing its matching is what keeps this honest:
  // it is whole-word, so a mask like "3872" inside 238725.43 is not a hit, and
  // a naive substring check here would reject every honest recording.
  const before = JSON.stringify(outbound);
  if (JSON.stringify(scrub(outbound, aliasMap)) !== before) {
    throw new FixturePiiError(
      `Refusing to record this call: ${describeSurvivor(before, aliasMap)} It should have been replaced ` +
        `before the request left lib/llm.ts, so this is a gap in lib/pii-scrubber.ts. Fix that before ` +
        `recording again — fixtures are committed to a public repo.`,
    );
  }

  const serialized = JSON.stringify(file);
  const email = serialized.match(EMAIL_RE);
  if (email) {
    throw new FixturePiiError(
      `Refusing to write this fixture: it contains what looks like an email address ("${email[0]}"). ` +
        `Fixtures are committed to a public repo and must never carry a real address. ` +
        `Record against a seeded tenant, and check that lib/pii-scrubber.ts strips this field.`,
    );
  }

  const digits = serialized.match(LONG_DIGIT_RUN_RE);
  if (digits) {
    throw new FixturePiiError(
      `Refusing to write this fixture: it contains a ${digits[0].length}-digit run ("${digits[0]}"), ` +
        `which could be an account or routing number. Fixtures are committed to a public repo. ` +
        `Record against a seeded tenant, and check that lib/pii-scrubber.ts strips this field.`,
    );
  }
}

// ── Record / replay ──────────────────────────────────────────────────────────

/** The metadata every fixture carries, success or failure. */
function baseFile(call: FixtureCall): Omit<FixtureFile, "response"> {
  return {
    source: call.source,
    kind: call.kind,
    model: modelSlugOf(call.request.model),
    recordedAt: new Date().toISOString(),
    promptExcerpt: excerpt(call.request),
  };
}

function excerpt(request: FixtureRequest): string {
  const parts = [
    typeof request.system === "string" ? request.system : "",
    typeof request.prompt === "string" ? request.prompt : JSON.stringify(request.messages ?? ""),
  ].filter(Boolean);
  return parts.join("\n---\n").slice(0, 400);
}

function usd(cost: unknown): string {
  return typeof cost === "number" && Number.isFinite(cost)
    ? `$${cost.toFixed(4)}`
    : "cost not reported";
}

/** Recording is the one mode that spends money, so it never does so quietly. */
function announcePrice(file: FixtureFile, path: string): void {
  const usage = file.usage as { inputTokens?: number; outputTokens?: number } | undefined;
  const meta = file.providerMetadata as { openrouter?: { usage?: { cost?: unknown } } } | undefined;
  console.log(
    `[llm-fixtures] RECORDED (this call was billed) source=${file.source} model=${file.model} ` +
      `in=${usage?.inputTokens ?? "?"}tok out=${usage?.outputTokens ?? "?"}tok ` +
      `cost=${usd(meta?.openrouter?.usage?.cost)} -> ${path}`,
  );
}

function replayMiss(call: FixtureCall, key: string): never {
  throw new Error(
    `LLM fixture miss. LLM_FIXTURES=replay never calls the provider, so this call cannot be served.\n` +
      `  source:     ${call.source}\n` +
      `  model:      ${modelSlugOf(call.request.model)}\n` +
      `  key:        ${key}\n` +
      `  looked for: ${displayPath(call.source, key)}\n` +
      `Record it with:\n` +
      `  LLM_FIXTURES=record pnpm -F @lasagna/api record:llm -- --source ${call.source} --tenant <seeded-tenant-id>\n` +
      `A miss on a surface that used to work means the model or the prompt changed, ` +
      `which makes the old recording stale. See packages/api/fixtures/llm/README.md.`,
  );
}

/** Rebuild the provider result shape the fixture stands in for. */
function hydrate(file: FixtureFile): object {
  if (file.error) {
    const e = new Error(file.error.message);
    e.name = file.error.name;
    throw e;
  }
  const shared = { usage: file.usage, providerMetadata: file.providerMetadata };
  return file.kind === "text"
    ? {
        text: file.response.text ?? "",
        toolCalls: file.response.toolCalls ?? [],
        finishReason: file.response.finishReason,
        ...shared,
      }
    : { object: file.response.object, ...shared };
}

/**
 * Wrap the provider call.
 *
 * `run` must be the raw provider call on the ALREADY SCRUBBED request, and its
 * result must not yet be descrubbed. That positioning is what keeps real names
 * out of a fixture, and `assertRecordable` verifies it held.
 *
 * Returns the provider's own result shape in every mode, so cost accounting,
 * usage logging, parsing and the failure branches downstream all still run. The
 * point is to skip the network, not to skip the code.
 */
export async function throughFixtures<R extends object>(
  call: FixtureCall,
  run: () => Promise<R>,
): Promise<R> {
  const mode = fixtureMode();
  if (mode === "off") return run();

  const key = fixtureKey(call);
  const path = fixturePath(call.source, key);

  if (existsSync(path)) {
    // Record mode too: "record" means capture what is missing, not re-buy what
    // is already on disk. Re-running a recording after one call in a multi-step
    // agent loop failed would otherwise pay for every earlier step again.
    // To genuinely re-record, delete the file first.
    if (mode === "record") {
      console.log(`[llm-fixtures] already recorded, not billed again: ${displayPath(call.source, key)}`);
    }
    return hydrate(JSON.parse(readFileSync(path, "utf8")) as FixtureFile) as R;
  }
  if (mode === "replay") replayMiss(call, key);

  let result: R;
  try {
    result = await run();
  } catch (e) {
    // A failed call was billed too, so it is recorded. Delete the file to retry
    // a failure you believe was transient rather than what this prompt does.
    const failure: FixtureFile = {
      ...baseFile(call),
      response: {},
      error: { name: e instanceof Error ? e.name : "Error", message: String(e instanceof Error ? e.message : e) },
    };
    assertRecordable(failure, call.request, call.aliasMap);
    mkdirSync(join(fixtureRoot(), call.source), { recursive: true });
    writeFileSync(path, `${JSON.stringify(failure, null, 2)}\n`, "utf8");
    console.log(
      `[llm-fixtures] RECORDED A FAILURE (this call was billed and returned nothing) ` +
        `source=${failure.source} model=${failure.model} error=${failure.error?.message.slice(0, 120)} ` +
        `-> ${displayPath(call.source, key)}`,
    );
    throw e;
  }

  const file: FixtureFile = {
    ...baseFile(call),
    response:
      call.kind === "text"
        ? {
            text: (result as { text?: string }).text ?? "",
            toolCalls: (result as { toolCalls?: unknown }).toolCalls ?? [],
            finishReason: (result as { finishReason?: unknown }).finishReason,
          }
        : { object: (result as { object?: unknown }).object },
    usage: (result as { usage?: unknown }).usage,
    providerMetadata: (result as { providerMetadata?: unknown }).providerMetadata,
  };

  assertRecordable(file, call.request, call.aliasMap);
  mkdirSync(join(fixtureRoot(), call.source), { recursive: true });
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  announcePrice(file, displayPath(call.source, key));
  return result;
}
