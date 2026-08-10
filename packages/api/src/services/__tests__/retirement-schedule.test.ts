import { describe, it, expect } from "vitest";
import { runSchedule, deriveScheduleContext, type ScheduleInputs } from "../retirement-schedule.js";

const base: ScheduleInputs = {
  currentAge: 38, retirementAge: 40, planThroughAge: 90,
  buckets: { taxable: 400_000, deferred: 300_000, roth: 50_000, hsa: 20_000 },
  monthlySavings: 3_000, monthlySpend: 5_000, blendedReturn: 0.06, inflationRate: 0.03,
  ssMonthly: 2_000, ssClaimAge: 67, otherMonthly: 0, otherStartAge: 40,
  realEstate: null, reAppreciation: 0.03, dividendYield: 0.018,
  costBasisRatio: 0.7, filingStatus: "single",
};

describe("runSchedule reconciliation", () => {
  it("every bucket ties out and totals sum", () => {
    const { rows } = runSchedule(base);
    expect(rows).toHaveLength(90 - 38 + 1);
    for (const r of rows) {
      for (const k of ["taxable","deferred","roth","hsa"] as const) {
        const b = r.buckets[k];
        expect(Math.abs(b.end - (b.start + b.growth + b.contribution - b.withdrawal))).toBeLessThanOrEqual(1);
      }
      const sum = Object.values(r.buckets).reduce((s,b)=>s+b.end,0);
      expect(Math.abs(r.totalPortfolio - sum)).toBeLessThanOrEqual(1);
      const drawn = Object.values(r.buckets).reduce((s,b)=>s+b.withdrawal,0);
      expect(Math.abs(r.portfolioWithdrawal - drawn)).toBeLessThanOrEqual(1);
      expect(r.taxFreeWithdrawal).toBeGreaterThanOrEqual(0);
      expect(r.taxFreeWithdrawal).toBeLessThanOrEqual(r.portfolioWithdrawal + 1);
    }
  });
  it("next year's start equals this year's end per bucket", () => {
    const { rows } = runSchedule(base);
    for (let i = 1; i < rows.length; i++)
      for (const k of ["taxable","deferred","roth","hsa"] as const)
        expect(Math.abs(rows[i].buckets[k].start - rows[i-1].buckets[k].end)).toBeLessThanOrEqual(1);
  });
  it("before 59.5 no deferred/roth/hsa is withdrawn (the bridge)", () => {
    const { rows, flags } = runSchedule(base);
    for (const r of rows.filter(r => r.phase === "retirement" && r.age < 59))
      expect(r.buckets.deferred.withdrawal + r.buckets.roth.withdrawal + r.buckets.hsa.withdrawal).toBe(0);
    expect(flags.bridge).not.toBeNull();
    expect(flags.bridge!.fromAge).toBe(40);
  });
  it("gross-up: withdrawals cover spend + tax within tolerance", () => {
    const hot: ScheduleInputs = { ...base, monthlySpend: 9_000, buckets: { taxable: 1_500_000, deferred: 0, roth: 0, hsa: 0 }, costBasisRatio: 0.4 };
    const { rows } = runSchedule(hot);
    const r = rows.find(x => x.phase === "retirement")!;
    const gi = r.guaranteedIncome.socialSecurity + r.guaranteedIncome.rental + r.guaranteedIncome.other;
    const residual = r.portfolioWithdrawal + gi - r.spendTarget - r.estimatedTax;
    expect(Math.abs(residual)).toBeLessThanOrEqual(0.02 * r.spendTarget);
  });
  it("accumulation routes savings without withdrawals", () => {
    const { rows } = runSchedule(base);
    const acc = rows.filter(r => r.phase === "accumulation");
    expect(acc.length).toBe(2); // ages 38, 39
    for (const r of acc) {
      expect(r.portfolioWithdrawal).toBe(0);
      const contrib = Object.values(r.buckets).reduce((s,b)=>s+b.contribution,0);
      expect(Math.abs(contrib - 36_000)).toBeLessThanOrEqual(1); // 3000*12
    }
  });
  it("handles zero portfolio without NaN", () => {
    const { rows } = runSchedule({ ...base, buckets: { taxable: 0, deferred: 0, roth: 0, hsa: 0 } });
    for (const r of rows) {
      expect(Number.isFinite(r.totalPortfolio)).toBe(true);
      expect(r.totalPortfolio).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("gross-up convergence (Fix 1)", () => {
  // Deferred-only, retire at 60 (deferred is drawable), very high spend that
  // pushes grossed-up withdrawals across bracket boundaries. A fixed 2-pass
  // gross-up under-delivers net by up to ~12%; the fixed-point iteration must
  // deliver net essentially exactly.
  it("delivers near-exact net for a non-depleted high-spend year", () => {
    const hot: ScheduleInputs = {
      ...base,
      currentAge: 59, retirementAge: 60, planThroughAge: 90,
      buckets: { taxable: 0, deferred: 40_000_000, roth: 0, hsa: 0 },
      monthlySpend: 40_000, // $480k/yr
      inflationRate: 0, ssMonthly: 0,
    };
    const { rows } = runSchedule(hot);
    // First retirement year is age 60 with a huge, non-depleted balance.
    const r = rows.find((x) => x.phase === "retirement" && x.buckets.deferred.end > 0)!;
    const gi = r.guaranteedIncome.socialSecurity + r.guaranteedIncome.rental + r.guaranteedIncome.other;
    const deliveredNet = r.portfolioWithdrawal - r.estimatedTax;
    const netNeed = r.spendTarget - gi;
    expect(Math.abs(deliveredNet - netNeed)).toBeLessThanOrEqual(0.01 * r.spendTarget);
    expect(r.shortfall).toBe(0);
  });

  it("reports a real shortfall when the portfolio cannot fund spend + tax", () => {
    const tooSmall: ScheduleInputs = {
      ...base,
      currentAge: 59, retirementAge: 60, planThroughAge: 90,
      buckets: { taxable: 0, deferred: 100_000, roth: 0, hsa: 0 },
      monthlySpend: 40_000, // $480k/yr — vastly exceeds the $100k balance
      inflationRate: 0, ssMonthly: 0,
    };
    const { rows, flags } = runSchedule(tooSmall);
    const r = rows.find((x) => x.phase === "retirement")!;
    expect(r.shortfall).toBeGreaterThan(0);
    expect(flags.firstShortfallAge).not.toBeNull();
  });
});

describe("age gating at 59.5 (Fix 2)", () => {
  it("age-59 row draws from deferred (no phantom one-year bridge gap)", () => {
    const inputs: ScheduleInputs = {
      ...base,
      currentAge: 58, retirementAge: 59, planThroughAge: 90,
      buckets: { taxable: 0, deferred: 5_000_000, roth: 0, hsa: 0 },
      monthlySpend: 5_000, inflationRate: 0, ssMonthly: 0,
    };
    const { rows } = runSchedule(inputs);
    const row59 = rows.find((r) => r.age === 59)!;
    expect(row59.buckets.deferred.withdrawal).toBeGreaterThan(0);
    // No full-spend shortfall — the year is fundable from deferred.
    expect(row59.shortfall).toBe(0);
  });

  it("bridge span ends at age 58 (last taxable-only year)", () => {
    const { flags } = runSchedule({ ...base, retirementAge: 40 });
    expect(flags.bridge).not.toBeNull();
    expect(flags.bridge!.toAge).toBe(58);
  });
});

describe("input guards (Fix 3)", () => {
  it("planThroughAge < currentAge returns empty rows and does not throw", () => {
    const { rows, flags } = runSchedule({ ...base, planThroughAge: 30 }); // < currentAge 38
    expect(rows.length).toBe(0);
    expect(flags.bridge).toBeNull();
    expect(flags.firstShortfallAge).toBeNull();
    expect(flags.endingPortfolio).toBe(0);
    expect(flags.endingNetWorth).toBe(0);
    expect(flags.depleted).toBe(false);
    expect(Number.isFinite(flags.taxFreeCapacityAtRetirement)).toBe(true);
  });

  it("clamps costBasisRatio outside [0,1] to finite, non-negative results", () => {
    for (const cbr of [-0.5, 1.5]) {
      const { rows } = runSchedule({ ...base, costBasisRatio: cbr });
      for (const r of rows) {
        expect(Number.isFinite(r.taxFreeWithdrawal)).toBe(true);
        expect(r.taxFreeWithdrawal).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(r.estimatedTax)).toBe(true);
      }
    }
  });
});

describe("taxFreeWithdrawal SS double-credit (Fix 4)", () => {
  // With SS taxable and deferred draws, the std-deduction room must be credited
  // to SS first, then to deferred draws — never double-counting the room.
  it("never credits more std-deduction room than the deferred draw uses", () => {
    const inputs: ScheduleInputs = {
      ...base,
      currentAge: 66, retirementAge: 67, planThroughAge: 90,
      buckets: { taxable: 0, deferred: 3_000_000, roth: 0, hsa: 0 },
      monthlySpend: 4_000, inflationRate: 0,
      ssMonthly: 3_000, ssClaimAge: 67,
    };
    const { rows } = runSchedule(inputs);
    for (const r of rows.filter((x) => x.phase === "retirement" && x.portfolioWithdrawal > 0)) {
      // taxFreeWithdrawal is a portion of the gross withdrawal — the SS benefit
      // itself is not a withdrawal and must not inflate this figure.
      expect(r.taxFreeWithdrawal).toBeLessThanOrEqual(r.portfolioWithdrawal + 1);
      expect(r.taxFreeWithdrawal).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("rental income inflation (Fix 5)", () => {
  it("inflates rental income with the same factor as spend", () => {
    const inputs: ScheduleInputs = {
      ...base,
      retirementAge: 40, inflationRate: 0.03,
      realEstate: { value: 500_000, mortgage: 200_000, netAnnualRent: 24_000 },
    };
    const { rows } = runSchedule(inputs);
    const r40 = rows.find((r) => r.age === 40)!; // yearsInto = 0
    const r50 = rows.find((r) => r.age === 50)!; // yearsInto = 10
    expect(r40.guaranteedIncome.rental).toBe(24_000);
    const expected50 = Math.round(24_000 * Math.pow(1.03, 10));
    expect(r50.guaranteedIncome.rental).toBe(expected50);
    expect(r50.realEstate!.netRentalIncome).toBe(expected50);
  });
});

describe("deriveScheduleContext", () => {
  it("derives cost-basis ratio, real-estate totals, and filing status", () => {
    const ctx = deriveScheduleContext({
      portfolioBasis: { costBasis: 300_000, marketValue: 500_000, unrealizedGain: 200_000 },
      realEstate: { totalValue: 900_000, totalMortgage: 400_000, totalNetAnnualRent: 24_000 } as any,
      demographics: { filingStatus: "married_joint" } as any,
    } as any);
    expect(ctx.costBasisRatio).toBeCloseTo(0.6, 5);
    expect(ctx.realEstate).toEqual({ value: 900_000, mortgage: 400_000, netAnnualRent: 24_000 });
    expect(ctx.filingStatus).toBe("married_joint");
  });
  it("falls back to defaults when data is absent", () => {
    const ctx = deriveScheduleContext(null);
    expect(ctx.costBasisRatio).toBeGreaterThan(0);
    expect(ctx.realEstate).toBeNull();
    expect(ctx.filingStatus).toBe("single");
  });
});

describe("per-account drawdown", () => {
  const accounts = [
    { id: "chk", name: "Schwab Checking", bucket: "taxable" as const, kind: "depository" as const, balance: 30_000 },
    { id: "brk1", name: "Vanguard Brokerage", bucket: "taxable" as const, kind: "investment" as const, balance: 900_000 },
    { id: "brk2", name: "Fidelity Brokerage", bucket: "taxable" as const, kind: "investment" as const, balance: 200_000 },
    { id: "401k", name: "Fidelity 401(k)", bucket: "deferred" as const, kind: "investment" as const, balance: 400_000 },
    { id: "roth", name: "Roth IRA", bucket: "roth" as const, kind: "investment" as const, balance: 80_000 },
  ];
  const withAccts: ScheduleInputs = {
    ...base,
    currentAge: 40, retirementAge: 41, monthlySavings: 0,
    buckets: { taxable: 0, deferred: 0, roth: 0, hsa: 0 }, // ignored when accounts present
    accounts,
  };

  it("reconciles at the ACCOUNT level and buckets equal account sums", () => {
    const { rows } = runSchedule(withAccts);
    for (const r of rows) {
      const sums = { taxable: 0, deferred: 0, roth: 0, hsa: 0 } as Record<string, number>;
      for (const f of r.accounts) {
        expect(Math.abs(f.end - (f.start + f.growth + f.contribution - f.withdrawal))).toBeLessThanOrEqual(1);
        sums[f.bucket] += f.end;
      }
      for (const k of ["taxable", "deferred", "roth", "hsa"] as const) {
        expect(Math.abs(r.buckets[k].end - sums[k])).toBeLessThanOrEqual(1);
      }
    }
  });

  it("next year's account start equals this year's account end", () => {
    const { rows } = runSchedule(withAccts);
    for (let i = 1; i < rows.length; i++) {
      for (const f of rows[i].accounts) {
        const prev = rows[i - 1].accounts.find((p) => p.id === f.id)!;
        expect(Math.abs(f.start - prev.end)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("draws cash first, then the largest brokerage; deferred/roth untouched pre-59", () => {
    const { rows } = runSchedule(withAccts);
    const r = rows.find((x) => x.phase === "retirement")!;
    const flow = Object.fromEntries(r.accounts.map((f) => [f.id, f]));
    // checking (cash) is drained before any brokerage sale
    if (flow.brk1.withdrawal > 0) expect(flow.chk.end).toBe(0);
    // largest brokerage drawn before the smaller one
    if (flow.brk2.withdrawal > 0) expect(flow.brk1.end).toBe(0);
    // age-gated accounts untouched before 59
    expect(flow["401k"].withdrawal).toBe(0);
    expect(flow.roth.withdrawal).toBe(0);
  });

  it("cash draws realize no capital gains", () => {
    // Only a big checking account: draws must produce zero LTCG and zero tax.
    const cashOnly: ScheduleInputs = {
      ...withAccts,
      accounts: [{ id: "chk", name: "Checking", bucket: "taxable", kind: "depository", balance: 2_000_000 }],
    };
    const r = runSchedule(cashOnly).rows.find((x) => x.phase === "retirement")!;
    expect(r.portfolioWithdrawal).toBeGreaterThan(0);
    expect(r.ltcgRealized).toBe(0);
    expect(r.estimatedTax).toBe(0);
    expect(r.taxFreeWithdrawal).toBe(r.portfolioWithdrawal);
  });

  it("routes contributions to the 401(k) and the taxable investment account", () => {
    const saver: ScheduleInputs = { ...withAccts, currentAge: 38, retirementAge: 41, monthlySavings: 3_000 };
    const r = runSchedule(saver).rows[0];
    const flow = Object.fromEntries(r.accounts.map((f) => [f.id, f]));
    expect(flow["401k"].contribution).toBe(23_500); // DEFERRED_401K_LIMIT
    expect(flow.brk1.contribution).toBe(36_000 - 23_500); // remainder to largest taxable investment
    expect(flow.chk.contribution).toBe(0); // not parked in checking
  });

  it("synthesizes pseudo-accounts when only buckets are given (backcompat)", () => {
    const { rows } = runSchedule(base);
    expect(rows[0].accounts.length).toBeGreaterThan(0);
    for (const f of rows[0].accounts) expect(f.name).toBeTruthy();
  });
});

describe("earmarked accounts (529/custodial)", () => {
  // A kid's 529 sits in the taxable bucket with more money than every other
  // account — it must NEVER fund the parent's retirement, even when everything
  // else runs dry (a shortfall must appear instead), while still growing.
  const earmarkedInputs: ScheduleInputs = {
    ...base,
    currentAge: 40, retirementAge: 41, monthlySavings: 0,
    ssMonthly: 0,
    buckets: { taxable: 0, deferred: 0, roth: 0, hsa: 0 }, // ignored when accounts present
    accounts: [
      { id: "brk", name: "Vanguard Brokerage", bucket: "taxable", kind: "investment", balance: 200_000 },
      { id: "kid529", name: "Kids 529", bucket: "taxable", kind: "investment", balance: 500_000, earmarked: true },
    ],
  };

  it("never withdraws from an earmarked account, even when other money runs out", () => {
    const { rows, flags } = runSchedule(earmarkedInputs);
    for (const r of rows) {
      const kid = r.accounts.find((f) => f.id === "kid529")!;
      expect(kid.withdrawal).toBe(0);
    }
    // The brokerage is exhausted long before the horizon — the gap must surface
    // as a shortfall, not as a raid on the 529.
    expect(flags.firstShortfallAge).not.toBeNull();
    const shortfallRow = rows.find((r) => r.shortfall > 0)!;
    const kidAtShortfall = shortfallRow.accounts.find((f) => f.id === "kid529")!;
    expect(kidAtShortfall.end).toBeGreaterThan(0);
  });

  it("still grows the earmarked account and counts it in totals", () => {
    const { rows } = runSchedule(earmarkedInputs);
    const kid0 = rows[0].accounts.find((f) => f.id === "kid529")!;
    expect(kid0.end).toBeGreaterThan(kid0.start); // grows in early years
    expect(kid0.earmarked).toBe(true); // flagged on the flow
    const bucketSum = rows[0].accounts.reduce((s, f) => s + f.end, 0);
    expect(Math.abs(rows[0].totalPortfolio - bucketSum)).toBeLessThanOrEqual(1); // counted in totals
  });

  it("never routes contributions to an earmarked account and sorts it last in its bucket", () => {
    const saver: ScheduleInputs = {
      ...earmarkedInputs,
      currentAge: 38, retirementAge: 41, monthlySavings: 3_000,
      accounts: [
        { id: "brk", name: "Vanguard Brokerage", bucket: "taxable", kind: "investment", balance: 100_000 },
        { id: "kid529", name: "Kids 529", bucket: "taxable", kind: "investment", balance: 500_000, earmarked: true },
        { id: "401k", name: "Fidelity 401(k)", bucket: "deferred", kind: "investment", balance: 300_000 },
      ],
    };
    const r = runSchedule(saver).rows[0];
    const flow = Object.fromEntries(r.accounts.map((f) => [f.id, f]));
    // Taxable remainder lands on the non-earmarked brokerage, even though the
    // 529 is the larger taxable investment account.
    expect(flow.kid529.contribution).toBe(0);
    expect(flow.brk.contribution).toBe(36_000 - 23_500);
    // Display order: earmarked last within the taxable bucket despite its size.
    const taxableIds = r.accounts.filter((f) => f.bucket === "taxable").map((f) => f.id);
    expect(taxableIds).toEqual(["brk", "kid529"]);
  });
});
