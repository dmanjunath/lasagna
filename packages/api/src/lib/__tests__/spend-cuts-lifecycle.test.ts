import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

/**
 * What a regeneration is allowed to do to a row that already exists.
 *
 * These findings are recomputed every month against the household's real
 * transactions, and the same finding usually comes back. So a regeneration is
 * an UPSERT, and the question that decides whether the feature works is which
 * columns it may touch. Two of the failures this pins are silent:
 *
 *   I1  a SET clause that reached dismissed_at, acted_on_at or snoozed_until
 *       would un-dismiss a finding the person called deliberate, or cancel a
 *       snooze they set this morning, and nothing would say so.
 *   I3  a delete that only spared dismissed rows would remove a SNOOZED one,
 *       then insert it again in the same run: the snooze becomes a dismissal
 *       followed by a resurrection.
 *
 * Asserted against the SQL these statements actually render, not against
 * behaviour, because the behaviour needs a database and the SQL is the thing
 * that would be wrong. The query builder here builds and never executes, so
 * nothing in this file touches a database or a model.
 */

const TENANT = "00000000-0000-4000-8000-0000000000aa";

const WINDOW = {
  start: new Date("2025-09-01T00:00:00Z"),
  end: new Date("2026-09-01T00:00:00Z"),
  months: 12,
};

/** What the (mocked) detector hands the generator. Set per test. */
let findings: SpendCutFinding[] = [];

interface Rendered {
  sql: string;
  params: unknown[];
}
const captured = {
  rows: [] as SpendCutInsightRow[],
  upsert: null as Rendered | null,
  deletes: [] as Rendered[],
};

/**
 * A drizzle instance used purely as a query BUILDER. postgres.js connects on
 * the first query and nothing here ever runs one, so this opens no socket.
 */
let qb: ReturnType<typeof createDb>;

function selectChain() {
  let table: unknown = null;
  let ordered = false;
  const self: Record<string, unknown> = {
    from: (t: unknown) => {
      table = t;
      return self;
    },
    leftJoin: () => self,
    where: () => self,
    orderBy: () => {
      ordered = true;
      return self;
    },
    limit: () => self,
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
      // Three reads, told apart by shape: the account existence check, the
      // spending read (ordered), and the earliest-transaction probe.
      const rows =
        table === accounts ? [{ one: 1 }] : ordered ? [] : [{ earliest: null }];
      return Promise.resolve(rows).then(res, rej);
    },
  };
  return self;
}

function insertChain(table: unknown) {
  return {
    values: (v: unknown) => {
      if (table === insights) captured.rows = v as SpendCutInsightRow[];
      const q = qb.insert(table as never).values(v as never);
      return {
        onConflictDoUpdate: (cfg: never) => {
          const rendered = q.onConflictDoUpdate(cfg).toSQL();
          if (table === insights) captured.upsert = rendered;
          return Promise.resolve();
        },
      };
    },
  };
}

function deleteChain(table: unknown) {
  return {
    where: (w: unknown) => {
      captured.deletes.push(
        qb
          .delete(table as never)
          .where(w as never)
          .toSQL(),
      );
      return Promise.resolve();
    },
  };
}

vi.mock("../db.js", () => ({
  db: {
    select: () => selectChain(),
    insert: (t: unknown) => insertChain(t),
    delete: (t: unknown) => deleteChain(t),
  },
}));
// The detector is stood in for so the findings under test are exactly the ones
// written here. Its own arithmetic is covered in spend-cut-detector.test.ts.
vi.mock("../spend-cut-detector.js", () => ({ detectSpendCuts: () => findings }));
// Nothing in this file may reach a model. `polish` is never passed, so this
// throwing is the assertion that it never does.
vi.mock("../llm.js", () => ({
  llmGenerateObject: async () => {
    throw new Error("this file must not make a model call");
  },
}));
vi.mock("../../agent/index.js", () => ({ getModel: () => ({}) as never }));
vi.mock("../billing.js", () => ({ isTenantDisabled: async () => false }));
vi.mock("../account-balances.js", () => ({ excludedTxnAccountIds: async () => [] }));

import { accounts, createDb, insights } from "@lasagna/core";
import type { SpendCutFinding } from "../spend-cut-detector.js";
import {
  generateSpendCuts,
  insightRowForFinding,
  polishSchema,
  spendCutTotals,
  type PolishedCopy,
  type SpendCutInsightRow,
} from "../spend-cuts.js";

beforeAll(() => {
  qb = createDb("postgres://placeholder@localhost:5432/placeholder");
});

beforeEach(() => {
  findings = [];
  captured.rows = [];
  captured.upsert = null;
  captured.deletes = [];
});

/** One finding per kind, so every branch of the row builder is exercised. */
const BY_KIND: Record<string, SpendCutFinding> = {
  fee: {
    findingKey: "fee:overdraft",
    kind: "fee",
    size: "s",
    title: "Ask your bank to refund the overdraft fees and link a savings account as cover",
    description: "Call and ask. A first request is usually granted.",
    evidence: "2 overdraft fees of $35.00 since June 2026.",
    monthlySaving: 5.83,
    annualSaving: 69.96,
    claimKey: null,
    categoryId: null,
    merchantName: "Bank of Nowhere",
    txnIds: ["t1", "t2"],
  },
  one_time_fee: {
    findingKey: "fee_once:bank",
    kind: "one_time_fee",
    size: "s",
    title: "Ask your bank to refund the bank fee",
    description: "Ask what the charge was for and whether it can be reversed.",
    evidence: "One bank fee of $2,900.00 on Apr 16, 2026.",
    monthlySaving: 2900,
    annualSaving: null,
    claimKey: null,
    categoryId: null,
    merchantName: null,
    txnIds: ["t3"],
  },
  price_increase: {
    findingKey: "price_increase:tuneline",
    kind: "price_increase",
    size: "s",
    title: "Ask Tuneline for the rate you were paying before",
    description: "Ask to go back to $16.99 a month. If they will not move, price up leaving.",
    evidence: "Tuneline was $16.99 a month and the charge on Aug 2, 2026 was $19.49.",
    monthlySaving: 2.5,
    annualSaving: null,
    claimKey: "merchant:tuneline",
    categoryId: null,
    merchantName: "Tuneline",
    txnIds: ["t4", "t5"],
  },
  duplicate_service: {
    findingKey: "duplicate:music:one+two",
    kind: "duplicate_service",
    size: "m",
    title: "Move Tuneline and Songbox onto a single family plan",
    description: "Tuneline and Songbox each sell a family plan that covers several people.",
    evidence: "Tuneline at $16.99 and Songbox at $11.50 every month since March 2026.",
    monthlySaving: 11.5,
    annualSaving: null,
    claimKey: "merchant:songbox",
    categoryId: null,
    merchantName: "Songbox",
    txnIds: ["t6", "t7"],
  },
  category_above_trend: {
    findingKey: "category:11111111-1111-4111-8111-111111111111",
    kind: "category_above_trend",
    size: "l",
    title: "Check what drove Dining Out up",
    description: "The figure beside this row is the gap between that month and your usual.",
    evidence: "Dining Out was $3,400.00 in August 2026, up 55% on your usual $2,200.00.",
    monthlySaving: 1200,
    annualSaving: null,
    claimKey: "category:11111111-1111-4111-8111-111111111111",
    categoryId: "11111111-1111-4111-8111-111111111111",
    categoryName: "Dining Out",
    merchantName: null,
    txnIds: ["t8", "t9", "t10"],
  },
};

const ALL_KINDS = Object.keys(BY_KIND);

/** The columns a rendered UPDATE SET assigns, in the order it assigns them. */
function assignedColumns(rendered: Rendered): string[] {
  const set = rendered.sql.slice(rendered.sql.lastIndexOf("do update set ") + "do update set ".length);
  return [...set.matchAll(/"([a-z_]+)" = /g)].map((m) => m[1]);
}

// ── I1: generation writes content, never state ────────────────────────────

describe("I1 — a regeneration may rewrite content and must not touch state", () => {
  const CONTENT = [
    "category",
    "urgency",
    "effort",
    "title",
    "description",
    "impact",
    "impact_color",
    "chat_prompt",
    "monthly_value",
    "one_time_value",
    "evidence",
    "metadata",
    "generated_by",
    "updated_at",
  ];
  const STATE = [
    "dismissed_at",
    "acted_on_at",
    "snoozed_until",
    "expires_at",
    "created_at",
    "tenant_id",
    "dedupe_key",
    "producer",
  ];

  beforeEach(async () => {
    findings = ALL_KINDS.map((k) => BY_KIND[k]);
    await generateSpendCuts(TENANT);
  });

  it("assigns exactly the content columns, and nothing else", () => {
    expect(captured.upsert).not.toBeNull();
    expect([...assignedColumns(captured.upsert!)].sort()).toEqual([...CONTENT].sort());
  });

  it.each(STATE)("never assigns %s", (column) => {
    expect(assignedColumns(captured.upsert!)).not.toContain(column);
  });

  it("conflicts on the tenant and the dedupe key, over the partial index", () => {
    const sql = captured.upsert!.sql;
    expect(sql).toMatch(/on conflict \("tenant_id","dedupe_key"\)/);
    // Matching the index predicate is what lets Postgres infer a PARTIAL unique
    // index. Without it the statement fails outright.
    expect(sql).toMatch(/where "insights"\."dedupe_key" IS NOT NULL/);
  });
});

// ── I3 / I4: the condition going away is a deletion, a stamp is a tombstone ──

describe("I3 — the delete spares every row the person has touched", () => {
  it("scopes to this producer and spares dismissed, acted-on and snoozed rows", async () => {
    findings = [BY_KIND.fee];
    await generateSpendCuts(TENANT);

    expect(captured.deletes).toHaveLength(1);
    const { sql, params } = captured.deletes[0];
    expect(sql).toContain('"tenant_id" = $');
    // Without this clause the monthly run deletes the insights engine's whole
    // non-dismissed set.
    expect(sql).toContain('"producer" = $');
    expect(params).toContain("spend-cuts");
    expect(sql).toContain('"dismissed_at" IS NULL');
    // The two clauses the earlier version was missing. A snoozed row that gets
    // deleted comes straight back on the same run.
    expect(sql).toContain('"acted_on_at" IS NULL');
    expect(sql).toContain('"snoozed_until" IS NULL');
    // And the keys that still hold are excluded from it.
    expect(sql).toContain('"dedupe_key" not in');
    expect(params).toContain("spend-cut:fee:overdraft");
  });

  it("keeps the same guards when nothing was found at all", async () => {
    findings = [];
    await generateSpendCuts(TENANT);

    expect(captured.deletes).toHaveLength(1);
    const { sql, params } = captured.deletes[0];
    expect(sql).toContain('"producer" = $');
    expect(params).toContain("spend-cuts");
    expect(sql).toContain('"dismissed_at" IS NULL');
    expect(sql).toContain('"acted_on_at" IS NULL');
    expect(sql).toContain('"snoozed_until" IS NULL');
    // No keys hold, so every untouched row goes, and no key list is rendered.
    expect(sql).not.toContain('"dedupe_key" not in');
    // Nothing was inserted either.
    expect(captured.upsert).toBeNull();
  });
});

describe("I4 — expiresAt stays null on a spend-cut row", () => {
  it("writes no expiry, because a finding that stops holding is deleted instead", async () => {
    findings = ALL_KINDS.map((k) => BY_KIND[k]);
    await generateSpendCuts(TENANT);

    expect(captured.rows).toHaveLength(ALL_KINDS.length);
    for (const row of captured.rows) expect(row.expiresAt).toBeNull();
  });
});

// ── The model's write surface ─────────────────────────────────────────────

describe("the model's entire write surface is a description", () => {
  it("has exactly those keys on the rewrite row, so widening it breaks the build", () => {
    // Not a title. The title is the curated remedy, and a remedy that named a
    // price no bank feed contains would be caught by no guard here, so the
    // model is kept away from it by the schema rather than by the prompt.
    const row = polishSchema.shape.rows.element;
    expect(Object.keys(row.shape)).toEqual(["id", "description"]);
  });
});

/**
 * The guarantee, proved rather than argued.
 *
 * Every kind is handed a rewrite that is actively hostile: it states a figure
 * the finding never had, it calls the amount monthly, and it is enormous. The
 * row that comes back must be byte-identical to the one built with no rewrite
 * at all, which is only possible if the model can reach nothing but the two
 * copy fields, and only reaches those when it behaves.
 */
describe("a hostile rewrite changes nothing", () => {
  const HOSTILE: PolishedCopy = {
    description: "Do this and you keep $99,999 a month, every month, forever.",
  };

  it.each(ALL_KINDS)("keeps every derived field on a %s finding", (kind) => {
    const f = BY_KIND[kind];
    const plain = insightRowForFinding(TENANT, f, WINDOW);
    const attacked = insightRowForFinding(TENANT, f, WINDOW, HOSTILE);

    // The figures, and everything derived from the finding rather than written.
    expect(attacked.monthlyValue).toBe(plain.monthlyValue);
    expect(attacked.oneTimeValue).toBe(plain.oneTimeValue);
    expect(attacked.impact).toBe(plain.impact);
    expect(attacked.urgency).toBe(plain.urgency);
    expect(attacked.effort).toBe(plain.effort);
    expect(attacked.dedupeKey).toBe(plain.dedupeKey);
    expect(attacked.evidence).toBe(plain.evidence);
    expect(attacked.metadata).toEqual(plain.metadata);
    expect(attacked.chatPrompt).toBe(plain.chatPrompt);

    // And the copy fell back to the template, recorded as the system's own.
    expect(attacked.title).toBe(f.title);
    expect(attacked.description).toBe(f.description);
    expect(attacked.generatedBy).toBe("system");

    // Nothing at all differs, which is the strongest form of the claim.
    expect(attacked).toEqual(plain);
  });

  it("takes a rewrite that states only the figures the finding has", () => {
    const f = BY_KIND.price_increase;
    const row = insightRowForFinding(TENANT, f, WINDOW, {
      description: "The charge went from $16.99 to $19.49. One call usually gets it back.",
    });
    // The remedy is the detector's, whatever the rewrite says.
    expect(row.title).toBe(f.title);
    expect(row.generatedBy).toBe("ai");
    // The figures and everything else still come from the finding.
    expect(row.monthlyValue).toBe("2.50");
    expect(row.impact).toBe("Saves $3/mo");
  });
});

/**
 * The one kind with no remedy must not read like the four that have one.
 *
 * Both of these are the STORED row rather than a rendering of it, which is the
 * level the bug lived at: the home shortlist printed `impact` straight off the
 * wire and so printed "Saves $367/mo" on a row whose whole offer is to go and
 * look. Fixing only that reader would have left the same sentence in the table
 * for the next one to find.
 */
describe("an awareness row promises nothing", () => {
  const awareness = () => insightRowForFinding(TENANT, BY_KIND.category_above_trend, WINDOW);

  it("labels the category row with the magnitude and never with a saving", () => {
    expect(awareness().impact).toBe("$1,200 above usual");
    expect(awareness().impact).not.toMatch(/sav/i);
  });

  it("stores it in the caution tone, never the colour of money gained", () => {
    // Green is what this column means by money gained. Stored green, a reader
    // of the raw row paints "$1,200 above usual" as a saving, which is the same
    // mistake `impact` made one column over.
    expect(awareness().impactColor).toBe("amber");
    expect(awareness().impactColor).not.toBe("green");
  });

  it("keeps green on every kind that does hand money back", () => {
    for (const kind of ALL_KINDS.filter((k) => k !== "category_above_trend")) {
      expect(insightRowForFinding(TENANT, BY_KIND[kind], WINDOW).impactColor).toBe("green");
    }
  });

  it("still labels the kinds that do hand money back as savings", () => {
    expect(insightRowForFinding(TENANT, BY_KIND.fee, WINDOW).impact).toBe("Saves $6/mo");
    expect(insightRowForFinding(TENANT, BY_KIND.price_increase, WINDOW).impact).toBe("Saves $3/mo");
    expect(insightRowForFinding(TENANT, BY_KIND.duplicate_service, WINDOW).impact).toBe("Saves $12/mo");
    expect(insightRowForFinding(TENANT, BY_KIND.one_time_fee, WINDOW).impact).toBe("$2,900 back once");
  });

  it("rates it as one sitting, because opening the month is all it asks", () => {
    expect(awareness().effort).toBe("quick");
  });

  it("leaves the size letter alone, because the copy rule reads it", () => {
    // POLISH_SYSTEM forbids a rewrite of an "l" suggestion setting a target or
    // saying what the household ought to spend. Moving the letter to match the
    // effort would switch that rule off without a word.
    expect(BY_KIND.category_above_trend.size).toBe("l");
    expect(awareness().metadata.size).toBe("l");
  });

  it("still reads every other kind's effort off its letter", () => {
    expect(insightRowForFinding(TENANT, BY_KIND.fee, WINDOW).effort).toBe("quick");
    expect(insightRowForFinding(TENANT, BY_KIND.price_increase, WINDOW).effort).toBe("quick");
    expect(insightRowForFinding(TENANT, BY_KIND.duplicate_service, WINDOW).effort).toBe("moderate");
  });
});

describe("the figure a row carries is split by period, not flagged", () => {
  it("leaves monthly null on a one-off, so no sum over it can include the amount", () => {
    const row = insightRowForFinding(TENANT, BY_KIND.one_time_fee, WINDOW);
    expect(row.monthlyValue).toBeNull();
    expect(row.oneTimeValue).toBe("2900.00");
    expect(row.impact).toBe("$2,900 back once");
  });

  it("leaves the one-off column null on every recurring kind", () => {
    for (const kind of ALL_KINDS.filter((k) => k !== "one_time_fee")) {
      const row = insightRowForFinding(TENANT, BY_KIND[kind], WINDOW);
      expect(row.oneTimeValue).toBeNull();
      expect(row.monthlyValue).not.toBeNull();
    }
  });

  it("totals the two periods separately", () => {
    const rows = ALL_KINDS.map((k) => insightRowForFinding(TENANT, BY_KIND[k], WINDOW));
    // 5.83 + 2.50 + 11.50 for the monthly kinds that hand money back, and the
    // $2,900 refund kept out of a figure labelled "a month".
    expect(spendCutTotals(rows)).toEqual({ monthly: 19.83, oneTime: 2900 });
  });

  it("leaves the awareness magnitude out of the total, because it is money already spent", () => {
    const paying = ALL_KINDS.filter((k) => k !== "category_above_trend").map((k) =>
      insightRowForFinding(TENANT, BY_KIND[k], WINDOW),
    );
    const all = ALL_KINDS.map((k) => insightRowForFinding(TENANT, BY_KIND[k], WINDOW));
    // The awareness row is on the page and carries a $1,200 figure. Adding it
    // in is what made four "go and look" rows read as savings on offer.
    expect(all.length).toBe(paying.length + 1);
    expect(spendCutTotals(all)).toEqual(spendCutTotals(paying));
    expect(spendCutTotals(all).monthly).not.toBe(1219.83);
  });

  it("has nothing to total where every row is an awareness row", () => {
    const rows = [insightRowForFinding(TENANT, BY_KIND.category_above_trend, WINDOW)];
    expect(spendCutTotals(rows)).toEqual({ monthly: 0, oneTime: 0 });
  });
});
