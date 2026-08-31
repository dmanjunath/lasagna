import { eq, desc, and, accounts, balanceSnapshots, goals, goalAccounts, type GoalDetails } from "@lasagna/core";
import { db } from "./db.js";
import { readMonthlySpend } from "./monthly-spend.js";
import { buildGoalAccountMap, resolveGoalAmount } from "./goal-progress.js";
import { resolveDebtAccounts, type DebtAccount } from "./debt-accounts.js";
import { readHouseholdProfile, readUserPersonalProfile, resolveProfile } from "./profile-resolver.js";

/**
 * Everything a financial path is built from, read once.
 *
 * This is the single read of a household's situation. The path candidates and
 * the sizing pass take this same object, and every surface that shows the path
 * reads it through one endpoint, so two of them can never quote two different
 * figures for the same fact.
 */

/** One active goal, with the typed details its target was derived from. */
export interface PathGoal {
  id: string;
  name: string;
  category: string;
  targetAmount: number;
  currentAmount: number;
  deadline: Date | null;
  /** Typed inputs for the five categories that derive their own target. Null for a plain amount goal. */
  details: GoalDetails | null;
}

export interface PathContext {
  // ── Profile ──
  age: number | null;
  dateOfBirth: Date | null;
  annualIncome: number;
  monthlyIncome: number;
  filingStatus: 'single' | 'married_joint' | 'married_separate' | 'head_of_household' | null;
  employmentType: string | null;
  /**
   * Their answer to "do you have a 401(k)?", as onboarding writes it: the match
   * percent, 0 for a plan that matches nothing, and null for no plan at all.
   *
   * The three are not the same thing, and flattening the last two with `?? 0`
   * told a household with a plan and no match that they had no plan, which cost
   * them the whole elective deferral limit out of their contribution room. That
   * room recurs every year and takes a standing share of the surplus, so
   * understating it re-routes their money for good.
   */
  employerMatchPct: number | null;
  stateOfResidence: string | null;
  retirementAge: number;
  /** False when the 65 above is our default rather than a figure they gave us. */
  retirementAgeSet: boolean;
  riskTolerance: string | null;
  /** True/false when they told us, null when they never did. The three are not
   *  the same thing: a step must not ask for a health plan already on file. */
  hasHDHP: boolean | null;
  /**
   * How many people rely on this income, as onboarding writes it: the count, 0
   * for nobody, and null for a field they never filled in.
   *
   * The same three-way distinction `employerMatchPct` above holds, and it was
   * flattened the same way. Once the term-life step was gated on a count above
   * zero, reading the column as `?? 0` deleted that step from everybody who
   * skipped the question, on the strength of an answer they never gave.
   */
  dependentCount: number | null;
  isPSLFEligible: boolean;

  // ── Spending ──
  /**
   * Non-transfer expense over the last 30 days. Null when there is none.
   *
   * Nothing on the path is priced from this. It is a raw read of one noisy
   * window, kept because it is what the window is, and every figure a step
   * quotes comes from `stableMonthlyExpenses` below.
   */
  monthlyExpenses: number | null;
  /** The stable trailing three-month figure every step is priced from. */
  stableMonthlyExpenses: number | null;
  /** Monthly income minus the stable spend figure. Null without spending history. */
  monthlySurplus: number | null;
  /** The share of income the stable spend figure leaves. Null without spending history. */
  savingsRate: number | null;

  // ── Balances ──
  cashTotal: number;
  hsaBalance: number;
  rothIraBalance: number;
  trad401kBalance: number;
  /**
   * The CATCH-ALL investment bucket: every investment account that is not an
   * HSA, not a Roth IRA and not a workplace plan. A traditional IRA, a 529 and
   * a crypto account all land here, so this is a total of what is invested and
   * not a statement about any wrapper. Only read where every investment counts.
   */
  brokerageBalance: number;
  /**
   * What is held in an ordinary taxable brokerage account, and nothing else.
   *
   * The step that asks somebody to OPEN one was pruned on `brokerageBalance`
   * above, which is a different question: a household holding a traditional IRA
   * and a crypto account read as already having a taxable brokerage, so nobody
   * with a retirement account and money to spare was ever told where anything
   * past the annual limits goes.
   */
  taxableBrokerageBalance: number;
  /** Market value of real_estate accounts that count toward net worth. */
  propertyValue: number;
  hasOverdraft: boolean;
  hasESPP: boolean;
  hasPension: boolean;
  has457b: boolean;
  has403b: boolean;
  hasInheritedIRA: boolean;

  /** Every credit/loan account with its own rate and payment. No aggregate totals: a step names one account. */
  debtAccounts: DebtAccount[];

  goals: PathGoal[];
}

/**
 * Whether an investment account that is not an HSA, a Roth IRA or a workplace
 * plan is nonetheless a TAXABLE BROKERAGE.
 *
 * The bucket it is applied to is the catch-all, so it holds every wrapper this
 * file does not name above: a traditional or rollover IRA, a SEP or SIMPLE, a
 * 529, an annuity, a pension, a crypto account. None of those is the account
 * the brokerage step asks somebody to open, and reading the bucket as though
 * they were deleted that step from anyone holding one.
 *
 * Stated as what a taxable brokerage is NOT, because the bucket already
 * excludes the accounts with a settled vocabulary and what is left is mostly
 * ordinary. A wrapper we fail to recognise offers somebody a step they have
 * already taken, which is the milder of the two failures.
 */
function isTaxableBrokerage(subtypeOrName: string): boolean {
  return !/\bira\b|retirement|529|education savings|coverdell|annuity|pension|keogh|profit.sharing|thrift|\btsp\b|sarsep|\bsep\b|simple|non.?taxable|crypto|\besop\b/.test(
    subtypeOrName,
  );
}

export async function buildPathContext(tenantId: string, userId: string): Promise<PathContext> {
  const [accts, debtAccounts, household, personal, activeGoals, goalLinks] = await Promise.all([
    (async () => {
      const allAccounts = await db.query.accounts.findMany({
        where: eq(accounts.tenantId, tenantId),
      });
      return Promise.all(
        allAccounts.map(async (acct) => {
          const latest = await db.query.balanceSnapshots.findFirst({
            where: eq(balanceSnapshots.accountId, acct.id),
            orderBy: [desc(balanceSnapshots.snapshotAt)],
          });
          const rawBalance = parseFloat(latest?.balance ?? "0");
          return { ...acct, balance: acct.invertBalance ? -rawBalance : rawBalance };
        }),
      );
    })(),
    // Per-account debts with their real APR resolved from liability metadata —
    // the same resolver /accounts/debts uses, so the path and the debt page
    // can never disagree about an account's rate.
    resolveDebtAccounts(tenantId),
    // Household row + THIS user's personal profile → merged for the per-user
    // "you vs partner" figures.
    readHouseholdProfile(tenantId),
    readUserPersonalProfile(tenantId, userId),
    db.query.goals.findMany({
      where: and(eq(goals.tenantId, tenantId), eq(goals.status, 'active')),
    }),
    db.query.goalAccounts.findMany({
      where: eq(goalAccounts.tenantId, tenantId),
    }),
  ]);

  const resolved = resolveProfile(household ?? null, personal ?? null);

  const goalAccountMap = buildGoalAccountMap(goalLinks);
  const goalBalanceById = new Map(accts.map((a) => [a.id, a.balance]));

  const annualIncome = resolved.annualIncome ?? 0;
  const monthlyIncome = annualIncome / 12;

  let cashTotal = 0, hsaBalance = 0, rothIraBalance = 0, trad401kBalance = 0, brokerageBalance = 0;
  let taxableBrokerageBalance = 0;
  let propertyValue = 0;
  let has457b = false, has403b = false;

  for (const acct of accts) {
    if (acct.excludeFromNetWorth) continue;
    const sub = (acct.subtype || acct.name || "").toLowerCase();

    if (acct.type === "depository") {
      cashTotal += acct.balance;
    } else if (acct.type === "investment") {
      if (sub.includes("hsa") || sub.includes("health savings")) hsaBalance += acct.balance;
      else if (sub.includes("roth") && sub.includes("ira")) rothIraBalance += acct.balance;
      else if (sub.includes("401") || sub.includes("403b") || sub.includes("457")) trad401kBalance += acct.balance;
      else {
        brokerageBalance += acct.balance;
        if (isTaxableBrokerage(sub)) taxableBrokerageBalance += acct.balance;
      }
      if (sub.includes("457")) has457b = true;
      if (sub.includes("403")) has403b = true;
    } else if (acct.type === "real_estate") {
      propertyValue += acct.balance;
    }
  }

  // Monthly spend — the shared definition, so the path and an emergency-fund
  // goal can never quote two different averages for the same spending.
  //
  // The surplus and the savings rate both come off the STABLE figure, the same
  // one the emergency fund and the independence number are priced from. Off the
  // 30-day window they did not: a month that happened to be quiet read as a 99%
  // savings rate on the same screen where independence was priced at ten times
  // that month's spending.
  const { monthlyExpenses, stableMonthlyExpenses } = await readMonthlySpend(tenantId);
  const monthlySurplus =
    stableMonthlyExpenses !== null ? monthlyIncome - stableMonthlyExpenses : null;
  const savingsRate = monthlySurplus !== null && monthlyIncome > 0
    ? Math.round((monthlySurplus / monthlyIncome) * 100)
    : null;

  return {
    age: resolved.age,
    dateOfBirth: resolved.dateOfBirth,
    annualIncome,
    monthlyIncome,
    filingStatus: (resolved.filingStatus ?? null) as PathContext['filingStatus'],
    employmentType: resolved.employmentType ?? 'w2',
    employerMatchPct: resolved.employerMatchPercent ?? null,
    stateOfResidence: resolved.stateOfResidence ?? null,
    retirementAge: resolved.retirementAge ?? 65,
    retirementAgeSet: resolved.retirementAge != null,
    riskTolerance: resolved.riskTolerance ?? null,
    hasHDHP: resolved.hasHDHP,
    dependentCount: resolved.dependentCount,
    isPSLFEligible: resolved.isPSLFEligible ?? false,

    monthlyExpenses,
    stableMonthlyExpenses,
    monthlySurplus,
    savingsRate,

    cashTotal, hsaBalance, rothIraBalance, trad401kBalance, brokerageBalance,
    taxableBrokerageBalance,
    propertyValue,
    hasOverdraft: false,
    hasESPP: false,
    hasPension: false,
    has457b, has403b,
    hasInheritedIRA: false,

    debtAccounts,

    goals: activeGoals.map((g) => ({
      id: g.id,
      name: g.name,
      category: g.category,
      targetAmount: parseFloat(g.targetAmount ?? "0"),
      currentAmount: resolveGoalAmount(
        g.currentAmount ?? "0",
        goalAccountMap.get(g.id),
        goalBalanceById,
      ).amount,
      deadline: g.deadline ? new Date(g.deadline) : null,
      details: (g.details as GoalDetails | null) ?? null,
    })),
  };
}

/**
 * A context with everything zeroed, for tests and for callers that need a
 * shape without a database.
 */
export function buildPathContextDefaults(overrides: Partial<PathContext> = {}): PathContext {
  return {
    age: null,
    dateOfBirth: null,
    annualIncome: 0,
    monthlyIncome: 0,
    filingStatus: null,
    employmentType: 'w2',
    employerMatchPct: null,
    stateOfResidence: null,
    retirementAge: 65,
    retirementAgeSet: false,
    riskTolerance: null,
    hasHDHP: null,
    dependentCount: null,
    isPSLFEligible: false,
    monthlyExpenses: null,
    stableMonthlyExpenses: null,
    monthlySurplus: null,
    savingsRate: null,
    cashTotal: 0,
    hsaBalance: 0,
    rothIraBalance: 0,
    trad401kBalance: 0,
    brokerageBalance: 0,
    taxableBrokerageBalance: 0,
    propertyValue: 0,
    hasOverdraft: false,
    hasESPP: false,
    hasPension: false,
    has457b: false,
    has403b: false,
    hasInheritedIRA: false,
    debtAccounts: [],
    goals: [],
    ...overrides,
  };
}
