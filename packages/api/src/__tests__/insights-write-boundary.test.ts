/**
 * Write boundary on the actions table: two producers, and no third.
 *
 * The `insights` table now carries two independent workflows, told apart by the
 * `producer` column. Everything that makes that safe is a convention, and a
 * convention nothing enforces is a convention that lasts until the next person
 * needs a row written. This test makes it STRUCTURAL:
 *
 *   - Only the two producer files and the route that owns the lifecycle
 *     endpoints may write to the table at all, so a third writer cannot appear
 *     without its producer value and its delete scope being thought about.
 *   - The figure columns and the dedupe key may only be assigned by the
 *     deterministic producer, which is what keeps a figure out of the reach of
 *     anything that talks to a model.
 *   - `producer` itself may only be assigned by a producer, so no caller can
 *     write a row INTO another workflow's set and have it deleted out from
 *     under them on that workflow's next run.
 *
 * A sibling of llm-boundary.test.ts, and the same shape: exceptions are
 * DELIBERATE and documented below, so adding one means editing this file, which
 * puts the decision in front of a reviewer.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

// ── The writers + documented exceptions ─────────────────────────────────────

// Files allowed to insert, update or delete rows in the actions table.
const TABLE_WRITE_ALLOWLIST = new Set([
  // Producer 1: the daily, model-authored set. Deletes only its own rows.
  "lib/insights-engine.ts",
  // Producer 2: the monthly, deterministic "ways to spend less" set.
  "lib/spend-cuts.ts",
  // The lifecycle endpoints — dismiss, acted, snooze — which are producer
  // agnostic on purpose: an action is completed or put off the same way
  // whichever workflow produced it.
  "routes/insights.ts",
]);

// Files allowed to assign the deterministic figure columns and the dedupe key.
// Exactly one, and that is the point: these values are computed from the
// household's own transactions, and nothing that reaches a model may write one.
const FIGURE_WRITE_ALLOWLIST = new Set(["lib/spend-cuts.ts"]);

// Files allowed to assign `producer`. One per producer, and nothing else.
const PRODUCER_WRITE_ALLOWLIST = new Set(["lib/insights-engine.ts", "lib/spend-cuts.ts"]);

const TABLE_WRITE_RE = /\.(insert|update|delete)\(\s*insights\s*\)/;
const FIGURE_COLUMNS = ["dedupeKey", "monthlyValue", "oneTimeValue", "evidence"];
const PRODUCER_COLUMN = "producer";

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

/**
 * Every argument a write statement is given: the object handed to `.values()`,
 * to `.set()`, and the `set:` of an upsert.
 *
 * Scoped to write statements rather than run over whole files, because these
 * columns are also READ: routes/insights.ts serializes evidence and both figure
 * columns into the payload, and a rule that could not tell a projection from an
 * assignment would either fail on that or have to exempt the whole file.
 */
function writeArguments(src: string): string {
  const out: string[] = [];
  // `.set(` is required to open an object literal immediately, so a Map's
  // `.set(key, value)` is not read as a column assignment.
  for (const m of src.matchAll(/\.values\(|\.set\(\s*\{|\bset:\s*\{/g)) {
    const start = m.index + m[0].length - 1;
    const open = src[start];
    const close = open === "(" ? ")" : "}";
    let depth = 0;
    for (let j = start; j < src.length; j++) {
      if (src[j] === open) depth++;
      else if (src[j] === close && --depth === 0) {
        out.push(src.slice(start, j + 1));
        break;
      }
    }
  }
  return out.join("\n");
}

/** The files that write to the table at all. The first test is what bounds this. */
function tableWriters(): string[] {
  return walk(SRC)
    .map((f) => relative(SRC, f))
    .filter((rel) => TABLE_WRITE_RE.test(readFileSync(join(SRC, rel), "utf8")));
}

function assigners(column: string, allow: Set<string>): string[] {
  return tableWriters().filter(
    (rel) =>
      !allow.has(rel) &&
      new RegExp(`\\b${column}:`).test(writeArguments(readFileSync(join(SRC, rel), "utf8"))),
  );
}

describe("write boundary — the actions table has two producers", () => {
  it("only the two producers and the lifecycle route may write to the table", () => {
    const found = tableWriters().filter((rel) => !TABLE_WRITE_ALLOWLIST.has(rel));
    expect(
      found,
      `These files write to the actions table. A writer has to decide which producer owns its rows and how a producer-scoped delete treats them, so route the write through lib/insights-engine.ts or lib/spend-cuts.ts, or add a documented exception in insights-write-boundary.test.ts: ${found.join(", ")}`,
    ).toEqual([]);
  });

  it.each(FIGURE_COLUMNS)(
    "only the deterministic producer may assign %s",
    (column) => {
      const found = assigners(column, FIGURE_WRITE_ALLOWLIST);
      expect(
        found,
        `These files assign ${column} on a write to the actions table. Every figure column is computed from the household's own transactions in lib/spend-cuts.ts and must not be written anywhere a model's output can reach: ${found.join(", ")}`,
      ).toEqual([]);
    },
  );

  it("only a producer may assign `producer`", () => {
    const found = assigners(PRODUCER_COLUMN, PRODUCER_WRITE_ALLOWLIST);
    expect(
      found,
      `These files assign \`producer\` on a write to the actions table. A row written into another workflow's set is deleted out from under it on that workflow's next run: ${found.join(", ")}`,
    ).toEqual([]);
  });

  it("the lifecycle route writes STATE and nothing else", () => {
    // The complement of the rules above, and the reason the route may write at
    // all: dismiss, acted and snooze stamp a row and touch no content. A
    // content column appearing here would be a second author for a figure.
    const args = writeArguments(readFileSync(join(SRC, "routes/insights.ts"), "utf8"));
    const assigned = [...new Set([...args.matchAll(/\b([a-zA-Z]+):/g)].map((m) => m[1]))].sort();
    expect(assigned).toEqual(["actedOn", "dismissed", "snoozedUntil"]);
  });

  it("each producer actually scopes its own delete", () => {
    const engine = readFileSync(join(SRC, "lib/insights-engine.ts"), "utf8");
    const cuts = readFileSync(join(SRC, "lib/spend-cuts.ts"), "utf8");
    expect(engine).toContain("eq(insights.producer, INSIGHTS_ENGINE_PRODUCER)");
    expect(cuts).toContain("eq(insights.producer, SPEND_CUTS_PRODUCER)");
  });
});
