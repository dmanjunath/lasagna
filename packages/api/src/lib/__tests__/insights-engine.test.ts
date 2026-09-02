import { describe, it, expect } from "vitest";
import {
  normalizePunctuation,
  debtAccountPaidInFull,
  mentionsTaxSavingAmount,
  mentionsPersonalPortfolio,
  namesHeldSecurity,
  personalizesPortfolio,
} from "../insights-engine.js";

describe("debtAccountPaidInFull — a card cleared each month is not a payoff target", () => {
  const card = (metadata: Record<string, unknown>) => ({ type: "credit", metadata });

  it("is true when the last payment cleared the last statement", () => {
    expect(
      debtAccountPaidInFull(
        card({ type: "credit_card", lastStatementBalance: 1200, lastPaymentAmount: 1200 }),
      ),
    ).toBe(true);
  });

  it("is false for a carried balance", () => {
    expect(
      debtAccountPaidInFull(
        card({ type: "credit_card", lastStatementBalance: 5000, lastPaymentAmount: 200 }),
      ),
    ).toBe(false);
  });

  it("is false for legacy metadata that carries no statement signal", () => {
    expect(debtAccountPaidInFull(card({ interestRate: 24.99 }))).toBe(false);
  });

  it("never applies to a loan", () => {
    expect(
      debtAccountPaidInFull({
        type: "loan",
        metadata: { lastStatementBalance: 0, lastPaymentAmount: 0 },
      }),
    ).toBe(false);
  });

  it("honours a manual designation with no statement signal", () => {
    expect(
      debtAccountPaidInFull({ type: "credit", metadata: { interestRate: 24.99 }, paidInFullMonthly: true }),
    ).toBe(true);
  });

  it("never applies a manual designation to a loan", () => {
    expect(debtAccountPaidInFull({ type: "loan", metadata: null, paidInFullMonthly: true })).toBe(false);
  });
});

describe("normalizePunctuation", () => {
  it("replaces the spaced em dash seen in generated insights with a comma", () => {
    const out = normalizePunctuation(
      "overpaid by $61,821 federally and $10,358 to Virginia — a combined $72,179",
    );
    expect(out).toBe(
      "overpaid by $61,821 federally and $10,358 to Virginia, a combined $72,179",
    );
  });

  it("converts dashes between digits to 'to' ranges", () => {
    expect(normalizePunctuation("expected returns of 7–10% beat 3—5% savings")).toBe(
      "expected returns of 7 to 10% beat 3 to 5% savings",
    );
  });

  it("replaces unspaced dashes and middots with commas", () => {
    expect(normalizePunctuation("Rebalance now—your allocation drifted")).toBe(
      "Rebalance now, your allocation drifted",
    );
    expect(normalizePunctuation("Dining $840 · Groceries $410")).toBe(
      "Dining $840, Groceries $410",
    );
  });

  it("leaves hyphens, currency, and URLs untouched", () => {
    const s = "Set up a $500/mo auto-transfer via https://example.com/my-bank";
    expect(normalizePunctuation(s)).toBe(s);
  });
});

describe("mentionsTaxSavingAmount — an action may not price the tax it saves", () => {
  it("catches a tax saving stated after the verb", () => {
    expect(
      mentionsTaxSavingAmount(
        "You're contributing $15k to your 401(k). Increasing to $23,500 saves $2,040 in taxes at your 24% bracket.",
      ),
    ).toBe(true);
    expect(mentionsTaxSavingAmount("Open an HSA to save $1,290/yr in taxes")).toBe(true);
  });

  it("catches a tax saving stated before the amount", () => {
    expect(mentionsTaxSavingAmount("Harvest the loss to cut your tax bill by $2,000")).toBe(true);
    expect(mentionsTaxSavingAmount("Bunch your gifts and reduce taxes by 12%")).toBe(true);
  });

  it("catches a bare tax-savings label", () => {
    expect(mentionsTaxSavingAmount("$1,200+ tax savings")).toBe(true);
    expect(mentionsTaxSavingAmount("Save $2,040 in federal tax")).toBe(true);
    expect(mentionsTaxSavingAmount("That is $2,040 less in taxes this year")).toBe(true);
  });

  it("leaves a figure read straight off a document alone", () => {
    // Both of these were dropped by an earlier, broader matcher, which took
    // the whole withholding lens with them.
    expect(
      mentionsTaxSavingAmount(
        "Review your W-4 withholding after $41,200 federal withheld Your W-2 shows $41,200 in federal tax withheld on $250,000 wages.",
      ),
    ).toBe(false);
    expect(
      mentionsTaxSavingAmount(
        "Fund a NY 529 with up to $10,000 to claim the state deduction Your W-2 shows $14,100 in state tax withheld on $250,000 income.",
      ),
    ).toBe(false);
  });

  it("leaves non-tax dollar benefits alone", () => {
    expect(
      mentionsTaxSavingAmount(
        "Pay down your $3,076 card to stop $736/yr in interest Because the numbers say so. Save $340/yr",
      ),
    ).toBe(false);
    expect(
      mentionsTaxSavingAmount("Raise your 401(k) to 4% to claim $3,400/yr in free match"),
    ).toBe(false);
    expect(
      mentionsTaxSavingAmount("Invest $33,290 of idle cash to earn about $998/yr more"),
    ).toBe(false);
  });

  it("leaves an amount the user is asked to act on alone", () => {
    expect(
      mentionsTaxSavingAmount(
        "Contribute $8,550 to your HSA to lower your taxable income. $8,550 room left",
      ),
    ).toBe(false);
    expect(
      mentionsTaxSavingAmount(
        "Claim the $2,500 student loan interest deduction on your return. $2,500 cap",
      ),
    ).toBe(false);
    expect(
      mentionsTaxSavingAmount("Harvest the $4,200 loss sitting in your taxable brokerage"),
    ).toBe(false);
    expect(
      mentionsTaxSavingAmount("Move $50,000 into a tax-advantaged account to cut fund fees"),
    ).toBe(false);
    // The amount is the base the action moves, not the tax it removes.
    expect(
      mentionsTaxSavingAmount("Fund a NY 529 and lower your state taxable income by $7,000"),
    ).toBe(false);
    expect(
      mentionsTaxSavingAmount("Contribute $7,000 to a NY 529 to deduct against state tax"),
    ).toBe(false);
  });
});

describe("mentionsPersonalPortfolio — a portfolio action states the guideline, not their holdings", () => {
  it("catches a description of what the reader holds", () => {
    expect(
      mentionsPersonalPortfolio("Your portfolio is heavily invested in US stocks at 92%"),
    ).toBe(true);
    expect(mentionsPersonalPortfolio("You hold 4% in bonds at age 41")).toBe(true);
    expect(mentionsPersonalPortfolio("32% of your brokerage sits in one stock")).toBe(true);
    expect(mentionsPersonalPortfolio("Trim your $192,000 US equity position")).toBe(true);
  });

  it("catches an allocation prescribed for the reader", () => {
    expect(mentionsPersonalPortfolio("Rebalance to a 70/30 split")).toBe(true);
    expect(
      mentionsPersonalPortfolio("Move about 30% into international funds to diversify"),
    ).toBe(true);
    expect(
      mentionsPersonalPortfolio(
        "Trim Procter & Gamble from 32% to under 10% to cut single-name risk",
      ),
    ).toBe(true);
  });

  it("leaves general allocation guidance alone", () => {
    // The two forms the hosted copy is written in. Neither carries a possessive
    // nor an imperative, which is the whole of what separates them.
    expect(mentionsPersonalPortfolio("The recommended stock allocation is 70/30")).toBe(false);
    expect(
      mentionsPersonalPortfolio("Bonds should make up 20% of a balanced portfolio"),
    ).toBe(false);
    expect(
      mentionsPersonalPortfolio(
        "The recommended stock allocation is about 70 percent US to 30 percent international",
      ),
    ).toBe(false);
    expect(
      mentionsPersonalPortfolio(
        "A single holding above 10 percent of a portfolio is generally considered concentrated",
      ),
    ).toBe(false);
    expect(
      mentionsPersonalPortfolio(
        "Realized losses in a taxable account offset capital gains, and up to $3,000 of ordinary income a year",
      ),
    ).toBe(false);
    expect(mentionsPersonalPortfolio("70/30 guideline")).toBe(false);
    expect(mentionsPersonalPortfolio("20% bonds")).toBe(false);
  });

  it("leaves every action outside the portfolio family alone", () => {
    expect(
      mentionsPersonalPortfolio("Raise your 401(k) to 4% to claim $3,400/yr in free match"),
    ).toBe(false);
    expect(
      mentionsPersonalPortfolio("Pay down your $3,076 card to stop $736/yr in interest"),
    ).toBe(false);
    expect(
      mentionsPersonalPortfolio("Invest $33,290 of idle cash to earn about $998/yr more"),
    ).toBe(false);
    expect(mentionsPersonalPortfolio("Move $200 into your buffer")).toBe(false);
    // "withholding" ends in a portfolio noun and is not one.
    expect(
      mentionsPersonalPortfolio("Review your W-4 withholding after $41,200 federal withheld"),
    ).toBe(false);
    // A house is not a stock, whatever the word for its equity is.
    expect(mentionsPersonalPortfolio("Tap the $180,000 of equity in your home")).toBe(false);
    expect(
      mentionsPersonalPortfolio("Your home equity is $180,000 after 12 years of payments"),
    ).toBe(false);
  });
});

describe("mentionsPersonalPortfolio — an account the reader owns is not an allocation claim", () => {
  // Every string below is a window that a run of this predicate over every
  // stored action matched without cause. Each belongs to a lens the rule must
  // never touch, and each was matched because a possessive and a figure sat
  // near an account noun. A household with a card and a brokerage writes these
  // sentences constantly, and losing the action around them is the whole cost.
  const CASH_DRAG = [
    "Invest $56,632 of idle cash to earn about $1,700/yr more",
    "The excess earns ~5% in cash vs ~8% expected market return in your brokerage",
    "Moving $56,632 into index funds captures a 3% spread, worth $1,700/yr",
    "Moving $56,632 from cash earning ~5% to a diversified portfolio earning ~8%",
    "Moving $56,632 from savings to your brokerage captures a 3% spread",
    "Cash earns about 5% in a high-yield savings account; stocks historically return 8%",
    "Your brokerage holds only $14,869, and you have 6 months of expenses covered",
    "Moving this excess into your brokerage or 401(k) captures a 3% spread",
  ];
  const DEBT = [
    "Pay down your $12,662 Credit Card to stop $3,163/yr in interest",
    "Moving $12,662 to clear this card eliminates the highest-cost debt in your portfolio and frees up $263/mo",
    "Credit card at 24.99% APR costs $736/yr in interest",
    "This is a guaranteed -25% return on money that could be earning 8% in your brokerage",
    "Add interest rate and payment for your $375k Mortgage",
    "If below 4%, investing the difference in your 401(k) or taxable brokerage likely yields more",
    // A rate that moved is written the same way a reweighting is, so the
    // percent-to-percent form counts only beside the verb doing the reweighting.
    "Your APR rose from 18% to 24.99% after the promotional period ended",
  ];
  const CONTRIBUTION_ROOM = [
    "Contribute $7,000 to a Roth IRA for tax-free growth",
    "Your brokerage balance of $15,629 suggests room to fund this",
    "Invest your $21,029 HSA balance to unlock triple tax advantage",
    "Raise your 401(k) to 4% to claim $3,400/yr in free match",
  ];

  it("leaves the cash-drag action alone", () => {
    for (const text of CASH_DRAG) expect([text, mentionsPersonalPortfolio(text)]).toEqual([text, false]);
  });

  it("leaves the debt actions alone", () => {
    for (const text of DEBT) expect([text, mentionsPersonalPortfolio(text)]).toEqual([text, false]);
  });

  it("leaves the contribution-room actions alone", () => {
    for (const text of CONTRIBUTION_ROOM)
      expect([text, mentionsPersonalPortfolio(text)]).toEqual([text, false]);
  });

  it("still catches the allocation claims those windows were confused with", () => {
    for (const text of [
      "Your portfolio is 87% US equity and only 6% international",
      "Trim Apple from 18% to under 10% to reduce idiosyncratic risk",
      "Move about 25% into international funds to diversify",
      "Rebalance to a 70/30 split",
      "Trim your $192,000 US equity position",
      "Your brokerage holds 100% US equities and bonds with zero international exposure",
      "Add about 10% bonds to align with your age and moderate risk",
      "Adding $20,279 (30% of your $67,597 in investments) to a bond fund",
    ])
      expect([text, mentionsPersonalPortfolio(text)]).toEqual([text, true]);
  });
});

describe("mentionsPersonalPortfolio — a percentage that moved is not a reweighting", () => {
  // Every lens in the product moves a percentage from one figure to another,
  // and only one of them is moving an allocation. The employer-match action is
  // the single most repeated action there is, and it is written this way the
  // moment the model reaches for the fuller phrasing.
  const A_RATE_THAT_MOVED = [
    "Raise your 401(k) contribution from 3% to 6% to capture the full employer match",
    "Increase your 401(k) deferral from 4% to 6% to claim $3,400/yr in free match",
    "Increase your withholding from 12% to 15% to avoid an underpayment penalty",
    "Raise your savings rate from 12% to 15% of income",
    "Move your savings from 0.01% to 4.5% by switching to a high-yield account",
    "Reduce dining out from 18% to 12% of your monthly spending",
  ];
  // The same shape with nothing in the sentence saying the percentage is a
  // rate. None of these has to name a slice of a portfolio to be an allocation.
  const AN_ALLOCATION_THAT_MOVED = [
    "Trim Apple from 18% to under 10% to reduce idiosyncratic risk",
    "Trim your bond position from 18% to under 10%",
    "Shift your allocation from 90% to 70% over the next year",
    "Move your international stocks from 6% to 25%",
  ];
  // Prescriptions that name no asset class anywhere. Requiring one beside the
  // move let every one of these through, and each prescribes an allocation as
  // plainly as the ones that do name a slice: what tells an allocation from a
  // rate is that the percentage is not a rate, not that a slice is named.
  const AN_ALLOCATION_NAMING_NO_ASSET_CLASS = [
    "Trim your largest position from 24% to under 10% to reduce single-name risk",
    "Reduce your top holding from 28% to 10% to cut idiosyncratic risk",
    "Rebalance your account from 95% to 70% by selling the winners",
    "Trim your single largest fund from 32% to under 10%",
    "Trim it from 32% to under 10%",
  ];

  it("leaves a contribution, withholding, savings or spending rate alone", () => {
    for (const text of A_RATE_THAT_MOVED)
      expect([text, mentionsPersonalPortfolio(text)]).toEqual([text, false]);
  });

  it("still catches the reweighting of an allocation", () => {
    for (const text of AN_ALLOCATION_THAT_MOVED)
      expect([text, mentionsPersonalPortfolio(text)]).toEqual([text, true]);
  });

  it("catches a reweighting that names no asset class at all", () => {
    for (const text of AN_ALLOCATION_NAMING_NO_ASSET_CLASS)
      expect([text, mentionsPersonalPortfolio(text)]).toEqual([text, true]);
  });
});

describe("mentionsPersonalPortfolio — a retirement account holds an allocation but is not one", () => {
  // A share of a tax-advantaged container is how the cash-drag actions are
  // written, and those are about a balance sitting in cash.
  const A_BALANCE = [
    "Put 100% of your HSA into investments instead of cash",
    "Only 12% of your IRA is invested; the rest sits in cash",
    "Invest your $21,029 HSA balance instead of leaving it in cash",
    "Max your HSA and invest the $3,850 instead of holding cash",
    "Contribute 6% of your 401(k) eligible pay to capture the match",
  ];
  // The same container with a slice of a portfolio named beside it, which is an
  // allocation claim and not a balance.
  const AN_ALLOCATION = [
    "Move 40% of your IRA into international stocks",
    "Only 12% of your 401(k) sits in bonds",
  ];

  it("leaves a share of the balance alone", () => {
    for (const text of A_BALANCE)
      expect([text, mentionsPersonalPortfolio(text)]).toEqual([text, false]);
  });

  it("still catches a share of it stated as an asset class", () => {
    for (const text of AN_ALLOCATION)
      expect([text, mentionsPersonalPortfolio(text)]).toEqual([text, true]);
  });

  it("still catches a share of an account that is not a container", () => {
    for (const text of [
      "32% of your brokerage sits in one stock",
      "22% of your taxable holdings are in a single position",
      "Adding $20,279 (30% of your $67,597 in investments) to a bond fund",
    ])
      expect([text, mentionsPersonalPortfolio(text)]).toEqual([text, true]);
  });
});

describe("namesHeldSecurity — matched against what this tenant holds, not by shape", () => {
  const held = {
    tickers: ["VTSAX", "PG", "BRK.B"],
    names: ["Procter & Gamble Co.", "Vanguard Total Stock Market ETF"],
  };

  it("catches a ticker, in an action of any kind", () => {
    expect(namesHeldSecurity("Harvest the $4,200 loss in VTSAX", held, true)).toBe(true);
    expect(namesHeldSecurity("BRK.B is a third of the account", held, true)).toBe(true);
    // A ticker is case-sensitive, word-bounded and stoplisted, so nothing but
    // the fund produces one. It is matched outside the holdings families too.
    expect(namesHeldSecurity("Invest the idle cash in index funds like VTSAX", held, false)).toBe(
      true,
    );
  });

  it("catches a fund or company name, with or without its legal tail", () => {
    expect(namesHeldSecurity("Trim Procter & Gamble to under 10%", held, true)).toBe(true);
    expect(namesHeldSecurity("Sell the Vanguard Total Stock Market ETF lot", held, true)).toBe(true);
  });

  it("does not fire on the acronyms the tax lens is built out of", () => {
    for (const word of ["HSA", "IRA", "APR", "ETF", "RMD", "LTCG", "MAGI", "NUA", "ACA", "US"]) {
      expect(namesHeldSecurity(`Open an ${word} account this year`, held, true)).toBe(false);
    }
  });

  it("does not fire on a security this tenant does not hold", () => {
    expect(
      namesHeldSecurity("Harvest the $4,200 loss in VTSAX", { tickers: [], names: [] }, true),
    ).toBe(false);
  });

  it("looks for a NAME only where the action is about holdings", () => {
    // Half the index is also a shop or a card. Outside the holdings families
    // the word is the merchant, so the name is not looked for at all.
    const brands = {
      tickers: ["V", "TGT", "AAPL", "AXP"],
      names: ["Visa Inc.", "Target Corporation", "Apple Inc.", "American Express Company"],
    };
    expect(namesHeldSecurity("Pay down your Visa card to stop $736/yr in interest", brands, false))
      .toBe(false);
    expect(namesHeldSecurity("Cut $240/mo at Target by switching to a list", brands, false)).toBe(
      false,
    );
    expect(
      namesHeldSecurity("Your American Express card carries $4,100 at 22% APR", brands, false),
    ).toBe(false);
    expect(namesHeldSecurity("Turn on Apple Pay round-ups to save $50/mo", brands, false)).toBe(
      false,
    );
    // The same words in a holdings action are the position, and are caught.
    expect(
      namesHeldSecurity("Trim Visa from 25% to under 10% to cut single-stock risk", brands, true),
    ).toBe(true);
  });
});

describe("personalizesPortfolio — what both paths call", () => {
  const held = { tickers: ["VTSAX"], names: ["Vanguard Total Stock Market ETF"] };

  it("drops the personalized action and keeps the general one", () => {
    expect(
      personalizesPortfolio(
        {
          title: "Move about 30% into international funds to diversify",
          description: "Your portfolio is 92% US against a 70% benchmark.",
          impact: "92% US",
        },
        held,
      ),
    ).toBe(true);
    expect(
      personalizesPortfolio(
        {
          title: "The recommended stock allocation is about 70 percent US to 30 percent international",
          description:
            "A globally diversified stock allocation holds roughly a third of it outside the US. Open the Portfolio page to see how the split compares.",
          impact: "70/30 guideline",
        },
        held,
      ),
    ).toBe(false);
  });

  it("keeps the debt action of a household that holds the card network", () => {
    const brands = { tickers: ["V"], names: ["Visa Inc."] };
    expect(
      personalizesPortfolio(
        {
          title: "Pay down your Visa card to stop $736/yr in interest",
          description: "The card carries 24.99% APR against $3,076 of balance.",
          impact: "$736/yr interest",
          category: "debt",
          type: "debt",
        },
        brands,
      ),
    ).toBe(false);
    // The same holding, named in an action that IS about the position.
    expect(
      personalizesPortfolio(
        {
          title: "Trim Visa from 25% to under 10% to cut single-stock risk",
          description: "One position is a quarter of the account.",
          impact: "10% guideline",
          category: "portfolio",
          type: "portfolio",
        },
        brands,
      ),
    ).toBe(true);
    // The same action with no figure anywhere in it, so the allocation rule
    // reads nothing here and the held name is the whole of what carries it.
    expect(
      personalizesPortfolio(
        {
          title: "Sell down your Visa position and reinvest the proceeds",
          description: "",
          impact: "",
          category: "portfolio",
          type: "portfolio",
        },
        brands,
      ),
    ).toBe(true);
  });

  it("does not let a figure in the title reach a noun in the description", () => {
    expect(
      personalizesPortfolio(
        {
          title: "Cap dining near $39 after it jumped 129% to $89",
          description: "Stocks are not the subject of this action.",
          impact: "$50/mo",
        },
        held,
      ),
    ).toBe(false);
  });
});
