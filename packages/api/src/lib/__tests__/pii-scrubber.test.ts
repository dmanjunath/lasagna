import { describe, it, expect } from "vitest";
import { scrub, descrub, descrubObject, type AliasMap } from "../pii-scrubber.js";

// Helper to build an AliasMap without DB
function makeMap(
  entries: Array<[string, string]>
): AliasMap {
  const forward = new Map<string, string>();
  const reverse = new Map<string, string>();
  for (const [real, alias] of entries) {
    forward.set(real, alias);
    if (alias !== "") {
      reverse.set(alias, real);
    }
  }
  return { forward, reverse };
}

// ── scrub ─────────────────────────────────────────────────────────────────────

describe("scrub", () => {
  const map = makeMap([
    ["Chase Checking", "Account 1"],
    ["Fidelity 401k", "Account 2"],
    ["Wells Fargo Auto Loan", "auto loan"],
    ["Hawaii Vacation Fund", "Goal 1"],
    ["4832", ""], // mask — stripped
  ]);

  it("replaces account names in a flat object", () => {
    const input = {
      name: "Chase Checking",
      balance: 5200.5,
      type: "depository",
    };
    const result = scrub(input, map) as Record<string, unknown>;
    expect(result.name).toBe("Account 1");
    expect(result.balance).toBe(5200.5);
    expect(result.type).toBe("depository");
  });

  it("replaces account names in nested objects", () => {
    const input = {
      allocation: {
        depository: {
          accounts: [{ name: "Chase Checking", balance: 5200 }],
        },
      },
    };
    const result = scrub(input, map) as any;
    expect(result.allocation.depository.accounts[0].name).toBe("Account 1");
    expect(result.allocation.depository.accounts[0].balance).toBe(5200);
  });

  it("replaces debt account names with type label", () => {
    const input = { name: "Wells Fargo Auto Loan", balance: 15000 };
    const result = scrub(input, map) as any;
    expect(result.name).toBe("auto loan");
  });

  it("replaces goal names", () => {
    const input = { name: "Hawaii Vacation Fund", targetAmount: 10000 };
    const result = scrub(input, map) as any;
    expect(result.name).toBe("Goal 1");
  });

  it("strips mask fields by setting to null", () => {
    const input = { name: "Chase Checking", mask: "4832", balance: 5200 };
    const result = scrub(input, map) as any;
    expect(result.mask).toBeNull();
  });

  it("strips mask values from string fields too", () => {
    const input = { description: "Account ending in 4832" };
    const result = scrub(input, map) as any;
    expect(result.description).toBe("Account ending in ");
  });

  it("replaces multiple PII values in a single string", () => {
    const input =
      "Transfer from Chase Checking to Fidelity 401k for Hawaii Vacation Fund";
    const result = scrub(input, map);
    expect(result).toBe("Transfer from Account 1 to Account 2 for Goal 1");
  });

  it("handles arrays of objects", () => {
    const input = [
      { name: "Chase Checking", balance: 5200 },
      { name: "Fidelity 401k", balance: 120000 },
    ];
    const result = scrub(input, map) as any[];
    expect(result[0].name).toBe("Account 1");
    expect(result[1].name).toBe("Account 2");
  });

  it("preserves non-PII fields exactly", () => {
    const input = {
      type: "depository",
      subtype: "checking",
      balance: 5200.5,
      available: 5100.0,
      lastUpdated: "2026-04-20T00:00:00Z",
      ticker: "AAPL",
      merchant: "Starbucks",
    };
    const result = scrub(input, map) as any;
    expect(result.type).toBe("depository");
    expect(result.subtype).toBe("checking");
    expect(result.balance).toBe(5200.5);
    expect(result.available).toBe(5100.0);
    expect(result.lastUpdated).toBe("2026-04-20T00:00:00Z");
    expect(result.ticker).toBe("AAPL");
    expect(result.merchant).toBe("Starbucks");
  });

  it("handles null and undefined values", () => {
    expect(scrub(null, map)).toBeNull();
    expect(scrub(undefined, map)).toBeUndefined();
  });

  it("handles empty map without errors", () => {
    const emptyMap = makeMap([]);
    const input = { name: "Chase Checking", balance: 5200 };
    const result = scrub(input, emptyMap) as any;
    expect(result.name).toBe("Chase Checking");
  });

  it("does not modify numbers or booleans", () => {
    const input = { count: 42, active: true, rate: 0.04 };
    const result = scrub(input, map) as any;
    expect(result.count).toBe(42);
    expect(result.active).toBe(true);
    expect(result.rate).toBe(0.04);
  });

  it("handles longer name matching before shorter (no partial replace)", () => {
    // "Chase Checking Plus" should not partially match "Chase Checking"
    const mapWithLong = makeMap([
      ["Chase Checking", "Account 1"],
      ["Chase Checking Plus", "Account 2"],
    ]);
    const input = { name: "Chase Checking Plus" };
    const result = scrub(input, mapWithLong) as any;
    expect(result.name).toBe("Account 2");
  });
});

// ── descrub ───────────────────────────────────────────────────────────────────

describe("descrub", () => {
  const map = makeMap([
    ["Chase Checking", "Account 1"],
    ["Fidelity 401k", "Account 2"],
    ["Wells Fargo Auto Loan", "auto loan"],
    ["Hawaii Vacation Fund", "Goal 1"],
  ]);

  it("replaces aliases back to real names in text", () => {
    const input = "Your Account 1 has a balance of $5,200.";
    const result = descrub(input, map);
    expect(result).toBe("Your Chase Checking has a balance of $5,200.");
  });

  it("replaces multiple aliases in one string", () => {
    const input =
      "Transfer from Account 1 to Account 2 for Goal 1";
    const result = descrub(input, map);
    expect(result).toBe(
      "Transfer from Chase Checking to Fidelity 401k for Hawaii Vacation Fund"
    );
  });

  it("replaces debt type aliases back", () => {
    const input = "Your auto loan has a remaining balance of $15,000.";
    const result = descrub(input, map);
    expect(result).toBe(
      "Your Wells Fargo Auto Loan has a remaining balance of $15,000."
    );
  });

  it("handles text with no aliases", () => {
    const input = "Your savings rate is 22%.";
    const result = descrub(input, map);
    expect(result).toBe("Your savings rate is 22%.");
  });

  it("handles empty string", () => {
    expect(descrub("", map)).toBe("");
  });

  it("handles numbered aliases correctly (Account 10 vs Account 1)", () => {
    const mapWithMany = makeMap([
      ["First Account", "Account 1"],
      ["Tenth Account", "Account 10"],
    ]);
    const input = "Account 10 has more than Account 1.";
    const result = descrub(input, mapWithMany);
    expect(result).toBe("Tenth Account has more than First Account.");
  });
});

// ── descrubObject ─────────────────────────────────────────────────────────────

describe("descrubObject", () => {
  const map = makeMap([
    ["Chase Checking", "Account 1"],
    ["Fidelity 401k", "Account 2"],
    ["Hawaii Vacation Fund", "Goal 1"],
  ]);

  it("descrubs string values in a flat object", () => {
    const input = {
      title: "Account 1 is running low",
      description: "Your Account 1 balance dropped by $500.",
      impact: "Save $200/yr",
    };
    const result = descrubObject(input, map) as any;
    expect(result.title).toBe("Chase Checking is running low");
    expect(result.description).toBe(
      "Your Chase Checking balance dropped by $500."
    );
    expect(result.impact).toBe("Save $200/yr");
  });

  it("descrubs nested objects and arrays", () => {
    const input = {
      insights: [
        { title: "Goal 1 is on track" },
        { title: "Account 2 grew 5%" },
      ],
    };
    const result = descrubObject(input, map) as any;
    expect(result.insights[0].title).toBe("Hawaii Vacation Fund is on track");
    expect(result.insights[1].title).toBe("Fidelity 401k grew 5%");
  });

  it("preserves non-string values", () => {
    const input = { amount: 5200, active: true, items: null };
    const result = descrubObject(input, map) as any;
    expect(result.amount).toBe(5200);
    expect(result.active).toBe(true);
    expect(result.items).toBeNull();
  });
});

// ── Integration: scrub then descrub roundtrip ─────────────────────────────────

describe("scrub → descrub roundtrip", () => {
  const map = makeMap([
    ["Chase Checking", "Account 1"],
    ["Fidelity 401k", "Account 2"],
    ["Hawaii Vacation Fund", "Goal 1"],
  ]);

  it("roundtrips a tool result through scrub and descrub", () => {
    const toolResult = {
      accounts: [
        { name: "Chase Checking", balance: 5200, type: "depository" },
        { name: "Fidelity 401k", balance: 120000, type: "investment" },
      ],
    };

    // Scrub before sending to LLM
    const scrubbed = scrub(toolResult, map) as any;
    expect(scrubbed.accounts[0].name).toBe("Account 1");
    expect(scrubbed.accounts[1].name).toBe("Account 2");

    // Simulate LLM response referencing the aliases
    const llmResponse =
      "Your Account 1 has $5,200 and Account 2 has $120,000. Total: $125,200.";

    // Descrub before returning to user
    const final = descrub(llmResponse, map);
    expect(final).toBe(
      "Your Chase Checking has $5,200 and Fidelity 401k has $120,000. Total: $125,200."
    );
  });

  it("scrubbed data contains no real account names", () => {
    const snapshot = {
      accounts: [
        { name: "Chase Checking", balance: 5200 },
        { name: "Fidelity 401k", balance: 120000 },
      ],
      goals: [{ name: "Hawaii Vacation Fund", target: 10000 }],
      summary: "Chase Checking and Fidelity 401k totals",
    };

    const scrubbed = scrub(snapshot, map);
    const serialized = JSON.stringify(scrubbed);

    // Verify no real names appear in the scrubbed output
    expect(serialized).not.toContain("Chase Checking");
    expect(serialized).not.toContain("Fidelity 401k");
    expect(serialized).not.toContain("Hawaii Vacation Fund");

    // Verify aliases are present
    expect(serialized).toContain("Account 1");
    expect(serialized).toContain("Account 2");
    expect(serialized).toContain("Goal 1");

    // Verify financial data is preserved
    expect(serialized).toContain("5200");
    expect(serialized).toContain("120000");
    expect(serialized).toContain("10000");
  });
});

// ── Edge cases for data sent to LLM ──────────────────────────────────────────

describe("PII never reaches LLM payload", () => {
  const map = makeMap([
    ["Chase Savings", "Account 1"],
    ["BofA Credit Card", "credit card"],
    ["Emergency Fund", "Goal 1"],
    ["9876", ""], // mask
  ]);

  it("scrubs a full financial tool response", () => {
    const toolResponse = {
      accounts: [
        {
          id: "uuid-1",
          name: "Chase Savings",
          type: "depository",
          subtype: "savings",
          mask: "9876",
          balance: "45000.00",
          available: "44500.00",
          lastUpdated: "2026-04-20T00:00:00Z",
        },
        {
          id: "uuid-2",
          name: "BofA Credit Card",
          type: "credit",
          subtype: "credit card",
          mask: "1234",
          balance: "2500.00",
          available: null,
          lastUpdated: "2026-04-20T00:00:00Z",
        },
      ],
    };

    const scrubbed = scrub(toolResponse, map) as any;
    const serialized = JSON.stringify(scrubbed);

    // No real account names
    expect(serialized).not.toContain("Chase Savings");
    expect(serialized).not.toContain("BofA Credit Card");

    // Masks are null
    expect(scrubbed.accounts[0].mask).toBeNull();
    expect(scrubbed.accounts[1].mask).toBeNull();

    // Balances preserved
    expect(scrubbed.accounts[0].balance).toBe("45000.00");
    expect(scrubbed.accounts[1].balance).toBe("2500.00");

    // Types preserved
    expect(scrubbed.accounts[0].type).toBe("depository");
    expect(scrubbed.accounts[1].type).toBe("credit");

    // IDs preserved (not PII, internal use)
    expect(scrubbed.accounts[0].id).toBe("uuid-1");
  });

  it("scrubs an insights engine data snapshot", () => {
    const snapshot = {
      accounts: [
        {
          name: "Chase Savings",
          type: "depository",
          subtype: "savings",
          balance: 45000,
          balanceDelta30d: 1200,
          metadata: null,
        },
      ],
      holdings: [
        {
          ticker: "VTI",
          name: "Vanguard Total Stock Market",
          quantity: 150,
          value: 38000,
          costBasis: 30000,
          accountName: "Chase Savings",
        },
      ],
      goals: [
        {
          name: "Emergency Fund",
          targetAmount: 50000,
          currentAmount: 45000,
          deadline: "2026-12-31",
          status: "active",
        },
      ],
      profile: {
        annualIncome: 125000,
        filingStatus: "single",
        stateOfResidence: "CA",
        riskTolerance: "moderate",
        retirementAge: 65,
        age: 32,
      },
      spending: {
        topMerchants: [
          { merchant: "Whole Foods", total: 450 },
          { merchant: "Amazon", total: 320 },
        ],
      },
    };

    const scrubbed = scrub(snapshot, map) as any;
    const serialized = JSON.stringify(scrubbed);

    // Account names scrubbed
    expect(serialized).not.toContain("Chase Savings");
    expect(scrubbed.accounts[0].name).toBe("Account 1");
    expect(scrubbed.holdings[0].accountName).toBe("Account 1");

    // Goal names scrubbed
    expect(serialized).not.toContain("Emergency Fund");
    expect(scrubbed.goals[0].name).toBe("Goal 1");

    // Securities preserved (not PII)
    expect(scrubbed.holdings[0].ticker).toBe("VTI");
    expect(scrubbed.holdings[0].name).toBe("Vanguard Total Stock Market");

    // Merchants preserved (not PII per requirements)
    expect(scrubbed.spending.topMerchants[0].merchant).toBe("Whole Foods");
    expect(scrubbed.spending.topMerchants[1].merchant).toBe("Amazon");

    // Profile data preserved (needed for accurate analysis)
    expect(scrubbed.profile.annualIncome).toBe(125000);
    expect(scrubbed.profile.filingStatus).toBe("single");
    expect(scrubbed.profile.stateOfResidence).toBe("CA");

    // Financial amounts preserved
    expect(scrubbed.accounts[0].balance).toBe(45000);
    expect(scrubbed.goals[0].targetAmount).toBe(50000);
    expect(scrubbed.holdings[0].value).toBe(38000);
  });
});
