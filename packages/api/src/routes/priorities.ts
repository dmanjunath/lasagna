import { Hono } from "hono";
import { eq, desc, and, sql, accounts, balanceSnapshots, financialProfiles, transactions } from "@lasagna/core";
import { db } from "../lib/db.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { z } from "zod";

export const priorityRoutes = new Hono<AuthEnv>();
priorityRoutes.use("*", requireAuth);

// GET / - Calculate personalized financial priorities
priorityRoutes.get("/", async (c) => {
  const session = c.get("session");

  // Fetch all data in parallel
  const [accts, profile] = await Promise.all([
    // Get accounts with latest balances
    (async () => {
      const allAccounts = await db.query.accounts.findMany({
        where: eq(accounts.tenantId, session.tenantId),
      });
      return Promise.all(
        allAccounts.map(async (acct) => {
          const latest = await db.query.balanceSnapshots.findFirst({
            where: eq(balanceSnapshots.accountId, acct.id),
            orderBy: [desc(balanceSnapshots.snapshotAt)],
          });
          return {
            ...acct,
            balance: parseFloat(latest?.balance ?? "0"),
          };
        })
      );
    })(),
    db.query.financialProfiles.findFirst({
      where: eq(financialProfiles.tenantId, session.tenantId),
    }),
  ]);

  // Calculate financial state
  const annualIncome = parseFloat(profile?.annualIncome ?? "0");
  const monthlyIncome = annualIncome / 12;
  const employerMatch = parseFloat(profile?.employerMatch ?? "0");
  const age =
    profile?.dateOfBirth
      ? Math.floor(
          (Date.now() - new Date(profile.dateOfBirth).getTime()) /
            (365.25 * 24 * 60 * 60 * 1000)
        )
      : null;
  const filingStatus = profile?.filingStatus ?? null;
  const retirementAge = profile?.retirementAge ?? 65;

  // Categorize accounts
  let cashTotal = 0;
  let investmentTotal = 0;
  let hsaBalance = 0;
  let rothIraBalance = 0;
  let trad401kBalance = 0;
  let brokerageBalance = 0;
  const highInterestDebts: Array<{
    name: string;
    balance: number;
    rate: number;
  }> = [];
  const mediumInterestDebts: Array<{
    name: string;
    balance: number;
    rate: number;
  }> = [];

  for (const acct of accts) {
    const balance = Math.abs(acct.balance);
    if (acct.type === "depository") {
      cashTotal += acct.balance;
    } else if (acct.type === "investment") {
      investmentTotal += acct.balance;
      const sub = (acct.subtype || acct.name || "").toLowerCase();
      if (sub.includes("hsa") || sub.includes("health"))
        hsaBalance += acct.balance;
      else if (sub.includes("roth") && sub.includes("ira"))
        rothIraBalance += acct.balance;
      else if (
        sub.includes("401") ||
        sub.includes("403") ||
        sub.includes("457")
      )
        trad401kBalance += acct.balance;
      else brokerageBalance += acct.balance;
    } else if (acct.type === "credit" || acct.type === "loan") {
      let rate = 0;
      try {
        if (acct.metadata) {
          const meta = JSON.parse(acct.metadata);
          rate = meta.interestRate || 0;
        }
      } catch {
        // ignore malformed metadata
      }

      if (rate > 7) {
        highInterestDebts.push({ name: acct.name, balance, rate });
      } else if (rate >= 4) {
        mediumInterestDebts.push({ name: acct.name, balance, rate });
      }
    }
  }

  // Get monthly expenses from real transaction data (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const [txnResult] = await db
    .select({ total: sql<string>`coalesce(sum(${transactions.amount}), 0)` })
    .from(transactions)
    .where(and(
      eq(transactions.tenantId, session.tenantId),
      sql`${transactions.amount} > 0`,
      sql`${transactions.category} != 'transfer'`,
      sql`${transactions.date} >= ${thirtyDaysAgo.toISOString().split('T')[0]}`,
    ));
  const realMonthlyExpenses = parseFloat(txnResult?.total ?? "0");
  const hasTransactionData = realMonthlyExpenses > 0;
  // Use real data if available, otherwise 0 (don't fabricate)
  const monthlyExpenses = hasTransactionData ? realMonthlyExpenses : 0;

  const isOver50 = age !== null && age >= 50;
  const isMarried = filingStatus === "married_joint";

  const steps = [];
  let order = 1;

  // Step 1: Cover Insurance Deductibles
  // First, build a small buffer equal to your max out-of-pocket — typically $1,500–$2,000
  const deductibleTarget = 1500;
  const deductiblePct = Math.min(1, cashTotal / deductibleTarget);
  steps.push({
    id: "cover_deductibles",
    order: order++,
    title: "Cover Insurance Deductibles",
    subtitle: "Initial $1,500 emergency buffer",
    icon: "shield",
    status:
      deductiblePct >= 1
        ? "complete"
        : cashTotal > 0
          ? "in_progress"
          : "not_started",
    current: Math.round(Math.min(cashTotal, deductibleTarget)),
    target: deductibleTarget,
    progress: Math.round(deductiblePct * 100),
    action:
      deductiblePct >= 1
        ? "Initial buffer is covered — keep these funds liquid!"
        : `Save $${Math.round(deductibleTarget - Math.min(cashTotal, deductibleTarget)).toLocaleString()} more in a checking or HYSA`,
    detail:
      "Before anything else, have enough cash to cover your insurance deductibles so an emergency doesn't derail your finances.",
    priority: "critical",
  });

  // Step 2: Capture Employer Match — 100% guaranteed ROI
  if (employerMatch > 0) {
    const matchContribution = monthlyIncome * (employerMatch / 100);
    const annualMatch = matchContribution * 12;
    steps.push({
      id: "employer_match",
      order: order++,
      title: "Capture Full Employer Match",
      subtitle: `${employerMatch}% match — 100% guaranteed ROI`,
      icon: "gift",
      status: trad401kBalance > 0 ? "in_progress" : "not_started",
      current: null,
      target: Math.round(annualMatch),
      progress: trad401kBalance > 0 ? 50 : 0,
      action: `Contribute at least ${employerMatch}% ($${Math.round(matchContribution).toLocaleString()}/mo) to your 401(k) to get the full match`,
      detail: `Your employer matches ${employerMatch}% — that's $${Math.round(annualMatch).toLocaleString()}/yr in free money. No investment beats a 100% instant return.`,
      priority: "critical",
    });
  }

  // Step 3: Eliminate High-Interest Debt (>6% APR)
  const totalHighDebt = highInterestDebts.reduce(
    (s, d) => s + d.balance,
    0
  );
  if (totalHighDebt > 0) {
    steps.push({
      id: "high_interest_debt",
      order: order++,
      title: "Eliminate High-Interest Debt",
      subtitle: `${highInterestDebts.length} debt${highInterestDebts.length > 1 ? "s" : ""} above 6% APR`,
      icon: "flame",
      status: "in_progress",
      current: Math.round(totalHighDebt),
      target: 0,
      progress: 0,
      action: `Pay off $${Math.round(totalHighDebt).toLocaleString()} using the avalanche method (highest rate first)`,
      detail: highInterestDebts
        .map(
          (d) =>
            `${d.name}: $${Math.round(d.balance).toLocaleString()} at ${d.rate}%`
        )
        .join(" · "),
      priority: "high",
      debts: highInterestDebts,
    });
  }

  // Step 4: Build Full Emergency Reserves (3–6 months)
  const emergencyTarget = monthlyExpenses > 0 ? monthlyExpenses * 6 : monthlyIncome * 3;
  const emergencyPct =
    emergencyTarget > 0 ? Math.min(1, cashTotal / emergencyTarget) : 0;
  // Only show if deductible step is done
  if (deductiblePct >= 1 || cashTotal > deductibleTarget) {
    steps.push({
      id: "emergency_fund",
      order: order++,
      title: "Build Full Emergency Reserve",
      subtitle: "3–6 months of expenses in a HYSA",
      icon: "shield",
      status:
        emergencyPct >= 1
          ? "complete"
          : cashTotal > deductibleTarget
            ? "in_progress"
            : "not_started",
      current: Math.round(cashTotal),
      target: Math.round(emergencyTarget),
      progress: Math.round(emergencyPct * 100),
      action:
        emergencyPct >= 1
          ? "Emergency fund fully funded — you're protected!"
          : `Save $${Math.round(Math.max(0, emergencyTarget - cashTotal)).toLocaleString()} more in a high-yield savings account`,
      detail: monthlyExpenses > 0
        ? `Target: $${Math.round(emergencyTarget).toLocaleString()} (6 × $${Math.round(monthlyExpenses).toLocaleString()}/mo expenses). Keep in a high-yield savings account.`
        : `Target: $${Math.round(emergencyTarget).toLocaleString()} (3 × monthly income). Connect a bank account for a precise target.`,
      priority: "critical",
    });
  }

  // Step 5a: Max Out Roth IRA (tax-free growth)
  const rothMax = isOver50 ? 8000 : 7000;
  const incomeLimit = isMarried ? 240000 : 161000;
  const overIncomeLimit = annualIncome > incomeLimit;
  steps.push({
    id: "max_roth_ira",
    order: order++,
    title: overIncomeLimit ? "Backdoor Roth IRA" : "Max Out Roth IRA",
    subtitle: "Tax-free growth forever",
    icon: "sprout",
    status: rothIraBalance > 0 ? "in_progress" : "not_started",
    current: Math.round(rothIraBalance),
    target: rothMax,
    progress:
      rothMax > 0
        ? Math.min(100, Math.round((rothIraBalance / rothMax) * 100))
        : 0,
    action: overIncomeLimit
      ? `Use backdoor Roth conversion — your income ($${Math.round(annualIncome).toLocaleString()}) exceeds the $${incomeLimit.toLocaleString()} direct limit`
      : `Contribute up to $${rothMax.toLocaleString()}/yr to a Roth IRA`,
    detail: overIncomeLimit
      ? "Contribute to a non-deductible Traditional IRA, then convert to Roth (pro-rata rule may apply — check with your tax advisor)."
      : "Contributions grow 100% tax-free. Withdrawals in retirement are tax-free. Best vehicle for long-term wealth.",
    priority: "medium",
  });

  // Step 5b: Max Out HSA (triple tax advantage)
  const hsaMax = isMarried ? 8550 : 4300;
  steps.push({
    id: "max_hsa",
    order: order++,
    title: "Max Out HSA",
    subtitle: "Triple tax advantage",
    icon: "heart-pulse",
    status: hsaBalance > 0 ? "in_progress" : "not_started",
    current: Math.round(hsaBalance),
    target: hsaMax,
    progress:
      hsaMax > 0
        ? Math.min(100, Math.round((hsaBalance / hsaMax) * 100))
        : 0,
    action: `Contribute up to $${hsaMax.toLocaleString()}/yr to your HSA`,
    detail:
      "The only account with triple tax advantages: contributions are deductible, growth is tax-free, and withdrawals for medical costs are tax-free. Invest it for retirement.",
    priority: "high",
  });

  // Step 6: Max Out 401(k) beyond match
  const max401k = isOver50 ? 31000 : 23500;
  if (employerMatch > 0 || trad401kBalance > 0) {
    steps.push({
      id: "max_401k",
      order: order++,
      title: "Max Out 401(k)",
      subtitle: "Beyond employer match",
      icon: "trending-up",
      status: trad401kBalance > 0 ? "in_progress" : "not_started",
      current: Math.round(trad401kBalance),
      target: max401k,
      progress:
        max401k > 0
          ? Math.min(100, Math.round((trad401kBalance / max401k) * 100))
          : 0,
      action: `Increase 401(k) contributions toward the $${max401k.toLocaleString()}/yr max`,
      detail: isOver50
        ? "Includes $7,500 catch-up contribution for age 50+. Pre-tax or Roth 401(k) contributions reduce taxable income now or later."
        : "After capturing the match, continue increasing contributions to the annual limit. Every dollar reduces your tax bill today.",
      priority: "medium",
    });
  }

  // Step 7: Hyper-accumulate — target 25% savings rate
  const monthlySavings = hasTransactionData ? Math.max(0, monthlyIncome - realMonthlyExpenses) : null;
  const savingsRate = monthlySavings !== null && monthlyIncome > 0
    ? Math.round((monthlySavings / monthlyIncome) * 100)
    : null;
  const savingsRateTarget = 25;
  steps.push({
    id: "hyper_accumulate",
    order: order++,
    title: "Hyper-Accumulate",
    subtitle: "Save 25% of gross income",
    icon: "rocket",
    status:
      savingsRate !== null
        ? savingsRate >= savingsRateTarget
          ? "complete"
          : savingsRate > 0
            ? "in_progress"
            : "not_started"
        : "not_started",
    current: savingsRate,
    target: savingsRateTarget,
    progress: savingsRate !== null ? Math.min(100, Math.round((savingsRate / savingsRateTarget) * 100)) : 0,
    action:
      savingsRate !== null
        ? savingsRate >= savingsRateTarget
          ? `You're saving ${savingsRate}% — outstanding! Keep maximizing tax-advantaged accounts then deploy surplus.`
          : `Increase savings rate from ${savingsRate}% to ${savingsRateTarget}% by cutting expenses or boosting income`
        : "Connect bank accounts and set your income in profile to track your savings rate",
    detail:
      "Targeting 25% of gross income as your savings rate means every working year finances 3+ years of retirement.",
    priority: "low",
  });

  // Step 8: Pay Down Medium/Low-Interest Debt
  const totalMedDebt = mediumInterestDebts.reduce(
    (s, d) => s + d.balance,
    0
  );
  if (totalMedDebt > 0) {
    steps.push({
      id: "medium_interest_debt",
      order: order++,
      title: "Pay Down Lower-Interest Debt",
      subtitle: `${mediumInterestDebts.length} debt${mediumInterestDebts.length > 1 ? "s" : ""} at 4–6% APR`,
      icon: "credit-card",
      status: "in_progress",
      current: Math.round(totalMedDebt),
      target: 0,
      progress: 0,
      action: `Pay down $${Math.round(totalMedDebt).toLocaleString()} in lower-interest debt — or invest if your expected returns exceed the rate`,
      detail: mediumInterestDebts
        .map(
          (d) =>
            `${d.name}: $${Math.round(d.balance).toLocaleString()} at ${d.rate}%`
        )
        .join(" · "),
      priority: "low",
      debts: mediumInterestDebts,
    });
  }

  // Step 9: Invest Surplus in Taxable Brokerage
  steps.push({
    id: "taxable_investing",
    order: order++,
    title: "Invest Surplus in Brokerage",
    subtitle: "Low-cost index funds",
    icon: "trending-up",
    status: brokerageBalance > 0 ? "in_progress" : "not_started",
    current: Math.round(brokerageBalance),
    target: null,
    progress: brokerageBalance > 0 ? 100 : 0,
    action:
      brokerageBalance > 0
        ? `You have $${Math.round(brokerageBalance).toLocaleString()} invested — keep adding surplus here`
        : "After maxing tax-advantaged accounts, invest remaining surplus in a taxable brokerage using low-cost total market index funds",
    detail:
      "Use tax-efficient funds (VTI, VXUS, BND). Consider tax-loss harvesting. Any surplus beyond 25% savings rate goes here.",
    priority: "low",
  });

  // Load skipped steps from profile
  const skippedSet = new Set<string>(profile?.skippedPrioritySteps ?? []);

  // Mark skipped on each step (skipped overrides in_progress/not_started but not complete)
  const stepsWithSkip = steps.map((s) => ({
    ...s,
    skipped: s.status !== "complete" && skippedSet.has(s.id),
  }));

  // Find the "current step" — the first non-complete, non-skipped step
  const currentStepId =
    stepsWithSkip.find((s) => s.status !== "complete" && !s.skipped)?.id ||
    stepsWithSkip[stepsWithSkip.length - 1].id;

  return c.json({
    steps: stepsWithSkip,
    currentStepId,
    summary: {
      monthlyIncome: Math.round(monthlyIncome),
      monthlyExpenses: hasTransactionData ? Math.round(monthlyExpenses) : null,
      monthlySurplus: hasTransactionData ? Math.round(monthlyIncome - monthlyExpenses) : null,
      totalCash: Math.round(cashTotal),
      totalInvested: Math.round(investmentTotal),
      totalHighInterestDebt: Math.round(totalHighDebt),
      totalMediumInterestDebt: Math.round(totalMedDebt),
      age,
      retirementAge,
      filingStatus,
    },
  });
});

// PATCH /skip — toggle skipped status for a step
const skipSchema = z.object({
  stepId: z.string().min(1).max(100),
  skipped: z.boolean(),
});

priorityRoutes.patch("/skip", async (c) => {
  const session = c.get("session");
  const raw = await c.req.json();
  const parsed = skipSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid request" }, 400);
  }
  const { stepId, skipped } = parsed.data;

  // Get or create profile
  let profile = await db.query.financialProfiles.findFirst({
    where: eq(financialProfiles.tenantId, session.tenantId),
  });

  const currentSkipped = new Set<string>(profile?.skippedPrioritySteps ?? []);
  if (skipped) {
    currentSkipped.add(stepId);
  } else {
    currentSkipped.delete(stepId);
  }
  const updatedArray = [...currentSkipped];

  if (profile) {
    await db
      .update(financialProfiles)
      .set({ skippedPrioritySteps: updatedArray })
      .where(eq(financialProfiles.tenantId, session.tenantId));
  } else {
    await db.insert(financialProfiles).values({
      tenantId: session.tenantId,
      skippedPrioritySteps: updatedArray,
    });
  }

  return c.json({ ok: true, skippedSteps: updatedArray });
});
