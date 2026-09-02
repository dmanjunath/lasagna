import { llmGenerateText } from "./llm.js";
import { getModel, getModelSlug } from "../agent/index.js";
import { logLlmUsage } from "./activity.js";
import { isTenantDisabled } from "./billing.js";
import { db } from "./db.js";
import { env } from "./env.js";
import { buildAliasMap, scrub, descrub } from "./pii-scrubber.js";
import {
  accounts,
  balanceSnapshots,
  holdings,
  securities,
  insights,
  financialProfiles,
  transactions,
  categories,
  categoryGroups,
  goals,
  goalAccounts,
  taxDocuments,
  eq,
  and,
  desc,
  sql,
  notInArray,
} from "@lasagna/core";
import {
  excludedTxnAccountIds,
  fetchAccountsWithBalances,
} from "./account-balances.js";
import { buildGoalAccountMap, resolveGoalAmount } from "./goal-progress.js";
import { statementPaidInFull } from "./debt-accounts.js";

/**
 * Whether this account is a credit card cleared in full each month. Such a card
 * is this month's spending, not a debt, so it is left out of the debt trajectory
 * the model reasons over — nothing may recommend paying off a balance the person
 * already clears. Reads the transactor signal off the account's own metadata and
 * applies the same rule the path uses. See `creditCardPaysInFull`.
 */
export function debtAccountPaidInFull(a: {
  type: string;
  metadata: Record<string, unknown> | null;
  paidInFullMonthly?: boolean;
}): boolean {
  if (a.type !== "credit") return false;
  if (a.paidInFullMonthly) return true;
  const meta = a.metadata ?? {};
  const stmt = typeof meta.lastStatementBalance === "number" ? meta.lastStatementBalance : null;
  const paid = typeof meta.lastPaymentAmount === "number" ? meta.lastPaymentAmount : null;
  return statementPaidInFull(stmt, paid);
}
import { readPathSteps } from "./path-generator.js";
import {
  readHouseholdProfile,
  readOwnerPersonalProfile,
  resolveProfile,
} from "./profile-resolver.js";

interface FinancialSnapshot {
  accounts: Array<{
    name: string;
    type: string;
    subtype: string | null;
    balance: number;
    balanceDelta30d: number | null;
    metadata: Record<string, unknown> | null;
  }>;
  holdings: Array<{
    ticker: string;
    name: string;
    quantity: number;
    value: number;
    costBasis: number | null;
    accountName: string;
  }>;
  profile: {
    annualIncome: number | null;
    filingStatus: string | null;
    stateOfResidence: string | null;
    riskTolerance: string | null;
    retirementAge: number | null;
    employerMatchPercent: number | null;
    age: number | null;
  } | null;
  summary: {
    netWorth: number;
    totalAssets: number;
    totalLiabilities: number;
    totalDepository: number;
    totalInvestment: number;
    totalCredit: number;
    totalLoan: number;
    monthlyIncome: number;
    monthlyExpensesCurrent: number;
    monthlyExpensesPrior: number;
    savingsRateCurrent: number | null;
    savingsRatePrior: number | null;
  };
  spending: {
    analysisMonthLabel: string;
    analysisMonth: Array<{ category: string; total: number }>;
    priorMonth: Array<{ category: string; total: number }>;
    topMerchants: Array<{ merchant: string; total: number }>;
    recurringCharges: Array<{ merchant: string; monthlyAvg: number }>;
    inProgressMonth: {
      label: string;
      totalSpendSoFar: number;
      recentMonthlyAvgSpend: number;
    };
  };
  goals: Array<{
    name: string;
    targetAmount: number;
    currentAmount: number;
    deadline: string | null;
    status: string;
    projectedCompletionDate: string | null;
  }>;
  debtTrajectory: Array<{
    name: string;
    balance: number;
    /** The rate on file, or null when the account has none. Never a substitute. */
    interestRate: number | null;
    minimumPayment: number | null;
    monthsToPayoff: number | null;
    totalInterestRemaining: number | null;
  }>;
  /**
   * Credit cards cleared in full every month. The balance is this month's
   * spending, not debt: never a payoff target. Listed so the model can name
   * them to steer AROUND, not act on.
   */
  paidInFullCards: Array<{ name: string; balance: number }>;
  taxDocuments: Array<{
    documentType: string | null;
    taxYear: number | null;
    fields: Record<string, unknown>;
    summary: string;
  }>;
}

interface GeneratedInsight {
  category: "portfolio" | "debt" | "tax" | "savings" | "general";
  urgency: "low" | "medium" | "high" | "critical";
  type: string;
  title: string;
  description: string;
  impact: string;
  impactColor: "green" | "amber" | "red";
  chatPrompt: string;
  /** The key of the path step this action serves, or "none". */
  pathStepKey?: string;
}

/**
 * Every holding this tenant owns, joined to the security that names it.
 *
 * One definition, because two readers need the same answer: the snapshot the
 * model reasons over, and `heldSecurityNames` below, which decides whether an
 * action names something the reader actually holds. Two copies of this query
 * would be two different sets of holdings the day one of them gained a filter.
 */
function readHoldingRows(tenantId: string) {
  return db
    .select({
      ticker: securities.tickerSymbol,
      secName: securities.name,
      quantity: holdings.quantity,
      value: holdings.institutionValue,
      costBasis: holdings.costBasis,
      accountName: accounts.name,
    })
    .from(holdings)
    .innerJoin(securities, eq(holdings.securityId, securities.id))
    .innerJoin(accounts, eq(holdings.accountId, accounts.id))
    .where(eq(holdings.tenantId, tenantId));
}

async function gatherFinancialData(
  tenantId: string
): Promise<FinancialSnapshot> {
  const now = new Date();
  // Spending/cash-flow analysis runs on the last COMPLETE month, not the partial
  // in-progress one: mid-month, income is partial (e.g. 1 of 2 paychecks in) while
  // most expenses have landed, which fabricates "negative cash flow" and spike
  // signals. The in-progress month is only surfaced if its month-to-date total is a
  // significant anomaly vs the recent complete months (see the SPENDING lens).
  const inProgressMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const analysisMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const analysisMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  const priorMonthStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const priorMonthEnd = new Date(now.getFullYear(), now.getMonth() - 1, 0, 23, 59, 59);
  const baselineStart = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);

  // Accounts base
  const accts = await db
    .select({
      name: accounts.name,
      type: accounts.type,
      subtype: accounts.subtype,
      metadata: accounts.metadata,
      accountId: accounts.id,
      excludeFromNetWorth: accounts.excludeFromNetWorth,
      invertBalance: accounts.invertBalance,
    })
    .from(accounts)
    .where(eq(accounts.tenantId, tenantId));

  // Accounts with current + 30-days-ago balances
  const accountsWithBalances = await Promise.all(
    accts.map(async (a) => {
      const [snap, oldSnap] = await Promise.all([
        db
          .select({ balance: balanceSnapshots.balance })
          .from(balanceSnapshots)
          .where(eq(balanceSnapshots.accountId, a.accountId))
          .orderBy(desc(balanceSnapshots.snapshotAt))
          .limit(1),
        db
          .select({ balance: balanceSnapshots.balance })
          .from(balanceSnapshots)
          .where(
            and(
              eq(balanceSnapshots.accountId, a.accountId),
              sql`${balanceSnapshots.snapshotAt} <= ${thirtyDaysAgo.toISOString()}`
            )
          )
          .orderBy(desc(balanceSnapshots.snapshotAt))
          .limit(1),
      ]);

      let metadata: Record<string, unknown> | null = null;
      try {
        if (a.metadata) metadata = JSON.parse(a.metadata);
      } catch {
        /* ignore */
      }

      const currentBal = parseFloat(snap[0]?.balance || "0");
      const oldBal = oldSnap[0] ? parseFloat(oldSnap[0].balance ?? "0") : null;

      return {
        name: a.name,
        type: a.type,
        subtype: a.subtype,
        balance: currentBal,
        balanceDelta30d:
          oldBal !== null
            ? Math.round((currentBal - oldBal) * 100) / 100
            : null,
        metadata,
        excludeFromNetWorth: a.excludeFromNetWorth,
        invertBalance: a.invertBalance,
      };
    })
  );

  // Holdings
  const holdingRows = await readHoldingRows(tenantId);

  const holdingsData = holdingRows.map((h) => ({
    ticker: h.ticker || "Unknown",
    name: h.secName || "Unknown",
    quantity: parseFloat(h.quantity || "0"),
    value: parseFloat(h.value || "0"),
    costBasis: h.costBasis ? parseFloat(h.costBasis) : null,
    accountName: h.accountName,
  }));

  // Profile — session-less cron: household fields from the tenant profile,
  // personal fields (income, DOB/age, risk, retirement age, match) from the
  // tenant OWNER's personal profile.
  const [householdRow, ownerPersonal] = await Promise.all([
    readHouseholdProfile(tenantId),
    readOwnerPersonalProfile(tenantId),
  ]);
  const resolvedOwner = resolveProfile(householdRow ?? null, ownerPersonal ?? null);

  let profile: FinancialSnapshot["profile"] = null;
  if (householdRow || ownerPersonal) {
    profile = {
      annualIncome: resolvedOwner.annualIncome,
      filingStatus: resolvedOwner.filingStatus,
      stateOfResidence: resolvedOwner.stateOfResidence,
      riskTolerance: resolvedOwner.riskTolerance,
      retirementAge: resolvedOwner.retirementAge,
      employerMatchPercent: resolvedOwner.employerMatchPercent,
      age: resolvedOwner.age,
    };
  }

  // Summary totals
  let totalAssets = 0,
    totalLiabilities = 0,
    totalDepository = 0,
    totalInvestment = 0,
    totalCredit = 0,
    totalLoan = 0;

  for (const a of accountsWithBalances) {
    if (a.excludeFromNetWorth) continue;
    const effBalance = a.invertBalance ? -a.balance : a.balance;
    if (a.type === "credit" || a.type === "loan") {
      totalLiabilities += effBalance;
      if (a.type === "credit") totalCredit += effBalance;
      if (a.type === "loan") totalLoan += effBalance;
    } else {
      totalAssets += effBalance;
      if (a.type === "depository") totalDepository += effBalance;
      if (a.type === "investment") totalInvestment += effBalance;
    }
  }

  // Accounts whose transactions the user has hidden from spending views
  const excludedTxnIds = await excludedTxnAccountIds(tenantId);

  // Spending: current and prior month
  // Classification via taxonomy group type; labels are tenant display names
  // (spec: insights read names via join).
  const categoryNameExpr = sql<string>`coalesce(${categories.name}, 'Other')`;
  const [currentSpendRows, priorSpendRows] = await Promise.all([
    db
      .select({
        category: categoryNameExpr,
        total: sql<string>`coalesce(sum(${transactions.amount}), 0)`,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
      .where(
        and(
          eq(transactions.tenantId, tenantId),
          sql`${transactions.amount} > 0`,
          sql`coalesce(${categoryGroups.type}::text, 'expense') NOT IN ('income', 'transfer')`,
          sql`${transactions.date} >= ${analysisMonthStart.toISOString()}`,
          sql`${transactions.date} <= ${analysisMonthEnd.toISOString()}`,
          ...(excludedTxnIds.length > 0
            ? [notInArray(transactions.accountId, excludedTxnIds)]
            : [])
        )
      )
      .groupBy(categoryNameExpr),
    db
      .select({
        category: categoryNameExpr,
        total: sql<string>`coalesce(sum(${transactions.amount}), 0)`,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
      .where(
        and(
          eq(transactions.tenantId, tenantId),
          sql`${transactions.amount} > 0`,
          sql`coalesce(${categoryGroups.type}::text, 'expense') NOT IN ('income', 'transfer')`,
          sql`${transactions.date} >= ${priorMonthStart.toISOString()}`,
          sql`${transactions.date} <= ${priorMonthEnd.toISOString()}`,
          ...(excludedTxnIds.length > 0
            ? [notInArray(transactions.accountId, excludedTxnIds)]
            : [])
        )
      )
      .groupBy(categoryNameExpr),
  ]);

  const analysisMonthLabel = analysisMonthStart.toLocaleString("en-US", { month: "long", year: "numeric" });
  const inProgressMonthLabel = inProgressMonthStart.toLocaleString("en-US", { month: "long", year: "numeric" });

  // In-progress (partial) month total spend + baseline (avg of last 3 complete months).
  // Fed to the LLM only so it can decide whether the in-progress month is a SIGNIFICANT
  // anomaly worth surfacing — normal spending analysis uses the complete analysis month.
  const [inProgressSpendRow, baselineSpendRow] = await Promise.all([
    db
      .select({ total: sql<string>`coalesce(sum(${transactions.amount}), 0)` })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
      .where(
        and(
          eq(transactions.tenantId, tenantId),
          sql`${transactions.amount} > 0`,
          sql`coalesce(${categoryGroups.type}::text, 'expense') NOT IN ('income', 'transfer')`,
          sql`${transactions.date} >= ${inProgressMonthStart.toISOString()}`,
          ...(excludedTxnIds.length > 0 ? [notInArray(transactions.accountId, excludedTxnIds)] : [])
        )
      ),
    db
      .select({ total: sql<string>`coalesce(sum(${transactions.amount}), 0)` })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
      .where(
        and(
          eq(transactions.tenantId, tenantId),
          sql`${transactions.amount} > 0`,
          sql`coalesce(${categoryGroups.type}::text, 'expense') NOT IN ('income', 'transfer')`,
          sql`${transactions.date} >= ${baselineStart.toISOString()}`,
          sql`${transactions.date} <= ${analysisMonthEnd.toISOString()}`,
          ...(excludedTxnIds.length > 0 ? [notInArray(transactions.accountId, excludedTxnIds)] : [])
        )
      ),
  ]);
  const inProgressSpend = Math.round(parseFloat(inProgressSpendRow[0]?.total ?? "0") * 100) / 100;
  const baselineMonthlyAvgSpend = Math.round((parseFloat(baselineSpendRow[0]?.total ?? "0") / 3) * 100) / 100;

  // Top merchants (analysis month)
  const topMerchantRows = await db
    .select({
      merchant: transactions.merchantName,
      total: sql<string>`coalesce(sum(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(
      and(
        eq(transactions.tenantId, tenantId),
        sql`${transactions.amount} > 0`,
        sql`coalesce(${categoryGroups.type}::text, 'expense') NOT IN ('income', 'transfer')`,
        sql`${transactions.merchantName} IS NOT NULL`,
        sql`${transactions.date} >= ${analysisMonthStart.toISOString()}`,
        sql`${transactions.date} <= ${analysisMonthEnd.toISOString()}`,
        ...(excludedTxnIds.length > 0
          ? [notInArray(transactions.accountId, excludedTxnIds)]
          : [])
      )
    )
    .groupBy(transactions.merchantName)
    .orderBy(sql`sum(${transactions.amount}) DESC`)
    .limit(5);

  // Recurring charges: merchants appearing in 3+ of last 3 months (subscriptions + entertainment)
  const subRows = await db
    .select({
      merchant: transactions.merchantName,
      month: sql<string>`date_trunc('month', ${transactions.date})`,
      total: sql<string>`sum(${transactions.amount})`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        eq(transactions.tenantId, tenantId),
        sql`${transactions.amount} > 0`,
        // systemKey, not group type — this targets two specific categories
        sql`${categories.systemKey} IN ('subscriptions', 'entertainment')`,
        sql`${transactions.merchantName} IS NOT NULL`,
        sql`${transactions.date} >= ${threeMonthsAgo.toISOString()}`,
        ...(excludedTxnIds.length > 0
          ? [notInArray(transactions.accountId, excludedTxnIds)]
          : [])
      )
    )
    .groupBy(
      transactions.merchantName,
      sql`date_trunc('month', ${transactions.date})`
    );

  // Compute recurring in JS
  const merchantMonthMap = new Map<
    string,
    { months: Set<string>; totals: number[] }
  >();
  for (const row of subRows) {
    const m = row.merchant || "Unknown";
    if (!merchantMonthMap.has(m))
      merchantMonthMap.set(m, { months: new Set(), totals: [] });
    const entry = merchantMonthMap.get(m)!;
    entry.months.add(row.month);
    entry.totals.push(parseFloat(row.total));
  }
  const recurringCharges = Array.from(merchantMonthMap.entries())
    .filter(([, v]) => v.months.size >= 3)
    .map(([merchant, v]) => ({
      merchant,
      monthlyAvg:
        Math.round(
          (v.totals.reduce((a, b) => a + b, 0) / v.totals.length) * 100
        ) / 100,
    }));

  // Monthly income
  const [currentIncomeRow, priorIncomeRow] = await Promise.all([
    db
      .select({
        total: sql<string>`coalesce(sum(abs(${transactions.amount})), 0)`,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
      .where(
        and(
          eq(transactions.tenantId, tenantId),
          sql`coalesce(${categoryGroups.type}::text, 'expense') = 'income'`,
          sql`${transactions.date} >= ${analysisMonthStart.toISOString()}`,
          sql`${transactions.date} <= ${analysisMonthEnd.toISOString()}`,
          ...(excludedTxnIds.length > 0
            ? [notInArray(transactions.accountId, excludedTxnIds)]
            : [])
        )
      ),
    db
      .select({
        total: sql<string>`coalesce(sum(abs(${transactions.amount})), 0)`,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
      .where(
        and(
          eq(transactions.tenantId, tenantId),
          sql`coalesce(${categoryGroups.type}::text, 'expense') = 'income'`,
          sql`${transactions.date} >= ${priorMonthStart.toISOString()}`,
          sql`${transactions.date} <= ${priorMonthEnd.toISOString()}`,
          ...(excludedTxnIds.length > 0
            ? [notInArray(transactions.accountId, excludedTxnIds)]
            : [])
        )
      ),
  ]);

  const monthlyIncomeCurrent = parseFloat(currentIncomeRow[0]?.total ?? "0");
  const monthlyIncomePrior = parseFloat(priorIncomeRow[0]?.total ?? "0");
  const annualIncomeFromProfile = resolvedOwner.annualIncome ?? 0;
  const effectiveMonthlyIncome =
    monthlyIncomeCurrent > 0
      ? monthlyIncomeCurrent
      : annualIncomeFromProfile / 12;
  const effectiveMonthlyIncomePrior =
    monthlyIncomePrior > 0 ? monthlyIncomePrior : annualIncomeFromProfile / 12;

  const totalCurrentExpenses = currentSpendRows.reduce(
    (s, r) => s + parseFloat(r.total),
    0
  );
  const totalPriorExpenses = priorSpendRows.reduce(
    (s, r) => s + parseFloat(r.total),
    0
  );
  const monthlySurplus = effectiveMonthlyIncome - totalCurrentExpenses;

  const savingsRateCurrent =
    effectiveMonthlyIncome > 0
      ? Math.round(
          ((effectiveMonthlyIncome - totalCurrentExpenses) /
            effectiveMonthlyIncome) *
            1000
        ) / 10
      : null;
  const savingsRatePrior =
    effectiveMonthlyIncomePrior > 0
      ? Math.round(
          ((effectiveMonthlyIncomePrior - totalPriorExpenses) /
            effectiveMonthlyIncomePrior) *
            1000
        ) / 10
      : null;

  // Goals
  const [goalsRows, goalLinks, goalAccts] = await Promise.all([
    db
      .select()
      .from(goals)
      .where(and(eq(goals.tenantId, tenantId), eq(goals.status, "active"))),
    db.query.goalAccounts.findMany({ where: eq(goalAccounts.tenantId, tenantId) }),
    fetchAccountsWithBalances(tenantId),
  ]);
  const goalAccountMap = buildGoalAccountMap(goalLinks);
  const goalBalanceById = new Map(
    goalAccts.map((a) => [a.id, a.effectiveBalance]),
  );

  const goalsData = goalsRows.map((g) => {
    const target = parseFloat(g.targetAmount);
    let current = resolveGoalAmount(
      g.currentAmount,
      goalAccountMap.get(g.id),
      goalBalanceById,
    ).amount;

    // For retirement goals, use actual invested balance if higher than stored currentAmount
    const cat = (g.category || "").toLowerCase();
    if (cat === "retirement" || cat === "fire" || cat === "financial_independence") {
      const actualInvested = totalInvestment + totalDepository;
      if (actualInvested > current) {
        current = actualInvested;
      }
    }

    const remaining = target - current;
    let projectedCompletion: string | null = null;

    if (remaining <= 0) {
      projectedCompletion = "completed";
    } else if (monthlySurplus > 0) {
      const monthsToGo = Math.ceil(remaining / monthlySurplus);
      // Cap at 30 years — beyond that the projection is meaningless
      if (monthsToGo <= 360) {
        const projDate = new Date();
        projDate.setMonth(projDate.getMonth() + monthsToGo);
        projectedCompletion = projDate.toISOString().slice(0, 7);
      } else {
        projectedCompletion = "unreachable_at_current_rate";
      }
    }

    return {
      name: g.name,
      targetAmount: target,
      currentAmount: Math.round(current),
      deadline: g.deadline ? g.deadline.toISOString().slice(0, 10) : null,
      status: g.status,
      projectedCompletionDate: projectedCompletion,
    };
  });

  // Debt trajectory
  const debtAccounts = accountsWithBalances.filter(
    (a) =>
      !a.excludeFromNetWorth &&
      (a.type === "credit" || a.type === "loan") &&
      // A card paid in full each month is this month's spending, not a debt to
      // recommend paying off. Keep it out of what the model reasons over.
      !debtAccountPaidInFull(a)
  );

  // Named so the model can steer AROUND them: these clear every month and must
  // never be a payoff target, nor a place to move cash to "clear".
  const paidInFullCards = accountsWithBalances
    .filter((a) => !a.excludeFromNetWorth && a.type === "credit" && debtAccountPaidInFull(a))
    .map((a) => ({
      name: a.name,
      balance: Math.abs(a.invertBalance ? -a.balance : a.balance),
    }));

  const debtTrajectory = debtAccounts.map((a) => {
    const meta = a.metadata || {};
    // A rate we do not hold is not a rate of 0%. Flattened to zero, the model
    // was told an account carried no interest and wrote "the current interest
    // rate shows as 0%" onto a card whose own copy, two inches above, read "no
    // rate on file". Null says what is true, and the payoff arithmetic below
    // does not run on a rate nobody supplied.
    const rate =
      typeof meta.interestRate === "number" ? meta.interestRate : null;
    const minPayment =
      typeof meta.minimumPayment === "number" ? meta.minimumPayment : null;
    const balance = Math.abs(a.invertBalance ? -a.balance : a.balance);

    let monthsToPayoff: number | null = null;
    let totalInterestRemaining: number | null = null;

    if (rate !== null && minPayment && minPayment > 0 && balance > 0) {
      if (rate === 0) {
        monthsToPayoff = Math.ceil(balance / minPayment);
        totalInterestRemaining = 0;
      } else {
        const monthlyRate = rate / 100 / 12;
        if (minPayment > balance * monthlyRate) {
          monthsToPayoff = Math.ceil(
            -Math.log(1 - (balance * monthlyRate) / minPayment) /
              Math.log(1 + monthlyRate)
          );
          totalInterestRemaining =
            Math.round((minPayment * monthsToPayoff - balance) * 100) / 100;
        }
      }
    }

    return {
      name: a.name,
      balance,
      interestRate: rate,
      minimumPayment: minPayment,
      monthsToPayoff,
      totalInterestRemaining,
    };
  });

  return {
    accounts: accountsWithBalances,
    holdings: holdingsData,
    profile,
    summary: {
      netWorth: Math.round(totalAssets - totalLiabilities),
      totalAssets: Math.round(totalAssets),
      totalLiabilities: Math.round(totalLiabilities),
      totalDepository: Math.round(totalDepository),
      totalInvestment: Math.round(totalInvestment),
      totalCredit: Math.round(totalCredit),
      totalLoan: Math.round(totalLoan),
      monthlyIncome: Math.round(effectiveMonthlyIncome),
      monthlyExpensesCurrent: Math.round(totalCurrentExpenses),
      monthlyExpensesPrior: Math.round(totalPriorExpenses),
      savingsRateCurrent,
      savingsRatePrior,
    },
    spending: {
      // Spending analysis uses the last COMPLETE month vs the one before it — never the
      // partial in-progress month (which fabricates false spikes / negative cash flow).
      analysisMonthLabel,
      analysisMonth: currentSpendRows.map((r) => ({
        category: r.category,
        total: Math.round(parseFloat(r.total) * 100) / 100,
      })),
      priorMonth: priorSpendRows.map((r) => ({
        category: r.category,
        total: Math.round(parseFloat(r.total) * 100) / 100,
      })),
      topMerchants: topMerchantRows.map((r) => ({
        merchant: r.merchant || "Unknown",
        total: Math.round(parseFloat(r.total) * 100) / 100,
      })),
      recurringCharges,
      // Partial month — provided ONLY so a SIGNIFICANT anomaly can be surfaced (see SPENDING lens).
      inProgressMonth: {
        label: inProgressMonthLabel,
        totalSpendSoFar: inProgressSpend,
        recentMonthlyAvgSpend: baselineMonthlyAvgSpend,
      },
    },
    goals: goalsData,
    debtTrajectory,
    paidInFullCards,
    taxDocuments: await (async () => {
      const docs = await db
        .select({
          llmFields: taxDocuments.llmFields,
          llmSummary: taxDocuments.llmSummary,
          taxYear: taxDocuments.taxYear,
        })
        .from(taxDocuments)
        .where(eq(taxDocuments.tenantId, tenantId))
        .orderBy(desc(taxDocuments.createdAt));
      return docs.map((d) => {
        const fields = (d.llmFields ?? {}) as Record<string, unknown>;
        return {
          documentType: (fields.document_type || fields.form_type || null) as string | null,
          taxYear: d.taxYear,
          fields,
          summary: d.llmSummary,
        };
      });
    })(),
  };
}

const INSIGHTS_PROMPT = `You are Lasagna's financial insights engine. Analyze the user's complete financial data and surface the most actionable, most urgent insights first. Quality over quantity: there is no minimum — do not pad with weak observations.

CRITICAL RULES:
1. Every insight MUST include at least one specific dollar amount or percentage from the actual data
2. Every insight MUST include a comparison (vs last month, vs target, vs a benchmark, vs a threshold)
3. Every insight MUST end with a concrete next step — "review", "consider", "look into", or "adjust accordingly" are NOT concrete. A concrete step is: "increase X by $Y", "move $X from A to B", "open an account at...", "set up automatic transfer of $X/mo"
4. NEVER generate an insight from a lens if that lens has no data (e.g., skip spending insights if spending arrays are empty)
5. NEVER make factually incorrect statements — double-check all tax bracket thresholds against the user's actual income
6. Keep dollar amounts consistent: if the title states a figure, it MUST match the impact field. The figure is either the amount to act on (a balance, a monthly contribution, remaining contribution room) or a NON-TAX benefit (interest avoided, employer match earned, extra investment return). Never state the same figure two different ways.
7. When calculating opportunity costs, use a single consistent spread percentage throughout the insight.
8. NEVER report a goal as "behind" if currentAmount >= targetAmount — that goal is MET. If projectedCompletionDate is "completed", the goal is achieved.
9. NEVER produce timelines more than 30 years out. If a projection would be absurd (e.g., "complete in 2120"), instead calculate what monthly savings increase would be needed to hit the deadline.
10. AVOID generic boilerplate advice like "max out your 401(k)" or "contribute to your Roth IRA" unless you can tie it to a SPECIFIC number from the data (e.g., "You're contributing $15k to your 401(k), so $8,500 of this year's limit is still unused."). If you can't name a specific amount to act on from their data, don't generate the insight.
11. When taxDocuments are present, PRIORITIZE document-specific insights (Lens 5) over generic optimization advice (Lens 3). The user uploaded documents to get specific analysis, not boilerplate.
12. AT MOST ONE insight may primarily flag missing/incomplete data (phrases like "no holdings data", "with no payment tracking", "unknown interest rate", "no income tracked", "$0 monthly expenses"). The user knows their data is incomplete — repeating it across 3-4 insights is noise. If multiple data gaps exist, pick the single highest-impact gap and combine the rest into one "complete your profile" suggestion. Every OTHER insight must derive a concrete recommendation from data that IS present (account balances, balances by type, ages, account names, debt/asset ratios, etc.) — even partial data supports useful advice.
13. STYLE: never use em dashes, en dashes, middots, or semicolons in any output field. Write complete sentences. Write ranges as "X to Y".
14. TITLES ARE ACTIONS, NOT DIAGNOSES. Start every title with an imperative verb naming the move (Pay, Open, Move, Raise, Trim, Cancel, Add, Switch, Rebalance, Invest, Set). The title says what to DO; the description says why. Bad: "Credit card at 24.99% APR costs $736/yr". Good: "Pay down your $3,076 card to stop $736/yr in interest". Bad: "Missing $3,400/yr in free employer match". Good: "Raise your 401(k) to 4% to claim $3,400/yr in free match".
15. If an insight is a positive trend, a healthy metric, or an on-track status with no move to make (a spending category dropped, a ratio is healthy, a goal is on pace), either give it a concrete next move (e.g. "Redirect the $158 grocery drop into savings") or do NOT emit it. The Actions list is for actions, not congratulations or observations.
16. NEVER state or estimate a dollar or percentage amount of TAX that an action would save, avoid, defer, refund, or reduce. No "saves $2,040 in taxes", no "cuts your tax bill by 12%", no credit estimate, no refund estimate, no deduction expressed as its tax value. Name the OPPORTUNITY and the amount to ACT ON from their data (contribution room left, an account balance, the annual limit, a withholding gap, a harvestable loss) and leave the tax outcome unquantified. This binds on the title, the description and the impact field. NON-TAX benefits are untouched and still stated in dollars exactly as before: interest avoided on a debt, employer match earned, and investment opportunity cost.

## The user's financial path

The user is working through a numbered path, and its steps are given to you after their data as "financial path". Attach every action to the step it serves, in "pathStepKey", using the step's "key" EXACTLY as it was given to you. That is what lets the action be read as part of the plan rather than as one more suggestion.

- Pick the step the action MOVES FORWARD, not the step it merely mentions. Paying down a card is the card's own step. Raising a 401(k) contribution to capture the match is the match step, not a retirement step further along.
- Never invent a key, and never adapt one. A key you were not given is dropped and the action loses its place in the plan.
- Use "none" when no step is genuinely served. Fraud, a document to file, a habit with no rung on the path: these are real actions and they are kept, so do not force one onto the nearest step to avoid saying "none".
- A step may carry several actions, and a step may carry none. Do not spread actions across steps to even them out.
- If no path was given, use "none" for every action.

Analyze through these 4 lenses and generate insights from each lens WHERE THE DATA SUPPORTS IT:

---

## Lens 1: SPENDING
Spending is analyzed on the LAST COMPLETE month (spending.analysisMonth, named spending.analysisMonthLabel) vs the month before it (spending.priorMonth) — both full months. NEVER generate spending or cash-flow actions from the in-progress (partial) month: mid-month, income is partial (e.g. only one of two paychecks has landed) while most expenses have, which fabricates false spikes and false "negative cash flow".
SKIP THIS ENTIRE LENS if spending.analysisMonth is empty or has fewer than 3 categories.
If data exists:
- Compare each spending category (analysisMonth vs priorMonth). Flag categories up >20% AND >$50 in absolute terms.
- Calculate dining (food_dining) to groceries ratio. National benchmark is 1.1x. Flag if >2x.
- Sum all recurring charges and report total + count.
- Flag if total expenses increased month-over-month by >10% (analysis vs prior).

IN-PROGRESS MONTH EXCEPTION: spending.inProgressMonth has the partial current month's totalSpendSoFar and the recentMonthlyAvgSpend (avg of the last 3 complete months). Do NOT generate any action from it UNLESS totalSpendSoFar is already a SIGNIFICANT anomaly vs recentMonthlyAvgSpend — i.e. a still-incomplete month already running well above a normal FULL month. If so, surface exactly ONE action flagging the in-progress spike (total spend only — never a single category, never cash flow). Otherwise say nothing about the in-progress month.

## Lens 2: PROGRESS
- For each active goal:
  - If projectedCompletionDate is "completed", the goal is ALREADY MET — do NOT flag it as behind. Instead, congratulate and suggest whether the target should be raised or the goal archived.
  - If projectedCompletionDate is "unreachable_at_current_rate", the gap is too large for a simple timeline comparison. Instead, suggest concrete actions: increase monthly contributions by $X, reduce the target, or extend the deadline. Calculate the monthly savings needed to hit the deadline.
  - If currentAmount >= targetAmount, the goal is MET regardless of projectedCompletionDate — do NOT report it as behind schedule.
  - Otherwise, compare projectedCompletionDate vs deadline and state the gap in months.
- Every goal insight MUST include a specific, concrete action (e.g., "increase monthly 401(k) contribution by $500" or "move $50k from savings to index funds"). Never say "review your goal" or "adjust accordingly" — those are not actions.
- Calculate savings rate (summary.savingsRateCurrent). ONLY report savings rate if summary.monthlyExpensesCurrent > 0 (there is actual spending data). If monthlyExpensesCurrent is 0, skip all savings rate insights — this means no transaction data is available.
- For each debt with a minimumPayment: show months to payoff and total interest cost remaining. Calculate what $100/mo extra saves.
- If the monthly surplus is negative for the last COMPLETE month (income below expenses on full-month data — NOT the partial in-progress month), this is CRITICAL — include it.

## Lens 3: OPTIMIZATION (tax + contributions)
Apply each rule ONLY if the condition is precisely met — do NOT generate the insight if the condition is false:

- **Employer match**: ONLY if employerMatchPercent > 0. Calculate missed annual match = (employerMatchPercent/100) * annualIncome.
- **HSA**: ONLY if NO account with subtype containing "hsa" or "health savings". Name the annual contribution room going unused: $4,300/yr (single) or $8,550/yr (married_joint). Do not price what that room is worth in tax.
- **Roth IRA**: ONLY if annualIncome < $161,000 (single) or < $240,000 (married_joint). Do NOT assume they haven't contributed just because they have a balance — only flag this if it seems like a worthwhile reminder based on their income level and existing Roth balance relative to annual limits.
- **Roth conversion**: ONLY if traditional IRA/401k balance > 0. Roth conversions have no income limit. The insight should compare their marginal tax rate now vs expected rate in retirement. For high earners ($150k+), note that the conversion will be taxed at their current marginal rate and they should consult a tax advisor for optimal conversion amounts.
- **0% LTCG harvest**: ONLY if annualIncome < $47,025 (single) or < $94,050 (married_joint) AND taxable brokerage has holdings. At income above these thresholds, gains are taxed at 15%+ — do NOT suggest 0% rate.
- **Max 401(k)**: If no 401k account exists or 401k balance is very low relative to income (less than 1x annual income), suggest contributing toward the $23,500/yr limit for pre-tax savings.
- **W-4 withholding check**: ONLY if profile.employmentType is "w2". Suggest reviewing W-4 withholding — over-withholding gives the IRS an interest-free loan, under-withholding causes a surprise bill. The IRS withholding estimator takes 15 minutes. Urgency: low. Impact label: the withholding gap, figure first and no verb, e.g. "$2,000/yr over-withheld" or "$1,400/yr short". If the data does not support a gap figure, use the withholding on file instead, e.g. "$18,400 withheld". NEVER a verb phrase with no figure such as "Optimize cash flow", and never the tax the change would save.
- **High-APR debt** (>7%): paying this off is a guaranteed X% return — flag if interest rate exceeds this. A debtTrajectory entry whose interestRate is null has NO rate on file: never state or imply a rate for it (not "0%", not "no interest"), never compute interest on it, and never call it high or low interest. The only honest action on such an account is to add the rate.
- **Cards paid in full** (data field \`paidInFullCards\`): these clear in full every month, so their balance is this month's spending, NOT debt. They are deliberately absent from debtTrajectory. Never recommend paying one down, paying one off, or moving cash from checking/savings to "clear" it, and never treat its balance as interest-bearing or compute interest on it. Say nothing about them at all unless there is a genuinely different action (never a payoff one).
- **Cash drag**: If depository + money market balances exceed 12 months of income AND there are investment accounts available, calculate the opportunity cost. Use: excess_cash = total_cash - (6 * monthly_income); opportunity_cost = excess_cash * 0.03 (3% spread between cash yield ~5% and expected market return ~8%). Show the specific dollar opportunity cost per year.

ACTIVELY EVALUATE THESE CONDITIONS — the bullets above are a FLOOR, not a ceiling. The following are NOT optional ideas to consider — they are deterministic triggers you MUST CHECK, one by one, against the user's actual data (annualIncome, filingStatus, stateOfResidence, age, retirementAge, employmentType, accounts + subtypes, holdings + cost basis, debt, spending, goals, taxDocuments). For EACH trigger: evaluate its condition. WHEN the condition holds, you MUST emit the corresponding action with the specific amount to act on from their data. WHEN it does not hold, stay silent — do not emit it and never invent eligibility. This is mandatory-when-eligible, not discretionary:

- **Roth IRA, direct vs backdoor**: reason DIRECTIONALLY about the user's income relative to the direct Roth contribution phase-out for their filingStatus — do NOT cite a specific phase-out dollar threshold in the copy. A DIRECT Roth IRA contribution may be suggested ONLY when income is clearly BELOW that phase-out; when income is clearly ABOVE it (a high earner) a direct contribution is DISALLOWED, so never suggest a plain/direct Roth contribution as if it were allowed — the correct route is the BACKDOOR Roth. WHEN income is clearly above the phase-out AND they have earned income, you MUST surface the backdoor Roth: contribute the current-year IRA limit to a Traditional IRA (nondeductible) and convert it to Roth. Frame the specific contribution amount against the current-year IRA limit. CAVEAT: if they hold a large PRE-TAX Traditional IRA balance, the pro-rata rule makes most of the conversion taxable — name this pro-rata caveat and add the "confirm with a tax professional" hedge, but STILL SURFACE the action.
- **HSA as stealth retirement**: IF the user HAS an account with subtype containing "hsa" or "health savings", THEN you MUST surface maxing the HSA and INVESTING it for retirement (triple tax advantage: deductible in, tax-free growth, tax-free for medical in retirement). Frame the specific remaining contribution room against the current-year HSA limit for their filingStatus.
- **State 529 deduction**: IF stateOfResidence is a state that offers a state income-tax deduction or credit for 529 contributions, THEN you MUST surface funding a 529 with the state's deduction framing (e.g. New York deducts up to $10,000/yr married_joint against state tax). Do NOT emit this for states with NO such benefit — states with no income tax (e.g. TX, FL, WA, NV, TN, WY, SD, AK, NH) and non-conforming states with an income tax but no 529 deduction (e.g. CA, HI) get NOTHING here. Gate strictly on the actual stateOfResidence.
- **Saver's Credit**: IF annualIncome falls within the Saver's Credit range for their filingStatus (lower income) AND they contribute to a 401(k)/IRA, THEN you MUST surface it, naming the contribution amount from their data that qualifies. Do NOT estimate the credit itself.
- **Tax-loss harvesting**: IF any holding has an unrealized LOSS (cost basis > current value), THEN you MUST surface harvesting that specific lot, naming the ticker and the loss amount. If NO holding is at a loss (all at gains), emit NOTHING here.

Then, as SECONDARY candidates, also consider these and surface any the data supports with a specific amount to act on from their data (same mandatory-when-eligible discipline, but these are lower priority than the triggers above): education credits (AOTC or Lifetime Learning Credit) where tuition or education spending appears; Child & Dependent Care Credit or a Dependent Care FSA where dependent-care spending appears; above-the-line deductions (student-loan interest, and for 1099 income the self-employed health insurance deduction plus a SEP-IRA or Solo 401(k)); mega-backdoor Roth via after-tax 401(k) contributions; bunching itemized deductions or funding a donor-advised fund when total itemizables sit near the standard-deduction threshold; Qualified Charitable Distributions for users over 70.5 with a Traditional IRA; asset location (holding tax-inefficient assets in tax-advantaged accounts); EV and residential clean-energy credits and Premium Tax Credit reconciliation where the data hints at eligibility. Surface the move, not the diagnosis, per the title rules above.

GUARDRAILS (these bind on every trigger and candidate above):
- Rule 1 still binds: every suggestion MUST tie to a SPECIFIC number from the user's data, or it is skipped. No vague "consider a backdoor Roth" with no figure — no number, no insight. Rule 16 decides WHICH number: the specific amount to act on, never the tax it would save. An action carrying a real amount to act on is NOT skipped for lacking a savings figure.
- NO specific phase-out dollar thresholds in the copy: when eligibility depends on an income phase-out (Roth IRA, Saver's Credit, IRA deduction, education credits, etc.), the action text must NOT cite a specific phase-out dollar threshold — those numbers go stale and get miscompared. Reason DIRECTIONALLY about the user's income relative to the phase-out ("above/below the limit for your filing status"); if unsure of the exact number, do not state one.
- NO internally-contradictory actions: never emit an action whose own text is internally inconsistent (e.g. claiming an income is "below" a number it is actually above, or "eligible" for a route it is barred from). Before emitting each tax action, self-check its numeric claims for consistency — any figure you do cite must agree with the direction of your recommendation.
- Only emit when the eligibility condition GENUINELY holds. No false positives: do NOT recommend a 529 deduction in a state without one; do NOT recommend a direct Roth IRA contribution for someone clearly ABOVE the phase-out (route them to the backdoor Roth instead); and do NOT recommend a backdoor Roth for someone clearly UNDER the phase-out (they can contribute directly).
- Any nuanced, eligibility-sensitive, or aggressive item (backdoor Roth, mega-backdoor Roth, DAF, QCD) MUST carry a brief hedge to confirm with a tax professional, consistent with the Roth-conversion "consult a tax advisor" guidance above.
- HARD LINE: NEVER suggest anything fraudulent, evasive, or "too good to be true". No fabricated deductions, no income misclassification, no hiding or under-reporting income. Legitimate tax planning only, never evasion.

## Lens 5: TAX DOCUMENTS
SKIP THIS ENTIRE LENS if taxDocuments array is empty.
This lens is the HIGHEST PRIORITY when tax documents are present. Analyze the actual numbers from the user's uploaded tax documents to generate specific, personalized insights — NOT generic advice.

For each tax document, cross-reference its extracted fields with the user's current financial data:
- **Withholding vs liability**: If a W-2 shows federal_tax_withheld and you can estimate their tax liability from income + filing status, calculate whether they're over- or under-withheld. Show the specific dollar gap. "Your W-2 shows $18,400 withheld on $120k income. Estimated liability is ~$16,200, so you're over-withholding ~$2,200/yr. Adjust W-4 to keep that money working for you."
- **Year-over-year changes**: If documents span multiple tax years, compare key figures (wages, deductions, tax owed) and flag significant changes. "Your wages grew 12% from $107k to $120k but your effective tax rate jumped from 14.2% to 16.8%. You may have crossed into the 24% bracket."
- **Deduction analysis**: If a 1040 shows standard vs itemized deduction, compare their itemized total against the standard deduction for their filing status and state the gap between the two amounts. If they itemized and the total does not clear the standard deduction meaningfully, they may be doing extra work for little benefit. Do not state what switching would save in tax.
- **1099 income patterns**: If 1099s show freelance/investment income, calculate estimated quarterly tax payments needed. Flag if no estimated payments appear to be made (risk of underpayment penalty).
- **K-1 / S-Corp**: If K-1 or 1120S docs exist, look for pass-through income that may not have withholding — these often cause surprise tax bills.
- **Interest & dividend income**: Cross-reference 1099-INT/1099-DIV amounts with current account balances. Are they earning reasonable yields? Is dividend income tax-efficient (qualified vs ordinary)?
- **Retirement distributions**: If 1099-R shows distributions, check if early withdrawal penalties may apply (age < 59.5) and if the amount is sustainable.
- **Mortgage interest**: If 1098 data exists, compare mortgage interest deduction value against standard deduction to assess whether itemizing is worthwhile.
- **Student loans**: If 1098-E shows student loan interest, note the above-the-line deduction ($2,500 max) and whether they're capturing it.

IMPORTANT for this lens:
- Reference specific numbers FROM the documents, not hypotheticals
- Compare document figures against current account/profile data to find discrepancies or opportunities
- Every insight must cite which document it's derived from (e.g., "Based on your 2023 W-2..." or "Your 1040 shows...")
- Do NOT generate generic "you should contribute to X" advice here — that belongs in Lens 3. This lens is for insights that can ONLY be generated because the user uploaded specific documents.

## Lens 4: BEHAVIORAL
SKIP THIS ENTIRE LENS if spending.analysisMonth is empty or summary.monthlyExpensesCurrent is 0.
If data exists:
- Dining/groceries ratio with exact numbers.
- Subscription creep: total recurring charges vs last month.
- Savings rate vs 20% benchmark — ONLY report if there is actual expense data.

---

## Output Format

Respond with ONLY a JSON array, no markdown:
[
  {
    "category": "portfolio" | "debt" | "tax" | "savings" | "general",
    "urgency": "critical" | "high" | "medium" | "low",
    "type": "spending" | "behavioral" | "debt" | "tax" | "portfolio" | "savings" | "retirement" | "general",
    "title": "The action to take: start with an imperative verb (Pay, Open, Move, Raise, Trim, Cancel, Add, Invest, Rebalance), name the specific move and a real number. Not a diagnosis or a bare metric.",
    "description": "2-3 sentences explaining WHY, with exact numbers and one comparison. The title already states the action, so use the description for the reasoning and specifics (amounts, timeline, tradeoffs).",
    "impact": "Short label, 22 characters or less, figure FIRST and no verb: '$7,000 room left', '$3,000 limit', '$736/yr interest', '$3,400 match'. On a tax action this is the amount to ACT ON, never the tax saved.",
    "impactColor": "green" | "amber" | "red" (green means money gained, so never green on a tax action, whose figure is an amount to act on: use "amber"),
    "chatPrompt": "Natural question the user would ask",
    "pathStepKey": "the key of the financial path step this action serves, exactly as given, or \\"none\\""
  }
]

## Title examples (write the move, not the diagnosis)
- Instead of "Credit card at 24.99% APR costs $736/yr in interest", write "Pay down your $3,076 card to stop $736/yr in interest".
- Instead of "Missing $3,400/yr in free employer match", write "Raise your 401(k) to 4% to claim $3,400/yr in free match".
- Instead of "No HSA means missing $1,290/yr tax-free savings", write "Open an HSA and put the $4,300 you can still contribute to work".
- Instead of "100% US equity allocation misses international diversification", write "Move about 30% into international funds to diversify".
- Instead of "32% of brokerage in Procter & Gamble creates concentration risk", write "Trim Procter & Gamble from 32% to under 10% to cut single-stock risk".
- Instead of "$33,290 excess cash earning 5% instead of 8%", write "Invest $33,290 of idle cash to earn about $998/yr more".
- Instead of "Dining jumped 129% to $89 vs $39 last month", write "Cap dining near $39 after it jumped 129% to $89".

## Urgency:
- critical: losing money now (employer match uncaptured, negative cash flow, high-APR debt compounding)
- high: significant opportunity within 1-2 months
- medium: meaningful improvement this quarter
- low: optimization worth knowing

## Type:
- spending: category trends, merchant patterns
- behavioral: dining ratio, subscription habits, savings rate patterns
- debt: payoff timelines, interest costs
- tax: HSA, Roth, LTCG, asset location, contribution limits
- portfolio: allocation, holdings, rebalancing
- savings: goals, emergency fund
- retirement: 401k, retirement projections
- general: catch-all

Also check these portfolio rules:
- **US vs International allocation**: Calculate US equity % of total holdings. If >80% US, flag as overweight. Benchmark: 60-70% US, 30-40% international. Show exact current split.
- **Single-fund concentration**: If any single holding is >30% of portfolio value, flag it with exact dollar amount and percentage.
- **Bond allocation vs age**: Rule of thumb is hold (age)% in bonds. If significantly under or over, mention it.

Output at most 10 insights, ordered from most urgent/actionable to least. Skip a lens entirely if its data is weak — there is no minimum count, and padding with generic observations is a failure mode.

PRIORITIZATION against the 10-item cap: when you have more candidates than slots, RANK by how much of the user's own money the move puts in play combined with eligibility confidence, and let the highest-value moves the user is CLEARLY eligible for take their slots first. Do NOT drop a clearly-eligible, high-value tax optimization (a real credit, deduction, or Roth/HSA move on material dollars) in order to keep a lower-impact or marginal suggestion — the low-impact one is the one that yields its slot. This is directional ranking by value, not a quota: never invent or inflate an item to make the cut, and never emit anything the data does not genuinely support. A high-value, clearly-eligible move that also carries a pro-rata caveat and a tax-pro hedge (e.g. a backdoor Roth alongside a large pre-tax Traditional IRA) still counts as high-value — surface it responsibly (name the pro-rata drag and the standard remedy: roll the pre-tax Traditional IRA into an employer 401(k) first to clear pro-rata, THEN do the backdoor Roth, confirm with a tax professional) rather than dropping it at the cap.`;

// Appended to INSIGHTS_PROMPT in hosted deployments, and never seen by a
// self-hosted one.
//
// It has to REDIRECT, not just prohibit. Rules 1, 3 and 10 and the GUARDRAILS
// all say the same thing in different words: no specific number from the user's
// own data, no insight. A bare ban on naming what they hold therefore reads as
// an instruction to emit nothing at all, and the portfolio lens goes quiet.
// That failure is invisible from here: every reader of the actions list renders
// nothing when the list is empty, so a silent lens looks exactly like a
// household with no portfolio findings. So this names what the copy says
// INSTEAD, and states outright that the general benchmark figure is the
// specific number those rules are asking for.
//
// The trigger is untouched on purpose. The portfolio rules still run against
// the real holdings and the real age, and that is still what decides whether an
// action appears at all. Only the wording of the action changes.
const HOSTED_PORTFOLIO_RULES = `

---

## PORTFOLIO AND INVESTING COPY IN THIS DEPLOYMENT

This deployment states general allocation guidance in portfolio and investing actions instead of the reader's own holdings and figures. The rules in this section OVERRIDE everything above for every action in the portfolio family: the three portfolio rules (US versus international allocation, single-fund concentration, bond allocation versus age), tax-loss harvesting, asset location, and any other action whose subject is what the reader holds or how it is allocated.

THE TRIGGER DOES NOT CHANGE. Keep evaluating every one of those rules against the reader's actual holdings, cost basis, account subtypes and age, exactly as described above. Their data still decides WHETHER one of these actions appears. Only the wording changes.

These actions may NOT contain:
- A ticker symbol, or the name of any fund, security or company.
- A statement of what the reader holds, in dollars or in percent. Not "your portfolio is 92% US", not "you hold 4% in bonds at age 41", not "32% of your brokerage sits in one stock".
- An allocation prescribed for the reader. Not "rebalance to a 70/30 split", not "move about 30% into international funds", not "trim it to under 10%".
- An account name, or any dollar figure taken from their holdings.
- The reader's age, or any other fact read off their profile, attached to the guideline. State the benchmark on its own: "Bonds should make up 20 percent of a balanced portfolio", never "at age 30".

These actions say this instead:
- State the general benchmark as a general fact, in the third person, about portfolios in general and not about theirs.
- THIS SATISFIES RULE 1 AND RULE 10. For a portfolio action, the general benchmark figure IS the specific number those rules require. Never drop a portfolio action for lacking a figure from the reader's data, and never emit one without the benchmark figure.
- THIS SATISFIES RULE 3 AND THE GUARDRAILS. For a portfolio action, the concrete next step is to open the Portfolio page and compare their own split against the guideline. That is the step these actions give, and it is enough.
- RULE 14 IS OVERRIDDEN FOR THESE ACTIONS ONLY. The title states the guideline, so it is a statement and not an imperative. Never open one of these titles with Rebalance, Shift, Reallocate, Trim, Move or Sell.
- The impact label names the guideline, never their number: "70/30 guideline", "10% guideline", "20% bonds", "$3,000 limit".

Worked examples. The NO line is what this deployment must not produce. The YES line is what it produces instead, from the same trigger:

Trigger: holdings are more than 80% US.
NO: title "Move about 30% into international funds to diversify", impact "92% US"
YES: title "The recommended stock allocation is about 70 percent US to 30 percent international", description "A globally diversified stock allocation holds roughly a third of it outside the US, which spreads the risk across more than one economy. Open the Portfolio page to see how the split compares.", impact "70/30 guideline"

Trigger: one holding is more than 30% of the portfolio.
NO: title "Trim Procter & Gamble from 32% to under 10% to cut single-stock risk", impact "$192,000 equity"
YES: title "A single holding above 10 percent of a portfolio is generally considered concentrated", description "Concentration ties a large share of a portfolio to the results of one company. Open the Portfolio page to see the weight of the largest position.", impact "10% guideline"

Trigger: bond allocation is far from what the reader's age suggests.
NO: title "You hold 4% in bonds at age 41", impact "4% bonds"
YES: title "Bonds should make up 20 percent of a balanced portfolio", description "A common rule of thumb raises the bond share with age, which cushions a portfolio as the time left to spend it shortens. Open the Portfolio page to see the current bond share.", impact "20% bonds"

Trigger: a holding in a taxable account is worth less than it cost.
NO: title "Harvest the $4,200 loss in VTSAX", impact "$4,200 loss"
YES: title "Realized losses in a taxable account offset capital gains, and up to $3,000 of ordinary income a year", description "Selling a position worth less than it cost turns a paper loss into one that offsets gains, and any unused remainder carries forward to later years. Open the Portfolio page to see which positions sit below their cost basis.", impact "$3,000 limit"

Everything OUTSIDE the portfolio family is UNCHANGED and still names the reader's own numbers exactly as described above: spending categories, cash flow, goals, debt balances and rates, employer match, contribution room, withholding, and account balances.

ONE RULE APPLIES TO EVERY ACTION IN THIS DEPLOYMENT, portfolio family or not: never write a ticker symbol, a fund name or a security name. This holds even when the action is about something else and the fund is only an aside, which is where it is most often broken: a cash action saying where the idle money goes, a savings action naming what to buy, an HSA or 401(k) action naming what to invest it in. Name the KIND of fund instead. Write "a low-cost broad market index fund", "a total international fund", "a target-date fund". Never "VOO", "VTI", "VXUS", "index funds like VOO or VXUS", "a fund like BND".`;

// Deterministic punctuation backstop for STYLE rule 13: the model is told to
// avoid em dashes, en dashes, and middots but still slips on roughly a third
// of generations, and regenerating over punctuation is not worth it — banned
// characters are normalized after parsing instead (same idiom as sanitizeBrand
// in services/freeform-report.ts). Hyphen-minus is never touched, so negative
// numbers, compound words, currency, and URLs are safe.
export function normalizePunctuation(text: string): string {
  return text
    .replace(/\s+[—–]\s+/g, ", ") // spaced dash = clause break
    .replace(/(\d)\s*[—–]\s*(\d)/g, "$1 to $2") // dash between digits = range
    .replace(/[—–]/g, ", ") // any dash still left = clause break
    .replace(/\s*·\s*/g, ", ");
}

// Deterministic backstop for CRITICAL rule 16: the model is told never to price
// a tax outcome, and still writes "saves $2,040 in taxes" often enough that the
// prompt alone cannot be trusted (same reasoning as normalizePunctuation above
// and the missing-data cap below). An action is dropped after parsing when it
// puts a number on the tax an action would save.
//
// Deliberately TAX-SCOPED, because `impact` is shared by every category: a debt
// payoff that stops $736/yr in interest, an employer match worth $3,400/yr, and
// the opportunity cost of idle cash are all legitimate dollar benefits and must
// survive. A match needs a saving VERB, a TAX noun, and an AMOUNT standing in
// the relationship "this much tax, saved" — an amount the user is asked to ACT
// on ("contribute $8,550 to lower your taxable income") is not that.
const TAX_SAVE_VERB =
  "(?:sav(?:e|es|ed|ing|ings)|avoid(?:s|ed|ing)?|reduc(?:e|es|ed|ing)|cut(?:s|ting)?|lower(?:s|ed|ing)?|defer(?:s|red|ring)?|shave(?:s|d)?|slash(?:es|ed)?)";
// Only nouns naming the tax OUTCOME. "taxable income", "deduction" and
// "bracket" name the BASE an action moves, so "lower your taxable income by
// $7,000" is an amount to act on and survives. "tax" is matched only as a
// standalone word, so "pre-tax", "tax-advantaged" and "taxable brokerage"
// describe an account rather than claiming anything about tax owed.
const TAX_NOUN =
  "(?<![\\w-])(?:taxes|tax bill|tax liability|taxation|refund|tax)(?![-\\w])";
const MONEY = "(?:\\$\\s?[\\d,]+(?:\\.\\d+)?(?:\\s?[kKmM]\\b)?|\\d+(?:\\.\\d+)?\\s?%)";
// Gaps never cross a sentence boundary, so a tax word in the next sentence
// cannot reach back and condemn an amount that has nothing to do with it.
const GAP = "[^.!?]{0,40}?";
const SHORT_GAP = "[^.!?]{0,24}?";

const TAX_SAVING_PATTERNS: RegExp[] = [
  // "saves $2,040 in taxes", "cuts $1,290/yr off your tax bill"
  new RegExp(`\\b${TAX_SAVE_VERB}\\b${GAP}${MONEY}${SHORT_GAP}${TAX_NOUN}`, "i"),
  // "cut your tax bill by $2,000", "reduce taxes by 12%"
  new RegExp(`\\b${TAX_SAVE_VERB}\\b${SHORT_GAP}${TAX_NOUN}${SHORT_GAP}${MONEY}`, "i"),
  // "$1,200+ tax savings", "$800 tax break"
  new RegExp(
    `${MONEY}${SHORT_GAP}(?<![\\w-])tax(?:es)?(?![-\\w])\\s+(?:sav(?:ings?|ed)|reduction|relief|break|benefit)\\b`,
    "i",
  ),
  // "$600 less in federal tax". Deliberately requires the comparative: a bare
  // "$41,200 in federal tax withheld" is a figure READ OFF the user's W-2, and
  // banning that silences the whole withholding lens.
  new RegExp(
    `${MONEY}\\s+(?:less|lower|fewer)\\s+(?:in|of)\\s+(?:federal\\s+|state\\s+|income\\s+)?${TAX_NOUN}`,
    "i",
  ),
];

/** True when the text puts a dollar or percentage figure on a tax saving. */
export function mentionsTaxSavingAmount(text: string): boolean {
  if (!text) return false;
  return TAX_SAVING_PATTERNS.some((p) => p.test(text));
}

/**
 * The two rules below are the whole of what rule 16 enforces on a stored row,
 * and BOTH paths call them: the insert loop as it writes, and the read in
 * routes/insights.ts as it serves. Applying the rule only on the way in leaves
 * every row written before it existed still saying "save $2,790 in taxes" until
 * that tenant next regenerates, which is days. Applying it on the way out too
 * costs a regex per row and makes the banned copy unreachable immediately.
 *
 * They live here, together, so the two paths cannot drift into disagreeing
 * about what the rule is.
 */
export interface InsightCopy {
  title: string | null;
  description: string | null;
  impact: string | null;
}

/**
 * True when this action prices the tax it saves, so it may not be stored and
 * may not be shown.
 *
 * Not gated on the tax category, which is what makes the two paths the same
 * check: `mentionsTaxSavingAmount` is already tax-scoped by construction (it
 * needs a saving verb, a tax noun and an amount standing in the relationship
 * "this much tax, saved"), so a debt payoff worth "$340/yr" and an employer
 * match worth "$3,400" cannot match it whatever category they carry.
 */
export function pricesTaxSaving(copy: InsightCopy): boolean {
  return mentionsTaxSavingAmount(
    `${copy.title ?? ""} ${copy.description ?? ""} ${copy.impact ?? ""}`,
  );
}

/**
 * A portfolio action states general allocation guidance in a hosted deployment,
 * not the reader's own holdings and figures. The prompt asks for that, and the
 * two predicates below are the deterministic backstop, applied on the write
 * path as an action is stored and again on the read path as it is served, for
 * the same reason the tax rule above is applied twice: a row written before the
 * flag was turned on is still in the table saying "your portfolio is 92% US"
 * until that household next regenerates, which is up to two days.
 *
 * Both are PURE. Neither reads the flag: the call sites do, so the rule can be
 * unit-tested without an environment.
 */
export interface HeldSecurities {
  tickers: string[];
  names: string[];
}

export const NO_HELD_SECURITIES: HeldSecurities = { tickers: [], names: [] };

/**
 * The tickers and security names this tenant actually holds.
 *
 * Scoped to the tenant rather than matched by shape, because a blind
 * uppercase-token rule fires on HSA, IRA, APR, ETF, RMD, LTCG, MAGI, NUA, ACA
 * and US, and would take the tax lens down with the portfolio one.
 *
 * buildAliasMap aliases accounts, goals and users but NOT securities, so a
 * ticker and a fund name survive scrubbing un-aliased. That is what lets the
 * same predicate work on the raw generated text and on the stored, descrubbed
 * text without either side translating first.
 */
export async function heldSecurityNames(tenantId: string): Promise<HeldSecurities> {
  const rows = await readHoldingRows(tenantId);
  const tickers = new Set<string>();
  const names = new Set<string>();
  for (const r of rows) {
    if (r.ticker) tickers.add(r.ticker.trim());
    if (r.secName) names.add(r.secName.trim());
  }
  return { tickers: [...tickers], names: [...names] };
}

// Symbols that are also ordinary words. Matching is case-sensitive, which
// already spares "All" and "It" mid-sentence, but not a label written in caps.
const TICKER_STOPLIST = new Set(["ALL", "IT", "CASH", "ONE", "NOW", "PAY", "REAL"]);

// A one-character ticker is not evidence of anything, and the security's name
// catches that holding anyway.
const MIN_TICKER_LENGTH = 2;
// Short enough that a name is a name and not a word. "Visa" and "Bitcoin" pass;
// nothing shorter is worth the false positives.
const MIN_NAME_LENGTH = 4;

// The legal and corporate tail a custodian keeps and a writer drops, stripped
// so "Procter & Gamble" still matches the stored "Procter & Gamble Co.".
const LEGAL_SUFFIX =
  /(?:[,\s]+(?:inc|corp|corporation|co|company|ltd|limited|llc|lp|plc|trust|holdings?|group)\.?)+$/i;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The forms of a stored security name worth looking for in the copy. */
function nameForms(name: string): string[] {
  const raw = name.trim().replace(/\s+/g, " ");
  const stripped = raw.replace(LEGAL_SUFFIX, "").replace(/[^\w)]+$/, "").trim();
  return [...new Set([raw, stripped])].filter((n) => n.length >= MIN_NAME_LENGTH);
}

/**
 * True when the text names a security this tenant holds.
 *
 * `matchNames` is what separates the two halves. A TICKER is matched
 * everywhere: it is case-sensitive, word-bounded and stoplisted, so the only
 * thing that produces "VOO" in a sentence is the fund. A security NAME is
 * matched case-insensitively, and half the S&P is also a shop or a card: a
 * household holding Visa, Target, Apple or American Express would otherwise
 * lose "Pay down your Visa card", "Cut $240/mo at Target" and every other
 * action whose subject is the merchant rather than the position. So names are
 * looked for only where the action is ABOUT what the reader holds.
 */
export function namesHeldSecurity(
  text: string,
  held: HeldSecurities,
  matchNames: boolean,
): boolean {
  if (!text) return false;
  for (const ticker of held.tickers) {
    if (ticker.length < MIN_TICKER_LENGTH || TICKER_STOPLIST.has(ticker.toUpperCase())) continue;
    // Case-SENSITIVE and word-bounded: the alternative catches every acronym
    // the tax lens is built out of.
    if (new RegExp(`\\b${escapeRegExp(ticker)}\\b`).test(text)) return true;
  }
  if (!matchNames) return false;
  for (const name of held.names) {
    for (const form of nameForms(name)) {
      if (new RegExp(`\\b${escapeRegExp(form)}\\b`, "i").test(text)) return true;
    }
  }
  return false;
}

// The families whose subject is what the reader holds: the portfolio rules
// themselves, and the tax rules written about positions (loss harvesting,
// asset location, gain harvesting), which the model files under `tax`. Outside
// these two an action is about a merchant, a card or a bill, and a security
// name appearing in it is a coincidence of branding.
const HOLDINGS_FAMILY = new Set(["portfolio", "tax"]);

/** True when this action's subject is the reader's holdings. */
function aboutHoldings(category?: string | null, type?: string | null): boolean {
  return HOLDINGS_FAMILY.has(category ?? "") || HOLDINGS_FAMILY.has(type ?? "");
}

// The subject of the rule is ALLOCATION: how a portfolio is divided, and how
// much of it sits where. It is NOT the fact that the reader owns an investment
// account. "your brokerage" is an account noun, and a household with a card and
// a brokerage says it in the cash, debt and contribution actions the rule must
// never touch: "8% in your brokerage", "your brokerage balance of $15,629",
// "moving $25,000 into your brokerage". So no account noun is a trigger on its
// own, and neither is a bare dollar amount.

// The slices a portfolio is divided into. Deliberately narrow. "equity" alone
// is a house as often as it is a stock, so it counts only with something
// investment-shaped attached; "index fund" is how every cash action names the
// destination for idle money, so it is not here at all.
const ASSET_CLASS =
  "(?:stocks?|equities|bonds?|international|domestic|fixed\\s+income|emerging\\s+markets?|US\\s+equit(?:y|ies)|US\\s+stocks?|equity\\s+(?:position|allocation|exposure|holdings?))";
// Words naming a portfolio's composition rather than an account someone owns.
const ALLOCATION_NOUN =
  "(?:allocations?|asset\\s+mix|asset\\s+class(?:es)?|splits?|weightings?|concentration|diversification)";
// What a share can be a share OF, once the reader is named as its owner.
const PORTFOLIO_ACCOUNT =
  "(?:portfolios?|brokerages?|holdings?|investments?|positions?|assets)";
// A tax-advantaged container is NOT one of them. It holds an allocation but is
// not one, and a share of it is how the cash-drag actions are written: "put
// 100% of your HSA into investments", "only 12% of your IRA is invested". So it
// counts only where a slice of a portfolio is named beside it. No trailing word
// boundary after "401(k)": the string ends in a bracket, so a \b there would
// demand a word character that never comes.
const RETIREMENT_ACCOUNT = "(?:401\\(k\\)|IRAs?\\b|HSAs?\\b)";
// An allocation is written as a share or a ratio. A dollar figure is not one:
// every action in the list moves dollars.
const SHARE = "(?:\\d+(?:\\.\\d+)?\\s*(?:%|percent\\b)|\\b\\d{1,3}\\s*/\\s*\\d{1,3}\\b)";

// Neither gap may contain a second figure, so a rate in one clause cannot reach
// a noun in the next: "5% in cash vs ~8% expected market return" is two
// statements, not one claim.
const NEAR = "[^.!?%$]{0,16}?";
const NEAR_MONEY = "[^.!?%$]{0,12}?";

// A share bound to a slice of a portfolio: "100% US equity", "4% in bonds",
// "30 to 40% to international stocks", "70/30 split", "$12,300 (79.6%) in
// individual stocks".
const SHARE_IN_ASSET_CLASS = `${SHARE}${NEAR}\\b(?:${ASSET_CLASS}|${ALLOCATION_NOUN})\\b`;
// The same claim the other way round, and only with a connector that makes the
// share the SIZE of the slice: "bonds from 19% down to 10%", "allocation near
// 30%". That connector is the whole difference between it and the general forms
// this deployment writes, which read "stocks historically return 8%" and "bonds
// should make up 20 percent of a balanced portfolio".
const ASSET_CLASS_AT_SHARE = `\\b(?:${ASSET_CLASS}|${ALLOCATION_NOUN})\\s+(?:from|at|to|near|of|around|about|under|above|over|below)\\s+(?:about\\s+|roughly\\s+|under\\s+|around\\s+)?${SHARE}`;
// What may stand between the possessive and the noun: a qualifier, a figure,
// "your taxable holdings", "your $67,597 in investments". Never a tax-advantaged
// container, because then the share is a share of THAT and the noun after it is
// only where the money is headed: without this, "100% of your HSA into
// investments" reads as a share of the investments and the cash-drag action
// disappears.
const OF_QUALIFIER = `(?:(?!\\b${RETIREMENT_ACCOUNT})[^.!?]){0,30}?`;
// A share of something that is theirs: "32% of your brokerage", "22% of your
// taxable holdings". The share and the possessive are one phrase, so this is a
// personal claim on its own.
const SHARE_OF_YOUR_PORTFOLIO = `${SHARE}\\s+of\\s+your\\b${OF_QUALIFIER}\\b${PORTFOLIO_ACCOUNT}\\b`;
// The same claim with a definite article: "32% of the brokerage". Personal in
// context but not on its own, so it still needs the possessive or the
// imperative beside it. "10 percent of a portfolio" is the general form and is
// neither.
const SHARE_OF_THE_PORTFOLIO = `${SHARE}\\s+of\\s+(?:the|this)\\b${OF_QUALIFIER}\\b${PORTFOLIO_ACCOUNT}\\b`;
// A share of a retirement account, which counts only with a slice of a
// portfolio beside it, on either side: "40% of your IRA sits in bonds" and
// "bonds are only 12% of your IRA" both state an allocation, where "12% of your
// IRA is invested" states a balance.
const SHARE_OF_RETIREMENT = `${SHARE}\\s+of\\s+(?:your|the|this)\\b${OF_QUALIFIER}\\b${RETIREMENT_ACCOUNT}`;
const SHARE_OF_RETIREMENT_ACCOUNT = `(?:${SHARE_OF_RETIREMENT}[^.!?]{0,30}?\\b${ASSET_CLASS}\\b|\\b${ASSET_CLASS}\\b[^.!?]{0,30}?${SHARE_OF_RETIREMENT})`;
// What a moved percentage turns out to be a percentage OF, in every lens that
// is not the portfolio one: a contribution, a deferral, a withholding, a
// savings or spending share, a yield, an employer match. Each of these moves a
// figure from one percent to another in exactly the words a reweighting uses,
// and "raise your 401(k) contribution from 3% to 6%" is the most repeated
// action the product has.
const RATE_SUBJECT =
  "(?:contributions?|deferrals?|withholding|savings|spending|yields?|APY|match(?:es|ing)?|pay)";
// A prescribed reweighting: "from 18% to under 10%", "from 16.5% to 45%". Only
// ever read beside the verb doing the reweighting, because on its own it is
// also how a rate that moved is written.
const FROM_SHARE_TO_SHARE = `\\bfrom\\s+${SHARE}\\s+(?:down\\s+)?to\\s+(?:about\\s+|under\\s+|over\\s+|around\\s+|roughly\\s+)?${SHARE}`;
// The rates are SUBTRACTED from the sentence rather than a slice of a portfolio
// being required in it, because what separates the two is not that an asset
// class is named: "trim your largest position from 24% to under 10%" names none
// and is an allocation all the same. A rate, by contrast, always says what it
// is a rate of, on one side of the move or the other, so the run between the
// verb and the move carries none of those words and neither does the rest of
// the sentence after it.
const NOT_A_RATE = `(?:(?!\\b${RATE_SUBJECT}\\b)[^.!?]){0,40}?`;
const REWEIGHTING = `${NOT_A_RATE}${FROM_SHARE_TO_SHARE}(?![^.!?]*\\b${RATE_SUBJECT}\\b)`;
// Dollars sitting in a slice: "your $192,000 US equity position". Tight, because
// a dollar figure next to a loose noun is every other action in the list.
const MONEY_IN_ASSET_CLASS = `${MONEY}${NEAR_MONEY}\\b${ASSET_CLASS}\\b`;

const ALLOCATION_CLAIM = `(?:${SHARE_IN_ASSET_CLASS}|${ASSET_CLASS_AT_SHARE}|${SHARE_OF_THE_PORTFOLIO}|${MONEY_IN_ASSET_CLASS})`;

// The reader named as the owner of what is described. "you have" is left out
// on purpose: it opens half the actions in the list and owns none of them.
const SECOND_PERSON = "(?:\\byour\\b|\\byou\\s+(?:hold|own|carry|keep)\\b)";
const ALLOCATION_VERB =
  "(?:rebalanc(?:e|es|ed|ing)|shift(?:s|ed|ing)?|reallocat(?:e|es|ed|ing)|allocat(?:e|es|ed|ing)|trim(?:s|med|ming)?|mov(?:e|es|ed|ing)|add(?:s|ed|ing)?|rais(?:e|es|ed|ing)|increas(?:e|es|ed|ing)|reduc(?:e|es|ed|ing)|tilt(?:s|ed|ing)?|diversify)";

// Relationship-based, exactly like TAX_SAVING_PATTERNS above: an allocation
// claim on its own is the general guidance this deployment is FOR, so a match
// needs the possessive that makes the claim about THIS reader, or the
// imperative that prescribes the allocation TO them. That is what leaves the
// wanted forms standing: "The recommended stock allocation is 70/30" and
// "Bonds should make up 20% of a balanced portfolio" have neither.
const OWN_PORTFOLIO_PATTERNS: RegExp[] = [
  // "your portfolio is 92% US equity", "your $192,000 US equity position",
  // "you hold 4% in bonds at age 41"
  new RegExp(`${SECOND_PERSON}[^.!?]{0,40}?${ALLOCATION_CLAIM}`, "i"),
  // "10% bonds to align with your age", "32% of the brokerage in your Roth"
  new RegExp(`${ALLOCATION_CLAIM}[^.!?]{0,40}?${SECOND_PERSON}`, "i"),
  // "rebalance to a 70/30 split", "move about 30% into international funds"
  new RegExp(`\\b${ALLOCATION_VERB}\\b[^.!?]{0,40}?${ALLOCATION_CLAIM}`, "i"),
  // "trim it from 32% to under 10%", "trim your largest position from 24% to
  // under 10%" — a move between two percentages that nothing in the sentence
  // says is a rate.
  new RegExp(`\\b${ALLOCATION_VERB}\\b${REWEIGHTING}`, "i"),
  // "32% of your brokerage sits in one stock" — already both halves of a claim
  // about this reader, with nothing left for a second leg to add. "40% of your
  // IRA sits in bonds" is the same claim about a container, and carries the
  // asset class that tells it apart from a cash-drag action.
  new RegExp(`(?:${SHARE_OF_YOUR_PORTFOLIO}|${SHARE_OF_RETIREMENT_ACCOUNT})`, "i"),
];

/**
 * True when the text states the reader's own allocation, or prescribes one for
 * them, instead of stating general guidance.
 */
export function mentionsPersonalPortfolio(text: string): boolean {
  if (!text) return false;
  return OWN_PORTFOLIO_PATTERNS.some((p) => p.test(text));
}

/**
 * True when this action states the reader's own holdings or allocation, so in a
 * hosted deployment it may not be stored and may not be shown.
 *
 * The entry point both paths call, as `pricesTaxSaving` is for the tax rule.
 * The fields are joined with a sentence break rather than a space: the patterns
 * never cross a sentence boundary, and a title carries no terminal period, so a
 * plain space would let a figure at the end of the title reach a noun at the
 * start of the description and condemn a pair that never appeared together.
 */
export function personalizesPortfolio(
  copy: InsightCopy & { category?: string | null; type?: string | null },
  held: HeldSecurities,
): boolean {
  const text = `${copy.title ?? ""}. ${copy.description ?? ""}. ${copy.impact ?? ""}`;
  return (
    mentionsPersonalPortfolio(text) ||
    namesHeldSecurity(text, held, aboutHoldings(copy.category, copy.type))
  );
}

const VALID_IMPACT_COLORS = ["green", "amber", "red"] as const;
export type ImpactColor = (typeof VALID_IMPACT_COLORS)[number];

/**
 * Green is the colour of money gained, and a tax action's figure is an amount
 * to ACT on now that it can no longer be the tax saved. The model still reaches
 * for green out of habit, so it is corrected to the amber the tax tag already
 * wears. Anything that is not one of the three colours is no colour at all.
 */
export function taxSafeImpactColor(row: {
  category: string | null;
  type: string | null;
  impactColor: string | null;
}): ImpactColor | null {
  if (!VALID_IMPACT_COLORS.includes(row.impactColor as ImpactColor)) return null;
  const isTax = row.category === "tax" || row.type === "tax";
  return row.impactColor === "green" && isTax ? "amber" : (row.impactColor as ImpactColor);
}

// Roughly 4 characters per token, held well under the model's 200k window so a
// runaway section fails here with a diagnosis instead of as an opaque provider
// "prompt is too long" after the request has already been paid for.
const MAX_PROMPT_CHARS = 600_000;

// Fails loudly, naming the section that blew the budget — a data bug upstream
// (a table growing unbounded, say) is otherwise invisible in the cron logs.
function assertPromptFits(tenantId: string, data: unknown, dataJson: string): void {
  if (dataJson.length <= MAX_PROMPT_CHARS) return;
  const biggest = Object.entries(data as Record<string, unknown>)
    .map(([key, value]) => [key, JSON.stringify(value)?.length ?? 0] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, size]) => `${key}=${Math.round(size / 1024)}KB`)
    .join(", ");
  throw new Error(
    `Insights payload too large for tenant ${tenantId}: ${Math.round(dataJson.length / 1024)}KB exceeds the ${Math.round(MAX_PROMPT_CHARS / 1024)}KB budget. Largest sections: ${biggest}`,
  );
}

export async function generateInsights(tenantId: string): Promise<number> {
  // Admin pause: disabled tenants get no actions generated (route + cron both
  // funnel through here).
  if (await isTenantDisabled(tenantId)) {
    console.log(`[Insights] Tenant ${tenantId} is disabled — skipping`);
    return 0;
  }
  console.log(`[Insights] Starting generation for tenant ${tenantId}`);
  const data = await gatherFinancialData(tenantId);

  if (data.accounts.length === 0) return 0;

  // Scrub PII before sending to LLM
  const aliasMap = await buildAliasMap(tenantId);
  const scrubbedData = scrub(data, aliasMap, "insights-engine");
  // Compact, not pretty-printed — indentation is ~30% of the payload and the
  // model does not need it.
  const dataJson = JSON.stringify(scrubbedData);
  assertPromptFits(tenantId, scrubbedData, dataJson);

  // The plan the actions belong to. Its titles go through the alias map like
  // everything else, but the KEYS deliberately do not: a key is what comes back
  // and gets matched, so it has to reach the model exactly as it is stored.
  // Scrubbing is whole-word replacement, and an account someone named "debt"
  // would otherwise rewrite the prefix of every debt step's key.
  const pathSteps = await readPathSteps(tenantId);
  const pathJson = JSON.stringify(
    pathSteps.map((s) => ({ ...s, title: scrub(s.title, aliasMap) as string })),
  );

  let model: ReturnType<typeof getModel>;
  try {
    model = getModel("medium");
  } catch (e) {
    console.error("Insights engine: AI model not available");
    throw e instanceof Error ? e : new Error("AI model not available");
  }

  let result;
  try {
    // descrubOutput: false — the response is JSON.parsed below, and a real
    // name containing a quote/backslash would corrupt it. The insert loop
    // descrubs each user-visible field after parsing.
    result = await llmGenerateText({ tenantId, aliasMap, descrubOutput: false }, {
      model,
      system: INSIGHTS_PROMPT + (env.HOSTED_MODE ? HOSTED_PORTFOLIO_RULES : ""),
      prompt:
        `Here is the user's complete financial data:\n\n${dataJson}` +
        (pathSteps.length > 0
          ? `\n\nHere are the steps of their financial path, in the order they work through them:\n\n${pathJson}`
          : ""),
      temperature: 0.3,
      maxOutputTokens: 4000,
    });
    logLlmUsage({ tenantId, source: "insights", model: getModelSlug("medium"), inputTokens: result.usage?.inputTokens, outputTokens: result.usage?.outputTokens, costUsd: result.costUsd });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[Insights] LLM API call failed: ${msg.slice(0, 300)}`);
    throw e instanceof Error ? e : new Error(msg);
  }

  let generated: GeneratedInsight[];
  try {
    let text = result.text.trim();
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) text = jsonMatch[0];
    generated = JSON.parse(text);
    if (!Array.isArray(generated)) throw new Error("Not an array");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[Insights] Failed to parse AI response: ${msg}`);
    console.error(`[Insights] Raw response (first 5000 chars): ${result.text.slice(0, 5000)}`);
    throw e instanceof Error ? e : new Error(msg);
  }

  // Full delete of all non-dismissed insights — ensures numbers stay fresh
  await db
    .delete(insights)
    .where(
      and(
        eq(insights.tenantId, tenantId),
        sql`${insights.dismissed} IS NULL`
      )
    );

  const validCategories = [
    "portfolio",
    "debt",
    "tax",
    "savings",
    "general",
  ] as const;
  const validUrgencies = ["low", "medium", "high", "critical"] as const;
  const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

  // Cap "this data is missing" insights at one per generation. The LLM is told
  // this in the prompt (rule #12) but reliably ignores it for users with
  // incomplete profiles, producing 3-4 near-duplicate "we don't have your X"
  // entries that drown out actionable insights. Keep the first encountered —
  // the prompt orders by urgency, so that's the highest-priority gap.
  const MISSING_DATA_PATTERNS: RegExp[] = [
    /\bno\s+\w+\s+(data|tracking|tracked|info)\b/i,
    /\bwith\s+no\s+\w+\s+(data|tracking|info)\b/i,
    /\bunknown\s+(interest\s+rate|apr|apy|rate)\b/i,
    /\bnot\s+tracked\b/i,
    /\bmissing\s+(data|info|information)\b/i,
    /\$0\s+(monthly\s+)?(income|expenses?|spending)\b/i,
  ];
  const isMissingDataInsight = (ins: GeneratedInsight): boolean => {
    const text = `${ins.title ?? ""} ${ins.description ?? ""}`;
    return MISSING_DATA_PATTERNS.some((p) => p.test(text));
  };

  const onThePath = new Set(pathSteps.map((s) => s.key));

  // Read once, and only where the rule applies: a self-hosted deployment never
  // filters on this, so it never pays for the query.
  const held = env.HOSTED_MODE ? await heldSecurityNames(tenantId) : NO_HELD_SECURITIES;

  let missingDataKept = 0;
  let insertCount = 0;
  for (const ins of generated) {
    // Checked before the missing-data cap so a dropped action never spends the
    // one slot that cap allows.
    if (pricesTaxSaving(ins)) {
      // The text goes in the log too: a drop is either the rule working or the
      // matcher over-reaching, and the title alone never says which.
      const insText = `${ins.title ?? ""} ${ins.description ?? ""} ${ins.impact ?? ""}`;
      console.log(`[Insights] Dropping insight that prices a tax saving: ${insText.slice(0, 240)}`);
      continue;
    }

    // Also before the cap, and for the same reason.
    if (env.HOSTED_MODE && personalizesPortfolio(ins, held)) {
      const insText = `${ins.title ?? ""} ${ins.description ?? ""} ${ins.impact ?? ""}`;
      console.log(
        `[Insights] Dropping insight that states the reader's own holdings: ${insText.slice(0, 240)}`,
      );
      continue;
    }

    if (isMissingDataInsight(ins)) {
      if (missingDataKept >= 1) {
        console.log(`[Insights] Dropping duplicate missing-data insight: "${ins.title?.slice(0, 80)}"`);
        continue;
      }
      missingDataKept++;
    }

    const category = validCategories.includes(
      ins.category as (typeof validCategories)[number]
    )
      ? ins.category
      : "general";
    const urgency = validUrgencies.includes(
      ins.urgency as (typeof validUrgencies)[number]
    )
      ? ins.urgency
      : "medium";

    await db.insert(insights).values({
      tenantId,
      category,
      urgency,
      title: descrub(normalizePunctuation(ins.title || "Financial insight"), aliasMap),
      description: descrub(normalizePunctuation(ins.description || ""), aliasMap),
      impact: ins.impact ? descrub(normalizePunctuation(ins.impact), aliasMap) : null,
      impactColor: taxSafeImpactColor({
        category,
        type: ins.type ?? null,
        impactColor: ins.impactColor,
      }),
      chatPrompt: ins.chatPrompt ? descrub(normalizePunctuation(ins.chatPrompt), aliasMap) : null,
      generatedBy: "ai",
      insightType: ins.type || "general",
      // Validated exactly as the path's own ordering validates the keys it gets
      // back: a key that is not on the path is not a step, so it is dropped to
      // null rather than persisted. The action itself is kept either way — an
      // action the path has no step for is still advice worth reading, and it
      // is shown after every action that has a step.
      pathStepKey: onThePath.has(ins.pathStepKey ?? "") ? ins.pathStepKey! : null,
      sourceData: dataJson,
      expiresAt: new Date(Date.now() + NINETY_DAYS),
    });
    insertCount++;
  }

  // Update lastActionsGeneratedAt timestamp in financial profile
  await db
    .insert(financialProfiles)
    .values({
      tenantId,
      lastActionsGeneratedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: financialProfiles.tenantId,
      set: {
        lastActionsGeneratedAt: new Date(),
      },
    });

  return insertCount;
}
