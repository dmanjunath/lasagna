import { generateText } from "ai";
import { getModel } from "../agent/index.js";
import { db } from "./db.js";
import {
  accounts,
  balanceSnapshots,
  holdings,
  securities,
  insights,
  financialProfiles,
  transactions,
  goals,
  eq,
  and,
  desc,
  sql,
} from "@lasagna/core";

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
    currentMonth: Array<{ category: string; total: number }>;
    priorMonth: Array<{ category: string; total: number }>;
    topMerchants: Array<{ merchant: string; total: number }>;
    recurringCharges: Array<{ merchant: string; monthlyAvg: number }>;
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
    interestRate: number;
    minimumPayment: number | null;
    monthsToPayoff: number | null;
    totalInterestRemaining: number | null;
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
}

async function gatherFinancialData(
  tenantId: string
): Promise<FinancialSnapshot> {
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const priorMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const priorMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
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
      const oldBal = oldSnap[0] ? parseFloat(oldSnap[0].balance) : null;

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
      };
    })
  );

  // Holdings
  const holdingRows = await db
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

  const holdingsData = holdingRows.map((h) => ({
    ticker: h.ticker || "Unknown",
    name: h.secName || "Unknown",
    quantity: parseFloat(h.quantity || "0"),
    value: parseFloat(h.value || "0"),
    costBasis: h.costBasis ? parseFloat(h.costBasis) : null,
    accountName: h.accountName,
  }));

  // Profile
  const [profileRow] = await db
    .select()
    .from(financialProfiles)
    .where(eq(financialProfiles.tenantId, tenantId))
    .limit(1);

  let profile: FinancialSnapshot["profile"] = null;
  if (profileRow) {
    const age = profileRow.dateOfBirth
      ? Math.floor(
          (Date.now() - new Date(profileRow.dateOfBirth).getTime()) /
            (365.25 * 24 * 60 * 60 * 1000)
        )
      : null;
    profile = {
      annualIncome: profileRow.annualIncome
        ? parseFloat(profileRow.annualIncome)
        : null,
      filingStatus: profileRow.filingStatus,
      stateOfResidence: profileRow.stateOfResidence,
      riskTolerance: profileRow.riskTolerance,
      retirementAge: profileRow.retirementAge,
      employerMatchPercent: profileRow.employerMatch
        ? parseFloat(profileRow.employerMatch)
        : null,
      age,
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
    if (a.type === "credit" || a.type === "loan") {
      totalLiabilities += a.balance;
      if (a.type === "credit") totalCredit += a.balance;
      if (a.type === "loan") totalLoan += a.balance;
    } else {
      totalAssets += a.balance;
      if (a.type === "depository") totalDepository += a.balance;
      if (a.type === "investment") totalInvestment += a.balance;
    }
  }

  // Spending: current and prior month
  const [currentSpendRows, priorSpendRows] = await Promise.all([
    db
      .select({
        category: transactions.category,
        total: sql<string>`coalesce(sum(${transactions.amount}), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.tenantId, tenantId),
          sql`${transactions.amount} > 0`,
          sql`${transactions.category} NOT IN ('income', 'transfer')`,
          sql`${transactions.date} >= ${currentMonthStart.toISOString()}`
        )
      )
      .groupBy(transactions.category),
    db
      .select({
        category: transactions.category,
        total: sql<string>`coalesce(sum(${transactions.amount}), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.tenantId, tenantId),
          sql`${transactions.amount} > 0`,
          sql`${transactions.category} NOT IN ('income', 'transfer')`,
          sql`${transactions.date} >= ${priorMonthStart.toISOString()}`,
          sql`${transactions.date} <= ${priorMonthEnd.toISOString()}`
        )
      )
      .groupBy(transactions.category),
  ]);

  // Top merchants current month
  const topMerchantRows = await db
    .select({
      merchant: transactions.merchantName,
      total: sql<string>`coalesce(sum(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.tenantId, tenantId),
        sql`${transactions.amount} > 0`,
        sql`${transactions.category} NOT IN ('income', 'transfer')`,
        sql`${transactions.merchantName} IS NOT NULL`,
        sql`${transactions.date} >= ${currentMonthStart.toISOString()}`
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
    .where(
      and(
        eq(transactions.tenantId, tenantId),
        sql`${transactions.amount} > 0`,
        sql`${transactions.category} IN ('subscriptions', 'entertainment')`,
        sql`${transactions.merchantName} IS NOT NULL`,
        sql`${transactions.date} >= ${threeMonthsAgo.toISOString()}`
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
      .where(
        and(
          eq(transactions.tenantId, tenantId),
          sql`${transactions.category} = 'income'`,
          sql`${transactions.date} >= ${currentMonthStart.toISOString()}`
        )
      ),
    db
      .select({
        total: sql<string>`coalesce(sum(abs(${transactions.amount})), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.tenantId, tenantId),
          sql`${transactions.category} = 'income'`,
          sql`${transactions.date} >= ${priorMonthStart.toISOString()}`,
          sql`${transactions.date} <= ${priorMonthEnd.toISOString()}`
        )
      ),
  ]);

  const monthlyIncomeCurrent = parseFloat(currentIncomeRow[0]?.total ?? "0");
  const monthlyIncomePrior = parseFloat(priorIncomeRow[0]?.total ?? "0");
  const annualIncomeFromProfile = profileRow?.annualIncome
    ? parseFloat(profileRow.annualIncome)
    : 0;
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
  const goalsRows = await db
    .select()
    .from(goals)
    .where(
      and(eq(goals.tenantId, tenantId), eq(goals.status, "active"))
    );

  const goalsData = goalsRows.map((g) => {
    const target = parseFloat(g.targetAmount);
    const current = parseFloat(g.currentAmount);
    const remaining = target - current;
    let projectedCompletion: string | null = null;

    if (monthlySurplus > 0 && remaining > 0) {
      const monthsToGo = Math.ceil(remaining / monthlySurplus);
      const projDate = new Date();
      projDate.setMonth(projDate.getMonth() + monthsToGo);
      projectedCompletion = projDate.toISOString().slice(0, 7);
    } else if (remaining <= 0) {
      projectedCompletion = "completed";
    }

    return {
      name: g.name,
      targetAmount: target,
      currentAmount: current,
      deadline: g.deadline ? g.deadline.toISOString().slice(0, 10) : null,
      status: g.status,
      projectedCompletionDate: projectedCompletion,
    };
  });

  // Debt trajectory
  const debtAccounts = accountsWithBalances.filter(
    (a) => a.type === "credit" || a.type === "loan"
  );

  const debtTrajectory = debtAccounts.map((a) => {
    const meta = a.metadata || {};
    const rate =
      typeof meta.interestRate === "number" ? meta.interestRate : 0;
    const minPayment =
      typeof meta.minimumPayment === "number" ? meta.minimumPayment : null;
    const balance = Math.abs(a.balance);

    let monthsToPayoff: number | null = null;
    let totalInterestRemaining: number | null = null;

    if (minPayment && minPayment > 0 && balance > 0) {
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
      currentMonth: currentSpendRows.map((r) => ({
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
    },
    goals: goalsData,
    debtTrajectory,
  };
}

const INSIGHTS_PROMPT = `You are Lasagna's financial insights engine. Analyze the user's complete financial data and generate as many actionable insights as the data warrants — there is NO limit.

CRITICAL RULES:
1. Every insight MUST include at least one specific dollar amount or percentage from the actual data
2. Every insight MUST include a comparison (vs last month, vs target, vs a benchmark, vs a threshold)
3. Every insight MUST end with a concrete next step
4. NEVER generate an insight from a lens if that lens has no data (e.g., skip spending insights if spending arrays are empty)
5. NEVER make factually incorrect statements — double-check all tax bracket thresholds against the user's actual income
6. The dollar amount in the insight title MUST match the dollar amount in the impact field. Do not use different numbers in different fields for the same thing.
7. When calculating opportunity costs, use a single consistent spread percentage throughout the insight.

Analyze through these 4 lenses and generate insights from each lens WHERE THE DATA SUPPORTS IT:

---

## Lens 1: SPENDING
SKIP THIS ENTIRE LENS if spending.currentMonth is empty or has fewer than 3 categories.
If data exists:
- Compare each spending category vs prior month. Flag categories up >20% AND >$50 in absolute terms.
- Calculate dining (food_dining) to groceries ratio. National benchmark is 1.1x. Flag if >2x.
- Sum all recurring charges and report total + count.
- Flag if total expenses increased month-over-month by >10%.

## Lens 2: PROGRESS
- For each active goal: is projectedCompletionDate before or after deadline? State the gap in months.
- Calculate savings rate (summary.savingsRateCurrent). ONLY report savings rate if summary.monthlyExpensesCurrent > 0 (there is actual spending data). If monthlyExpensesCurrent is 0, skip all savings rate insights — this means no transaction data is available.
- For each debt with a minimumPayment: show months to payoff and total interest cost remaining. Calculate what $100/mo extra saves.
- If monthly surplus is negative, this is CRITICAL — include it.

## Lens 3: OPTIMIZATION (tax + contributions)
Apply each rule ONLY if the condition is precisely met — do NOT generate the insight if the condition is false:

- **Employer match**: ONLY if employerMatchPercent > 0. Calculate missed annual match = (employerMatchPercent/100) * annualIncome.
- **HSA**: ONLY if NO account with subtype containing "hsa" or "health savings". Missed deduction = $4,300/yr (single) or $8,550/yr (married_joint).
- **Roth IRA**: ONLY if annualIncome < $161,000 (single) or < $240,000 (married_joint). Do NOT assume they haven't contributed just because they have a balance — only flag this if it seems like a worthwhile reminder based on their income level and existing Roth balance relative to annual limits.
- **Roth conversion**: ONLY if traditional IRA/401k balance > 0. Roth conversions have no income limit. The insight should compare their marginal tax rate now vs expected rate in retirement. For high earners ($150k+), note that the conversion will be taxed at their current marginal rate and they should consult a tax advisor for optimal conversion amounts.
- **0% LTCG harvest**: ONLY if annualIncome < $47,025 (single) or < $94,050 (married_joint) AND taxable brokerage has holdings. At income above these thresholds, gains are taxed at 15%+ — do NOT suggest 0% rate.
- **Max 401(k)**: If no 401k account exists or 401k balance is very low relative to income (less than 1x annual income), suggest contributing toward the $23,500/yr limit for pre-tax savings.
- **W-4 withholding check**: ONLY if profile.employmentType is "w2". Suggest reviewing W-4 withholding — over-withholding gives the IRS an interest-free loan, under-withholding causes a surprise bill. The IRS withholding estimator takes 15 minutes. Urgency: low. Impact label: "Optimize cash flow".
- **High-APR debt** (>7%): paying this off is a guaranteed X% return — flag if interest rate exceeds this.
- **Cash drag**: If depository + money market balances exceed 12 months of income AND there are investment accounts available, calculate the opportunity cost. Use: excess_cash = total_cash - (6 * monthly_income); opportunity_cost = excess_cash * 0.03 (3% spread between cash yield ~5% and expected market return ~8%). Show the specific dollar opportunity cost per year.

## Lens 4: BEHAVIORAL
SKIP THIS ENTIRE LENS if spending.currentMonth is empty or summary.monthlyExpensesCurrent is 0.
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
    "title": "Specific title with a real number from the data",
    "description": "2-3 sentences with exact numbers. Include one comparison. End with one concrete next step.",
    "impact": "Short label: 'Save $2,400/yr' or 'Earn $3,400 free money' etc.",
    "impactColor": "green" | "amber" | "red",
    "chatPrompt": "Natural question the user would ask"
  }
]

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

Generate insights for every lens that has meaningful data. Aim for 6-10 insights total.`;

export async function generateInsights(tenantId: string): Promise<number> {
  const data = await gatherFinancialData(tenantId);

  if (data.accounts.length === 0) return 0;

  const dataJson = JSON.stringify(data, null, 2);

  let model: ReturnType<typeof getModel>;
  try {
    model = getModel();
  } catch {
    console.error("Insights engine: AI model not available");
    return 0;
  }

  const result = await generateText({
    model,
    system: INSIGHTS_PROMPT,
    prompt: `Here is the user's complete financial data:\n\n${dataJson}`,
    temperature: 0.3,
    maxOutputTokens: 4000,
  });

  let generated: GeneratedInsight[];
  try {
    let text = result.text.trim();
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) text = jsonMatch[0];
    generated = JSON.parse(text);
    if (!Array.isArray(generated)) throw new Error("Not an array");
  } catch (e) {
    console.error("Insights engine: Failed to parse AI response:", e);
    console.error("Raw response:", result.text);
    return 0;
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
  const validColors = ["green", "amber", "red"];
  const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

  let insertCount = 0;
  for (const ins of generated) {
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
      title: ins.title || "Financial insight",
      description: ins.description || "",
      impact: ins.impact || null,
      impactColor: validColors.includes(ins.impactColor)
        ? ins.impactColor
        : null,
      chatPrompt: ins.chatPrompt || null,
      generatedBy: "ai",
      insightType: ins.type || "general",
      sourceData: dataJson,
      expiresAt: new Date(Date.now() + NINETY_DAYS),
    });
    insertCount++;
  }

  return insertCount;
}
