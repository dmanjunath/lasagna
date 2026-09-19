import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The line between what the detector owns and what the model owns.
 *
 * The suggestions are already complete and already correct before the model is
 * consulted, so every failure here has exactly one right answer: keep the
 * template wording. Asserted against the real code, with the model stubbed, so
 * none of it costs a call.
 */

// ── Everything the module reaches for around the model ──────────────────────

const llmGenerateObject = vi.fn();
vi.mock("../llm.js", () => ({
  llmGenerateObject: (...args: unknown[]) => llmGenerateObject(...args),
}));
vi.mock("../../agent/index.js", () => ({ getModel: () => ({}) as never }));
// The real descrub, with an empty map, so the punctuation assertions run
// through the same code the generator does.
vi.mock("../pii-scrubber.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../pii-scrubber.js")>()),
  buildAliasMap: async () => ({ forward: new Map(), reverse: new Map() }),
}));
vi.mock("../db.js", () => ({ db: {} }));
vi.mock("../billing.js", () => ({ isTenantDisabled: async () => false }));
vi.mock("../account-balances.js", () => ({ excludedTxnAccountIds: async () => [] }));

import {
  claimsRecurrence,
  copyForRow,
  polishSpendCutCopy,
  statesUnknownFigure,
} from "../spend-cuts.js";
import type { SpendCutFinding } from "../spend-cut-detector.js";

const TENANT = "00000000-0000-4000-8000-0000000000aa";

/** A real detector finding, template wording and all. */
const FINDING: SpendCutFinding = {
  findingKey: "duplicate:music:one+two",
  kind: "duplicate_service",
  size: "m",
  title: "Cancel Tuneline and keep Songbox",
  description:
    "Two music streaming subscriptions bill every month. Songbox is the cheaper one and the figure here is its price, so dropping either saves at least this much.",
  evidence: "Tuneline at $16.99 and Songbox at $11.50 every month since March 2026.",
  monthlySaving: 11.5,
  annualSaving: null,
  claimKey: "merchant:songbox",
  categoryId: null,
  merchantName: "Songbox",
  txnIds: ["t1", "t2"],
};

/**
 * A finding the model IS allowed to rewrite. Its figure means one thing on its
 * own, which is what separates it from the duplicate pair above: $2.50 is the
 * difference the price rise made, whatever the reader decides to do about it.
 */
const REWRITABLE: SpendCutFinding = {
  findingKey: "price_increase:tuneline",
  kind: "price_increase",
  size: "s",
  title: "Ask Tuneline for the rate you were paying before",
  description:
    "Ask to go back to $16.99 a month. If they will not move, ask what their cheapest plan is and price up leaving while you are on the call.",
  evidence: "Tuneline was $16.99 a month and the charge on Aug 2, 2026 was $19.49.",
  monthlySaving: 2.5,
  annualSaving: null,
  claimKey: "merchant:tuneline",
  categoryId: null,
  merchantName: "Tuneline",
  txnIds: ["t1", "t2"],
};

/** The figure fields of a row, as both paths hand them to the predicate. */
const figuresOf = (f: SpendCutFinding) => ({
  evidence: f.evidence,
  monthlySaving: f.monthlySaving,
  annualSaving: f.annualSaving,
});

describe("statesUnknownFigure", () => {
  it("accepts the template wording, which states only figures the finding has", () => {
    expect(statesUnknownFigure({ description: FINDING.description, ...figuresOf(FINDING) })).toBe(
      false,
    );
  });

  it("accepts a figure the finding's own facts state", () => {
    expect(
      statesUnknownFigure({
        description: "Songbox bills $11.50 every month on top of Tuneline at $16.99.",
        ...figuresOf(FINDING),
      }),
    ).toBe(false);
  });

  it("accepts the row's own saving, however it is spelled", () => {
    // Stored as a numeric string by the driver, written with a comma by the
    // detector, and restated without one by the model. All the same figure.
    expect(
      statesUnknownFigure({
        description: "Holding a month at your usual keeps $1200.00 of it.",
        evidence: "Dining Out was $3,400.00 in August 2026, up 55% on your usual $2,200.00.",
        monthlySaving: "1200.00",
        annualSaving: null,
      }),
    ).toBe(false);
  });

  it("rejects an amount the finding never had", () => {
    expect(
      statesUnknownFigure({
        description: "Dropping Songbox saves you $240.00 over the next year.",
        ...figuresOf(FINDING),
      }),
    ).toBe(true);
  });

  it("rejects a rounded restatement, because it is a different number", () => {
    expect(
      statesUnknownFigure({
        description: "Songbox costs about $12 every month.",
        ...figuresOf(FINDING),
      }),
    ).toBe(true);
  });

  /**
   * The title is the curated remedy, so its figures are the detector's own and
   * asking this question of it would suppress a correct row: the target a
   * category remedy used to name lives in the title and nowhere else.
   */
  it("looks at the description alone, because that is all the model writes", () => {
    expect(
      statesUnknownFigure({
        description: "Two music subscriptions bill every month.",
        ...figuresOf(FINDING),
      }),
    ).toBe(false);
  });
});

/**
 * The period a figure covers, which the figure rule above cannot see. $2,900 IS
 * a one-off fee's own figure, so "save $2,900 a month" states nothing invented
 * and passes every other check, while describing a refund the household gets
 * once as one it gets forever.
 */
describe("claimsRecurrence", () => {
  const ONE_OFF: SpendCutFinding = {
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
    txnIds: ["t1"],
  };

  it("accepts a one-off row that says nothing about a period", () => {
    expect(claimsRecurrence(ONE_OFF.kind, ONE_OFF.description)).toBe(false);
    // And the figure rule has nothing to say about it either, which is the
    // point: these two guards catch different things.
    expect(
      statesUnknownFigure({ description: ONE_OFF.description, ...figuresOf(ONE_OFF) }),
    ).toBe(false);
  });

  it.each([
    "Getting that $2,900.00 back is worth $2,900.00 a month to you.",
    "Ask for it back, and you keep $2,900.00 every month after that.",
    "That is a monthly charge you can stop.",
    "Reversing it saves $2,900.00 a year.",
  ])("rejects a one-off row whose copy says %s", (description) => {
    expect(claimsRecurrence(ONE_OFF.kind, description)).toBe(true);
    // The figure it states is real, so nothing else would have stopped it.
    expect(
      statesUnknownFigure({ description, ...figuresOf(ONE_OFF) }),
    ).toBe(false);
  });

  it("says nothing about a kind that really is monthly", () => {
    expect(claimsRecurrence("fee", "Two of these a month is $70.00 a year.")).toBe(false);
    expect(claimsRecurrence("category_above_trend", "$140.00 every month.")).toBe(false);
  });
});

describe("polishSpendCutCopy", () => {
  beforeEach(() => {
    // Block body on purpose: returning the mock from the hook makes vitest
    // await it, which runs the stub an extra time outside any try block.
    llmGenerateObject.mockReset();
  });

  it("makes no call at all when there is nothing to rewrite", async () => {
    expect((await polishSpendCutCopy(TENANT, [])).size).toBe(0);
    expect(llmGenerateObject).not.toHaveBeenCalled();
  });

  it("takes the rewritten body and keeps the curated title", async () => {
    llmGenerateObject.mockResolvedValue({
      object: {
        rows: [
          {
            id: "f1",
            description:
              "You are paying $19.49 a month where it used to be $16.99; the difference is worth one phone call — ask before you renew.",
          },
        ],
      },
    });

    const map = await polishSpendCutCopy(TENANT, [REWRITABLE]);
    const rewrite = map.get(REWRITABLE.findingKey);
    // The punctuation rule is deterministic, not left to the prompt: the
    // semicolon and the em dash both come back as commas.
    expect(rewrite?.description).toBe(
      "You are paying $19.49 a month where it used to be $16.99, the difference is worth one phone call, ask before you renew.",
    );
    expect(copyForRow(REWRITABLE, rewrite)).toEqual({
      // The remedy, untouched. Only the body has two possible authors.
      title: REWRITABLE.title,
      description: rewrite?.description,
      generatedBy: "ai",
    });
  });

  /**
   * The one kind whose meaning a rewrite can invert while stating only real
   * figures. A live rewrite came back reading "cutting the pricier option and
   * keeping the cheaper one" beside $17.99, which is the price of the one it
   * had just told the reader to keep, and it dropped both merchant names. The
   * figure guard cannot see that, and no deterministic check can, so the row
   * never reaches the model at all.
   */
  it("never asks the model to rewrite a duplicate pair", async () => {
    llmGenerateObject.mockResolvedValue({ object: { rows: [] } });

    const map = await polishSpendCutCopy(TENANT, [FINDING]);
    expect(llmGenerateObject).not.toHaveBeenCalled();
    expect(map.size).toBe(0);
    expect(copyForRow(FINDING, map.get(FINDING.findingKey))).toEqual({
      title: FINDING.title,
      description: FINDING.description,
      generatedBy: "system",
    });
  });

  it("rewrites the rest of the set with the duplicate pair left out of the call", async () => {
    llmGenerateObject.mockResolvedValue({
      object: { rows: [{ id: "f1", description: "Worth a call." }] },
    });

    const map = await polishSpendCutCopy(TENANT, [FINDING, REWRITABLE]);
    // f1 is the price rise, because the duplicate pair was never numbered.
    expect(map.get(REWRITABLE.findingKey)?.description).toBe("Worth a call.");
    expect(map.has(FINDING.findingKey)).toBe(false);
    const [, opts] = llmGenerateObject.mock.calls[0] as [unknown, { prompt: string }];
    expect(opts.prompt).not.toContain("duplicate_service");
  });

  it("throws away a rewrite that turns a one-off refund into a monthly saving", async () => {
    const oneOff: SpendCutFinding = {
      ...REWRITABLE,
      findingKey: "fee_once:bank",
      kind: "one_time_fee",
      title: "Ask your bank to refund the bank fee",
      description: "Ask what the charge was for and whether it can be reversed.",
      evidence: "One bank fee of $2,900.00 on Apr 16, 2026.",
      monthlySaving: 2900,
      claimKey: null,
      merchantName: null,
    };
    llmGenerateObject.mockResolvedValue({
      object: {
        rows: [
          {
            id: "f1",
            // Every figure here is the row's own. Only the period is invented.
            description: "Ask for the $2,900.00 back, and that is $2,900.00 a month you keep.",
          },
        ],
      },
    });

    const map = await polishSpendCutCopy(TENANT, [oneOff]);
    expect(map.size).toBe(0);
    expect(copyForRow(oneOff, map.get(oneOff.findingKey)).generatedBy).toBe("system");
  });

  it("keeps the template wording when the call throws", async () => {
    llmGenerateObject.mockImplementation(async () => {
      throw new Error("502 upstream");
    });

    const map = await polishSpendCutCopy(TENANT, [REWRITABLE]);
    expect(map.size).toBe(0);
    expect(copyForRow(REWRITABLE, map.get(REWRITABLE.findingKey))).toEqual({
      title: REWRITABLE.title,
      description: REWRITABLE.description,
      generatedBy: "system",
    });
  });

  it("keeps the template wording when the response is malformed", async () => {
    // No rows, an unknown id, and a row missing its description: three shapes
    // of the same answer.
    for (const object of [
      {},
      { rows: [{ id: "f9", description: "A description." }] },
      { rows: [{ id: "f1", description: "   " }] },
    ]) {
      llmGenerateObject.mockResolvedValue({ object });
      const map = await polishSpendCutCopy(TENANT, [REWRITABLE]);
      expect(map.size).toBe(0);
      expect(copyForRow(REWRITABLE, map.get(REWRITABLE.findingKey)).generatedBy).toBe("system");
    }
  });

  it("throws away only the row whose rewrite invents a figure", async () => {
    const other: SpendCutFinding = {
      ...REWRITABLE,
      findingKey: "fee:overdraft",
      kind: "fee",
      size: "s",
      title: "Ask your bank to refund the overdraft fees",
      description: "Call and ask.",
      evidence: "2 overdraft fees of $35.00 since June 2026.",
      monthlySaving: 5.83,
    };
    llmGenerateObject.mockResolvedValue({
      object: {
        rows: [
          {
            id: "f1",
            description: "Dropping it saves $240.00 a year, which is more than the rise itself.",
          },
          {
            id: "f2",
            description:
              "Two charges of $35.00 landed since June. A first request is usually granted.",
          },
        ],
      },
    });

    const map = await polishSpendCutCopy(TENANT, [REWRITABLE, other]);
    expect(map.has(REWRITABLE.findingKey)).toBe(false);
    expect(copyForRow(REWRITABLE, map.get(REWRITABLE.findingKey)).generatedBy).toBe("system");
    expect(copyForRow(other, map.get(other.findingKey))).toEqual({
      title: other.title,
      description: "Two charges of $35.00 landed since June. A first request is usually granted.",
      generatedBy: "ai",
    });
  });

  it("hands the model the figures it may state, and no size to change", async () => {
    llmGenerateObject.mockResolvedValue({ object: { rows: [] } });
    await polishSpendCutCopy(TENANT, [REWRITABLE]);

    const [anon, opts] = llmGenerateObject.mock.calls[0] as [
      { source: string; descrubOutput: boolean },
      { prompt: string; schema: { parse: (v: unknown) => unknown } },
    ];
    expect(anon.source).toBe("spend-cuts");
    expect(opts.prompt).toContain('"$16.99"');
    expect(opts.prompt).toContain('"$19.49"');
    // The schema structurally cannot carry a title, a figure or a size back.
    expect(() => opts.schema.parse({ rows: [{ id: "f1", description: "d" }] })).not.toThrow();
    expect(
      opts.schema.parse({
        rows: [{ id: "f1", title: "t", description: "d", monthlySaving: 99, size: "l" }],
      }),
    ).toEqual({ rows: [{ id: "f1", description: "d" }] });
  });
});
