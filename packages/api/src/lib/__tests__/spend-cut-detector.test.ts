import { describe, it, expect } from "vitest";
import {
  detectCategoryAboveTrend,
  detectDuplicateServices,
  detectFees,
  detectPriceIncreases,
  detectSpendCuts,
  normalizeMerchant,
  REMEDY_TEMPLATES,
  recurringMerchants,
  type AnalysisWindow,
  type DetectorTxn,
  type SpendCutFinding,
} from "../spend-cut-detector.js";

const WINDOW: AnalysisWindow = {
  start: new Date("2025-07-01T00:00:00Z"),
  end: new Date("2026-07-01T00:00:00Z"),
  months: 12,
};

let seq = 0;
function txn(
  over: Omit<Partial<DetectorTxn>, "date"> & { date: string; amount: number },
): DetectorTxn {
  return {
    id: over.id ?? `t${++seq}`,
    name: over.name ?? "Charge",
    merchantName: over.merchantName ?? null,
    amount: over.amount,
    categoryId: over.categoryId ?? null,
    categoryName: over.categoryName ?? null,
    categorySystemKey: over.categorySystemKey ?? null,
    plaidCategoryDetailed: over.plaidCategoryDetailed ?? null,
    date: new Date(over.date),
  };
}

/** N monthly charges 30 days apart, ending on `last`. */
function monthly(merchant: string, amounts: number[], last = "2026-06-10"): DetectorTxn[] {
  const end = new Date(`${last}T00:00:00Z`).getTime();
  return amounts.map((amount, i) =>
    txn({
      merchantName: merchant,
      amount,
      date: new Date(end - (amounts.length - 1 - i) * 30 * 86400000).toISOString(),
    }),
  );
}

/** The same charges, filed under one category. */
function inCategory(rows: DetectorTxn[], categoryId: string, categoryName: string): DetectorTxn[] {
  return rows.map((r) => ({ ...r, categoryId, categoryName }));
}

/**
 * A one-off charge in a category, so a category's month can be given an exact
 * total. The name carries the date, which keeps these out of the recurring
 * detector: three equal charges 30 days apart under one name are a subscription.
 */
function spend(
  categoryId: string,
  categoryName: string,
  amount: number,
  date: string,
): DetectorTxn {
  return txn({ name: `Shop ${date}`, amount, date, categoryId, categoryName });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Exactly the arithmetic GET /api/spend-cuts does over the rows it returns,
 * one-off fees included in the row list and excluded from the monthly figures,
 * because their amount is money back once.
 */
function totals(found: SpendCutFinding[]): { all: number; s: number; m: number; l: number } {
  const t = { all: 0, s: 0, m: 0, l: 0 };
  for (const f of found) {
    if (f.kind === "one_time_fee") continue;
    t.all += f.monthlySaving;
    t[f.size] += f.monthlySaving;
  }
  return { all: round2(t.all), s: round2(t.s), m: round2(t.m), l: round2(t.l) };
}

describe("normalizeMerchant", () => {
  it("lowercases, drops punctuation, collapses whitespace and truncates to 40", () => {
    expect(normalizeMerchant("NETFLIX.COM")).toBe("netflix com");
    expect(normalizeMerchant("  SQ *The   Coffee-Place  ")).toBe("sq the coffee place");
    expect(normalizeMerchant("A".repeat(60))).toHaveLength(40);
  });
});

describe("detectFees", () => {
  it("fires on a fee type seen twice", () => {
    const found = detectFees(
      [
        txn({ name: "OVERDRAFT FEE", amount: 35, date: "2026-01-12" }),
        txn({ name: "OVERDRAFT FEE", amount: 35, date: "2026-03-04" }),
      ],
      WINDOW,
    );
    expect(found).toHaveLength(1);
    expect(found[0].findingKey).toBe("fee:overdraft");
    expect(found[0].kind).toBe("fee");
    expect(found[0].size).toBe("s");
    // The remedy, not the diagnosis, and it is what the row is titled.
    expect(found[0].title).toBe(
      "Ask your bank to refund the overdraft fees and link a savings account as cover",
    );
    // $70 across a 12 month window.
    expect(found[0].monthlySaving).toBe(5.83);
    // The division is written out, in the whole dollars the row prints, because
    // the window length appears nowhere else on a page that has findings and a
    // monthly figure nobody can check is a figure they have to take on trust.
    expect(found[0].evidence).toBe(
      "2 overdraft fees of $35.00 since January 2026. That is about $6 a month across 12 months.",
    );
  });

  it("does not fire on a single small fee", () => {
    const found = detectFees([txn({ name: "ATM FEE", amount: 3, date: "2026-01-12" })], WINDOW);
    expect(found).toEqual([]);
  });

  it("states a single large fee as money back once, not as a monthly saving", () => {
    const found = detectFees([txn({ name: "ATM FEE", amount: 30, date: "2026-01-12" })], WINDOW);
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("one_time_fee");
    expect(found[0].findingKey).toBe("fee_once:atm");
    // The whole amount, NOT $30 over 12 months. Refunding it returns $30 once.
    expect(found[0].monthlySaving).toBe(30);
    // And the date reads the way every other date in the app reads, so the
    // receipt can be matched against the transactions it links to.
    expect(found[0].evidence).toBe("One ATM fee of $30.00 on Jan 12, 2026.");
  });

  it("amortises a single large fee nowhere, however long the window", () => {
    const eightMonths: AnalysisWindow = {
      start: new Date("2025-11-01T00:00:00Z"),
      end: new Date("2026-07-01T00:00:00Z"),
      months: 8,
    };
    const [found] = detectFees(
      [txn({ name: "BANK FEE", categorySystemKey: "bank_fees", amount: 2900, date: "2026-04-16" })],
      eightMonths,
    );
    // The bug this kind exists for: $2,900 / 8 is $362.50, which is a true
    // division of a charge that happened once.
    expect(found.monthlySaving).toBe(2900);
    expect(found.evidence).not.toContain("a month");
  });

  it("recognises a fee by taxonomy key and by Plaid category when no keyword matches", () => {
    const found = detectFees(
      [
        txn({ name: "Acme Bank charge", amount: 20, categorySystemKey: "bank_fees", date: "2026-02-01" }),
        txn({ name: "Acme Bank charge", amount: 20, plaidCategoryDetailed: "BANK_FEES_OTHER", date: "2026-03-01" }),
      ],
      WINDOW,
    );
    expect(found.map((f) => f.findingKey)).toEqual(["fee:bank"]);
  });
});

describe("recurringMerchants", () => {
  it("treats 30 day gaps as recurring", () => {
    const found = recurringMerchants(monthly("Netflix", [17.99, 17.99, 17.99]));
    expect(found).toHaveLength(1);
    expect(found[0].norm).toBe("netflix");
    expect(found[0].median).toBe(17.99);
  });

  it("does not treat 12 day gaps as recurring", () => {
    const rows = [0, 12, 24].map((d) =>
      txn({
        merchantName: "Corner Store",
        amount: 17.99,
        date: new Date(Date.UTC(2026, 0, 1) + d * 86400000).toISOString(),
      }),
    );
    expect(recurringMerchants(rows)).toEqual([]);
  });

  it("rejects amounts that swing more than 25% from the median", () => {
    expect(recurringMerchants(monthly("Corner Store", [10, 10, 40]))).toEqual([]);
  });

  it("needs three charges", () => {
    expect(recurringMerchants(monthly("Netflix", [17.99, 17.99]))).toEqual([]);
  });
});

describe("detectPriceIncreases", () => {
  it("fires when the latest charge clears both the $2 and the 8% floor", () => {
    const found = detectPriceIncreases(recurringMerchants(monthly("Netflix", [15.49, 15.49, 17.99])));
    expect(found).toHaveLength(1);
    expect(found[0].findingKey).toBe("price_increase:netflix");
    expect(found[0].size).toBe("s");
    expect(found[0].monthlySaving).toBe(2.5);
    expect(found[0].claimKey).toBe("merchant:netflix");
    // Netflix sets one price. There is no desk to ring and no rate to restore,
    // so the row asks for the only thing the reader actually controls.
    expect(found[0].title).toBe("Decide whether Netflix is still worth $17.99 a month");
    expect(found[0].description).toBe(
      "The charge stays at $17.99 until you change plan or cancel, and neither of those needs anyone's agreement. So the real question is whether it is worth that now, not whether it was worth $15.49.",
    );
  });

  it("asks for the old rate only where a retention desk genuinely exists", () => {
    const [found] = detectPriceIncreases(recurringMerchants(monthly("Verizon", [90.0, 90.0, 110.0])));
    expect(found.title).toBe("Ask Verizon for the rate you were paying before");
    const [gym] = detectPriceIncreases(recurringMerchants(monthly("Planet Fitness", [24.99, 24.99, 29.99])));
    expect(gym.title).toBe("Ask Planet Fitness for the rate you were paying before");
  });

  it("keeps the negotiate and annual wording for a merchant that does both", () => {
    const [found] = detectPriceIncreases(
      recurringMerchants(monthly("The New York Times", [17.0, 17.0, 21.0])),
    );
    expect(found.title).toBe("Ask The New York Times for your old rate, or switch to annual billing");
  });

  it("offers annual billing only where the merchant genuinely sells it", () => {
    const [found] = detectPriceIncreases(recurringMerchants(monthly("Dropbox", [11.99, 11.99, 14.49])));
    // Dropbox bills yearly and negotiates nothing, so the remedy is the one
    // move the reader can make alone.
    expect(found.title).toBe("Switch Dropbox to annual billing");
    // Named, never priced: what yearly costs at Dropbox is Dropbox's number.
    expect(found.description).toBe(
      "Dropbox bills yearly as well as monthly, so price the annual plan up before you pay $14.49 again. If it comes out no cheaper, the question is whether it is still worth that.",
    );
  });

  /**
   * Spotify is the case that broke this. It is a fixed-price consumer
   * subscription with no retention desk, so "ask for your old rate" is advice
   * that cannot work. It DOES sell Duo and Family, which is real and needs
   * nobody at Spotify to agree, so that is what the row says instead.
   */
  it("sends a fixed-price subscription to the plan it really sells", () => {
    const [found] = detectPriceIncreases(recurringMerchants(monthly("Spotify", [11.99, 11.99, 14.49])));
    expect(found.title).toBe("Move Spotify onto a family plan");
    expect(found.description).toContain("covers several people on one bill");
  });

  it("stays quiet for a rise under $2", () => {
    const found = detectPriceIncreases(recurringMerchants(monthly("Spotify", [10.99, 10.99, 12.49])));
    expect(found).toEqual([]);
  });

  /**
   * "AT&T" normalizes to "at t", which is a substring of "flat tire". A list
   * matched with a plain `includes` would tell somebody to ring their tire shop
   * for a better rate.
   */
  it("matches a negotiable merchant on whole words, never on a substring", () => {
    const [att] = detectPriceIncreases(recurringMerchants(monthly("AT&T", [80.0, 80.0, 95.0])));
    expect(att.title).toBe("Ask AT&T for the rate you were paying before");
    const [tires] = detectPriceIncreases(
      recurringMerchants(monthly("Flat Tire Repair", [40.0, 40.0, 48.0])),
    );
    expect(tires.title).toBe("Decide whether Flat Tire Repair is still worth $48.00 a month");
    // "at t" is also a whole-word run inside a raw descriptor, so that entry is
    // anchored to the start of the name.
    const [maxx] = detectPriceIncreases(
      recurringMerchants(monthly("PAYMENT AT T J MAXX", [40.0, 40.0, 48.0])),
    );
    expect(maxx.title).toBe("Decide whether PAYMENT AT T J MAXX is still worth $48.00 a month");
    const [wireless] = detectPriceIncreases(
      recurringMerchants(monthly("AT&T Wireless", [80.0, 80.0, 95.0])),
    );
    expect(wireless.title).toBe("Ask AT&T Wireless for the rate you were paying before");
  });
});

describe("detectDuplicateServices", () => {
  it("claims the cheaper of the pair", () => {
    const found = detectDuplicateServices(
      recurringMerchants([...monthly("Netflix", [22.99, 22.99, 22.99]), ...monthly("Hulu", [17.99, 17.99, 17.99])]),
    );
    expect(found).toHaveLength(1);
    expect(found[0].size).toBe("m");
    expect(found[0].monthlySaving).toBe(17.99);
    expect(found[0].merchantName).toBe("Hulu");
    // No bundle and no family plan between these two, so the generic move.
    expect(found[0].title).toBe("Cancel Netflix and keep Hulu");
    expect(found[0].evidence).toBe(
      "Netflix at $22.99 and Hulu at $17.99 every month since April 2026.",
    );
  });

  it("builds the same finding key whichever order the merchants arrive in", () => {
    const netflix = monthly("Netflix", [22.99, 22.99, 22.99]);
    const hulu = monthly("Hulu", [17.99, 17.99, 17.99]);
    const forwards = detectDuplicateServices(recurringMerchants([...netflix, ...hulu]));
    const backwards = detectDuplicateServices(recurringMerchants([...hulu, ...netflix]));
    expect(forwards[0].findingKey).toBe("duplicate:streaming_video:hulu+netflix");
    expect(backwards[0].findingKey).toBe(forwards[0].findingKey);
  });

  it("ignores a lone service in a family", () => {
    expect(detectDuplicateServices(recurringMerchants(monthly("Netflix", [22.99, 22.99, 22.99])))).toEqual([]);
  });

  it("names the bundle when the pair is genuinely sold as one", () => {
    const [found] = detectDuplicateServices(
      recurringMerchants([
        ...monthly("Hulu", [17.99, 17.99, 17.99]),
        ...monthly("Disney Plus", [10.99, 10.99, 10.99]),
      ]),
    );
    expect(found.title).toBe("Move Hulu and Disney Plus onto the Disney Bundle");
    // The bundle is NAMED and never priced: what it costs is Disney's number.
    expect(found.description).toBe(
      "Hulu and Disney Plus are sold together as the Disney Bundle, so one plan can cover both. The figure here is what Disney Plus costs on its own today.",
    );
  });

  it("sends a pair that both sell a family plan to one plan", () => {
    const [found] = detectDuplicateServices(
      recurringMerchants([
        ...monthly("Spotify", [16.99, 16.99, 16.99]),
        ...monthly("Apple Music", [10.99, 10.99, 10.99]),
      ]),
    );
    expect(found.title).toBe("Move Spotify and Apple Music onto a single family plan");
  });

  /**
   * Backblaze is priced per computer and sells no family plan, so a rule keyed
   * on the FAMILY would put a remedy on this pair that is simply not true of
   * one of them. Keyed on the merchant, it falls back to the generic move.
   */
  it("falls back to the generic move when one of the pair has no family plan", () => {
    const [found] = detectDuplicateServices(
      recurringMerchants([
        ...monthly("Dropbox", [11.99, 11.99, 11.99]),
        ...monthly("Backblaze", [9.0, 9.0, 9.0]),
      ]),
    );
    expect(found.title).toBe("Cancel Dropbox and keep Backblaze");
  });
});

describe("detectCategoryAboveTrend", () => {
  // Baseline months are March, April and May 2026; the last complete month in
  // WINDOW is June 2026.
  const baseline = (categoryId: string, name: string, amount: number) => [
    spend(categoryId, name, amount, "2026-03-12"),
    spend(categoryId, name, amount, "2026-04-11"),
    spend(categoryId, name, amount, "2026-05-11"),
  ];

  it("compares last month against the median of the three before, not the mean", () => {
    const rows = [
      spend("ent", "Entertainment", 100, "2026-03-12"),
      spend("ent", "Entertainment", 100, "2026-04-11"),
      // One holiday. A mean baseline would be $200 and this month would read as
      // a saving already made.
      spend("ent", "Entertainment", 400, "2026-05-11"),
      spend("ent", "Entertainment", 60, "2026-06-03"),
      spend("ent", "Entertainment", 50, "2026-06-10"),
      spend("ent", "Entertainment", 50, "2026-06-18"),
    ];
    const found = detectCategoryAboveTrend(rows, WINDOW);
    expect(found).toHaveLength(1);
    expect(found[0].size).toBe("l");
    expect(found[0].findingKey).toBe("category:ent");
    expect(found[0].claimKey).toBe("category:ent");
    expect(found[0].monthlySaving).toBe(60);
    expect(found[0].evidence).toBe(
      "Entertainment was $160.00 in June 2026, up 60% on your usual $100.00.",
    );
  });

  it("names the real month, never the one still running", () => {
    const rows = [
      ...baseline("dine", "Dining Out", 280),
      spend("dine", "Dining Out", 200, "2026-06-04"),
      spend("dine", "Dining Out", 120, "2026-06-12"),
      spend("dine", "Dining Out", 100, "2026-06-20"),
      // July is the month still running in WINDOW, and none of it counts.
      spend("dine", "Dining Out", 900, "2026-07-02"),
    ];
    const [found] = detectCategoryAboveTrend(rows, WINDOW);
    expect(found.monthlySaving).toBe(140);
    expect(found.evidence).toContain("in June 2026");
    expect(found.evidence).not.toContain("July");
  });

  /**
   * The percentage rule, which cuts two ways on purpose.
   *
   * PRESCRIPTIVE percentages stay banned: nothing here tells a household to cut
   * groceries by a fifth, because no bank feed says what they ought to spend.
   * A DESCRIPTIVE one is the opposite. "up 50% on your usual $280.00" is both
   * dollar figures and the arithmetic between them, all of it theirs, and it is
   * the plainest way to say how big the change was.
   */
  it("states how much bigger the month was, from their own two figures", () => {
    const rows = [
      ...baseline("dine", "Dining Out", 280),
      spend("dine", "Dining Out", 200, "2026-06-04"),
      spend("dine", "Dining Out", 120, "2026-06-12"),
      spend("dine", "Dining Out", 100, "2026-06-20"),
    ];
    const [found] = detectCategoryAboveTrend(rows, WINDOW);
    expect(found.title).toBe("Check what drove Dining Out up");
    expect(found.evidence).toBe("Dining Out was $420.00 in June 2026, up 50% on your usual $280.00.");
  });

  it("reads a clean multiple as a multiple, which is plainer than a percentage", () => {
    const rows = [
      ...baseline("dine", "Dining Out", 100),
      spend("dine", "Dining Out", 200, "2026-06-04"),
      spend("dine", "Dining Out", 120, "2026-06-12"),
      spend("dine", "Dining Out", 100, "2026-06-20"),
    ];
    const [found] = detectCategoryAboveTrend(rows, WINDOW);
    expect(found.evidence).toBe(
      "Dining Out was $420.00 in June 2026, more than four times your usual $100.00.",
    );
  });

  /**
   * The bar, stated: half again on their own usual. A month that is merely
   * above every one of the three before it is still a normal month with a
   * dentist in it, and a page of those reads as nagging.
   */
  it("stays quiet on a month up 40% on the usual, above every baseline or not", () => {
    const rows = [
      spend("dine", "Dining Out", 100, "2026-03-12"),
      spend("dine", "Dining Out", 200, "2026-04-11"),
      spend("dine", "Dining Out", 250, "2026-05-11"),
      spend("dine", "Dining Out", 100, "2026-06-04"),
      spend("dine", "Dining Out", 90, "2026-06-12"),
      spend("dine", "Dining Out", 90, "2026-06-20"),
    ];
    // $280 against a $200 usual is 40% up, and it is above all three months.
    expect(detectCategoryAboveTrend(rows, WINDOW)).toEqual([]);
  });

  it("fires on a month up 60% on the usual", () => {
    const rows = [
      ...baseline("dine", "Dining Out", 200),
      spend("dine", "Dining Out", 120, "2026-06-04"),
      spend("dine", "Dining Out", 100, "2026-06-12"),
      spend("dine", "Dining Out", 100, "2026-06-20"),
    ];
    const [found] = detectCategoryAboveTrend(rows, WINDOW);
    expect(found.monthlySaving).toBe(120);
    expect(found.evidence).toBe("Dining Out was $320.00 in June 2026, up 60% on your usual $200.00.");
  });

  it("holds an absolute floor under the ratio, so $10 becoming $16 says nothing", () => {
    const rows = [
      ...baseline("dine", "Dining Out", 10),
      spend("dine", "Dining Out", 6, "2026-06-04"),
      spend("dine", "Dining Out", 5, "2026-06-12"),
      spend("dine", "Dining Out", 5, "2026-06-20"),
    ];
    expect(detectCategoryAboveTrend(rows, WINDOW)).toEqual([]);
  });

  /**
   * The whole point of the kind after the correction: it says a month ran high
   * and it stops there. Nobody here knows what a household ought to spend on
   * groceries, so no ceiling, no budget and no "should" appears in any string
   * it writes.
   */
  it("prescribes nothing: no target, no ceiling and no should", () => {
    const rows = [
      ...baseline("dine", "Dining Out", 280),
      spend("dine", "Dining Out", 200, "2026-06-04"),
      spend("dine", "Dining Out", 120, "2026-06-12"),
      spend("dine", "Dining Out", 100, "2026-06-20"),
    ];
    const [found] = detectCategoryAboveTrend(rows, WINDOW);
    for (const copy of [found.title, found.description]) {
      expect(copy).not.toMatch(/\btarget\b|\bshould\b|\bbudget\b|\bcap\b|\blimit\b|\bought\b/i);
      // Not a dollar figure either: the row's figures live in the receipt.
      expect(copy).not.toContain("$");
    }
    expect(found.evidence).not.toMatch(/\btarget\b|\bshould\b|\bbudget\b|\bcap\b|\blimit\b/i);
  });

  it("does not fire on two transactions, however large", () => {
    const rows = [
      ...baseline("dine", "Dining Out", 100),
      spend("dine", "Dining Out", 200, "2026-06-04"),
      spend("dine", "Dining Out", 200, "2026-06-20"),
    ];
    expect(detectCategoryAboveTrend(rows, WINDOW)).toEqual([]);
  });

  it("does not fire on a category with no months behind it", () => {
    const rows = [
      spend("dine", "Dining Out", 200, "2026-06-04"),
      spend("dine", "Dining Out", 200, "2026-06-12"),
      spend("dine", "Dining Out", 200, "2026-06-20"),
    ];
    expect(detectCategoryAboveTrend(rows, WINDOW)).toEqual([]);
  });

  it("does not fire when the month is barely above the usual", () => {
    const rows = [
      ...baseline("dine", "Dining Out", 1000),
      spend("dine", "Dining Out", 400, "2026-06-04"),
      spend("dine", "Dining Out", 400, "2026-06-12"),
      spend("dine", "Dining Out", 300, "2026-06-20"),
    ];
    expect(detectCategoryAboveTrend(rows, WINDOW)).toEqual([]);
  });

  // The whole never-suggest list, on spending shaped exactly like the case two
  // tests above that DOES fire, so the only thing separating them is the key.
  // home_improvement is on it because this band claims a changed habit, and a
  // renovation is a project that ends.
  it.each([
    ["housing", "Housing"],
    ["debt_payment", "Debt Payment"],
    ["taxes", "Taxes"],
    ["savings_investment", "Savings and Investments"],
    ["insurance", "Insurance"],
    ["healthcare", "Healthcare"],
    ["home_improvement", "Home Improvement"],
  ])("never tells anyone to spend less on %s", (systemKey, name) => {
    const rows = [
      ...baseline("cat", name, 100),
      spend("cat", name, 200, "2026-06-04"),
      spend("cat", name, 200, "2026-06-12"),
      spend("cat", name, 200, "2026-06-20"),
    ].map((r) => ({ ...r, categorySystemKey: systemKey }));
    expect(detectCategoryAboveTrend(rows, WINDOW)).toEqual([]);
  });

  /**
   * Three complete months is two of baseline and one to read, and the median of
   * two months is not a usual. Four is the floor, so a household three months
   * in gets no category suggestions at all rather than a confident one.
   */
  it.each([2, 3])("says nothing at all on %i complete months", (months) => {
    const rows = [
      ...baseline("dine", "Dining Out", 100),
      spend("dine", "Dining Out", 200, "2026-06-04"),
      spend("dine", "Dining Out", 200, "2026-06-12"),
      spend("dine", "Dining Out", 200, "2026-06-20"),
    ];
    const short: AnalysisWindow = {
      start: new Date(Date.UTC(2026, 6 - months, 1)),
      end: new Date("2026-07-01T00:00:00Z"),
      months,
    };
    expect(detectCategoryAboveTrend(rows, short)).toEqual([]);
  });

  it("still fires on four complete months, which is three of baseline and one to read", () => {
    const rows = [
      ...baseline("dine", "Dining Out", 100),
      spend("dine", "Dining Out", 100, "2026-06-04"),
      spend("dine", "Dining Out", 50, "2026-06-12"),
      spend("dine", "Dining Out", 50, "2026-06-20"),
    ];
    const fourMonths: AnalysisWindow = {
      start: new Date("2026-03-01T00:00:00Z"),
      end: new Date("2026-07-01T00:00:00Z"),
      months: 4,
    };
    expect(detectCategoryAboveTrend(rows, fourMonths)).toHaveLength(1);
  });
});

describe("detectSpendCuts", () => {
  it("never claims the same merchant's money twice", () => {
    // Hulu is both the cheaper half of the duplicate pair and mid price rise.
    const txns = [
      ...monthly("Netflix", [22.99, 22.99, 22.99]),
      ...monthly("Hulu", [14.99, 14.99, 17.99]),
    ];
    const found = detectSpendCuts(txns, WINDOW);
    expect(found.map((f) => f.kind)).toEqual(["duplicate_service"]);
    // The steady monthly amount, not the raised one: the median is what the
    // person actually stops paying if Hulu goes.
    expect(found[0].monthlySaving).toBe(14.99);
  });

  it("lets a category claim only the dollars no merchant finding claims", () => {
    // Entertainment ran $180 in June against a $100 median, so $80 above trend.
    // $15 of that is the duplicate music subscription, which is the specific
    // finding and keeps its whole figure.
    const rows = [
      ...inCategory(monthly("Spotify", [15, 15, 15, 15]), "ent", "Entertainment"),
      ...inCategory(monthly("Tidal", [20, 20, 20, 20]), "ent", "Entertainment"),
      spend("ent", "Entertainment", 65, "2026-03-20"),
      spend("ent", "Entertainment", 65, "2026-04-20"),
      spend("ent", "Entertainment", 65, "2026-05-20"),
      spend("ent", "Entertainment", 80, "2026-06-05"),
      spend("ent", "Entertainment", 65, "2026-06-20"),
    ];
    const found = detectSpendCuts(rows, WINDOW);
    const byKind = new Map(found.map((f) => [f.kind, f]));
    expect([...byKind.keys()].sort()).toEqual(["category_above_trend", "duplicate_service"]);
    expect(byKind.get("duplicate_service")!.monthlySaving).toBe(15);
    expect(byKind.get("category_above_trend")!.monthlySaving).toBe(65);
    // $80, not $95. The $15 is promised once.
    expect(totals(found).all).toBe(80);
    // And the receipt says so, or it would no longer add up to the figure.
    expect(byKind.get("category_above_trend")!.evidence).toContain(
      "$15.00 of that gap is claimed by another suggestion here, so this row counts the remaining $65.00.",
    );
  });

  it("drops a category finding whose remainder is below the floor", () => {
    // $50 above trend, $38 of it already claimed by the duplicate pair, so $12
    // is left. A row that says "cut $12 out of entertainment" is not advice.
    const rows = [
      ...inCategory(monthly("Spotify", [38, 38, 38, 38]), "ent", "Entertainment"),
      ...inCategory(monthly("Tidal", [45, 45, 45, 45]), "ent", "Entertainment"),
      spend("ent", "Entertainment", 17, "2026-03-20"),
      spend("ent", "Entertainment", 17, "2026-04-20"),
      spend("ent", "Entertainment", 17, "2026-05-20"),
      spend("ent", "Entertainment", 67, "2026-06-20"),
    ];
    const found = detectSpendCuts(rows, WINDOW);
    expect(found.map((f) => f.kind)).toEqual(["duplicate_service"]);
    expect(totals(found).all).toBe(38);
  });

  it("keeps the total equal to its bands with all four kinds live", () => {
    const rows = [
      // Two video subscriptions in entertainment: Hulu is the cheaper half, so
      // its $17.99 is the claim inside the category above trend.
      ...inCategory(monthly("Netflix", [22.99, 22.99, 22.99, 22.99]), "ent", "Entertainment"),
      ...inCategory(monthly("Hulu", [17.99, 17.99, 17.99, 17.99]), "ent", "Entertainment"),
      // A price rise, in a different category and so claiming nothing here.
      ...inCategory(monthly("Acme Internet", [50, 50, 50, 60]), "bills", "Internet & Phone"),
      txn({ name: "OVERDRAFT FEE", amount: 35, date: "2026-01-12", categoryId: "fees", categoryName: "Bank Fees" }),
      txn({ name: "OVERDRAFT FEE", amount: 35, date: "2026-03-04", categoryId: "fees", categoryName: "Bank Fees" }),
      spend("ent", "Entertainment", 100, "2026-03-20"),
      spend("ent", "Entertainment", 100, "2026-04-20"),
      spend("ent", "Entertainment", 100, "2026-05-20"),
      spend("ent", "Entertainment", 200, "2026-06-20"),
    ];
    const found = detectSpendCuts(rows, WINDOW);
    expect([...new Set(found.map((f) => f.kind))].sort()).toEqual([
      "category_above_trend",
      "duplicate_service",
      "fee",
      "price_increase",
    ]);

    const t = totals(found);
    // $70 of fees over 12 months plus a $10 price rise, the $17.99 duplicate,
    // and $100 above trend less that same $17.99.
    expect(t).toEqual({ all: 115.83, s: 15.83, m: 17.99, l: 82.01 });
    expect(t.all).toBe(round2(t.s + t.m + t.l));

    // And it still holds after a dismissal, which takes a row's OWN amount off
    // the headline and off its band, and reflows nothing else.
    for (const gone of found) {
      const after = totals(found.filter((f) => f !== gone));
      expect(after.all).toBe(round2(after.s + after.m + after.l));
    }
  });

  it("keeps a one-off fee out of the monthly total and a repeated one in it", () => {
    // Eight complete months, which is what turned one $2,900 charge into
    // "$363 a month" and overstated the headline by 23%.
    const eightMonths: AnalysisWindow = {
      start: new Date("2025-11-01T00:00:00Z"),
      end: new Date("2026-07-01T00:00:00Z"),
      months: 8,
    };
    const rows = [
      txn({ name: "FID BKG SVC LLC", categorySystemKey: "bank_fees", amount: 2900, date: "2026-04-16" }),
      txn({ name: "OVERDRAFT FEE", amount: 35, date: "2026-01-12" }),
      txn({ name: "OVERDRAFT FEE", amount: 35, date: "2026-03-04" }),
      txn({ name: "OVERDRAFT FEE", amount: 35, date: "2026-05-04" }),
    ];
    const found = detectSpendCuts(rows, eightMonths);
    const byKind = new Map(found.map((f) => [f.kind, f]));
    expect([...byKind.keys()].sort()).toEqual(["fee", "one_time_fee"]);

    // Both rows are shown. The $2,900 refund is the most valuable thing this
    // page can tell anyone, so the answer to "it is not monthly" is never to
    // hide it.
    expect(byKind.get("one_time_fee")!.monthlySaving).toBe(2900);
    // $105 over eight months, and it is the ONLY thing in the monthly total.
    expect(byKind.get("fee")!.monthlySaving).toBe(13.13);
    expect(totals(found)).toEqual({ all: 13.13, s: 13.13, m: 0, l: 0 });
  });

  it("drops a finding whose figure would print as $0", () => {
    // Two $1.50 ATM fees over a year is 25 cents a month, which the page rounds
    // to "$0 a month" over a receipt about two real charges.
    const rows = [
      txn({ name: "ATM FEE", amount: 1.5, date: "2026-01-12" }),
      txn({ name: "ATM FEE", amount: 1.5, date: "2026-04-12" }),
    ];
    expect(detectFees(rows, WINDOW)[0].monthlySaving).toBe(0.25);
    expect(detectSpendCuts(rows, WINDOW)).toEqual([]);
  });
});

/**
 * The catalog, checked as a set rather than case by case.
 *
 * A remedy is a claim about somebody else's product, which is exactly the claim
 * the household's transactions cannot support. "Save 40% by bundling" passes
 * every other guard in this codebase, because an invented discount is not a
 * figure about the user at all and there is nothing for a figure check to
 * disagree with. So the rule is checked here, at the source: the curated
 * wording states no percentage, and no rendered remedy states a dollar figure
 * the finding was not given.
 */
describe("the remedy catalog", () => {
  it("states no percentage anywhere, because a discount is not ours to promise", () => {
    for (const template of REMEDY_TEMPLATES) {
      expect(template).not.toMatch(/%|\bpercent/i);
    }
  });

  it("is not empty, so the assertion above cannot pass vacuously", () => {
    expect(REMEDY_TEMPLATES.length).toBeGreaterThan(20);
  });

  /**
   * CLASS 2, the remedies that only work if the OTHER PARTY agrees: refund a
   * fee, waive a charge, restore an old rate, hand over a retention discount.
   *
   * Asking is real at a carrier, an ISP, an insurer and a gym, which all route
   * a leaving customer to somebody whose job is to keep them. It is not real at
   * a fixed-price consumer subscription, which publishes one price and has
   * nobody to ask. Stating it there sounds confident and sends the reader to do
   * a thing that cannot work, so it may only appear for a merchant on the
   * explicit list, and the list is the evidence.
   */
  const ASKS_THE_MERCHANT_TO_AGREE = /refund|waiv|old rate|rate you were paying|retention|discount|negotiat/i;

  it("asks no merchant outside the negotiable list to move on price", () => {
    const fixedPrice = [
      "Netflix", "Spotify", "Dropbox", "Google One", "Backblaze",
      "Peloton", "Adobe", "Duolingo", "Flat Tire Repair",
    ];
    for (const merchant of fixedPrice) {
      const [f] = detectPriceIncreases(recurringMerchants(monthly(merchant, [20.0, 20.0, 24.0])));
      expect(`${merchant}: ${f.title} ${f.description}`).not.toMatch(ASKS_THE_MERCHANT_TO_AGREE);
    }
  });

  it("still asks where the list permits it, so the guard above is not vacuous", () => {
    for (const merchant of ["Comcast", "Geico", "Planet Fitness", "T-Mobile"]) {
      const [f] = detectPriceIncreases(recurringMerchants(monthly(merchant, [60.0, 60.0, 70.0])));
      expect(`${merchant}: ${f.title}`).toMatch(ASKS_THE_MERCHANT_TO_AGREE);
    }
  });

  /** Every "$1,234.50"-shaped run, canonicalised so spelling cannot hide one. */
  function amounts(text: string): string[] {
    return (text.match(/\$\s?\d[\d,]*(?:\.\d+)?/g) ?? [])
      .map((run) => Number(run.replace(/[$,\s]/g, "")).toFixed(2));
  }

  /** Every branch of the catalog, rendered by the real detector over real shapes. */
  function everyRemedy(): SpendCutFinding[] {
    const recurring = (rows: DetectorTxn[]) => recurringMerchants(rows);
    return [
      ...detectFees(
        [
          txn({ name: "OVERDRAFT FEE", amount: 35, date: "2026-01-12" }),
          txn({ name: "OVERDRAFT FEE", amount: 35, date: "2026-03-04" }),
          txn({ name: "NSF FEE", amount: 30, date: "2026-02-02" }),
          txn({ name: "NSF FEE", amount: 30, date: "2026-04-02" }),
          txn({ name: "ATM FEE", amount: 3, date: "2026-01-20" }),
          txn({ name: "ATM FEE", amount: 3, date: "2026-02-20" }),
          txn({ name: "FOREIGN TRANSACTION FEE", amount: 12, date: "2026-01-21" }),
          txn({ name: "FOREIGN TRANSACTION FEE", amount: 12, date: "2026-02-21" }),
          txn({ name: "LATE FEE", amount: 29, date: "2026-01-22" }),
          txn({ name: "LATE FEE", amount: 29, date: "2026-02-22" }),
          txn({ name: "MAINTENANCE FEE", amount: 15, date: "2026-01-23" }),
          txn({ name: "MAINTENANCE FEE", amount: 15, date: "2026-02-23" }),
          txn({ name: "SERVICE CHARGE", amount: 18, date: "2026-01-24" }),
          txn({ name: "SERVICE CHARGE", amount: 18, date: "2026-02-24" }),
          txn({ name: "OVER LIMIT FEE", amount: 25, date: "2026-01-25" }),
          txn({ name: "OVER LIMIT FEE", amount: 25, date: "2026-02-25" }),
          txn({ name: "Acme Bank charge", amount: 40, categorySystemKey: "bank_fees", date: "2026-03-01" }),
        ],
        WINDOW,
      ),
      ...detectPriceIncreases(recurring(monthly("Netflix", [15.49, 15.49, 17.99]))),
      ...detectPriceIncreases(recurring(monthly("Dropbox", [11.99, 11.99, 14.49]))),
      ...detectPriceIncreases(recurring(monthly("Spotify", [11.99, 11.99, 14.49]))),
      ...detectPriceIncreases(recurring(monthly("Verizon", [90.0, 90.0, 110.0]))),
      ...detectPriceIncreases(recurring(monthly("The New York Times", [17.0, 17.0, 21.0]))),
      ...detectDuplicateServices(
        recurring([...monthly("Netflix", [22.99, 22.99, 22.99]), ...monthly("Hulu", [17.99, 17.99, 17.99])]),
      ),
      ...detectDuplicateServices(
        recurring([...monthly("Hulu", [17.99, 17.99, 17.99]), ...monthly("Disney Plus", [10.99, 10.99, 10.99])]),
      ),
      ...detectDuplicateServices(
        recurring([...monthly("Spotify", [16.99, 16.99, 16.99]), ...monthly("Apple Music", [10.99, 10.99, 10.99])]),
      ),
      ...detectCategoryAboveTrend(
        [
          ...[100, 100, 100].map((a, i) => spend("dine", "Dining Out", a, ["2026-03-12", "2026-04-11", "2026-05-11"][i])),
          spend("dine", "Dining Out", 200, "2026-06-04"),
          spend("dine", "Dining Out", 120, "2026-06-12"),
          spend("dine", "Dining Out", 100, "2026-06-20"),
        ],
        WINDOW,
      ),
    ];
  }

  it("covers every kind, so no branch is checked by accident", () => {
    const kinds = new Set(everyRemedy().map((f) => f.kind));
    expect([...kinds].sort()).toEqual([
      "category_above_trend",
      "duplicate_service",
      "fee",
      "one_time_fee",
      "price_increase",
    ]);
  });

  it("states no dollar figure a finding was not given", () => {
    for (const f of everyRemedy()) {
      const allowed = new Set([
        ...amounts(f.evidence),
        f.monthlySaving.toFixed(2),
        ...(f.annualSaving == null ? [] : [f.annualSaving.toFixed(2)]),
      ]);
      for (const a of amounts(`${f.title} ${f.description}`)) {
        expect({ key: f.findingKey, amount: a, allowed: [...allowed] }).toEqual({
          key: f.findingKey,
          amount: a,
          allowed: expect.arrayContaining([a]),
        });
      }
    }
  });
});
